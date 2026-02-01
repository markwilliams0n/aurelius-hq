"use client";

import { useState, useRef, useEffect } from "react";
import { Header } from "@/components/aurelius/header";
import { ChatMessage } from "@/components/aurelius/chat-message";
import { ChatInput } from "@/components/aurelius/chat-input";
import { toast } from "sonner";

type Message = {
  role: "user" | "assistant";
  content: string;
  memories?: Array<{ factId: string; content: string }>;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (content: string) => {
    if (!content.trim() || isStreaming) return;

    // Add user message
    const userMessage: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    // Add placeholder for assistant
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

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
      let currentMemories: Array<{ factId: string; content: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "text") {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage.role === "assistant") {
                    lastMessage.content += data.content;
                  }
                  return newMessages;
                });
              } else if (data.type === "memories") {
                currentMemories = data.memories;
              } else if (data.type === "conversation") {
                setConversationId(data.id);
              } else if (data.type === "done") {
                // Update with memories
                if (currentMemories.length > 0) {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage.role === "assistant") {
                      lastMessage.memories = currentMemories;
                    }
                    return newMessages;
                  });
                }
              } else if (data.type === "error") {
                toast.error(data.message);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Failed to send message");
      // Remove placeholder message
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleUndo = async (factId: string) => {
    try {
      const response = await fetch(`/api/memory/${factId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to undo");
      }

      // Remove memory from message
      setMessages((prev) =>
        prev.map((msg) => ({
          ...msg,
          memories: msg.memories?.filter((m) => m.factId !== factId),
        }))
      );

      toast.success("Memory removed");
    } catch (error) {
      console.error("Undo error:", error);
      toast.error("Failed to undo memory");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
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
              <ChatMessage
                key={index}
                message={message}
                onUndo={handleUndo}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="sticky bottom-0 py-4 bg-background">
          <ChatInput onSend={handleSend} disabled={isStreaming} />
        </div>
      </main>
    </div>
  );
}
