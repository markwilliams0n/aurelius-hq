"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Search,
  Upload,
  Send,
  FileText,
  Key,
  Hash,
  Link,
  Lock,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  Archive,
  Pencil,
  Check,
  Cloud,
  CloudOff,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface VaultItem {
  id: string;
  type: "document" | "fact" | "credential" | "reference";
  title: string;
  content: string | null;
  filePath: string | null;
  fileName: string | null;
  contentType: string | null;
  sensitive: boolean;
  tags: string[];
  sourceUrl: string | null;
  supermemoryStatus: "none" | "pending" | "sent";
  supermemoryLevel: string | null;
  supermemorySummary: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ActionCard {
  id: string;
  type: "save_confirmation" | "sm_level_select" | "sm_preview";
  title: string;
  data: Record<string, unknown>;
}

// ============================================================
// Helpers
// ============================================================

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  credential: Key,
  fact: Hash,
  reference: Link,
};

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ============================================================
// VaultItemCard — Expandable item row
// ============================================================

function VaultItemCard({
  item,
  isExpanded,
  onToggle,
  onUpdate,
}: {
  item: VaultItem;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (updated: VaultItem) => void;
}) {
  const TypeIcon = TYPE_ICONS[item.type] || FileText;
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editTags, setEditTags] = useState(item.tags.join(", "));
  const [revealedContent, setRevealedContent] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  // SM flow state
  const [smLevel, setSmLevel] = useState<string | null>(null);
  const [smPreview, setSmPreview] = useState<string | null>(null);
  const [smLoading, setSmLoading] = useState(false);

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/vault/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          tags: editTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      const { item: updated } = await res.json();
      onUpdate(updated);
      setIsEditing(false);
      toast.success("Item updated");
    } catch {
      toast.error("Failed to update item");
    }
  };

  const handleReveal = async () => {
    setIsRevealing(true);
    try {
      const res = await fetch(`/api/vault/items/${item.id}/reveal`);
      if (!res.ok) throw new Error("Reveal failed");
      const data = await res.json();
      setRevealedContent(data.content);
    } catch {
      toast.error("Failed to reveal content");
    } finally {
      setIsRevealing(false);
    }
  };

  const handleSmPreview = async (level: string) => {
    setSmLevel(level);
    setSmLoading(true);
    try {
      const res = await fetch(`/api/vault/items/${item.id}/supermemory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", level }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setSmPreview(data.summary);
    } catch {
      toast.error("Failed to generate preview");
      setSmLevel(null);
    } finally {
      setSmLoading(false);
    }
  };

  const handleSmSend = async () => {
    if (!smLevel || !smPreview) return;
    setSmLoading(true);
    try {
      const res = await fetch(`/api/vault/items/${item.id}/supermemory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          level: smLevel,
          summary: smPreview,
        }),
      });
      if (!res.ok) throw new Error("Send failed");
      toast.success("Sent to SuperMemory");
      onUpdate({
        ...item,
        supermemoryStatus: "sent",
        supermemoryLevel: smLevel,
        supermemorySummary: smPreview,
      });
      setSmLevel(null);
      setSmPreview(null);
    } catch {
      toast.error("Failed to send to SuperMemory");
    } finally {
      setSmLoading(false);
    }
  };

  return (
    <div className="border border-border/50 bg-card rounded-lg hover:border-border transition-colors">
      {/* Compact row */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4 flex items-center gap-3"
      >
        <TypeIcon className="w-4 h-4 text-muted-foreground shrink-0" />
        {item.sensitive && (
          <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {item.title}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold/80"
            >
              {tag}
            </span>
          ))}
          {item.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{item.tags.length - 3}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {formatRelativeDate(item.createdAt)}
        </span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50 space-y-3">
          {/* Content area */}
          <div className="mt-3">
            {item.sensitive && !revealedContent ? (
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-muted-foreground italic">
                  Sensitive content hidden
                </span>
                <button
                  onClick={handleReveal}
                  disabled={isRevealing}
                  className="text-xs text-gold hover:underline ml-2"
                >
                  {isRevealing ? "Revealing..." : "Reveal"}
                </button>
              </div>
            ) : (
              <pre className="text-sm text-foreground bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {revealedContent || item.content || "No content"}
              </pre>
            )}
          </div>

          {/* Edit controls */}
          {isEditing ? (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full mt-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full mt-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gold/20 text-gold text-xs font-medium hover:bg-gold/30 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditTitle(item.title);
                    setEditTags(item.tags.join(", "));
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-muted-foreground text-xs hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-muted-foreground text-xs hover:text-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>

              {/* SuperMemory status + controls */}
              {item.supermemoryStatus === "sent" ? (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <Cloud className="w-3.5 h-3.5" />
                  In SuperMemory ({item.supermemoryLevel})
                </span>
              ) : (
                <>
                  {!smLevel ? (
                    <div className="flex items-center gap-1">
                      <CloudOff className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground mr-1">
                        SM:
                      </span>
                      {["short", "medium", "detailed", "full"].map((level) => (
                        <button
                          key={level}
                          onClick={() => handleSmPreview(level)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors capitalize"
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {/* SM preview area */}
          {smLevel && smPreview !== null && (
            <div className="space-y-2 border border-border/50 rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gold capitalize">
                  {smLevel} summary preview
                </span>
                <button
                  onClick={() => {
                    setSmLevel(null);
                    setSmPreview(null);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {smLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Generating...
                  </span>
                </div>
              ) : (
                <>
                  <textarea
                    value={smPreview}
                    onChange={(e) => setSmPreview(e.target.value)}
                    className="w-full min-h-[80px] px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSmSend}
                      disabled={smLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gold/20 text-gold text-xs font-medium hover:bg-gold/30 transition-colors disabled:opacity-50"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      Send to SuperMemory
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* SM loading state (before preview comes back) */}
          {smLevel && smPreview === null && smLoading && (
            <div className="flex items-center gap-2 py-2 border border-border/50 rounded-lg p-3 bg-muted/30">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Generating {smLevel} summary...
              </span>
            </div>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
            <span>Type: {item.type}</span>
            {item.fileName && <span>File: {item.fileName}</span>}
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold hover:underline"
              >
                Source link
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// VaultSaveCard — Action card for save confirmation from AI chat
// ============================================================

function VaultSaveCard({
  card,
  onDismiss,
  onItemSaved,
}: {
  card: ActionCard;
  onDismiss: () => void;
  onItemSaved: (item: VaultItem) => void;
}) {
  const data = card.data as {
    content: string;
    title: string;
    type: string;
    sensitive: boolean;
    tags: string[];
    actionCard?: { id: string };
  };

  const [title, setTitle] = useState(data.title || "");
  const [tags, setTags] = useState((data.tags || []).join(", "));
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/vault/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: data.content,
          title,
          type: data.type,
          sensitive: data.sensitive,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const { item } = await res.json();
      onItemSaved(item);
      onDismiss();
      toast.success("Saved to vault");
    } catch {
      toast.error("Failed to save to vault");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="border border-gold/30 bg-gold/5 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gold">Save to Vault</h3>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-xs text-muted-foreground">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full mt-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Tags</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full mt-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Type: {data.type}</span>
          {data.sensitive && (
            <span className="text-amber-400 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Sensitive
            </span>
          )}
        </div>
        <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {data.content?.length > 200
            ? data.content.slice(0, 200) + "..."
            : data.content}
        </pre>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gold/20 text-gold text-xs font-medium hover:bg-gold/30 transition-colors disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          Save
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 rounded-md text-muted-foreground text-xs hover:text-foreground hover:bg-muted transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Main VaultClient Component
// ============================================================

export default function VaultClient() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [actionCards, setActionCards] = useState<ActionCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ----------------------------------------------------------
  // Data fetching
  // ----------------------------------------------------------

  const fetchItems = useCallback(
    async (query?: string, filterTags?: string[]) => {
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (filterTags?.length) params.set("tags", filterTags.join(","));

        const res = await fetch(`/api/vault/items?${params.toString()}`);
        if (!res.ok) throw new Error("Fetch failed");
        const data = await res.json();
        setItems(data.items || []);
      } catch {
        toast.error("Failed to load vault items");
      }
    },
    []
  );

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/tags");
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setTags(data.tags || []);
    } catch {
      // Tags are non-critical; don't toast
    }
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([fetchItems(), fetchTags()]).then(() => setIsLoading(false));
  }, [fetchItems, fetchTags]);

  // ----------------------------------------------------------
  // Search (debounced)
  // ----------------------------------------------------------

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      fetchItems(searchQuery || undefined, selectedTags.length ? selectedTags : undefined);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, selectedTags, fetchItems]);

  // ----------------------------------------------------------
  // Tag filter
  // ----------------------------------------------------------

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const clearTagFilter = () => {
    setSelectedTags([]);
  };

  // ----------------------------------------------------------
  // AI chat
  // ----------------------------------------------------------

  const handleChatSend = async () => {
    const message = chatInput.trim();
    if (!message || isSending) return;

    setChatInput("");
    setIsSending(true);

    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", content: message },
    ];
    setChatHistory(newHistory);

    try {
      const res = await fetch("/api/vault/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: chatHistory.slice(-10),
        }),
      });

      if (!res.ok) throw new Error("Chat failed");
      const data = await res.json();

      setChatHistory([
        ...newHistory,
        { role: "assistant", content: data.response },
      ]);

      // Handle action cards from AI response
      if (data.action === "save_to_vault" && data.actionData) {
        const cardData = data.actionData as Record<string, unknown>;
        setActionCards((prev) => [
          ...prev,
          {
            id: (cardData.actionCard as { id?: string })?.id || crypto.randomUUID(),
            type: "save_confirmation",
            title: (cardData.title as string) || "Save to vault",
            data: cardData,
          },
        ]);
      }

      if (data.action === "search_vault" && data.actionData) {
        const queryStr = (data.actionData as { query?: string }).query;
        if (queryStr) {
          setSearchQuery(queryStr);
        }
      }
    } catch {
      toast.error("Failed to send message");
      setChatHistory(newHistory); // keep user message, remove pending
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleChatSend();
    }
  };

  // ----------------------------------------------------------
  // File upload
  // ----------------------------------------------------------

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/vault/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      // Add to items list at top
      setItems((prev) => [data.item, ...prev]);
      // Refresh tags
      fetchTags();
      toast.success(`Uploaded: ${data.item.title}`);
    } catch {
      toast.error("Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  // ----------------------------------------------------------
  // Item update handler
  // ----------------------------------------------------------

  const handleItemUpdate = (updated: VaultItem) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    // Refresh tags in case they changed
    fetchTags();
  };

  const handleItemSavedFromCard = (newItem: VaultItem) => {
    setItems((prev) => [newItem, ...prev]);
    fetchTags();
  };

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-2xl text-gold">Vault</h1>
          <p className="text-sm text-muted-foreground">
            Store and retrieve important documents, facts, and credentials
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* AI Input area */}
          <div
            className={cn(
              "border rounded-lg p-4 transition-colors",
              isDragOver
                ? "border-gold bg-gold/5"
                : "border-border bg-card"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex gap-3">
              <textarea
                ref={textareaRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the vault anything, or paste content to save..."
                rows={2}
                className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 resize-none"
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleChatSend}
                  disabled={isSending || !chatInput.trim()}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-gold/20 text-gold text-sm font-medium hover:bg-gold/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-md border border-border text-muted-foreground text-sm hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            </div>
            {isDragOver && (
              <div className="mt-2 text-center text-sm text-gold">
                Drop file to upload
              </div>
            )}
            <div className="mt-2 text-[10px] text-muted-foreground">
              Cmd+Enter to send | Drag and drop files to upload
            </div>
          </div>

          {/* Chat history (last few messages) */}
          {chatHistory.length > 0 && (
            <div className="space-y-2">
              {chatHistory.slice(-4).map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "text-sm rounded-lg px-3 py-2",
                    msg.role === "user"
                      ? "bg-muted/50 text-foreground ml-8"
                      : "bg-card border border-border/50 text-foreground mr-8"
                  )}
                >
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">
                    {msg.role === "user" ? "You" : "Vault AI"}
                  </span>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Action Cards */}
          {actionCards.length > 0 && (
            <div className="space-y-3">
              {actionCards.map((card) => (
                <VaultSaveCard
                  key={card.id}
                  card={card}
                  onDismiss={() =>
                    setActionCards((prev) =>
                      prev.filter((c) => c.id !== card.id)
                    )
                  }
                  onItemSaved={handleItemSavedFromCard}
                />
              ))}
            </div>
          )}

          {/* Search + tag filter bar */}
          <div className="space-y-3">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vault items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-8 py-2 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tag filter chips */}
            {tags.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={clearTagFilter}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    selectedTags.length === 0
                      ? "bg-gold/20 text-gold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  All
                </button>
                {tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      selectedTags.includes(tag)
                        ? "bg-gold/20 text-gold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading vault...
              </span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Archive className="w-16 h-16 text-muted-foreground" />
              <h2 className="font-serif text-xl text-gold">
                {searchQuery || selectedTags.length > 0
                  ? "No results found"
                  : "Vault is empty"}
              </h2>
              <p className="text-muted-foreground text-center max-w-md text-sm">
                {searchQuery || selectedTags.length > 0
                  ? "Try a different search or clear your filters."
                  : "Use the input above to store documents, facts, credentials, and references."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <VaultItemCard
                  key={item.id}
                  item={item}
                  isExpanded={expandedItemId === item.id}
                  onToggle={() =>
                    setExpandedItemId(
                      expandedItemId === item.id ? null : item.id
                    )
                  }
                  onUpdate={handleItemUpdate}
                />
              ))}

              {/* Count footer */}
              <p className="text-xs text-muted-foreground text-center pt-2">
                {items.length} item{items.length !== 1 ? "s" : ""}
                {searchQuery ? ` matching "${searchQuery}"` : ""}
                {selectedTags.length > 0
                  ? ` tagged ${selectedTags.join(", ")}`
                  : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
