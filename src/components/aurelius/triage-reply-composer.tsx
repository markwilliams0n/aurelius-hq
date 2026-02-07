"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Wand2, Loader2, Save } from "lucide-react";
import { TriageItem } from "./triage-card";
import { cn } from "@/lib/utils";

interface TriageReplyComposerProps {
  item: TriageItem;
  userEmail?: string;
  onComplete: (result: { wasDraft: boolean }) => void;
  onClose: () => void;
}

export function TriageReplyComposer({
  item,
  userEmail,
  onComplete,
  onClose,
}: TriageReplyComposerProps) {
  const [message, setMessage] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showBcc, setShowBcc] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Call the reply API
  const callReplyApi = useCallback(
    async (forceDraft: boolean) => {
      const res = await fetch("/api/gmail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          body: message.trim(),
          forceDraft,
          to: to.trim() || undefined,
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      return res.json();
    },
    [item.id, message, to, cc, bcc]
  );

  // Generate AI draft
  const handleGenerateDraft = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/gmail/draft-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate draft");
      }

      const { draft } = await res.json();
      setMessage(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setIsGenerating(false);
    }
  }, [item.id]);

  // Save as draft in Gmail
  const handleSaveDraft = useCallback(async () => {
    if (!message.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);

    try {
      await callReplyApi(true);
      onComplete({ wasDraft: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  }, [message, isSaving, callReplyApi, onComplete]);

  // Send email (two-step: confirm first)
  const handleSend = useCallback(async () => {
    if (!message.trim() || isSending) return;

    if (!confirmSend) {
      setConfirmSend(true);
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      await callReplyApi(false);
      onComplete({ wasDraft: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email");
      setConfirmSend(false);
    } finally {
      setIsSending(false);
    }
  }, [message, isSending, confirmSend, callReplyApi, onComplete]);

  // Pre-populate recipients from rawPayload (reply-all style)
  useEffect(() => {
    if (item.connector === "gmail" && item.rawPayload) {
      const raw = item.rawPayload;
      const sender = item.sender.toLowerCase();

      // To: original sender
      setTo(item.sender);

      // CC: original To recipients + original CC recipients, minus sender and self
      const self = userEmail?.toLowerCase();
      const toList = (raw.to as Array<{ email: string; name?: string }>) || [];
      const ccList = (raw.cc as Array<{ email: string; name?: string }>) || [];
      const allCc = [...toList, ...ccList]
        .map((r) => r.email)
        .filter(Boolean)
        .filter((email) => {
          const lower = email.toLowerCase();
          return lower !== sender && lower !== self;
        });

      // Deduplicate (case-insensitive) but preserve original casing
      const seen = new Set<string>();
      const uniqueCc = allCc.filter((e) => {
        const lower = e.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
      if (uniqueCc.length) setCc(uniqueCc.join(", "));
    }
  }, [item, userEmail]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Handle escape key and Cmd+Enter for save draft
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmSend) {
          setConfirmSend(false);
        } else {
          onClose();
        }
      }
      // Cmd/Ctrl + Enter = Save Draft (NOT send)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (message.trim() && !isSaving && !isSending) {
          handleSaveDraft();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [message, onClose, isSaving, isSending, confirmSend, handleSaveDraft]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, [message]);

  const busy = isSaving || isSending || isGenerating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Side-by-side: Original email + Composer */}
      <div className="relative w-full max-w-5xl mx-4 max-h-[85vh] flex bg-secondary border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Left: Original email */}
        <div className="w-1/2 border-r border-border flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-border shrink-0">
            <p className="text-sm font-medium">{item.senderName || item.sender}</p>
            <p className="text-xs text-muted-foreground">{item.subject}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(item.receivedAt).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {item.content}
            </div>
          </div>
        </div>

        {/* Right: Reply composer */}
        <div className="w-1/2 flex flex-col min-h-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
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

          {/* Recipient fields */}
          <div className="px-4 pt-3 space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-8 text-right shrink-0">To</label>
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="flex-1 bg-background/50 border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gold/50"
                placeholder="recipient@example.com"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-8 text-right shrink-0">CC</label>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="flex-1 bg-background/50 border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gold/50"
                placeholder="cc@example.com"
              />
              <button
                onClick={() => setShowBcc(!showBcc)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {showBcc ? "Hide" : "BCC"}
              </button>
            </div>
            {showBcc && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-8 text-right shrink-0">BCC</label>
                <input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  className="flex-1 bg-background/50 border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gold/50"
                  placeholder="bcc@example.com"
                />
              </div>
            )}
          </div>

          {/* Compose area */}
          <div className="flex-1 p-4 overflow-y-auto">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your reply..."
              className="w-full h-full bg-transparent resize-none text-sm focus:outline-none min-h-[120px]"
              disabled={busy}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 pb-2 shrink-0">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          {/* Send confirmation banner */}
          {confirmSend && (
            <div className="mx-4 mb-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg shrink-0">
              <p className="text-sm text-amber-200">
                Send this email to <strong>{to || item.sender}</strong>
                {cc ? ` (CC: ${cc})` : ""}?
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSend}
                  disabled={isSending}
                  className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-500 transition-colors flex items-center gap-1"
                >
                  {isSending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  Yes, send it
                </button>
                <button
                  onClick={() => setConfirmSend(false)}
                  className="px-3 py-1 bg-background border border-border rounded text-sm hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-4 py-3 border-t border-border flex items-center justify-between shrink-0">
            <button
              onClick={handleGenerateDraft}
              disabled={busy}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                busy
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
              <span className="text-xs text-muted-foreground hidden lg:inline">
                <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">
                  ⌘
                </kbd>
                +
                <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">
                  Enter
                </kbd>
                {" "}to save draft
              </span>
              <button
                onClick={handleSaveDraft}
                disabled={!message.trim() || busy}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  message.trim() && !busy
                    ? "bg-gold text-background hover:bg-gold/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Draft</span>
              </button>
              <button
                onClick={handleSend}
                disabled={!message.trim() || busy}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                  message.trim() && !busy
                    ? "text-foreground hover:bg-background border border-border"
                    : "text-muted-foreground cursor-not-allowed"
                )}
              >
                <Send className="w-4 h-4" />
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
