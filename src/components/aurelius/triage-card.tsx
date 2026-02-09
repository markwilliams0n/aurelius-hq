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
  CalendarDays,
  ShieldAlert,
  Users,
  Bell,
  Send,
  AtSign,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Types matching the schema
export type TriageItem = {
  id: string;
  dbId?: string; // Original DB UUID (id gets remapped to externalId in triage-client)
  externalId: string;
  connector: "gmail" | "slack" | "linear" | "granola" | "manual";
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
  rawPayload?: Record<string, unknown> | null;
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
    // Gmail-specific enrichment
    senderTags?: string[];
    isSuspicious?: boolean;
    phishingIndicators?: string[];
    threadId?: string;
    messageCount?: number;
    attachments?: Array<{ filename: string; mimeType: string; size: number }>;
    // Action needed tracking
    actionNeededDate?: string;
    // Recipients
    recipients?: {
      to: Array<{ email: string; name?: string }>;
      cc: Array<{ email: string; name?: string }>;
      internal: Array<{ email: string; name?: string }>;
    };
  } | null;
};

interface TriageCardProps {
  item: TriageItem;
  isActive?: boolean;
  className?: string;
  senderItemCount?: number;
}

// Priority badge colors and icons
export const PRIORITY_CONFIG = {
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

// Connector icons and colors
export const CONNECTOR_CONFIG = {
  gmail: { icon: Mail, label: "Gmail", color: "text-red-400", bgColor: "bg-red-500/20", borderColor: "border-red-500/30" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-purple-400", bgColor: "bg-purple-500/20", borderColor: "border-purple-500/30" },
  linear: { icon: LayoutList, label: "Linear", color: "text-indigo-400", bgColor: "bg-indigo-500/20", borderColor: "border-indigo-500/30" },
  granola: { icon: CalendarDays, label: "Granola", color: "text-amber-400", bgColor: "bg-amber-500/20", borderColor: "border-amber-500/30" },
  manual: { icon: Mail, label: "Manual", color: "text-muted-foreground", bgColor: "bg-secondary", borderColor: "border-border" },
};

// Smart analysis tag config
const SENDER_TAG_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string }> = {
  Internal: { icon: Building, color: "text-green-400", bgColor: "bg-green-500/20" },
  Direct: { icon: Send, color: "text-blue-400", bgColor: "bg-blue-500/20" },
  CC: { icon: AtSign, color: "text-slate-400", bgColor: "bg-slate-500/20" },
  Auto: { icon: Bell, color: "text-orange-400", bgColor: "bg-orange-500/20" },
  Newsletter: { icon: Globe, color: "text-cyan-400", bgColor: "bg-cyan-500/20" },
  Group: { icon: Users, color: "text-violet-400", bgColor: "bg-violet-500/20" },
  Suspicious: { icon: ShieldAlert, color: "text-red-400", bgColor: "bg-red-500/20" },
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
  ({ item, isActive = false, className, senderItemCount }, ref) => {
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
    const senderTags = item.enrichment?.senderTags || [];
    const isSuspicious = item.enrichment?.isSuspicious;
    const phishingIndicators = item.enrichment?.phishingIndicators || [];
    const internalRecipients = item.enrichment?.recipients?.internal || [];

    return (
      <div
        ref={ref}
        className={cn(
          "relative w-[640px] max-w-2xl bg-secondary border rounded-xl overflow-hidden transition-all duration-200",
          isActive
            ? "border-gold shadow-lg shadow-gold/10 scale-100"
            : "border-border scale-95 opacity-60",
          className
        )}
      >
        {/* Top bar: Connector badge (prominent), Priority, Smart tags */}
        <div className="px-4 py-3 border-b border-border bg-secondary/50">
          <div className="flex items-center justify-between gap-2 mb-2">
            {/* Left: Connector badge (prominent) + Priority */}
            <div className="flex items-center gap-2">
              {/* Connector badge - large and prominent */}
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border",
                  connector.bgColor,
                  connector.borderColor,
                  connector.color
                )}
              >
                <ConnectorIcon className="w-4 h-4" />
                <span>{connector.label}</span>
              </div>

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
            </div>

            {/* Right: Time */}
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>

          {/* Smart analysis tags (from Gmail enrichment) */}
          {(senderTags.length > 0 || isSuspicious) && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {senderTags.map((tag) => {
                const config = SENDER_TAG_CONFIG[tag];
                if (!config) return null;
                const TagIcon = config.icon;
                return (
                  <span
                    key={tag}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                      config.bgColor,
                      config.color
                    )}
                  >
                    <TagIcon className="w-3 h-3" />
                    {tag}
                  </span>
                );
              })}
              {isSuspicious && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                  <ShieldAlert className="w-3 h-3" />
                  Suspicious
                </span>
              )}
            </div>
          )}

          {/* Internal recipients (@rostr.cc) */}
          {internalRecipients.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-green-400 mb-2">
              <Users className="w-3 h-3" />
              <span>
                {internalRecipients.map(r => r.email.replace('@rostr.cc', '')).join(', ')}
              </span>
            </div>
          )}

          {/* Phishing warning */}
          {phishingIndicators.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 mb-2">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-400">
                <span className="font-medium">Warning:</span>{" "}
                {phishingIndicators[0]}
              </div>
            </div>
          )}

          {/* Action needed badge */}
          {item.enrichment?.actionNeededDate && (
            <div className="flex items-center gap-1 text-xs text-amber-400 mb-2">
              <Clock className="w-3 h-3" />
              Marked for action on {new Date(item.enrichment.actionNeededDate).toLocaleDateString()}
            </div>
          )}

          {/* User tags */}
          {item.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
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
          )}

          {/* Linked entities from memory */}
          {linkedEntities.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
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

          {/* Memory context (separate from AI summary) */}
          {contextFromMemory && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              Memory: "{contextFromMemory}"
            </p>
          )}
        </div>

        {/* Main content */}
        <div className="p-4">

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
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm">
                  {item.senderName || item.sender}
                </span>
                {senderItemCount && senderItemCount > 0 ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    +{senderItemCount} more
                  </span>
                ) : null}
              </div>
              {item.senderName && item.sender !== item.senderName && (
                <span className="text-xs text-muted-foreground">{item.sender}</span>
              )}
            </div>
          </div>

          {/* Subject */}
          <h3 className="font-semibold mb-2">{item.subject}</h3>

          {/* AI Summary - prominent display */}
          {summary && (
            <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg bg-gold/5 border border-gold/20">
              <Zap className="w-4 h-4 text-gold shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">{summary}</p>
            </div>
          )}

          {/* Content preview - only show if no summary */}
          {!summary && (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
              {item.preview || item.content.slice(0, 400)}
              {item.content.length > 400 && !item.preview && "..."}
            </div>
          )}
        </div>

        {/* Bottom bar: Keyboard hints (only show when active) */}
        {isActive && (
          <div className="px-4 py-2 border-t border-border bg-background/50">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <KeyHint keyName="←" label="Archive" />
              <KeyHint keyName="↑" label="Summary" />
              <KeyHint keyName="s" label="Snooze" />
              {item.connector === "gmail" && (
                <KeyHint keyName="a" label="Action" />
              )}
              {item.connector === "gmail" && (
                <KeyHint keyName="x" label="Spam" />
              )}
              <KeyHint keyName="g" label="Group" />
              <KeyHint keyName="␣" label="Chat" />
              <KeyHint keyName="↵" label="Expand" />
              <KeyHint keyName="→" label="Actions" />
              {(item.connector === "gmail" || item.connector === "slack") && (
                <KeyHint keyName="↓" label="Reply" />
              )}
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
export function formatTimeAgo(date: Date): string {
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
