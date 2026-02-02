"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Wand2, Loader2 } from "lucide-react";
import { TriageItem } from "./triage-card";
import { cn } from "@/lib/utils";

interface TriageReplyComposerProps {
  item: TriageItem;
  onSend: (message: string) => void;
  onClose: () => void;
}

export function TriageReplyComposer({
  item,
  onSend,
  onClose,
}: TriageReplyComposerProps) {
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
      // Cmd/Ctrl + Enter to send
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (message.trim()) {
          onSend(message);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [message, onClose, onSend]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, [message]);

  // Generate AI draft
  const handleGenerateDraft = useCallback(async () => {
    setIsGenerating(true);

    // Simulate AI draft generation
    // In production, this would call the AI API
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const drafts = generateDraftResponses(item);
    setMessage(drafts[0]);
    setIsGenerating(false);
  }, [item]);

  // Handle send
  const handleSend = () => {
    if (!message.trim()) return;
    onSend(message);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Composer */}
      <div className="relative w-full max-w-2xl mx-4 mb-4 bg-secondary border border-border rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              Reply to {item.senderName || item.sender}
            </span>
            <span className="text-xs text-muted-foreground">
              Re: {item.subject}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-background transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Compose area */}
        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your reply..."
            className="w-full bg-transparent resize-none text-sm focus:outline-none min-h-[100px] max-h-[200px]"
            rows={4}
          />
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <button
            onClick={handleGenerateDraft}
            disabled={isGenerating}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
              isGenerating
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-background text-gold"
            )}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            <span>Generate draft</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">
                ⌘
              </kbd>
              +
              <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">
                Enter
              </kbd>
              {" "}to send
            </span>
            <button
              onClick={handleSend}
              disabled={!message.trim()}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                message.trim()
                  ? "bg-gold text-background hover:bg-gold/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Generate draft responses based on item content
function generateDraftResponses(item: TriageItem): string[] {
  const sender = item.senderName || item.sender.split("@")[0];

  // Different drafts based on content type
  const subject = item.subject.toLowerCase();
  const content = item.content.toLowerCase();

  if (subject.includes("meeting") || content.includes("schedule")) {
    return [
      `Hi ${sender},

Thanks for reaching out about scheduling. I'd be happy to find a time that works.

I'm generally available:
- Tuesday/Thursday afternoons
- Friday mornings

Would any of these work for you? Feel free to send a calendar invite once we align.

Best,`,
    ];
  }

  if (subject.includes("urgent") || item.priority === "urgent") {
    return [
      `Hi ${sender},

Thanks for flagging this. I'm looking into it now and will get back to you shortly with an update.

If you need immediate assistance, feel free to call me directly.

Best,`,
    ];
  }

  if (subject.includes("question") || content.includes("?")) {
    return [
      `Hi ${sender},

Thanks for your question. Let me look into this and get back to you with a detailed answer.

I should have an update for you by end of day tomorrow.

Best,`,
    ];
  }

  if (content.includes("partnership") || content.includes("collaborate")) {
    return [
      `Hi ${sender},

Thanks for reaching out about a potential collaboration. This sounds interesting.

Could you share a bit more about:
1. Your typical integration timeline
2. Technical requirements
3. Expected outcomes

Happy to schedule a call to discuss further.

Best,`,
    ];
  }

  // Default response
  return [
    `Hi ${sender},

Thanks for your message. I've received this and will review it shortly.

I'll follow up with you once I've had a chance to look at everything in detail.

Best,`,
  ];
}
