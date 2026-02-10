"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ActionCardData } from "@/lib/types/action-card";
import type { ChatContext } from "@/lib/types/chat-context";
import { parseSSELines } from "@/lib/sse/client";
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
  const processEvent = useCallback((data: Record<string, unknown>) => {
    switch (data.type as string) {
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
        buffer = parseSSELines(buffer, processEvent);
      }

      // Process remaining buffer
      if (buffer) {
        parseSSELines(buffer + "\n", processEvent);
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

        if (result.status === "needs_confirmation") {
          if (confirm(result.confirmMessage || "Are you sure?")) {
            // Re-send with confirmation flag
            return handleCardAction(cardId, actionName, { ...editedData, _confirmed: true });
          }
          return;
        }

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
