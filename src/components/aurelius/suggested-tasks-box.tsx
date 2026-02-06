"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, X, ListTodo, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SuggestedTask {
  id: string;
  description: string;
  assignee: string | null;
  assigneeType: "self" | "other" | "unknown";
  dueDate: string | null;
  confidence: "high" | "medium" | "low";
  status: "suggested" | "accepted" | "dismissed";
}

interface SuggestedTasksBoxProps {
  itemId: string;
  initialTasks?: SuggestedTask[];
  className?: string;
}

export function SuggestedTasksBox({ itemId, initialTasks, className }: SuggestedTasksBoxProps) {
  const [tasks, setTasks] = useState<SuggestedTask[]>(initialTasks || []);
  const [isLoading, setIsLoading] = useState(!initialTasks);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Only fetch if no initial tasks were provided (fallback)
  const fetchTasks = useCallback(async () => {
    if (initialTasks) return;
    try {
      const response = await fetch(`/api/triage/${itemId}/tasks`);
      if (!response.ok) throw new Error("Failed to fetch tasks");
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setIsLoading(false);
    }
  }, [itemId, initialTasks]);

  useEffect(() => {
    if (!initialTasks) fetchTasks();
  }, [fetchTasks, initialTasks]);

  // Update tasks when initialTasks prop changes (new card shown)
  useEffect(() => {
    if (initialTasks) {
      setTasks(initialTasks);
      setIsLoading(false);
    }
  }, [initialTasks]);

  // Accept a single task
  const handleAccept = async (taskId: string) => {
    setProcessingIds((prev) => new Set([...prev, taskId]));

    try {
      const response = await fetch(`/api/triage/${itemId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", taskIds: [taskId] }),
      });

      if (!response.ok) throw new Error("Failed to accept task");

      // Remove task from list with animation
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast.success("Task saved");
    } catch (error) {
      console.error("Failed to accept task:", error);
      toast.error("Failed to save task");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  // Dismiss a single task
  const handleDismiss = async (taskId: string) => {
    setProcessingIds((prev) => new Set([...prev, taskId]));

    try {
      const response = await fetch(`/api/triage/${itemId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", taskIds: [taskId] }),
      });

      if (!response.ok) throw new Error("Failed to dismiss task");

      // Remove task from list
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (error) {
      console.error("Failed to dismiss task:", error);
      toast.error("Failed to dismiss task");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  // Accept all "For You" tasks
  const handleAcceptAll = async () => {
    const forYouTasks = tasks.filter((t) => t.assigneeType === "self");
    if (forYouTasks.length === 0) return;

    const taskIds = forYouTasks.map((t) => t.id);
    setProcessingIds(new Set(taskIds));

    try {
      const response = await fetch(`/api/triage/${itemId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", assigneeType: "self" }),
      });

      if (!response.ok) throw new Error("Failed to accept tasks");

      // Remove accepted tasks from list
      setTasks((prev) => prev.filter((t) => t.assigneeType !== "self"));
      toast.success(`${forYouTasks.length} tasks saved`);
    } catch (error) {
      console.error("Failed to accept tasks:", error);
      toast.error("Failed to save tasks");
    } finally {
      setProcessingIds(new Set());
    }
  };

  // Categorize tasks
  const forYou = tasks.filter((t) => t.assigneeType === "self");
  const forOthers = tasks.filter((t) => t.assigneeType === "other" || t.assigneeType === "unknown");

  // Don't render if no tasks or loading
  if (isLoading || tasks.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "w-[640px] bg-background border border-border rounded-xl shadow-lg",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-medium">Suggested Tasks</h3>
          <span className="text-xs text-muted-foreground">({tasks.length})</span>
        </div>
        {forYou.length > 0 && (
          <button
            onClick={handleAcceptAll}
            disabled={processingIds.size > 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gold/20 text-gold rounded-lg hover:bg-gold/30 transition-colors disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            Accept All ({forYou.length})
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* For You section */}
        {forYou.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              For You ({forYou.length})
            </h4>
            <div className="space-y-2">
              {forYou.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onAccept={() => handleAccept(task.id)}
                  onDismiss={() => handleDismiss(task.id)}
                  isProcessing={processingIds.has(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* For Others section */}
        {forOthers.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              For Others ({forOthers.length})
            </h4>
            <div className="space-y-2">
              {forOthers.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onAccept={() => handleAccept(task.id)}
                  onDismiss={() => handleDismiss(task.id)}
                  isProcessing={processingIds.has(task.id)}
                  showAssignee
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Individual task row
function TaskRow({
  task,
  onAccept,
  onDismiss,
  isProcessing,
  showAssignee = false,
}: {
  task: SuggestedTask;
  onAccept: () => void;
  onDismiss: () => void;
  isProcessing: boolean;
  showAssignee?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border transition-all",
        isProcessing && "opacity-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {showAssignee && task.assignee && (
            <span className="font-medium text-purple-400">{task.assignee}: </span>
          )}
          {task.description}
        </p>
        {task.dueDate && (
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {task.dueDate}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onAccept}
          disabled={isProcessing}
          className="p-1.5 rounded-lg text-green-400 hover:bg-green-400/20 transition-colors disabled:opacity-50"
          title="Accept task"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={onDismiss}
          disabled={isProcessing}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
          title="Dismiss task"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
