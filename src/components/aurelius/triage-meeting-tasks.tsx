"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  X,
  MessageSquare,
  Archive,
  Users,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriageItem } from "@/components/aurelius/triage-card";

interface MeetingTask {
  id: string;
  description: string;
  assignee?: string | null;
  assigneeType?: "self" | "other" | "unknown";
  dueDate?: string | null;
  confidence?: "high" | "medium" | "low";
  status: "suggested" | "accepted" | "dismissed";
}

interface MeetingTasksProps {
  items: TriageItem[];
  tasksByItemId: Record<string, unknown[]>;
  onAcceptTask: (taskId: string, itemId: string) => void;
  onDismissTask: (taskId: string, itemId: string) => void;
  onArchiveMeeting: (item: TriageItem) => void;
  onOpenChat: (item: TriageItem) => void;
}

function getEnrichment(item: TriageItem) {
  return item.enrichment as Record<string, unknown> | null;
}

function getYourTasks(tasks: unknown[]): MeetingTask[] {
  return (tasks as MeetingTask[]).filter(
    (t) =>
      t.status === "suggested" &&
      (t.assigneeType === "self" || t.assigneeType === "unknown")
  );
}

function formatMeetingDate(receivedAt: string): string {
  const date = new Date(receivedAt);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TriageMeetingTasks({
  items,
  tasksByItemId,
  onAcceptTask,
  onDismissTask,
  onArchiveMeeting,
  onOpenChat,
}: MeetingTasksProps) {
  // Only show meetings that have tasks for you, or meetings without tasks at all
  const meetingsWithTasks = useMemo(() => {
    return items.map((item) => {
      // tasksByItemId is keyed by display ID (externalId), which matches
      // item.id after client-side transform. Fall back to dbId for safety.
      const allTasks = tasksByItemId[item.id] || tasksByItemId[item.dbId || item.id] || [];
      const yourTasks = getYourTasks(allTasks);
      const itemKey = item.dbId || item.id;
      return { item, yourTasks, itemKey };
    });
  }, [items, tasksByItemId]);

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
        <CalendarDays className="w-12 h-12 text-muted-foreground/50" />
        <p className="text-muted-foreground text-sm text-center max-w-sm">
          No meetings to review. Meeting tasks will appear after your next sync.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {meetingsWithTasks.map(({ item, yourTasks, itemKey }) => (
        <MeetingCard
          key={item.id}
          item={item}
          itemKey={itemKey}
          tasks={yourTasks}
          onAcceptTask={onAcceptTask}
          onDismissTask={onDismissTask}
          onArchiveMeeting={onArchiveMeeting}
          onOpenChat={onOpenChat}
        />
      ))}
    </div>
  );
}

function MeetingCard({
  item,
  itemKey,
  tasks,
  onAcceptTask,
  onDismissTask,
  onArchiveMeeting,
  onOpenChat,
}: {
  item: TriageItem;
  itemKey: string;
  tasks: MeetingTask[];
  onAcceptTask: (taskId: string, itemId: string) => void;
  onDismissTask: (taskId: string, itemId: string) => void;
  onArchiveMeeting: (item: TriageItem) => void;
  onOpenChat: (item: TriageItem) => void;
}) {
  const enrichment = getEnrichment(item);
  const attendees = enrichment?.attendees as string | undefined;
  const meetingTime = enrichment?.meetingTime as string | undefined;
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const handleAccept = (taskId: string) => {
    setProcessingIds((prev) => new Set([...prev, taskId]));
    onAcceptTask(taskId, itemKey);
    // Optimistic: remove from processing after a delay (parent mutate will refresh)
    setTimeout(() => setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    }), 2000);
  };

  const handleDismiss = (taskId: string) => {
    setProcessingIds((prev) => new Set([...prev, taskId]));
    onDismissTask(taskId, itemKey);
    setTimeout(() => setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    }), 2000);
  };

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Meeting header */}
      <div className="bg-secondary/30 px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-4 h-4 text-gold shrink-0" />
            <h3 className="text-sm font-medium text-foreground truncate">
              {item.subject}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {meetingTime && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {meetingTime}
              </span>
            )}
            {!meetingTime && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatMeetingDate(item.receivedAt)}
              </span>
            )}
            {attendees && (
              <span className="flex items-center gap-1 truncate">
                <Users className="w-3 h-3 shrink-0" />
                <span className="truncate">{attendees}</span>
              </span>
            )}
          </div>
        </div>

        {/* Meeting-level actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onOpenChat(item)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Chat about this meeting"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onArchiveMeeting(item)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Archive meeting"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="px-4 py-2">
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No tasks extracted for you from this meeting.
          </p>
        ) : (
          <ul className="divide-y divide-border/30">
            {tasks.map((task) => {
              const isProcessing = processingIds.has(task.id);
              return (
                <li
                  key={task.id}
                  className="flex items-center gap-3 py-2.5 group"
                >
                  <p className={cn(
                    "flex-1 text-sm text-foreground min-w-0",
                    isProcessing && "opacity-50",
                  )}>
                    {task.description}
                    {task.dueDate && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        due {task.dueDate}
                      </span>
                    )}
                    {task.confidence && task.confidence !== "high" && (
                      <span className={cn(
                        "ml-2 text-[10px] uppercase tracking-wider",
                        task.confidence === "medium"
                          ? "text-yellow-500/70"
                          : "text-muted-foreground/50"
                      )}>
                        {task.confidence}
                      </span>
                    )}
                  </p>

                  {/* Task actions */}
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  ) : (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleAccept(task.id)}
                        className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        title="Accept task (create in Linear)"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDismiss(task.id)}
                        className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Dismiss task"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
