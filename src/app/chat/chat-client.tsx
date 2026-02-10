"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/aurelius/chat-message";
import { ChatInput } from "@/components/aurelius/chat-input";
import { ChatStatus } from "@/components/aurelius/chat-status";
import { AppShell } from "@/components/aurelius/app-shell";
import { ToolPanel, PanelContent } from "@/components/aurelius/tool-panel";
import { ActionCard } from "@/components/aurelius/action-card";
import { CardContent } from "@/components/aurelius/cards/card-content";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/use-chat";

const SHARED_CONVERSATION_ID = "00000000-0000-0000-0000-000000000000"; // Shared between web and Telegram

export function ChatClient() {
  const [toolPanelContent, setToolPanelContent] = useState<PanelContent>(null);
  const [panelWidth, setPanelWidth] = useState(384);
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const {
    messages, isStreaming, isLoading, hasError, actionCards, stats,
    send, clear, handleCardAction, updateCardData,
  } = useChat({
    conversationId: SHARED_CONVERSATION_ID,
    context: { surface: "main" },
    pollInterval: 3000,
    onToolUse: (toolName) => {
      setCurrentToolName(toolName);
      if (toolName === "read_config" || toolName === "list_configs") {
        setToolPanelContent({ type: "tool_result", toolName, result: "Loading..." });
      } else if (toolName === "propose_config_change") {
        setToolPanelContent({ type: "tool_result", toolName, result: "Preparing proposed changes..." });
      }
    },
    onToolResult: (toolName, result) => {
      try {
        const parsed = JSON.parse(result);
        if (toolName === "read_config" && parsed.content !== undefined) {
          setToolPanelContent({
            type: "config_view",
            key: parsed.key,
            description: parsed.description || "",
            content: parsed.content,
            version: parsed.version,
            createdBy: parsed.createdBy,
            createdAt: parsed.createdAt,
          });
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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleNewChat = async () => {
    await clear();
    setToolPanelContent(null);
    toast.success("Started new conversation");
  };

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

  const handleOpenDailyNotes = () => {
    setToolPanelContent({ type: "daily_notes" });
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </AppShell>
    );
  }

  // Show tool panel sidebar only when there's active content
  const rightSidebar = toolPanelContent ? (
    <ToolPanel
      content={toolPanelContent}
      onClose={handleCloseToolPanel}
      onApprove={handleApproveChange}
      onReject={handleRejectChange}
      width={panelWidth}
      onWidthChange={setPanelWidth}
    />
  ) : null;

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
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input - fixed at bottom */}
        <div className="shrink-0 border-t border-border bg-background px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput onSend={send} disabled={isStreaming} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
