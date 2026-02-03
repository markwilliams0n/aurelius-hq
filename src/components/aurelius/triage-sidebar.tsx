"use client";

import { useState, useEffect } from "react";
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
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
  ListTodo,
} from "lucide-react";
import { TriageItem } from "./triage-card";
import { cn } from "@/lib/utils";
import { RightSidebar } from "./right-sidebar";

interface TriageSidebarProps {
  item: TriageItem | null;
  stats: {
    new: number;
    archived: number;
    snoozed: number;
    actioned: number;
  };
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function TriageSidebar({ item, stats, isExpanded = false, onToggleExpand }: TriageSidebarProps) {
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  // Reset expanded state when item changes
  useEffect(() => {
    setIsContentExpanded(false);
  }, [item?.id]);

  // Keyboard shortcuts footer
  const keyboardShortcuts = (
    <div className="px-4 py-3 border-t border-border bg-secondary/30">
      <h4 className="text-xs font-medium mb-2 text-muted-foreground">
        Keyboard Shortcuts
      </h4>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <ShortcutHint keys="←" label="Archive" />
        <ShortcutHint keys="↑" label="Memory" />
        <ShortcutHint keys="⇧↑" label="Mem+Archive" />
        <ShortcutHint keys="s" label="Snooze" />
        <ShortcutHint keys="Space" label="Chat" />
        <ShortcutHint keys="→" label="Actions" />
        <ShortcutHint keys="Esc" label="Close" />
      </div>
    </div>
  );

  return (
    <RightSidebar
      title="Inbox Stats"
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      footer={keyboardShortcuts}
    >
      {/* Stats section */}
      <div className="px-4 py-3 border-b border-border">
        <div className="grid grid-cols-2 gap-2">
          <StatBadge icon={Inbox} label="New" value={stats.new} color="text-gold" />
          <StatBadge icon={Archive} label="Archived" value={stats.archived} color="text-muted-foreground" />
          <StatBadge icon={Clock} label="Snoozed" value={stats.snoozed} color="text-blue-400" />
          <StatBadge icon={CheckCircle} label="Done" value={stats.actioned} color="text-green-400" />
        </div>
      </div>

      {/* Item details */}
      {item && (
        <div>
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

          {/* Extracted Memory (for Granola meetings) */}
          <ExtractedMemorySection item={item} />

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
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Full Content</h4>
              {item.content.length > 500 && (
                <button
                  onClick={() => setIsContentExpanded(!isContentExpanded)}
                  className="flex items-center gap-1 text-xs text-gold hover:text-gold/80 transition-colors"
                >
                  {isContentExpanded ? (
                    <>
                      <ChevronUp className="w-3 h-3" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      Show more
                    </>
                  )}
                </button>
              )}
            </div>
            <div
              className={cn(
                "text-sm text-muted-foreground whitespace-pre-wrap",
                !isContentExpanded && "line-clamp-[12]"
              )}
            >
              {item.content}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!item && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            No item selected
          </p>
        </div>
      )}
    </RightSidebar>
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

// Extracted Memory Section for Granola meetings
// Memory is auto-saved during sync, this is for display/review only
function ExtractedMemorySection({ item }: { item: TriageItem }) {
  // Cast enrichment to access dynamic fields (stored as JSON in DB)
  const enrichment = item.enrichment as Record<string, unknown> | null;
  const extractedMemory = enrichment?.extractedMemory as {
    entities?: Array<{ name: string; type: string; role?: string; facts: string[] }>;
    facts?: Array<{ content: string; category: string; entityName?: string; confidence: string }>;
    actionItems?: Array<{ description: string; assignee?: string }>;
    summary?: string;
    topics?: string[];
  } | null;

  if (!extractedMemory || item.connector !== "granola") {
    return null;
  }

  const hasEntities = extractedMemory.entities && extractedMemory.entities.length > 0;
  const hasFacts = extractedMemory.facts && extractedMemory.facts.length > 0;
  const hasActionItems = extractedMemory.actionItems && extractedMemory.actionItems.length > 0;

  if (!hasEntities && !hasFacts && !hasActionItems) {
    return null;
  }

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h4 className="text-sm font-medium">Extracted Memory</h4>
        </div>
        <span className="flex items-center gap-1 px-2 py-1 text-xs text-green-400">
          <Check className="w-3 h-3" />
          Auto-saved
        </span>
      </div>

      {/* Summary */}
      {extractedMemory.summary && (
        <p className="text-xs text-muted-foreground mb-3 italic">
          {extractedMemory.summary}
        </p>
      )}

      {/* Topics */}
      {extractedMemory.topics && extractedMemory.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {extractedMemory.topics.map((topic, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-[10px] bg-secondary rounded-full text-muted-foreground"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Entities */}
      {hasEntities && (
        <div className="space-y-2 mb-3">
          <div className="text-xs font-medium text-muted-foreground">People & Companies</div>
          {extractedMemory.entities!.slice(0, 5).map((entity, i) => {
            const Icon = entity.type === "company" ? Building : entity.type === "project" ? FolderOpen : User;
            return (
              <div
                key={i}
                className="flex items-start gap-2 p-2 rounded-lg bg-secondary/50 border border-border text-xs"
              >
                <Icon className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{entity.name}</div>
                  {entity.role && (
                    <div className="text-muted-foreground text-[10px]">{entity.role}</div>
                  )}
                  {entity.facts.length > 0 && (
                    <ul className="mt-1 text-muted-foreground">
                      {entity.facts.slice(0, 2).map((fact, j) => (
                        <li key={j} className="truncate">• {fact}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Facts */}
      {hasFacts && (
        <div className="space-y-2 mb-3">
          <div className="text-xs font-medium text-muted-foreground">Key Facts</div>
          {extractedMemory.facts!.slice(0, 5).map((fact, i) => (
            <div
              key={i}
              className="p-2 rounded-lg bg-secondary/50 border border-border text-xs"
            >
              <p>{fact.content}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground capitalize">
                  {fact.category}
                </span>
                {fact.entityName && (
                  <span className="text-[10px] text-purple-400">
                    → {fact.entityName}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action Items */}
      {hasActionItems && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <ListTodo className="w-3 h-3" />
            Action Items
          </div>
          {extractedMemory.actionItems!.slice(0, 3).map((action, i) => (
            <div
              key={i}
              className="p-2 rounded-lg bg-secondary/50 border border-border text-xs"
            >
              <p>{action.description}</p>
              {action.assignee && (
                <span className="text-[10px] text-muted-foreground">
                  → {action.assignee}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
