"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/aurelius/chat-message";
import { ChatInput } from "@/components/aurelius/chat-input";
import { AppShell } from "@/components/aurelius/app-shell";
import { ChatMemoryPanel } from "@/components/aurelius/chat-memory-panel";
import { ToolPanel, PanelContent } from "@/components/aurelius/tool-panel";
import { toast } from "sonner";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatStats = {
  model: string;
  tokenCount: number;
  factsSaved: number;
};

const STORAGE_KEY = "aurelius_conversation_id";

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
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load conversation on mount
  useEffect(() => {
    const loadConversation = async () => {
      const savedId = localStorage.getItem(STORAGE_KEY);
      if (savedId) {
        try {
          const response = await fetch(`/api/conversation/${savedId}`);
          if (response.ok) {
            const data = await response.json();
            setConversationId(savedId);
            setMessages(data.messages || []);
            setStats((prev) => ({
              ...prev,
              model: data.model || prev.model,
              factsSaved: data.factsSaved || 0,
            }));
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        } catch (error) {
          console.error("Failed to load conversation:", error);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setIsLoading(false);
    };

    loadConversation();
  }, []);

  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(STORAGE_KEY, conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setStats((prev) => ({ ...prev, tokenCount: 0, factsSaved: 0 }));
    setToolPanelContent(null);
    localStorage.removeItem(STORAGE_KEY);
    toast.success("Started new conversation");
  };

  const fetchPendingChange = async (changeId: string) => {
    try {
      const response = await fetch(`/api/config/pending/${changeId}`);
      if (response.ok) {
        const data = await response.json();
        const pending = data.pending;
        setToolPanelContent({
          type: "config_diff",
          key: pending.key,
          reason: pending.reason,
          currentContent: pending.currentContent,
          proposedContent: pending.proposedContent,
          pendingChangeId: pending.id,
        });
      }
    } catch (error) {
      console.error("Failed to fetch pending change:", error);
    }
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

  const handleSend = async (content: string) => {
    if (!content.trim() || isStreaming) return;

    streamingContentRef.current = "";

    const userMessage: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "" }]);
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
                }
              } else if (data.type === "tool_result") {
                // Parse the result and show appropriate panel
                try {
                  const result = JSON.parse(data.result);
                  if (currentToolName === "read_config" && result.content !== undefined) {
                    setToolPanelContent({
                      type: "config_view",
                      key: result.key,
                      description: result.description || "",
                      content: result.content,
                      version: result.version,
                      createdBy: result.createdBy,
                      createdAt: result.createdAt,
                    });
                  } else if (currentToolName === "propose_config_change" && result.pendingChangeId) {
                    // Fetch the pending change details
                    fetchPendingChange(result.pendingChangeId);
                  } else {
                    setToolPanelContent({
                      type: "tool_result",
                      toolName: currentToolName || "unknown",
                      result: data.result,
                    });
                  }
                } catch {
                  setToolPanelContent({
                    type: "tool_result",
                    toolName: currentToolName || "unknown",
                    result: data.result,
                  });
                }
                setCurrentToolName(null);
              } else if (data.type === "pending_change") {
                fetchPendingChange(data.changeId);
              } else if (data.type === "memories") {
                setStats((prev) => ({
                  ...prev,
                  factsSaved: prev.factsSaved + data.memories.length,
                }));
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
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
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

  // Determine which sidebar to show
  const rightSidebar = toolPanelContent ? (
    <ToolPanel
      content={toolPanelContent}
      onClose={handleCloseToolPanel}
      onApprove={handleApproveChange}
      onReject={handleRejectChange}
    />
  ) : (
    <ChatMemoryPanel />
  );

  return (
    <AppShell rightSidebar={rightSidebar} wideSidebar={!!toolPanelContent}>
      <div className="flex flex-col h-screen">
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
              {messages.map((message, index) => (
                <ChatMessage key={index} message={message} />
              ))}
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
