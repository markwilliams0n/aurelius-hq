import { NextResponse } from "next/server";
import { chat, type Message } from "@/lib/ai/client";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";

const SYSTEM_PROMPT = `You are Aurelius, an AI assistant helping triage and process incoming items.

You are currently helping the user with a specific triage item. You can help them:
- Add context or facts to memory about people, companies, or projects mentioned
- Create tasks or action items
- Snooze the item for later
- Extract and summarize key information
- Provide context from memory about mentioned entities

When the user wants to add something to memory, extract:
- Entity name and type (person, company, project)
- The fact or context to remember
- Category: status, preference, relationship, context, milestone

Respond conversationally but concisely. If you take an action, confirm what you did.

If you need to trigger an action, include it in your response as JSON at the end:
{"action": "snooze", "duration": "1d"} or {"action": "memory", "entity": "...", "fact": "..."}`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { itemId, item, message, history = [] } = body;

    if (!message) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    // Build context from item
    const itemContext = `
Current triage item:
- Type: ${item.connector}
- From: ${item.senderName || item.sender}
- Subject: ${item.subject}
- Preview: ${item.preview?.slice(0, 500) || item.content?.slice(0, 500)}
`;

    // Build messages for the AI
    const messages: Message[] = [
      { role: "user", content: `Context:\n${itemContext}` },
      ...history.slice(-10).map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: message },
    ];

    const result = await chat(messages, SYSTEM_PROMPT);

    let response = result;
    let action = null;
    let actionData = null;

    // Check for action JSON at the end of response
    const actionMatch = response.match(/\{[^}]*"action"[^}]*\}\s*$/);
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
