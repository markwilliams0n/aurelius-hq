"use client";

import { forwardRef } from "react";
import {
  Mail,
  MessageSquare,
  LayoutList,
  Zap,
  AlertTriangle,
  ArrowRight,
  Clock,
  User,
  Building,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types matching the schema
export type TriageItem = {
  id: string;
  externalId: string;
  connector: "gmail" | "slack" | "linear" | "manual";
  sender: string;
  senderName?: string | null;
  senderAvatar?: string | null;
  subject: string;
  content: string;
  preview?: string | null;
  status: "new" | "archived" | "snoozed" | "actioned";
  priority: "urgent" | "high" | "normal" | "low";
  tags: string[];
  receivedAt: string;
  enrichment?: {
    summary?: string;
    suggestedPriority?: string;
    suggestedTags?: string[];
    linkedEntities?: Array<{
      id: string;
      name: string;
      type: string;
    }>;
    suggestedActions?: Array<{
      type: string;
      label: string;
      reason: string;
    }>;
    contextFromMemory?: string;
  } | null;
};

interface TriageCardProps {
  item: TriageItem;
  isActive?: boolean;
  className?: string;
}

// Priority badge colors and icons
const PRIORITY_CONFIG = {
  urgent: {
    icon: Zap,
    label: "Urgent",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  high: {
    icon: AlertTriangle,
    label: "High priority",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  normal: {
    icon: ArrowRight,
    label: "Normal",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  low: {
    icon: Clock,
    label: "Low priority",
    className: "bg-muted text-muted-foreground border-border",
  },
};

// Connector icons
const CONNECTOR_CONFIG = {
  gmail: { icon: Mail, label: "Gmail", color: "text-red-400" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-purple-400" },
  linear: { icon: LayoutList, label: "Linear", color: "text-indigo-400" },
  manual: { icon: Mail, label: "Manual", color: "text-muted-foreground" },
};

// Entity type icons
const ENTITY_ICONS = {
  person: User,
  company: Building,
  project: FolderOpen,
  team: Building,
  topic: MessageSquare,
  document: LayoutList,
};

export const TriageCard = forwardRef<HTMLDivElement, TriageCardProps>(
  ({ item, isActive = false, className }, ref) => {
    const priority = PRIORITY_CONFIG[item.priority];
    const connector = CONNECTOR_CONFIG[item.connector];
    const PriorityIcon = priority.icon;
    const ConnectorIcon = connector.icon;

    // Format time ago
    const timeAgo = formatTimeAgo(new Date(item.receivedAt));

    // Get linked entities from enrichment
    const linkedEntities = item.enrichment?.linkedEntities || [];
    const contextFromMemory = item.enrichment?.contextFromMemory;
    const summary = item.enrichment?.summary;

    return (
      <div
        ref={ref}
        className={cn(
          "relative w-full max-w-2xl bg-secondary border rounded-xl overflow-hidden transition-all duration-200",
          isActive
            ? "border-gold shadow-lg shadow-gold/10 scale-100"
            : "border-border scale-95 opacity-60",
          className
        )}
      >
        {/* Top bar: Priority, tags, AI intel */}
        <div className="px-4 py-3 border-b border-border bg-secondary/50">
          <div className="flex items-center justify-between gap-2 mb-2">
            {/* Priority badge */}
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border",
                priority.className
              )}
            >
              <PriorityIcon className="w-3 h-3" />
              <span>{priority.label}</span>
            </div>

            {/* Tags */}
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {item.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs bg-gold/10 text-gold border border-gold/20"
                >
                  #{tag}
                </span>
              ))}
              {item.tags.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{item.tags.length - 3}
                </span>
              )}
            </div>
          </div>

          {/* Linked entities from memory */}
          {linkedEntities.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Linked:</span>
              {linkedEntities.slice(0, 2).map((entity) => {
                const EntityIcon =
                  ENTITY_ICONS[entity.type as keyof typeof ENTITY_ICONS] || User;
                return (
                  <span
                    key={entity.id}
                    className="flex items-center gap-1 text-foreground"
                  >
                    <EntityIcon className="w-3 h-3 text-gold" />
                    {entity.name}
                  </span>
                );
              })}
            </div>
          )}

          {/* AI summary */}
          {(summary || contextFromMemory) && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              "{summary || contextFromMemory}"
            </p>
          )}
        </div>

        {/* Main content */}
        <div className="p-4">
          {/* Header: Connector, sender, time */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  connector.color
                )}
              >
                <ConnectorIcon className="w-4 h-4" />
                <span>{connector.label}</span>
              </div>
              <span className="text-muted-foreground text-xs">·</span>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
          </div>

          {/* From line */}
          <div className="flex items-center gap-2 mb-2">
            {item.senderAvatar ? (
              <img
                src={item.senderAvatar}
                alt={item.senderName || item.sender}
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
                <span className="text-gold text-sm font-medium">
                  {(item.senderName || item.sender).charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex flex-col">
              <span className="font-medium text-sm">
                {item.senderName || item.sender}
              </span>
              {item.senderName && item.sender !== item.senderName && (
                <span className="text-xs text-muted-foreground">{item.sender}</span>
              )}
            </div>
          </div>

          {/* Subject */}
          <h3 className="font-semibold mb-3">{item.subject}</h3>

          {/* Content preview */}
          <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
            {item.preview || item.content.slice(0, 400)}
            {item.content.length > 400 && !item.preview && "..."}
          </div>
        </div>

        {/* Bottom bar: Keyboard hints (only show when active) */}
        {isActive && (
          <div className="px-4 py-2 border-t border-border bg-background/50 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <KeyHint keyName="←" label="Archive" />
              <KeyHint keyName="↑" label="Memory" />
              <KeyHint keyName="→" label="Action" />
              <KeyHint keyName="↓" label="Reply" />
            </div>
          </div>
        )}
      </div>
    );
  }
);

TriageCard.displayName = "TriageCard";

// Key hint component
function KeyHint({ keyName, label }: { keyName: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
        {keyName}
      </kbd>
      <span>{label}</span>
    </div>
  );
}

// Format time ago
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
