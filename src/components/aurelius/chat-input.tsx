"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type a message..."
          disabled={disabled}
          className="w-full resize-none rounded-lg border border-border bg-secondary px-4 py-3 pr-12 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold disabled:opacity-50"
          rows={1}
        />
      </div>
      <Button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="bg-gold hover:bg-gold-bright text-background h-12 w-12"
      >
        <Send className="w-5 h-5" />
      </Button>
    </div>
  );
}
