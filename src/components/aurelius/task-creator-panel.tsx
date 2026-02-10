"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Check,
  Trash2,
  Pencil,
  Loader2,
  ListTodo,
  Send,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { readSSEStream } from "@/lib/sse/client";
import { toast } from "sonner";
import { TriageItem } from "./triage-card";

interface ExtractedTask {
  id?: string;
  description: string;
  assignee: string | null;
  assigneeType: "self" | "other" | "unknown";
  dueDate: string | null;
  confidence: "high" | "medium" | "low";
  selected: boolean;
}

interface CreatedIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
}

type PanelState = "extracting" | "review" | "submitting" | "done";

interface TaskCreatorPanelProps {
  item: TriageItem;
  onClose: () => void;
  onCreated: () => void; // Called after tasks created successfully (marks item as actioned)
}

export function TaskCreatorPanel({ item, onClose, onCreated }: TaskCreatorPanelProps) {
  const [state, setState] = useState<PanelState>("extracting");
  const [tasks, setTasks] = useState<ExtractedTask[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [createdIssues, setCreatedIssues] = useState<CreatedIssue[]>([]);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Extract tasks on mount
  useEffect(() => {
    let cancelled = false;

    async function extract() {
      try {
        const res = await fetch(`/api/triage/${item.id}/extract-tasks`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("Failed to extract");
        const data = await res.json();

        if (cancelled) return;

        const extractedTasks: ExtractedTask[] = (data.tasks || []).map(
          (t: any) => ({
            ...t,
            selected: t.assigneeType === "self", // Auto-select "for you" tasks
          })
        );

        setTasks(extractedTasks);
        setState("review");
      } catch (error) {
        console.error("Task extraction failed:", error);
        if (!cancelled) {
          toast.error("Failed to extract tasks");
          setState("review"); // Show empty state so user can use chat
        }
      }
    }

    extract();
    return () => { cancelled = true; };
  }, [item.id]);

  // Focus edit input when editing
  useEffect(() => {
    if (editingIdx !== null) {
      editInputRef.current?.focus();
    }
  }, [editingIdx]);

  // Toggle task selection
  const toggleTask = useCallback((idx: number) => {
    setTasks((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, selected: !t.selected } : t))
    );
  }, []);

  // Start editing a task
  const startEdit = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditValue(tasks[idx].description);
  }, [tasks]);

  // Save edit
  const saveEdit = useCallback(() => {
    if (editingIdx === null) return;
    setTasks((prev) =>
      prev.map((t, i) =>
        i === editingIdx ? { ...t, description: editValue.trim() || t.description } : t
      )
    );
    setEditingIdx(null);
    setEditValue("");
  }, [editingIdx, editValue]);

  // Remove a task
  const removeTask = useCallback((idx: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Send chat message for task modification (uses unified /api/chat SSE endpoint)
  const handleChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;

    const message = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    const currentTaskList = tasks.map((t) => `- ${t.description} (${t.assigneeType})`).join("\n");

    const fullMessage = `Current suggested tasks:\n${currentTaskList}\n\nUser request: ${message}`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMessage,
          conversationId: `task-creator-${item.id}`,
          context: {
            surface: "triage" as const,
            triageItem: {
              connector: item.connector,
              sender: item.sender,
              senderName: item.senderName,
              subject: item.subject,
              preview: item.preview,
            },
          },
        }),
      });

      if (!res.ok) throw new Error("Chat failed");

      // Read SSE stream and collect full response
      let fullResponse = "";
      await readSSEStream(res, (data) => {
        if (data.type === "text") {
          fullResponse += data.content as string;
        }
      });

      setChatHistory((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: fullResponse },
      ]);

      // Check for task update JSON in the response
      const actionMatch = fullResponse.match(/\{"action"[\s\S]*\}\s*$/);
      if (actionMatch) {
        try {
          const actionJson = JSON.parse(actionMatch[0]);
          if (actionJson.action === "update_tasks" && actionJson.tasks) {
            const updatedTasks: ExtractedTask[] = actionJson.tasks.map((t: any) => ({
              description: t.description,
              assignee: t.assignee || null,
              assigneeType: t.assigneeType || "self",
              dueDate: t.dueDate || null,
              confidence: t.confidence || "high",
              selected: true,
            }));
            setTasks(updatedTasks);
          }
        } catch {
          // Invalid JSON, ignore
        }
      }

      // Fallback: try to parse task modifications from numbered/bullet lists
      if (!actionMatch) {
        const lines = fullResponse.split("\n");
        const newTasks: ExtractedTask[] = [];
        for (const line of lines) {
          const match = line.match(/^[\s]*[-*\d.]+[\s]+(.+)$/);
          if (match && match[1].length > 10 && match[1].length < 200) {
            newTasks.push({
              description: match[1].trim(),
              assignee: null,
              assigneeType: "self",
              dueDate: null,
              confidence: "high",
              selected: true,
            });
          }
        }
        if (newTasks.length > 0) {
          setTasks(newTasks);
          toast.success(`Updated to ${newTasks.length} tasks`);
        }
      }
    } catch (error) {
      console.error("Chat failed:", error);
      toast.error("Chat failed");
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, tasks, item, chatHistory]);

  // Create Linear issues for selected tasks
  const handleCreate = useCallback(async () => {
    const selectedTasks = tasks.filter((t) => t.selected);
    if (selectedTasks.length === 0) {
      toast.error("Select at least one task");
      return;
    }

    setState("submitting");

    try {
      // Accept tasks with Linear creation flag
      const taskIds = selectedTasks.map((t) => t.id).filter(Boolean);

      const res = await fetch(`/api/triage/${item.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          taskIds: taskIds.length > 0 ? taskIds : undefined,
          tasks: selectedTasks.map((t) => ({
            description: t.description,
            assignee: t.assignee,
          })),
        }),
      });

      if (!res.ok) throw new Error("Failed to create tasks");
      const data = await res.json();

      if (data.createdIssues && data.createdIssues.length > 0) {
        setCreatedIssues(data.createdIssues);
        setState("done");
        toast.success(`Created ${data.createdIssues.length} Linear issue(s)`);
      } else if (data.linearError) {
        toast.error(`Linear: ${data.linearError}`);
        setState("review");
      } else {
        // Tasks accepted but no Linear issues (not configured)
        toast.success("Tasks accepted");
        onCreated();
      }
    } catch (error) {
      console.error("Failed to create tasks:", error);
      toast.error("Failed to create tasks");
      setState("review");
    }
  }, [tasks, item.id, onCreated]);

  // Handle done - mark item as actioned and close
  const handleDone = useCallback(() => {
    onCreated();
  }, [onCreated]);

  const selectedCount = tasks.filter((t) => t.selected).length;
  const forYou = tasks.filter((t) => t.assigneeType === "self");
  const forOthers = tasks.filter((t) => t.assigneeType !== "self");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-150 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
            <h3 className="font-medium text-sm truncate">
              {state === "done" ? "Tasks Created" : `Create Tasks`}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-background transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Item context */}
        <div className="px-4 py-2 border-b border-border bg-background/50 shrink-0">
          <p className="text-xs text-muted-foreground truncate">
            From: <span className="text-foreground">{item.senderName || item.sender}</span>
            {" - "}
            {item.subject}
          </p>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Extracting state */}
          {state === "extracting" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              <p className="text-sm text-muted-foreground">Analyzing content for tasks...</p>
            </div>
          )}

          {/* Submitting state */}
          {state === "submitting" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
              <p className="text-sm text-muted-foreground">Creating {selectedCount} Linear issue(s)...</p>
            </div>
          )}

          {/* Done state */}
          {state === "done" && (
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-400 mb-3">
                <Check className="w-5 h-5" />
                <span className="text-sm font-medium">
                  {createdIssues.length} issue(s) created in Linear
                </span>
              </div>
              {createdIssues.map((issue) => (
                <a
                  key={issue.id}
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border hover:border-purple-400/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-purple-400 font-mono">{issue.identifier}</div>
                    <div className="text-sm truncate">{issue.title}</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                </a>
              ))}
            </div>
          )}

          {/* Review state */}
          {state === "review" && (
            <div className="p-4 space-y-4">
              {tasks.length === 0 ? (
                <div className="text-center py-6">
                  <ListTodo className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No tasks found. Use the chat below to add tasks.
                  </p>
                </div>
              ) : (
                <>
                  {/* For You section */}
                  {forYou.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        For You ({forYou.length})
                      </h4>
                      <div className="space-y-2">
                        {tasks.map((task, idx) => {
                          if (task.assigneeType !== "self") return null;
                          return (
                            <TaskEditRow
                              key={idx}
                              task={task}
                              isEditing={editingIdx === idx}
                              editValue={editValue}
                              editInputRef={editInputRef}
                              onToggle={() => toggleTask(idx)}
                              onEdit={() => startEdit(idx)}
                              onEditChange={setEditValue}
                              onEditSave={saveEdit}
                              onEditCancel={() => setEditingIdx(null)}
                              onRemove={() => removeTask(idx)}
                            />
                          );
                        })}
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
                        {tasks.map((task, idx) => {
                          if (task.assigneeType === "self") return null;
                          return (
                            <TaskEditRow
                              key={idx}
                              task={task}
                              isEditing={editingIdx === idx}
                              editValue={editValue}
                              editInputRef={editInputRef}
                              onToggle={() => toggleTask(idx)}
                              onEdit={() => startEdit(idx)}
                              onEditChange={setEditValue}
                              onEditSave={saveEdit}
                              onEditCancel={() => setEditingIdx(null)}
                              onRemove={() => removeTask(idx)}
                              showAssignee
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Chat messages */}
              {chatHistory.length > 0 && (
                <div className="border-t border-border pt-3 space-y-2">
                  {chatHistory.slice(-4).map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "text-xs px-3 py-2 rounded-lg",
                        msg.role === "user"
                          ? "bg-gold/10 text-gold ml-8"
                          : "bg-background text-muted-foreground mr-8"
                      )}
                    >
                      {msg.content}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {state === "review" && (
          <div className="border-t border-border shrink-0">
            {/* Chat input */}
            <div className="px-4 py-2 flex items-center gap-2">
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleChat();
                  }
                  e.stopPropagation(); // Prevent triage shortcuts
                }}
                placeholder="Modify tasks... (e.g. 'add a task to review the design')"
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/50"
                disabled={chatLoading}
              />
              <button
                onClick={handleChat}
                disabled={!chatInput.trim() || chatLoading}
                className="p-2 rounded-lg text-purple-400 hover:bg-purple-400/10 transition-colors disabled:opacity-50"
              >
                {chatLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Create button */}
            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={handleCreate}
                disabled={selectedCount === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gold/20 text-gold font-medium text-sm hover:bg-gold/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ListTodo className="w-4 h-4" />
                Create {selectedCount} task{selectedCount !== 1 ? "s" : ""} in Linear
              </button>
            </div>
          </div>
        )}

        {/* Done footer */}
        {state === "done" && (
          <div className="px-4 py-3 border-t border-border shrink-0">
            <button
              onClick={handleDone}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-500/20 text-green-400 font-medium text-sm hover:bg-green-500/30 transition-colors"
            >
              <Check className="w-4 h-4" />
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Individual editable task row
function TaskEditRow({
  task,
  isEditing,
  editValue,
  editInputRef,
  onToggle,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onRemove,
  showAssignee = false,
}: {
  task: ExtractedTask;
  isEditing: boolean;
  editValue: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onEdit: () => void;
  onEditChange: (val: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onRemove: () => void;
  showAssignee?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 p-3 rounded-lg border transition-all",
        task.selected
          ? "bg-purple-400/5 border-purple-400/20"
          : "bg-background/50 border-border opacity-60"
      )}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={cn(
          "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
          task.selected
            ? "bg-purple-400 border-purple-400 text-white"
            : "border-border hover:border-purple-400/50"
        )}
      >
        {task.selected && <Check className="w-3 h-3" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onEditSave();
              if (e.key === "Escape") onEditCancel();
            }}
            className="w-full bg-background border border-purple-400/50 rounded px-2 py-1 text-sm focus:outline-none"
          />
        ) : (
          <p className="text-sm">
            {showAssignee && task.assignee && (
              <span className="font-medium text-purple-400">{task.assignee}: </span>
            )}
            {task.description}
          </p>
        )}
        {task.dueDate && (
          <p className="text-xs text-muted-foreground mt-1">{task.dueDate}</p>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-red-400"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
