import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { chat } from "@/lib/ai/client";
import { buildAgentContext } from "@/lib/ai/context";
import { createCard, generateCardId } from "@/lib/action-cards/db";

/**
 * POST /api/vault/chat — Vault page AI input
 *
 * Simpler than main chat: request/response, no streaming, no memory extraction.
 *
 * Body: { message, history? }
 * Returns { response, action?, actionData? }
 */

const VAULT_CONTEXT = `
You are currently helping the user manage their personal vault — a filing system for important documents, facts, credentials, and references.

You can:
- Help the user store new items in the vault
- Search for existing items
- Answer questions about stored information
- Suggest tags and organization

When the user wants to save something to the vault, include this JSON at the end of your response:
{"action": "save_to_vault", "content": "the content to save", "title": "suggested title", "type": "document|fact|credential|reference", "sensitive": true/false, "tags": ["tag1", "tag2"]}

When the user asks you to search the vault, include:
{"action": "search_vault", "query": "search terms"}

Rules:
- "credential" type = contains a specific number/ID (passport, SSN, account number)
- "fact" type = a piece of information without a specific ID
- "document" type = longer text content
- "reference" type = a link or pointer
- Mark sensitive=true for SSN, passport numbers, financial account numbers, or identity-theft-risk data
- Always provide a descriptive title (3-8 words)
`;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { message, history = [] } = body;

    if (!message) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    // Use shared context builder with vault-specific additions
    const { systemPrompt } = await buildAgentContext({
      query: message,
      additionalContext: VAULT_CONTEXT,
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
    let actionData: Record<string, unknown> | null = null;

    // Check for action JSON at the end of response
    const actionMatch = response.match(/\{"action"[\s\S]*\}\s*$/);
    if (actionMatch) {
      try {
        const actionJson = JSON.parse(actionMatch[0]);
        action = actionJson.action;
        actionData = actionJson;

        // Remove action JSON from response text
        response = response.replace(actionMatch[0], "").trim();

        // If the action produces an action card, persist it
        if (action === "save_to_vault" && actionJson.content) {
          const card = await createCard({
            id: generateCardId(),
            pattern: "approval",
            handler: "vault:save-item",
            title: actionJson.title || "Save to vault",
            status: "pending",
            data: {
              content: actionJson.content,
              title: actionJson.title,
              type: actionJson.type || "fact",
              sensitive: actionJson.sensitive || false,
              tags: actionJson.tags || [],
            },
          });
          actionData = { ...actionData, actionCard: card };
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
    console.error("[Vault Chat] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to process chat",
        response: "Sorry, I encountered an error. Please try again.",
      },
      { status: 500 }
    );
  }
}
