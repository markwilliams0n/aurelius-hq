import { NextResponse } from "next/server";
import { chat } from "@/lib/ai/client";
import { buildAgentContext } from "@/lib/ai/context";
import { emitMemoryEvent } from "@/lib/memory/events";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";

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

When the user wants to add something to memory, extract:
- Entity name and type (person, company, project)
- The fact or context to remember
- Category: status, preference, relationship, context, milestone

If you need to trigger an action, include it in your response as JSON at the end:
{"action": "snooze", "duration": "1d"} or {"action": "memory", "entity": "...", "fact": "..."}

When the user asks to modify, add, remove, or update tasks, respond with a complete updated task list as JSON:
{"action": "update_tasks", "tasks": [{"description": "Task description", "assignee": "Name or null", "assigneeType": "self", "dueDate": null, "confidence": "high"}]}
The assigneeType should be "self" for user's own tasks or "other" for tasks assigned to others.
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
