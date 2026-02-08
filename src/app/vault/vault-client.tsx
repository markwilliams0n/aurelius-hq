"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Search,
  FileText,
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
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TYPE_ICONS } from "@/components/aurelius/cards/vault-card";
import { VaultWizard } from "./vault-wizard";
import type { VaultWizardEditItem } from "./vault-wizard";

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

// ============================================================
// Helpers
// ============================================================

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
  onEdit,
  onDelete,
}: {
  item: VaultItem;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (updated: VaultItem) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const TypeIcon = TYPE_ICONS[item.type] || FileText;
  const [revealedContent, setRevealedContent] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  // SM flow state
  const [smLevel, setSmLevel] = useState<string | null>(null);
  const [smPreview, setSmPreview] = useState<string | null>(null);
  const [smLoading, setSmLoading] = useState(false);

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

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-muted-foreground text-xs hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-muted-foreground text-xs hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>

            {/* SuperMemory status + controls */}
            {item.supermemoryStatus === "sent" ? (
              <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
                <Cloud className="w-3.5 h-3.5" />
                In SuperMemory ({item.supermemoryLevel})
              </span>
            ) : (
              <>
                {!smLevel ? (
                  <div className="flex items-center gap-1 ml-auto">
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
// Main VaultClient Component
// ============================================================

export default function VaultClient() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isItemsLoading, setIsItemsLoading] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VaultWizardEditItem | null>(null);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ----------------------------------------------------------
  // Data fetching
  // ----------------------------------------------------------

  const fetchItemsFn = useCallback(
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

  const fetchTagsFn = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/tags");
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setTags(data.tags || []);
    } catch {
      // Tags are non-critical
    }
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([fetchItemsFn(), fetchTagsFn()]).then(() =>
      setIsItemsLoading(false)
    );
  }, [fetchItemsFn, fetchTagsFn]);

  // ----------------------------------------------------------
  // Search (debounced)
  // ----------------------------------------------------------

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      fetchItemsFn(
        searchQuery || undefined,
        selectedTags.length ? selectedTags : undefined
      );
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, selectedTags, fetchItemsFn]);

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
  // Item handlers
  // ----------------------------------------------------------

  const handleItemUpdate = (updated: VaultItem) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    fetchTagsFn();
  };

  const handleEdit = (item: VaultItem) => {
    setEditingItem({
      id: item.id,
      title: item.title,
      type: item.type,
      tags: item.tags,
      content: item.content,
      sensitive: item.sensitive,
      supermemoryStatus: item.supermemoryStatus,
    });
    setWizardOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm("Delete this vault item?")) return;
    try {
      const res = await fetch(`/api/vault/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((item) => item.id !== itemId));
      fetchTagsFn();
      toast.success("Item deleted");
    } catch {
      toast.error("Failed to delete item");
    }
  };

  const handleWizardClose = () => {
    setWizardOpen(false);
    setEditingItem(null);
  };

  const handleItemSaved = () => {
    fetchItemsFn();
    fetchTagsFn();
  };

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="font-serif text-2xl text-gold">Vault</h1>
            <p className="text-sm text-muted-foreground">
              Store and retrieve important documents, facts, and credentials
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingItem(null);
              setWizardOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Vault
          </Button>
        </div>

        <div className="p-6 space-y-6">
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
          {isItemsLoading ? (
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
                  : "Click + Vault to store documents, facts, credentials, and references."}
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
                  onEdit={() => handleEdit(item)}
                  onDelete={() => handleDelete(item.id)}
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

      {/* Wizard drawer */}
      <VaultWizard
        isOpen={wizardOpen}
        onClose={handleWizardClose}
        onItemSaved={handleItemSaved}
        editItem={editingItem ?? undefined}
      />
    </AppShell>
  );
}
