"use client";

import { useState, useEffect, useRef } from "react";
import { FileText, Plus, X } from "lucide-react";
import { toast } from "sonner";

export function DailyNotesPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState("");
  const [newNote, setNewNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load daily notes when opened
  useEffect(() => {
    if (isOpen) {
      fetch("/api/daily-notes")
        .then((res) => res.json())
        .then((data) => setContent(data.content || ""))
        .catch(() => toast.error("Failed to load daily notes"));
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!newNote.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/daily-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote.trim() }),
      });

      if (res.ok) {
        toast.success("Note added");
        setNewNote("");
        // Refresh content
        const data = await fetch("/api/daily-notes").then((r) => r.json());
        setContent(data.content || "");
      } else {
        toast.error("Failed to add note");
      }
    } catch {
      toast.error("Failed to add note");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="Daily Notes"
      >
        <FileText className="w-3.5 h-3.5" />
        <span>Notes</span>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-96 max-h-[70vh] bg-background border border-border rounded-lg shadow-lg z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h3 className="text-sm font-medium">Today&apos;s Notes</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Add new note */}
          <div className="p-3 border-b border-border">
            <textarea
              ref={textareaRef}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a note... (Cmd+Enter to save)"
              className="w-full h-16 px-3 py-2 text-sm bg-muted/50 border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-gold/50"
            />
            <button
              onClick={handleSubmit}
              disabled={!newNote.trim() || isSubmitting}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gold/10 text-gold hover:bg-gold/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              Add Note
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {content ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground leading-relaxed">
                  {content}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No notes for today yet
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
