"use client";

import {
  Inbox,
  Archive,
  Clock,
  CheckCircle,
  User,
  Building,
  FolderOpen,
  Brain,
  Lightbulb,
} from "lucide-react";
import { TriageItem } from "./triage-card";
import { cn } from "@/lib/utils";

interface TriageSidebarProps {
  item: TriageItem | null;
  stats: {
    new: number;
    archived: number;
    snoozed: number;
    actioned: number;
  };
}

export function TriageSidebar({ item, stats }: TriageSidebarProps) {
  return (
    <aside className="h-full border-l border-border bg-background flex flex-col">
      {/* Stats header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium mb-3">Inbox Stats</h3>
        <div className="grid grid-cols-2 gap-2">
          <StatBadge
            icon={Inbox}
            label="New"
            value={stats.new}
            color="text-gold"
          />
          <StatBadge
            icon={Archive}
            label="Archived"
            value={stats.archived}
            color="text-muted-foreground"
          />
          <StatBadge
            icon={Clock}
            label="Snoozed"
            value={stats.snoozed}
            color="text-blue-400"
          />
          <StatBadge
            icon={CheckCircle}
            label="Done"
            value={stats.actioned}
            color="text-green-400"
          />
        </div>
      </div>

      {/* Current item context */}
      {item && (
        <>
          {/* Linked entities */}
          {item.enrichment?.linkedEntities &&
            item.enrichment.linkedEntities.length > 0 && (
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-gold" />
                  <h4 className="text-sm font-medium">From Memory</h4>
                </div>
                <div className="space-y-2">
                  {item.enrichment.linkedEntities.map((entity) => (
                    <EntityCard key={entity.id} entity={entity} />
                  ))}
                </div>
              </div>
            )}

          {/* Suggested actions */}
          {item.enrichment?.suggestedActions &&
            item.enrichment.suggestedActions.length > 0 && (
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-gold" />
                  <h4 className="text-sm font-medium">Suggested Actions</h4>
                </div>
                <div className="space-y-2">
                  {item.enrichment.suggestedActions.map((action, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-lg bg-secondary/50 border border-border"
                    >
                      <div className="font-medium text-sm">{action.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {action.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Context from memory */}
          {item.enrichment?.contextFromMemory && (
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-gold" />
                <h4 className="text-sm font-medium">Context</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                {item.enrichment.contextFromMemory}
              </p>
            </div>
          )}

          {/* Sender details */}
          <div className="px-4 py-3 border-b border-border">
            <h4 className="text-sm font-medium mb-2">Sender</h4>
            <div className="flex items-center gap-3">
              {item.senderAvatar ? (
                <img
                  src={item.senderAvatar}
                  alt={item.senderName || item.sender}
                  className="w-10 h-10 rounded-full"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center">
                  <span className="text-gold font-medium">
                    {(item.senderName || item.sender).charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div>
                <div className="font-medium text-sm">
                  {item.senderName || item.sender}
                </div>
                {item.senderName && item.sender !== item.senderName && (
                  <div className="text-xs text-muted-foreground">
                    {item.sender}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Full content preview */}
          <div className="flex-1 px-4 py-3 overflow-y-auto">
            <h4 className="text-sm font-medium mb-2">Full Content</h4>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">
              {item.content}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!item && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            No item selected
          </p>
        </div>
      )}

      {/* Keyboard shortcuts reference */}
      <div className="px-4 py-3 border-t border-border bg-secondary/30">
        <h4 className="text-xs font-medium mb-2 text-muted-foreground">
          Keyboard Shortcuts
        </h4>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <ShortcutHint keys="←" label="Archive" />
          <ShortcutHint keys="↑" label="Memory" />
          <ShortcutHint keys="→" label="Actions" />
          <ShortcutHint keys="↓" label="Reply" />
          <ShortcutHint keys="⌘U" label="Undo" />
          <ShortcutHint keys="Esc" label="Close" />
        </div>
      </div>
    </aside>
  );
}

function StatBadge({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
      <Icon className={cn("w-4 h-4", color)} />
      <div className="flex flex-col">
        <span className="font-mono text-sm font-medium">{value}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function EntityCard({
  entity,
}: {
  entity: { id: string; name: string; type: string };
}) {
  const icons = {
    person: User,
    company: Building,
    project: FolderOpen,
    team: Building,
  };
  const Icon = icons[entity.type as keyof typeof icons] || User;

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50 border border-border">
      <Icon className="w-4 h-4 text-gold" />
      <div>
        <div className="text-sm font-medium">{entity.name}</div>
        <div className="text-[10px] text-muted-foreground capitalize">
          {entity.type}
        </div>
      </div>
    </div>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <kbd className="px-1 py-0.5 rounded bg-background border border-border font-mono text-[10px]">
        {keys}
      </kbd>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
