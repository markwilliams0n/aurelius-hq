"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ChatPanel } from "./chat-panel";

type ChatContextType = {
  isOpen: boolean;
  open: (context?: string) => void;
  close: () => void;
  toggle: () => void;
};

const ChatContext = createContext<ChatContextType | null>(null);

export function useChatPanel() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatPanel must be used within ChatProvider");
  }
  return context;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [context, setContext] = useState<string | undefined>();

  const open = useCallback((ctx?: string) => {
    setContext(ctx);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggle();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <ChatContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
      <ChatPanel isOpen={isOpen} onClose={close} context={context} />
    </ChatContext.Provider>
  );
}
