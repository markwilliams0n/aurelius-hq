"use client";

import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { ActionCard } from "./action-card";
import { CardContent } from "./cards/card-content";
import { useChat } from "@/hooks/use-chat";

const SHARED_CONVERSATION_ID = "00000000-0000-0000-0000-000000000000";

export function ChatPanel({
  isOpen,
  onClose,
  context,
}: {
  isOpen: boolean;
  onClose: () => void;
  context?: string; // Optional context from current page
}) {
  const {
    messages,
    isStreaming,
    isLoading,
    actionCards,
    send,
    handleCardAction,
    updateCardData,
  } = useChat({
    conversationId: SHARED_CONVERSATION_ID,
    context: {
      surface: "panel",
      pageContext: context,
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-background border-l border-border shadow-lg z-50 flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border">
          <h2 className="font-serif text-lg text-gold">Aurelius</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Loading...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Ask anything...</p>
            </div>
          ) : (
            messages.map((message, index) => {
              const cards = actionCards.get(message.id);
              const isLast = index === messages.length - 1;
              return (
                <div key={message.id || index}>
                  <ChatMessage
                    message={message}
                    isStreaming={isStreaming && isLast && message.role === "assistant"}
                  />
                  {cards?.map((card) => (
                    <div key={card.id} className="ml-11 mt-2">
                      <ActionCard
                        card={card}
                        onAction={(action, editedData) =>
                          handleCardAction(card.id, action, editedData ?? card.data)
                        }
                      >
                        <CardContent
                          card={card}
                          onDataChange={(newData) => updateCardData(card.id, newData)}
                          onAction={(action, data) =>
                            handleCardAction(card.id, action, data ?? card.data)
                          }
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
        <div className="p-4 border-t border-border">
          <ChatInput onSend={send} disabled={isStreaming} />
        </div>
      </div>
    </>
  );
}
