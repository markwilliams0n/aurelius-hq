# Chat Across App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify all chat surfaces (main, triage, Cmd+K) to share one API endpoint, one React hook, and one set of capabilities — so improvements anywhere apply everywhere.

**Architecture:** Extract a `useChat` hook from the main chat client. All surfaces call `/api/chat` with a `context` object that drives surface-specific behavior (system prompt injection, memory overrides). Delete the separate `/api/triage/chat` route.

**Tech Stack:** Next.js, React hooks, SSE streaming, OpenRouter, Drizzle ORM, Supermemory

**Linear:** PER-188

**Design doc:** `docs/plans/2026-02-07-chat-across-app-design.md`

---

### Task 1: Add ChatContext type and update API route to accept context

**Files:**
- Create: `src/lib/types/chat-context.ts`
- Modify: `src/app/api/chat/route.ts`

**Step 1: Create the ChatContext type**

Create `src/lib/types/chat-context.ts`:

```typescript
export type ChatSurface = "main" | "triage" | "panel";

export interface TriageItemContext {
  connector: string;
  sender: string;
  senderName?: string;
  subject: string;
  content?: string;
  preview?: string;
}

export interface ChatContext {
  surface: ChatSurface;
  triageItem?: TriageItemContext;
  pageContext?: string;
  overrides?: {
    skipSupermemory?: boolean;
  };
}
```

**Step 2: Update `/api/chat/route.ts` to accept context**

In `src/app/api/chat/route.ts`, change the request destructuring from:

```typescript
const { message, conversationId } = await request.json();
```

to:

```typescript
const { message, conversationId, context } = await request.json();
```

Pass context to `buildAgentContext`:

```typescript
const { systemPrompt } = await buildAgentContext({ query: message, context });
```

Pass context to `extractAndSaveMemories`:

```typescript
await extractAndSaveMemories(message, fullResponse, context);
```

**Step 3: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

This will fail because `buildAgentContext` and `extractAndSaveMemories` don't accept context yet — that's expected. Just verify no unrelated errors.

**Step 4: Commit**

```bash
git add src/lib/types/chat-context.ts src/app/api/chat/route.ts
git commit -m "feat(chat): add ChatContext type and accept context in chat API"
```

---

### Task 2: Update buildAgentContext for surface-specific context injection

**Files:**
- Modify: `src/lib/ai/context.ts`

**Step 1: Update AgentContextOptions to accept ChatContext**

In `src/lib/ai/context.ts`, add the import and update the options type:

```typescript
import type { ChatContext } from '@/lib/types/chat-context';

export interface AgentContextOptions {
  query: string;
  modelId?: string;
  additionalContext?: string;
  context?: ChatContext;
}
```

**Step 2: Add surface context builder function**

Add a function that builds surface-specific additional context:

```typescript
function buildSurfaceContext(context?: ChatContext): string | null {
  if (!context) return null;

  switch (context.surface) {
    case "triage": {
      if (!context.triageItem) return null;
      const item = context.triageItem;
      return `You are currently helping the user with a specific triage item.

Current triage item:
- Type: ${item.connector}
- From: ${item.senderName || item.sender}
- Subject: ${item.subject}
- Preview: ${(item.preview || item.content || "").slice(0, 500)}

You can help the user with this item using your available tools — send Slack messages, create Linear tasks, save information to memory, update configuration, etc. Use the tools naturally based on what the user asks.`;
    }

    case "panel": {
      if (!context.pageContext) return null;
      return `The user is chatting via the quick-access panel. Page context: ${context.pageContext}`;
    }

    default:
      return null;
  }
}
```

**Step 3: Wire it into buildAgentContext**

In the `buildAgentContext` function, after the existing `additionalContext` append, add:

```typescript
// Append surface-specific context
const surfaceContext = buildSurfaceContext(options.context);
if (surfaceContext) {
  systemPrompt += `\n\n${surfaceContext}`;
}
```

Place this right after the existing `if (additionalContext)` block.

**Step 4: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

Expected: passes (or only the extraction.ts error from Task 1 remains).

**Step 5: Commit**

```bash
git add src/lib/ai/context.ts
git commit -m "feat(chat): surface-specific context injection in buildAgentContext"
```

---

### Task 3: Update extractAndSaveMemories to respect context overrides

**Files:**
- Modify: `src/lib/memory/extraction.ts`

**Step 1: Add context parameter**

Update the function signature:

```typescript
import type { ChatContext } from '@/lib/types/chat-context';

export async function extractAndSaveMemories(
  userMessage: string,
  assistantResponse: string,
  context?: ChatContext
): Promise<void> {
```

**Step 2: Conditionally skip Supermemory**

Replace the existing `addMemory` call with:

```typescript
// Send to Supermemory unless overridden
if (!context?.overrides?.skipSupermemory) {
  addMemory(
    `User: ${userMessage}\nAssistant: ${assistantResponse}`,
    { source: "chat" }
  ).catch((error) => {
    console.error('[Extraction] Supermemory add failed:', error);
    emitMemoryEvent({
      eventType: 'save',
      trigger: 'chat',
      summary: `Supermemory save failed: ${error instanceof Error ? error.message : String(error)}`,
      payload: { error: String(error), content: userMessage.slice(0, 200) },
      metadata: { status: 'error', method: 'supermemory' },
    }).catch(() => {});
  });
}
```

Everything else (daily notes, emit event) stays unchanged.

**Step 3: Update Telegram handler to pass context through**

In `src/lib/telegram/handler.ts`, find the `extractAndSaveMemories` call and ensure it still works (it passes no context, which means no overrides — same behavior as before). No change needed if the parameter is optional.

**Step 4: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

Expected: passes.

**Step 5: Commit**

```bash
git add src/lib/memory/extraction.ts
git commit -m "feat(chat): extractAndSaveMemories respects context overrides"
```

---

### Task 4: Create the useChat hook

**Files:**
- Create: `src/hooks/use-chat.ts`

This is the core of the refactor. Extract all SSE parsing, message state, action card management, and streaming logic from `chat-client.tsx` into a reusable hook.

**Step 1: Create the hook file**

Create `src/hooks/use-chat.ts` with the following structure:

```typescript
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import type { ChatContext } from "@/lib/types/chat-context";
import { toast } from "sonner";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatStats = {
  model: string;
  tokenCount: number;
  factsSaved: number;
};

type SSEEvent = {
  type: string;
  [key: string]: unknown;
};

const generateMessageId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface UseChatOptions {
  conversationId: string;
  context: ChatContext;
  /** Load existing conversation on mount? (default true) */
  loadOnMount?: boolean;
  /** Poll for new messages? (default false — only main chat needs this for Telegram sync) */
  pollInterval?: number;
  /** Callback when a tool_use event arrives */
  onToolUse?: (toolName: string, toolInput: Record<string, unknown>) => void;
  /** Callback when a tool_result event arrives */
  onToolResult?: (toolName: string, result: string) => void;
  /** Callback when a pending_change event arrives */
  onPendingChange?: (changeId: string) => void;
}

export function useChat(options: UseChatOptions) {
  const {
    conversationId,
    context,
    loadOnMount = true,
    pollInterval,
    onToolUse,
    onToolResult,
    onPendingChange,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(loadOnMount);
  const [hasError, setHasError] = useState(false);
  const [actionCards, setActionCards] = useState<Map<string, ActionCardData[]>>(new Map());
  const [stats, setStats] = useState<ChatStats>({ model: "", tokenCount: 0, factsSaved: 0 });

  const streamingContentRef = useRef("");
  const currentAssistantIdRef = useRef("");
  // Store callbacks in refs to avoid stale closures
  const onToolUseRef = useRef(onToolUse);
  const onToolResultRef = useRef(onToolResult);
  const onPendingChangeRef = useRef(onPendingChange);
  onToolUseRef.current = onToolUse;
  onToolResultRef.current = onToolResult;
  onPendingChangeRef.current = onPendingChange;

  // Load conversation from API
  const loadConversation = useCallback(async (isInitial = false) => {
    try {
      const response = await fetch(`/api/conversation/${conversationId}`);
      if (response.ok) {
        const data = await response.json();
        const loadedMessages: ChatMessage[] = (data.messages || []).map(
          (m: Partial<ChatMessage> & { role: ChatMessage["role"]; content: string }, i: number) => ({
            ...m,
            id: m.id || `loaded-${i}-${Date.now()}`,
          })
        );
        setMessages((prev) => {
          if (prev.length !== loadedMessages.length) return loadedMessages;
          return prev;
        });
        setStats((prev) => ({
          ...prev,
          model: data.model || prev.model,
          factsSaved: data.factsSaved || 0,
        }));

        // Hydrate persisted action cards on initial load
        if (data.actionCards?.length > 0 && isInitial) {
          const cardMap = new Map<string, ActionCardData[]>();
          const messageIdSet = new Set(loadedMessages.map((m) => m.id));
          const lastAssistantMsg = [...loadedMessages].reverse().find((m) => m.role === "assistant");
          const fallbackId = lastAssistantMsg?.id || "orphan";
          for (const card of data.actionCards as ActionCardData[]) {
            const targetId = card.messageId && messageIdSet.has(card.messageId)
              ? card.messageId
              : fallbackId;
            const existing = cardMap.get(targetId) || [];
            existing.push(card);
            cardMap.set(targetId, existing);
          }
          setActionCards(cardMap);
        }
      } else if (response.status === 404) {
        // No conversation yet — that's fine for new triage items
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
    if (isInitial) {
      setIsLoading(false);
    }
  }, [conversationId]);

  // Load on mount
  useEffect(() => {
    if (loadOnMount) {
      loadConversation(true);
    } else {
      setIsLoading(false);
    }
  }, [loadConversation, loadOnMount]);

  // Optional polling (for Telegram sync on main chat)
  useEffect(() => {
    if (!pollInterval || isStreaming) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadConversation();
      }
    }, pollInterval);
    return () => clearInterval(interval);
  }, [loadConversation, isStreaming, pollInterval]);

  // Process an SSE event
  const processEvent = useCallback((data: SSEEvent) => {
    switch (data.type) {
      case "text":
        streamingContentRef.current += data.content as string;
        const newContent = streamingContentRef.current;
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          const lastMessage = prev[lastIdx];
          if (lastMessage?.role === "assistant") {
            return [...prev.slice(0, lastIdx), { ...lastMessage, content: newContent }];
          }
          return prev;
        });
        break;

      case "tool_use":
        onToolUseRef.current?.(data.toolName as string, data.toolInput as Record<string, unknown>);
        break;

      case "tool_result":
        onToolResultRef.current?.(
          (data.toolName as string) || "unknown",
          data.result as string
        );
        // Check for action cards in tool results
        try {
          const parsed = JSON.parse(data.result as string);
          if (parsed.action_card) {
            // Card will arrive as its own event from the server
          }
        } catch {
          // Not JSON — fine
        }
        break;

      case "pending_change":
        onPendingChangeRef.current?.(data.changeId as string);
        break;

      case "memories":
        setStats((prev) => ({
          ...prev,
          factsSaved: prev.factsSaved + ((data.memories as unknown[]) || []).length,
        }));
        break;

      case "assistant_message_id": {
        const oldId = currentAssistantIdRef.current;
        const newId = data.id as string;
        currentAssistantIdRef.current = newId;
        setMessages((prev) => prev.map((m) => (m.id === oldId ? { ...m, id: newId } : m)));
        setActionCards((prev) => {
          const cards = prev.get(oldId);
          if (!cards) return prev;
          const next = new Map(prev);
          next.delete(oldId);
          next.set(newId, cards);
          return next;
        });
        break;
      }

      case "conversation":
        // Server assigned/confirmed conversation ID — no-op since we manage it
        break;

      case "stats":
        setStats((prev) => ({
          ...prev,
          model: (data.model as string) || prev.model,
          tokenCount: (data.tokenCount as number) || prev.tokenCount,
        }));
        break;

      case "error":
        toast.error(data.message as string);
        break;

      case "action_card": {
        const card = data.card as ActionCardData;
        const msgId = currentAssistantIdRef.current;
        if (msgId) {
          setActionCards((prev) => {
            const next = new Map(prev);
            const existing = next.get(msgId) || [];
            const idx = existing.findIndex((c) => c.id === card.id);
            if (idx >= 0) {
              const updated = [...existing];
              updated[idx] = card;
              next.set(msgId, updated);
            } else {
              next.set(msgId, [...existing, card]);
            }
            return next;
          });
        }
        break;
      }
    }
  }, []);

  // Send a message
  const send = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    streamingContentRef.current = "";
    setHasError(false);

    const userMessage: ChatMessage = { id: generateMessageId(), role: "user", content };
    const assistantMessage: ChatMessage = { id: generateMessageId(), role: "assistant", content: "" };
    currentAssistantIdRef.current = assistantMessage.id;
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          conversationId,
          context,
        }),
      });

      if (!response.ok) throw new Error("Chat request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              processEvent(data);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6));
          processEvent(data);
        } catch {
          // Skip
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Failed to send message");
      setHasError(true);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, conversationId, context, processEvent]);

  // Clear conversation
  const clear = useCallback(async () => {
    try {
      await fetch(`/api/conversation/${conversationId}`, { method: "DELETE" });
    } catch (error) {
      console.error("Failed to clear conversation:", error);
    }
    setMessages([]);
    setActionCards(new Map());
    setStats((prev) => ({ ...prev, tokenCount: 0, factsSaved: 0 }));
  }, [conversationId]);

  // Handle action card actions
  const handleCardAction = useCallback(
    async (cardId: string, actionName: string, editedData?: Record<string, unknown>) => {
      try {
        const response = await fetch(`/api/action-card/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, data: editedData }),
        });
        if (!response.ok) throw new Error("Action failed");
        const result = await response.json();

        setActionCards((prev) => {
          const next = new Map(prev);
          for (const [msgId, cards] of next) {
            const idx = cards.findIndex((c) => c.id === cardId);
            if (idx >= 0) {
              const updated = [...cards];
              updated[idx] = { ...updated[idx], status: result.status, result: result.result };
              next.set(msgId, updated);
              break;
            }
          }
          return next;
        });

        if (result.status === "confirmed") {
          toast.success(result.successMessage || "Done!");
        } else if (result.status === "error") {
          toast.error(result.result?.error || "Action failed");
        }
      } catch (error) {
        console.error("Action card action failed:", error);
        toast.error("Action failed");
      }
    },
    []
  );

  // Update action card data (for inline editing)
  const updateCardData = useCallback((cardId: string, newData: Record<string, unknown>) => {
    setActionCards((prev) => {
      const next = new Map(prev);
      for (const [msgId, cards] of next) {
        const idx = cards.findIndex((c) => c.id === cardId);
        if (idx >= 0) {
          const updated = [...cards];
          updated[idx] = { ...updated[idx], data: newData };
          next.set(msgId, updated);
          break;
        }
      }
      return next;
    });
  }, []);

  return {
    messages,
    isStreaming,
    isLoading,
    hasError,
    actionCards,
    stats,
    send,
    clear,
    loadConversation,
    handleCardAction,
    updateCardData,
  };
}
```

**Step 2: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

Expected: passes (hook isn't used yet, so no consumers to break).

**Step 3: Commit**

```bash
git add src/hooks/use-chat.ts
git commit -m "feat(chat): create useChat hook — shared engine for all chat surfaces"
```

---

### Task 5: Refactor chat-client.tsx to use useChat hook

**Files:**
- Modify: `src/app/chat/chat-client.tsx`

**Step 1: Replace inline state and SSE parsing with useChat**

Rewrite `chat-client.tsx` to use the hook. The component keeps its layout (AppShell, status bar, memory sidebar, tool panel) but delegates all chat logic to `useChat`.

Key changes:
- Remove: `messages`, `isStreaming`, `isLoading`, `actionCards`, `stats`, `hasError` state
- Remove: `streamingContentRef`, `currentAssistantIdRef`
- Remove: `handleSend` function body (the SSE parsing loop)
- Remove: `handleActionCardAction`
- Remove: `loadConversation` function
- Add: `useChat` call with `onToolUse`, `onToolResult`, `onPendingChange` callbacks for the tool panel
- Keep: tool panel state (`toolPanelContent`), pending change handlers, new chat button, Telegram polling (via `pollInterval`)

The hook call:

```typescript
const SHARED_CONVERSATION_ID = "00000000-0000-0000-0000-000000000000";

const {
  messages, isStreaming, isLoading, hasError, actionCards, stats,
  send, clear, handleCardAction, updateCardData,
} = useChat({
  conversationId: SHARED_CONVERSATION_ID,
  context: { surface: "main" },
  pollInterval: 3000,
  onToolUse: (toolName, toolInput) => {
    setCurrentToolName(toolName);
    if (toolName === "read_config" || toolName === "list_configs") {
      setToolPanelContent({ type: "tool_result", toolName, result: "Loading..." });
    } else if (toolName === "propose_config_change") {
      setToolPanelContent({ type: "tool_result", toolName, result: "Preparing proposed changes..." });
    }
  },
  onToolResult: (toolName, result) => {
    // Same tool panel logic that's currently inline
    try {
      const parsed = JSON.parse(result);
      if (toolName === "read_config" && parsed.content !== undefined) {
        setToolPanelContent({ type: "config_view", key: parsed.key, description: parsed.description || "", content: parsed.content, version: parsed.version, createdBy: parsed.createdBy, createdAt: parsed.createdAt });
      } else if (toolName === "propose_config_change" && parsed.pendingChangeId) {
        fetchPendingChange(parsed.pendingChangeId);
      } else {
        setToolPanelContent({ type: "tool_result", toolName, result });
      }
    } catch {
      setToolPanelContent({ type: "tool_result", toolName, result });
    }
    setCurrentToolName(null);
  },
  onPendingChange: (changeId) => {
    fetchPendingChange(changeId);
  },
});
```

The `handleNewChat` becomes:
```typescript
const handleNewChat = async () => {
  await clear();
  setToolPanelContent(null);
  toast.success("Started new conversation");
};
```

The JSX stays identical — just referencing hook values instead of local state.

**Step 2: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

Expected: passes.

**Step 3: Run dev server and manually test main chat**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && bun run dev`

Test:
- Send a message, verify streaming works
- Verify action cards render
- Verify tool panel works (ask to read a config)
- Verify "New chat" works

**Step 4: Commit**

```bash
git add src/app/chat/chat-client.tsx
git commit -m "refactor(chat): chat-client uses useChat hook — same behavior, less code"
```

---

### Task 6: Refactor chat-panel.tsx (Cmd+K) to use useChat hook

**Files:**
- Modify: `src/components/aurelius/chat-panel.tsx`

**Step 1: Replace inline SSE parsing with useChat**

Rewrite `chat-panel.tsx` to use the hook. Key changes:
- Remove: `messages`, `isStreaming`, `conversationId` state
- Remove: `handleSend` function with its SSE parsing
- Add: `useChat` call with shared conversation ID
- Add: action card rendering below messages (use `ActionCard` + `CardContent` like main chat)

```typescript
import { useChat } from "@/hooks/use-chat";
import { ActionCard } from "./action-card";
import { CardContent } from "./cards/card-content";

const SHARED_CONVERSATION_ID = "00000000-0000-0000-0000-000000000000";

export function ChatPanel({ isOpen, onClose, context }: { ... }) {
  const {
    messages, isStreaming, isLoading, actionCards,
    send, handleCardAction, updateCardData,
  } = useChat({
    conversationId: SHARED_CONVERSATION_ID,
    context: {
      surface: "panel",
      pageContext: context,
    },
  });

  const handleSend = (content: string) => {
    send(content);
  };

  // ... rest of component with same layout
  // Add action card rendering in the messages loop
}
```

In the messages map, add action card rendering:

```tsx
{messages.map((message, index) => {
  const cards = actionCards.get(message.id);
  return (
    <div key={message.id || index}>
      <ChatMessage message={message} isStreaming={isStreaming && index === messages.length - 1 && message.role === "assistant"} />
      {cards?.map((card) => (
        <div key={card.id} className="ml-11 mt-2">
          <ActionCard
            card={card}
            onAction={(action, editedData) => handleCardAction(card.id, action, editedData ?? card.data)}
          >
            <CardContent
              card={card}
              onDataChange={(newData) => updateCardData(card.id, newData)}
              onAction={(action, data) => handleCardAction(card.id, action, data ?? card.data)}
            />
          </ActionCard>
        </div>
      ))}
    </div>
  );
})}
```

**Step 2: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

**Step 3: Manually test Cmd+K**

- Press Cmd+K from any page
- Send a message, verify streaming
- Verify messages also appear on /chat page (shared conversation)
- Verify action cards render if the agent uses a tool

**Step 4: Commit**

```bash
git add src/components/aurelius/chat-panel.tsx
git commit -m "refactor(chat): Cmd+K panel uses useChat hook, gains action cards"
```

---

### Task 7: Rewrite triage-chat.tsx to use useChat hook + shared components

**Files:**
- Modify: `src/components/aurelius/triage-chat.tsx`

This is the biggest change. The triage chat goes from non-streaming + custom UI + JSON action hack to streaming + shared components + real tools.

**Step 1: Rewrite triage-chat.tsx**

Replace the entire component to use `useChat` with triage context:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { X, Brain } from "lucide-react";
import { TriageItem } from "./triage-card";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { ActionCard } from "./action-card";
import { CardContent } from "./cards/card-content";
import { useChat } from "@/hooks/use-chat";

interface TriageChatProps {
  item: TriageItem;
  onClose: () => void;
  onAction?: (action: string, data?: unknown) => void;
}

export function TriageChat({ item, onClose, onAction }: TriageChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages, isStreaming, isLoading, actionCards,
    send, handleCardAction, updateCardData,
  } = useChat({
    conversationId: `triage-${item.id}`,
    context: {
      surface: "triage",
      triageItem: {
        connector: item.connector,
        sender: item.sender,
        senderName: item.senderName,
        subject: item.subject,
        content: item.content,
        preview: item.preview,
      },
    },
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-[600px] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            <h2 className="font-semibold">Chat about this item</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Item summary */}
        <div className="px-4 py-2 border-b border-border bg-secondary/20 text-sm">
          <div className="font-medium truncate">{item.subject}</div>
          <div className="text-muted-foreground text-xs">
            {item.connector} · {item.senderName || item.sender}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Loading...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Ask anything about this item...</p>
            </div>
          ) : (
            messages.map((message, index) => {
              const cards = actionCards.get(message.id);
              const isLast = index === messages.length - 1;
              return (
                <div key={message.id}>
                  <ChatMessage
                    message={message}
                    isStreaming={isStreaming && isLast && message.role === "assistant"}
                  />
                  {cards?.map((card) => (
                    <div key={card.id} className="ml-11 mt-2">
                      <ActionCard
                        card={card}
                        onAction={(action, editedData) => handleCardAction(card.id, action, editedData ?? card.data)}
                      >
                        <CardContent
                          card={card}
                          onDataChange={(newData) => updateCardData(card.id, newData)}
                          onAction={(action, data) => handleCardAction(card.id, action, data ?? card.data)}
                        />
                      </ActionCard>
                    </div>
                  ))}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border bg-background">
          <ChatInput onSend={send} disabled={isStreaming} />
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span>Enter to send</span>
            <span>Shift+Enter for new line</span>
            <span>Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note: The `onAction` prop is kept in the interface for now but not used — the real tools handle everything. It can be removed in a cleanup pass once we verify nothing depends on it.

**Step 2: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

**Step 3: Manually test triage chat**

- Open a triage item, click chat
- Send a message — verify streaming works
- Verify markdown renders (bold, lists, links)
- Ask it to send a Slack message — verify action card appears
- Close and reopen — verify conversation persists
- Verify memories are saved (check daily notes or Supermemory)

**Step 4: Commit**

```bash
git add src/components/aurelius/triage-chat.tsx
git commit -m "refactor(chat): triage chat uses useChat hook — gains streaming, tools, markdown, persistence"
```

---

### Task 8: Delete the old triage chat API route

**Files:**
- Delete: `src/app/api/triage/chat/route.ts`

**Step 1: Verify no other code references the triage chat API**

Search for `/api/triage/chat` in the codebase. After Task 7, `triage-chat.tsx` no longer calls it. Verify nothing else does.

**Step 2: Delete the file**

```bash
rm "/Users/markwilliamson/Claude Code/aurelius-hq/src/app/api/triage/chat/route.ts"
```

**Step 3: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

Expected: passes.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(chat): delete old /api/triage/chat route — replaced by unified /api/chat"
```

---

### Task 9: Handle triage conversation ID format in the API

**Files:**
- Modify: `src/app/api/chat/route.ts`

The triage chat uses `triage-{itemId}` as conversation IDs (not UUIDs). The existing API tries to look up conversations by UUID. We need to handle creation of new conversations with string IDs.

**Step 1: Update conversation lookup/creation**

In the chat API route, the conversation lookup already works with any string ID (Drizzle `eq` doesn't care about format). But we need to handle the case where a triage conversation doesn't exist yet — create it with the provided ID instead of auto-generating.

Update the conversation creation block at the end of the stream. Currently it does:

```typescript
if (conversationId) {
  await db.update(conversations)...
} else {
  const [newConv] = await db.insert(conversations)...
}
```

Change to:

```typescript
if (conversationId) {
  // Try update first
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (existing) {
    await db.update(conversations)
      .set({ messages: newStoredMessages, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  } else {
    // First message in this conversation — create it with the provided ID
    await db.insert(conversations)
      .values({ id: conversationId, messages: newStoredMessages });
  }
} else {
  // No conversation ID provided — auto-generate
  const [newConv] = await db.insert(conversations)
    .values({ messages: newStoredMessages })
    .returning();
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ type: "conversation", id: newConv.id })}\n\n`)
  );
}
```

**Step 2: Run type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

**Step 3: Test triage chat persistence**

- Open triage item, send message
- Close modal, reopen — verify conversation loaded
- Send another message — verify it appends correctly

**Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): handle triage conversation IDs — create-on-first-message"
```

---

### Task 10: Final verification and cleanup

**Step 1: Full type check**

Run: `cd "/Users/markwilliamson/Claude Code/aurelius-hq" && npx tsc --noEmit`

**Step 2: Test all three surfaces**

1. **Main chat (/chat):** Send message, verify streaming, tools, action cards, memory sidebar, Telegram sync
2. **Cmd+K (any page):** Press Cmd+K, send message, verify streaming, action cards, verify message shows up on /chat page
3. **Triage modal:** Open triage item, send message, verify streaming, markdown, tools, action cards, persistence

**Step 3: Verify memory extraction**

- Send a message from triage chat
- Check that daily notes updated
- Check that Supermemory received the memory

**Step 4: Check for leftover references**

Search for:
- `/api/triage/chat` — should have zero hits
- `saveFactToMemory` — should only exist if referenced elsewhere
- `buildAndPersistSlackCard` — should be gone

**Step 5: Clean up any unused imports**

Remove dead imports from modified files if type check didn't catch them.

**Step 6: Final commit if any cleanup**

```bash
git add -A
git commit -m "chore(chat): cleanup unused imports and references"
```
