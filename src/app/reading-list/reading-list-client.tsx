"use client";

import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { toast } from "sonner";
import { ExternalLink, Archive, Bookmark, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReadingListItem } from "@/lib/db/schema/reading-list";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ReadingListClient() {
  const [items, setItems] = useState<ReadingListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const bookmarkletHref = `javascript:void(document.head.appendChild(document.createElement('script')).src='http://localhost:3333/bookmarklet.js?t='+Date.now())`;

  // Fetch items on mount
  useEffect(() => {
    async function fetchItems() {
      try {
        const res = await fetch("/api/reading-list");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setItems(data.items);
      } catch (error) {
        console.error("Failed to fetch reading list:", error);
        toast.error("Failed to load reading list");
      } finally {
        setIsLoading(false);
      }
    }
    fetchItems();
  }, []);

  // Derive unique tags from items
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const item of items) {
      if (item.tags) {
        for (const tag of item.tags) {
          if (tag) tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }, [items]);

  // Filter items by active tag
  const filteredItems = useMemo(() => {
    if (!activeTag) return items;
    return items.filter((item) => item.tags?.includes(activeTag));
  }, [items, activeTag]);

  // Mark as read + open URL
  async function handleOpen(item: ReadingListItem) {
    if (item.url) {
      window.open(item.url, "_blank");
    }
    if (item.status === "unread") {
      // Optimistic update
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "read" as const } : i))
      );
      try {
        await fetch(`/api/reading-list/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "read" }),
        });
      } catch {
        // Revert on failure
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "unread" as const } : i))
        );
        toast.error("Failed to mark as read");
      }
    }
  }

  // Archive item
  async function handleArchive(item: ReadingListItem) {
    // Optimistic: remove from list
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast.success("Archived");

    try {
      await fetch(`/api/reading-list/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
    } catch {
      // Revert on failure
      setItems((prev) => [...prev, item]);
      toast.error("Failed to archive");
    }
  }

  return (
    <AppShell>
      <div className="flex-1 flex flex-col h-screen">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="font-serif text-xl text-gold">Reading List</h1>
            <button
              onClick={() => setShowSetup((s) => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Setup bookmarklet"
            >
              <Bookmark className="w-3.5 h-3.5" />
              {showSetup ? "Close" : "Setup"}
            </button>
          </div>

          {/* Bookmarklet setup panel */}
          {showSetup && (
            <div className="mt-3 p-4 rounded-lg border border-border bg-card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-foreground font-medium mb-2">
                    Drag this to your bookmarks bar:
                  </p>
                  <a
                    href={bookmarkletHref}
                    onClick={(e) => e.preventDefault()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold/20 text-gold border border-gold/30 text-sm font-medium cursor-grab active:cursor-grabbing hover:bg-gold/30 transition-colors"
                  >
                    <Bookmark className="w-4 h-4" />
                    + Reading List
                  </a>
                </div>
                <button onClick={() => setShowSetup(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-3 text-xs text-muted-foreground space-y-1">
                <p><strong>On X bookmarks page:</strong> Scrapes all visible tweets and syncs them</p>
                <p><strong>On any other page:</strong> Saves the page (with selected text if any) to your reading list</p>
              </div>
            </div>
          )}

          {/* Tag filter bar */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button
                onClick={() => setActiveTag(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  activeTag === null
                    ? "bg-gold/20 text-gold border border-gold/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
                )}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    activeTag === tag
                      ? "bg-gold/20 text-gold border border-gold/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Loading state */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground">Loading reading list...</div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredItems.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">No items in your reading list yet.</p>
          </div>
        )}

        {/* Card list */}
        {!isLoading && filteredItems.length > 0 && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto flex flex-col gap-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border border-border bg-card p-4 transition-opacity",
                    item.status === "read" && "opacity-60"
                  )}
                >
                  {/* Top row: source badge + time */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {item.source}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {timeAgo(new Date(item.createdAt))}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="font-semibold text-sm text-foreground mb-1 leading-snug">
                    {item.title || "Untitled"}
                  </h3>

                  {/* Summary */}
                  {item.summary && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-3 leading-relaxed">
                      {item.summary}
                    </p>
                  )}

                  {/* Tags */}
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                      {item.tags.map((tag) =>
                        tag ? (
                          <span
                            key={tag}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ) : null
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpen(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open
                    </button>
                    <button
                      onClick={() => handleArchive(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Archive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
