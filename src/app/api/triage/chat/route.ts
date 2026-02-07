import { NextResponse } from "next/server";
import { chat } from "@/lib/ai/client";
import { buildAgentContext } from "@/lib/ai/context";
import { emitMemoryEvent } from "@/lib/memory/events";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";
import { resolveUser, resolveChannel, getDirectory } from "@/lib/slack/directory";

/**
 * Triage chat uses the same context building as main chat,
 * with additional triage-specific context and actions.
 */

const TRIAGE_CONTEXT = `
You are currently helping the user with a specific triage item. You can:
- Answer questions about this item using your memory
- Add facts to memory about people, companies, or projects mentioned
- Create tasks or action items
- Snooze the item for later
- Send a Slack message (DM or channel post)

When the user wants to add something to memory, extract:
- Entity name and type (person, company, project)
- The fact or context to remember
- Category: status, preference, relationship, context, milestone

If you need to trigger an action, include it in your response as JSON at the end:
{"action": "snooze", "duration": "1d"} or {"action": "memory", "entity": "...", "fact": "..."}

When the user asks to modify, add, remove, or update tasks, respond with a complete updated task list as JSON:
{"action": "update_tasks", "tasks": [{"description": "Task description", "assignee": "Name or null", "assigneeType": "self", "dueDate": null, "confidence": "high"}]}
The assigneeType should be "self" for user's own tasks or "other" for tasks assigned to others.

When the user wants to send a Slack message, respond with a draft and include this JSON at the end:
{"action": "send_slack_message", "to": "person name or #channel", "message": "message in Slack mrkdwn format"}
- For DMs, use the person's first name (e.g. "harvy", "mark")
- For channels, use #channel-name (e.g. "#general")
- Messages use Slack mrkdwn: *bold*, _italic_, \`code\`
- Always draft first — the user will see a confirmation card before sending
`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { itemId, item, message, history = [] } = body;

    if (!message) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    // Build item context
    const itemContext = `
Current triage item:
- Type: ${item.connector}
- From: ${item.senderName || item.sender}
- Subject: ${item.subject}
- Preview: ${item.preview?.slice(0, 500) || item.content?.slice(0, 500)}
`;

    // Use shared context builder with triage-specific additions
    const { systemPrompt } = await buildAgentContext({
      query: `${item.subject} ${item.senderName || item.sender} ${message}`,
      additionalContext: `${TRIAGE_CONTEXT}\n${itemContext}`,
    });

    // Build messages (include recent history)
    const messages = [
      ...history.slice(-10).map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user" as const, content: message },
    ];

    const result = await chat(messages, systemPrompt);

    let response = result;
    let action = null;
    let actionData = null;

    // Check for action JSON at the end of response (supports nested objects like tasks arrays)
    const actionMatch = response.match(/\{"action"[\s\S]*\}\s*$/);
    if (actionMatch) {
      try {
        const actionJson = JSON.parse(actionMatch[0]);
        action = actionJson.action;
        actionData = actionJson;

        // Remove action JSON from response
        response = response.replace(actionMatch[0], "").trim();

        // Execute memory action if requested
        if (action === "memory" && actionJson.entity && actionJson.fact) {
          await saveFactToMemory(actionJson.entity, actionJson.entityType || "person", actionJson.fact, itemId);
          response += "\n\n*Saved to memory*";
        }

        // Resolve Slack message action — build action card data for the client
        if (action === "send_slack_message" && actionJson.to && actionJson.message) {
          const slackCard = await buildSlackActionCard(actionJson.to, actionJson.message);
          if (slackCard) {
            actionData = { ...actionData, actionCard: slackCard };
          }
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Emit chat response event for debug analysis
    emitMemoryEvent({
      eventType: 'recall',
      trigger: 'chat',
      summary: `Triage chat response for: "${message.slice(0, 60)}"`,
      payload: {
        userMessage: message.slice(0, 1000),
        assistantResponse: response.slice(0, 2000),
        responseLength: response.length,
        itemId,
        connector: item?.connector,
        action,
      },
      metadata: { phase: 'response', source: 'triage-chat' },
    }).catch(() => {});

    return NextResponse.json({
      response,
      action,
      actionData,
    });
  } catch (error) {
    console.error("Triage chat error:", error);
    return NextResponse.json(
      { error: "Failed to process chat", response: "Sorry, I encountered an error. Please try again." },
      { status: 500 }
    );
  }
}

async function buildSlackActionCard(to: string, message: string) {
  try {
    const directory = await getDirectory();
    if (!directory) return null;

    const isChannel = to.startsWith("#");
    const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Use directory cache, fall back to env if stale
    const myUserId = directory.myUserId || process.env.SLACK_MY_USER_ID || '';

    if (isChannel) {
      const channel = await resolveChannel(to);
      if (!channel) return { error: `Channel "${to}" not found` };

      return {
        id: cardId,
        cardType: "slack_message" as const,
        status: "pending" as const,
        data: {
          recipientType: "channel",
          recipientId: channel.id,
          recipientName: `#${channel.name}`,
          channelName: channel.name,
          includeMe: true,
          message,
          myUserId,
        },
        actions: ["send", "cancel"],
      };
    } else {
      const resolved = await resolveUser(to);
      if (!resolved.found) {
        if (resolved.suggestions.length > 0) {
          return { error: `Ambiguous: ${resolved.suggestions.map(u => u.realName).join(", ")}` };
        }
        return { error: `User "${to}" not found` };
      }

      return {
        id: cardId,
        cardType: "slack_message" as const,
        status: "pending" as const,
        data: {
          recipientType: "dm",
          recipientId: resolved.user.id,
          recipientName: resolved.user.realName || resolved.user.displayName,
          recipient: resolved.user.realName || resolved.user.displayName,
          includeMe: true,
          message,
          myUserId,
        },
        actions: ["send", "cancel"],
      };
    }
  } catch (error) {
    console.error("[Triage Chat] Failed to build Slack action card:", error);
    return null;
  }
}

async function saveFactToMemory(
  entityName: string,
  entityType: "person" | "company" | "project",
  factContent: string,
  sourceId: string
) {
  try {
    const entity = await upsertEntity(entityName, entityType, {});
    await createFact(entity.id, factContent, "context", "chat", sourceId);
    return true;
  } catch (error) {
    console.error("Failed to save fact:", error);
    return false;
  }
}
