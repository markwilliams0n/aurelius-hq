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
  senderItemCount?: number;
  onClose: () => void;
  onAction?: (action: string, data?: unknown) => void;
}

export function TriageChat({ item, senderItemCount, onClose }: TriageChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages, isStreaming, isLoading, actionCards,
    send, handleCardAction, updateCardData,
  } = useChat({
    conversationId: item.dbId || item.id,
    context: {
      surface: "triage",
      triageItem: {
        connector: item.connector,
        sender: item.sender,
        senderName: item.senderName ?? undefined,
        subject: item.subject,
        content: item.content,
        preview: item.preview ?? undefined,
        senderItemCount,
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
