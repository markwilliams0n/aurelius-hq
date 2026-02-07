"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/aurelius/chat-message";
import { ChatInput } from "@/components/aurelius/chat-input";
import { ChatStatus } from "@/components/aurelius/chat-status";
import { AppShell } from "@/components/aurelius/app-shell";
import { ChatMemoryPanel } from "@/components/aurelius/chat-memory-panel";
import { ToolPanel, PanelContent } from "@/components/aurelius/tool-panel";
import { ActionCard } from "@/components/aurelius/action-card";
import { CardContent } from "@/components/aurelius/cards/card-content";
import type { ActionCardData } from "@/lib/types/action-card";
import { FileText } from "lucide-react";
import { toast } from "sonner";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// Generate unique message ID
const generateMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

type ChatStats = {
  model: string;
  tokenCount: number;
  factsSaved: number;
};

const SHARED_CONVERSATION_ID = "00000000-0000-0000-0000-000000000000"; // Shared between web and Telegram


export function ChatClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [stats, setStats] = useState<ChatStats>({
    model: "",
    tokenCount: 0,
    factsSaved: 0,
  });
  const [toolPanelContent, setToolPanelContent] = useState<PanelContent>(null);
  const [panelWidth, setPanelWidth] = useState(384);
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const [actionCards, setActionCards] = useState<Map<string, ActionCardData[]>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");
  const currentAssistantIdRef = useRef<string>("");

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load conversation from API
  const loadConversation = useCallback(async (isInitial = false) => {
    try {
      const response = await fetch(`/api/conversation/${SHARED_CONVERSATION_ID}`);
      if (response.ok) {
        const data = await response.json();
        // Add IDs to loaded messages if they don't have them
        const loadedMessages = (data.messages || []).map((m: Partial<Message> & { role: Message["role"]; content: string }, i: number) => ({
          ...m,
          id: m.id || `loaded-${i}-${Date.now()}`,
        }));
        // Only update if message count changed (avoid re-render during streaming)
        setMessages((prev) => {
          if (prev.length !== loadedMessages.length) {
            return loadedMessages;
          }
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
          // Build a set of known message IDs for matching
          const messageIdSet = new Set(loadedMessages.map((m: Message) => m.id));
          const lastAssistantMsg = [...loadedMessages].reverse().find((m: Message) => m.role === "assistant");
          const fallbackId = lastAssistantMsg?.id || "orphan";
          for (const card of data.actionCards as ActionCardData[]) {
            // Match card to its original message if the ID is stable,
            // otherwise fall back to the last assistant message
            const targetId = card.messageId && messageIdSet.has(card.messageId)
              ? card.messageId
              : fallbackId;
            const existing = cardMap.get(targetId) || [];
            existing.push(card);
            cardMap.set(targetId, existing);
          }
          setActionCards(cardMap);
        }
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
    if (isInitial) {
      setConversationId(SHARED_CONVERSATION_ID);
      setIsLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadConversation(true);
  }, [loadConversation]);

  // Poll for new messages every 3 seconds (for Telegram sync)
  useEffect(() => {
    if (isStreaming) return; // Don't poll while streaming

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadConversation();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [loadConversation, isStreaming]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleNewChat = async () => {
    // Clear the shared conversation (affects both web and Telegram)
    try {
      await fetch(`/api/conversation/${SHARED_CONVERSATION_ID}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("Failed to clear conversation:", error);
    }
    setMessages([]);
    setActionCards(new Map());
    setConversationId(SHARED_CONVERSATION_ID);
    setStats((prev) => ({ ...prev, tokenCount: 0, factsSaved: 0 }));
    setToolPanelContent(null);
    toast.success("Started new conversation");
  };

  const fetchPendingChange = useCallback(async (changeId: string) => {
    console.log("[Chat] fetchPendingChange called with:", changeId);
    try {
      const response = await fetch(`/api/config/pending/${changeId}`);
      console.log("[Chat] fetchPendingChange response status:", response.status);
      if (response.ok) {
        const data = await response.json();
        console.log("[Chat] fetchPendingChange data:", data);
        const pending = data.pending;
        setToolPanelContent({
          type: "config_diff",
          key: pending.key,
          reason: pending.reason,
          currentContent: pending.currentContent,
          proposedContent: pending.proposedContent,
          pendingChangeId: pending.id,
        });
      } else {
        console.error("[Chat] fetchPendingChange failed:", response.status, await response.text());
      }
    } catch (error) {
      console.error("Failed to fetch pending change:", error);
    }
  }, []);

  const handleApproveChange = async (id: string) => {
    const response = await fetch(`/api/config/pending/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (response.ok) {
      setToolPanelContent(null);
    } else {
      throw new Error("Failed to approve");
    }
  };

  const handleRejectChange = async (id: string) => {
    const response = await fetch(`/api/config/pending/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    if (response.ok) {
      setToolPanelContent(null);
    } else {
      throw new Error("Failed to reject");
    }
  };

  const handleCloseToolPanel = () => {
    setToolPanelContent(null);
  };

  const handleSend = async (content: string) => {
    if (!content.trim() || isStreaming) return;

    streamingContentRef.current = "";
    setHasError(false);

    const userMessage: Message = { id: generateMessageId(), role: "user", content };
    const assistantMessage: Message = { id: generateMessageId(), role: "assistant", content: "" };
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
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

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

              if (data.type === "text") {
                streamingContentRef.current += data.content;
                const newContent = streamingContentRef.current;

                setMessages((prev) => {
                  const lastIdx = prev.length - 1;
                  const lastMessage = prev[lastIdx];
                  if (lastMessage?.role === "assistant") {
                    return [
                      ...prev.slice(0, lastIdx),
                      { ...lastMessage, content: newContent },
                    ];
                  }
                  return prev;
                });
              } else if (data.type === "tool_use") {
                setCurrentToolName(data.toolName);
                // Show a loading state in the panel
                if (data.toolName === "read_config" || data.toolName === "list_configs") {
                  setToolPanelContent({
                    type: "tool_result",
                    toolName: data.toolName,
                    result: "Loading...",
                  });
                } else if (data.toolName === "propose_config_change") {
                  setToolPanelContent({
                    type: "tool_result",
                    toolName: data.toolName,
                    result: "Preparing proposed changes...",
                  });
                }
              } else if (data.type === "tool_result") {
                // Parse the result and show appropriate panel
                // Use data.toolName from the event (not React state) to avoid timing issues
                const toolName = data.toolName || currentToolName || "unknown";
                try {
                  const result = JSON.parse(data.result);
                  if (toolName === "read_config" && result.content !== undefined) {
                    setToolPanelContent({
                      type: "config_view",
                      key: result.key,
                      description: result.description || "",
                      content: result.content,
                      version: result.version,
                      createdBy: result.createdBy,
                      createdAt: result.createdAt,
                    });
                  } else if (toolName === "propose_config_change" && result.pendingChangeId) {
                    // Fetch the pending change details
                    console.log("[Chat] propose_config_change result, fetching pending:", result.pendingChangeId);
                    fetchPendingChange(result.pendingChangeId);
                  } else {
                    setToolPanelContent({
                      type: "tool_result",
                      toolName,
                      result: data.result,
                    });
                  }
                } catch {
                  setToolPanelContent({
                    type: "tool_result",
                    toolName,
                    result: data.result,
                  });
                }
                setCurrentToolName(null);
              } else if (data.type === "pending_change") {
                console.log("[Chat] pending_change event received:", data.changeId);
                fetchPendingChange(data.changeId);
              } else if (data.type === "memories") {
                setStats((prev) => ({
                  ...prev,
                  factsSaved: prev.factsSaved + data.memories.length,
                }));
              } else if (data.type === "assistant_message_id") {
                // Server provides a stable message ID for card<->message association
                const oldId = currentAssistantIdRef.current;
                const newId = data.id as string;
                currentAssistantIdRef.current = newId;
                setMessages((prev) =>
                  prev.map((m) => (m.id === oldId ? { ...m, id: newId } : m))
                );
                // Move any cards already attached to old ID
                setActionCards((prev) => {
                  const cards = prev.get(oldId);
                  if (!cards) return prev;
                  const next = new Map(prev);
                  next.delete(oldId);
                  next.set(newId, cards);
                  return next;
                });
              } else if (data.type === "conversation") {
                setConversationId(data.id);
              } else if (data.type === "stats") {
                setStats((prev) => ({
                  ...prev,
                  model: data.model || prev.model,
                  tokenCount: data.tokenCount || prev.tokenCount,
                }));
              } else if (data.type === "error") {
                toast.error(data.message);
              } else if (data.type === "action_card") {
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
              }
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
          if (data.type === "text") {
            streamingContentRef.current += data.content;
            const newContent = streamingContentRef.current;
            setMessages((prev) => {
              const lastIdx = prev.length - 1;
              const lastMessage = prev[lastIdx];
              if (lastMessage?.role === "assistant") {
                return [
                  ...prev.slice(0, lastIdx),
                  { ...lastMessage, content: newContent },
                ];
              }
              return prev;
            });
          }
        } catch {
          // Skip invalid JSON
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Failed to send message");
      setHasError(true);
      // Remove the empty assistant message on error
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleActionCardAction = useCallback(
    async (cardId: string, actionName: string, editedData?: Record<string, unknown>) => {
      try {
        const response = await fetch(`/api/action-card/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, data: editedData }),
        });
        if (!response.ok) throw new Error("Action failed");
        const result = await response.json();

        // Update the card in local state
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

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </AppShell>
    );
  }

  const handleOpenDailyNotes = () => {
    setToolPanelContent({ type: "daily_notes" });
  };

  // Determine which sidebar to show
  const rightSidebar = toolPanelContent ? (
    <ToolPanel
      content={toolPanelContent}
      onClose={handleCloseToolPanel}
      onApprove={handleApproveChange}
      onReject={handleRejectChange}
      width={panelWidth}
      onWidthChange={setPanelWidth}
    />
  ) : (
    <ChatMemoryPanel />
  );

  return (
    <AppShell rightSidebar={rightSidebar} wideSidebar={!!toolPanelContent} sidebarWidth={panelWidth}>
      <div className="flex flex-col h-screen">
        {/* Status bar - sticky header */}
        <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm px-6 py-2 sticky top-0 z-10">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleNewChat}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                New chat
              </button>
              <button
                onClick={handleOpenDailyNotes}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                Notes
              </button>
            </div>
            <ChatStatus stats={stats} />
          </div>
        </div>

        {/* Messages area - scrollable, takes remaining space */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <h2 className="font-serif text-2xl text-gold mb-2">
                  Aurelius
                </h2>
                <p className="text-muted-foreground">
                  Start a conversation...
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isAssistantStreaming = isStreaming && isLastMessage && message.role === "assistant";
                const showError = hasError && isLastMessage && message.role === "assistant";
                const cards = actionCards.get(message.id);
                return (
                  <div key={message.id}>
                    <ChatMessage
                      message={message}
                      isStreaming={isAssistantStreaming}
                      hasError={showError}
                    />
                    {cards?.map((card) => (
                      <div key={card.id} className="ml-11">
                        <ActionCard
                          card={card}
                          onAction={(action, editedData) => handleActionCardAction(card.id, action, editedData ?? card.data)}
                        >
                          <CardContent
                            card={card}
                            onDataChange={(newData) => {
                              setActionCards((prev) => {
                                const next = new Map(prev);
                                for (const [msgId, cards] of next) {
                                  const idx = cards.findIndex((c) => c.id === card.id);
                                  if (idx >= 0) {
                                    const updated = [...cards];
                                    updated[idx] = { ...updated[idx], data: newData };
                                    next.set(msgId, updated);
                                    break;
                                  }
                                }
                                return next;
                              });
                            }}
                            onAction={(action, data) => handleActionCardAction(card.id, action, data ?? card.data)}
                          />
                        </ActionCard>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input - fixed at bottom */}
        <div className="shrink-0 border-t border-border bg-background px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput onSend={handleSend} disabled={isStreaming} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
