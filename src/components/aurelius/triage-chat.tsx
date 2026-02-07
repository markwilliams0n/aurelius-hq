"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Brain, Clock, CheckCircle, Loader2 } from "lucide-react";
import { TriageItem } from "./triage-card";
import { ActionCard } from "./action-card";
import { SlackMessageCardContent } from "./cards/slack-message-card";
import type { ActionCardData } from "@/lib/types/action-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TriageChatProps {
  item: TriageItem;
  onClose: () => void;
  onAction?: (action: string, data?: any) => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function TriageChat({ item, onClose, onAction }: TriageChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionCards, setActionCards] = useState<Map<string, ActionCardData>>(new Map());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Add initial context message
  useEffect(() => {
    const contextMessage: ChatMessage = {
      id: "context",
      role: "assistant",
      content: `I can help you with this ${item.connector} item from **${item.senderName || item.sender}**.

What would you like to do?
- Add context to memory
- Create a task or project
- Snooze for later
- Extract key information
- Something else?`,
      timestamp: new Date(),
    };
    setMessages([contextMessage]);
  }, [item]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/triage/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          item: {
            connector: item.connector,
            sender: item.sender,
            senderName: item.senderName,
            subject: item.subject,
            content: item.content,
            preview: item.preview,
          },
          message: input,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response || "I couldn't process that request. Please try again.",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Handle any actions the AI suggested
      if (data.action && onAction) {
        onAction(data.action, data.actionData);
      }

      // If the response includes an action card (e.g. Slack message), display it
      if (data.actionData?.actionCard && !data.actionData.actionCard.error) {
        const card = data.actionData.actionCard as ActionCardData;
        setActionCards((prev) => new Map(prev).set(assistantMessage.id, card));
      }
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, item, messages, onAction]);

  const handleCardAction = useCallback(
    async (cardId: string, actionName: string, cardData: Record<string, unknown>) => {
      try {
        const response = await fetch(`/api/action-card/${cardId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, data: cardData }),
        });
        if (!response.ok) throw new Error("Action failed");
        const result = await response.json();

        // Update the card in state
        setActionCards((prev) => {
          const next = new Map(prev);
          for (const [msgId, card] of next) {
            if (card.id === cardId) {
              next.set(msgId, { ...card, status: result.status, resultUrl: result.resultUrl, error: result.error });
              break;
            }
          }
          return next;
        });

        if (result.status === "sent") {
          toast.success("Slack message sent!");
        } else if (result.status === "error") {
          toast.error(result.error || "Failed to send");
        }
      } catch (error) {
        console.error("Card action failed:", error);
        toast.error("Failed to send");
      }
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-[600px] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            <h2 className="font-semibold">Chat about this item</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
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
          {messages.map((message) => {
            const card = actionCards.get(message.id);
            return (
              <div key={message.id}>
                <div
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-4 py-2 text-sm",
                      message.role === "user"
                        ? "bg-gold text-background"
                        : "bg-secondary border border-border"
                    )}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </div>
                </div>
                {card && (
                  <div className="mt-2 max-w-[80%]">
                    <ActionCard
                      card={card}
                      onAction={(action, editedData) => handleCardAction(card.id, action, editedData ?? card.data)}
                    >
                      <SlackMessageCardContent
                        card={card}
                        onDataChange={(newData) => {
                          setActionCards((prev) => {
                            const next = new Map(prev);
                            next.set(message.id, { ...card, data: newData });
                            return next;
                          });
                        }}
                        onAction={(action, data) => handleCardAction(card.id, action, data ?? card.data)}
                      />
                    </ActionCard>
                  </div>
                )}
              </div>
            );
          })}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-secondary border border-border rounded-lg px-4 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border bg-background">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this item, add context, create tasks..."
              className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg resize-none text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
              rows={2}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="p-2 rounded-lg bg-gold text-background hover:bg-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
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
