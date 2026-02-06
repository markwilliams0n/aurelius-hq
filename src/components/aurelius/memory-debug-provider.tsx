"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { MemoryDebugPanel } from "./memory-debug-panel";

type MemoryDebugContextType = {
  isOpen: boolean;
  debugMode: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setDebugMode: (on: boolean) => void;
};

const MemoryDebugContext = createContext<MemoryDebugContextType | null>(null);

export function useMemoryDebug() {
  const context = useContext(MemoryDebugContext);
  if (!context) {
    throw new Error("useMemoryDebug must be used within MemoryDebugProvider");
  }
  return context;
}

export function MemoryDebugProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Cmd+D shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        toggle();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <MemoryDebugContext.Provider
      value={{ isOpen, debugMode, open, close, toggle, setDebugMode }}
    >
      {children}
      <MemoryDebugPanel isOpen={isOpen} onClose={close} />
    </MemoryDebugContext.Provider>
  );
}
