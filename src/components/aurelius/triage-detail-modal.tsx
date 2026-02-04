"use client";

import { useEffect, useState, useMemo } from "react";
import {
  X,
  Mail,
  MessageSquare,
  LayoutList,
  User,
  Building,
  Clock,
  Tag,
  Zap,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ShieldAlert,
  Users,
  Bell,
  Send,
  AtSign,
  Globe,
  ExternalLink,
} from "lucide-react";

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
import { cn } from "@/lib/utils";
import { TriageItem } from "./triage-card";

interface TriageDetailModalProps {
  item: TriageItem;
  onClose: () => void;
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
  granola: { icon: CalendarDays, label: "Granola", color: "text-amber-400" },
  manual: { icon: Mail, label: "Manual", color: "text-muted-foreground" },
};

export function TriageDetailModal({ item, onClose }: TriageDetailModalProps) {
  const priority = PRIORITY_CONFIG[item.priority];
  const connector = CONNECTOR_CONFIG[item.connector];
  const PriorityIcon = priority.icon;
  const ConnectorIcon = connector.icon;

  // Format time
  const receivedAt = new Date(item.receivedAt);
  const formattedDate = receivedAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = receivedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  // Get Linear URL for keyboard shortcut
  const linearUrl = item.connector === "linear"
    ? (item.enrichment as Record<string, unknown>)?.linearUrl as string | undefined
    : undefined;

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
      // L to open in Linear
      if (e.key === "l" || e.key === "L") {
        if (linearUrl) {
          e.preventDefault();
          window.open(linearUrl, "_blank", "noopener,noreferrer");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, linearUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/90 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {/* Connector badge */}
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
                connector.color,
                "bg-secondary border border-border"
              )}
            >
              <ConnectorIcon className="w-3.5 h-3.5" />
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

          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-background transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sender info */}
        <div className="px-6 py-4 border-b border-border bg-background/50 shrink-0">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            {item.senderAvatar ? (
              <img
                src={item.senderAvatar}
                alt={item.senderName || item.sender}
                className="w-12 h-12 rounded-full"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gold/20 flex items-center justify-center">
                <span className="text-gold text-lg font-medium">
                  {(item.senderName || item.sender).charAt(0).toUpperCase()}
                </span>
              </div>
            )}

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {item.senderName || item.sender}
                </span>
                {item.enrichment?.linkedEntities?.find(
                  (e) => e.type === "company"
                ) && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building className="w-3 h-3" />
                    {
                      item.enrichment.linkedEntities.find(
                        (e) => e.type === "company"
                      )?.name
                    }
                  </span>
                )}
              </div>
              {item.senderName && item.sender !== item.senderName && (
                <div className="text-sm text-muted-foreground">{item.sender}</div>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <Clock className="w-3 h-3" />
                <span>
                  {formattedDate} at {formattedTime}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Subject */}
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">{item.subject}</h2>

          {/* Smart analysis tags */}
          {((item.enrichment?.senderTags && item.enrichment.senderTags.length > 0) || item.enrichment?.isSuspicious) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              {item.enrichment?.senderTags?.map((tag) => {
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
              {item.enrichment?.isSuspicious && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                  <ShieldAlert className="w-3 h-3" />
                  Suspicious
                </span>
              )}
            </div>
          )}

          {/* Phishing warning */}
          {item.enrichment?.phishingIndicators && item.enrichment.phishingIndicators.length > 0 && (
            <div className="flex items-start gap-2 p-3 mt-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-400">
                <span className="font-medium">Phishing Warning:</span>
                <ul className="mt-1 space-y-1">
                  {item.enrichment.phishingIndicators.map((indicator, i) => (
                    <li key={i}>• {indicator}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* User tags */}
          {item.tags.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <Tag className="w-3.5 h-3.5 text-muted-foreground" />
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs bg-gold/10 text-gold border border-gold/20"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Linear-specific metadata */}
        {item.connector === "linear" && (() => {
          const linearEnrichment = item.enrichment as Record<string, unknown> | undefined;
          if (!linearEnrichment) return null;

          const issueState = linearEnrichment.issueState as string | undefined;
          const issuePriority = linearEnrichment.issuePriority as number | undefined;
          const issueProject = linearEnrichment.issueProject as string | undefined;
          const issueLabels = linearEnrichment.issueLabels as string[] | undefined;
          const notificationType = linearEnrichment.notificationType as string | undefined;
          const actor = linearEnrichment.actor as { name: string } | undefined;

          const priorityLabels: Record<number, string> = {
            0: "No priority",
            1: "Urgent",
            2: "High",
            3: "Normal",
            4: "Low",
          };

          return (
            <div className="px-6 py-3 border-b border-border bg-indigo-500/5 shrink-0">
              <div className="flex items-center gap-4 flex-wrap text-sm">
                {/* Notification type */}
                {notificationType && actor && (
                  <span className="text-muted-foreground">
                    {actor.name} • {notificationType.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                )}

                {/* Issue state */}
                {issueState && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300">
                    {issueState}
                  </span>
                )}

                {/* Priority */}
                {issuePriority !== undefined && issuePriority > 0 && (
                  <span className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
                    issuePriority === 1 && "bg-red-500/20 text-red-400",
                    issuePriority === 2 && "bg-orange-500/20 text-orange-400",
                    issuePriority === 3 && "bg-blue-500/20 text-blue-400",
                    issuePriority === 4 && "bg-slate-500/20 text-slate-400"
                  )}>
                    {priorityLabels[issuePriority] || "Unknown"}
                  </span>
                )}

                {/* Project */}
                {issueProject && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/20 text-violet-300">
                    {issueProject}
                  </span>
                )}

                {/* Labels */}
                {issueLabels && issueLabels.length > 0 && issueLabels.map((label) => (
                  <span
                    key={label}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-500/20 text-slate-300"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        {/* AI Enrichment */}
        {(item.enrichment?.summary || item.enrichment?.contextFromMemory) && (
          <div className="px-6 py-3 border-b border-border bg-gold/5 shrink-0">
            <div className="flex items-start gap-2">
              <div className="p-1 rounded bg-gold/20">
                <Zap className="w-3.5 h-3.5 text-gold" />
              </div>
              <div>
                {item.enrichment.summary && (
                  <p className="text-sm text-foreground">
                    {item.enrichment.summary}
                  </p>
                )}
                {item.enrichment.contextFromMemory && (
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    Memory: {item.enrichment.contextFromMemory}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {(() => {
            // Check if we have HTML content in rawPayload
            const rawPayload = item.rawPayload as Record<string, unknown> | undefined;
            const bodyHtml = rawPayload?.bodyHtml as string | undefined;

            if (bodyHtml && item.connector === 'gmail') {
              return (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none
                    [&_a]:text-gold [&_a]:no-underline [&_a:hover]:underline
                    [&_img]:max-w-full [&_img]:h-auto
                    [&_table]:border-collapse [&_td]:p-2 [&_th]:p-2
                    [&_*]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              );
            }

            // Fallback to plain text
            return (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                  {item.content}
                </pre>
              </div>
            );
          })()}
        </div>

        {/* Footer with keyboard hints */}
        <div className="px-6 py-3 border-t border-border bg-background/50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  Esc
                </kbd>
                Close
              </span>

              {/* Open in Linear shortcut */}
              {linearUrl && (
                <a
                  href={linearUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-indigo-400 transition-colors"
                >
                  <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                    L
                  </kbd>
                  Open in Linear
                </a>
              )}
            </div>

            {/* Linked entities */}
            {item.enrichment?.linkedEntities &&
              item.enrichment.linkedEntities.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Linked:</span>
                  {item.enrichment.linkedEntities.slice(0, 3).map((entity) => (
                    <span
                      key={entity.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary border border-border"
                    >
                      {entity.type === "person" && <User className="w-3 h-3" />}
                      {entity.type === "company" && (
                        <Building className="w-3 h-3" />
                      )}
                      {entity.name}
                    </span>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
