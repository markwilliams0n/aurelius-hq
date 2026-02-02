"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/aurelius/chat-message";
import { ChatInput } from "@/components/aurelius/chat-input";
import { ChatStatus } from "@/components/aurelius/chat-status";
import { AppShell } from "@/components/aurelius/app-shell";
import { ChatMemoryPanel } from "@/components/aurelius/chat-memory-panel";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    localStorage.removeItem(STORAGE_KEY);
    toast.success("Started new conversation");
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

  return (
    <AppShell rightSidebar={<ChatMemoryPanel />}>
      <div className="flex-1 flex flex-col h-screen">
        {/* Status bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border">
          <ChatStatus stats={stats} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center h-full min-h-[400px]">
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
            messages.map((message, index) => (
              <ChatMessage key={index} message={message} />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-border">
          <ChatInput onSend={handleSend} disabled={isStreaming} />
        </div>
      </div>
    </AppShell>
  );
}
