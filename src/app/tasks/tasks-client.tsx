"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { toast } from "sonner";
import {
  LayoutList,
  Columns3,
  RefreshCw,
  ExternalLink,
  Filter,
  ChevronDown,
  ChevronRight,
  Circle,
  AlertCircle,
  ArrowUp,
  Minus,
  ArrowDown,
  Inbox,
  FolderKanban,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  X,
  Search,
  MessageSquare,
  User,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// -- Types --

type ViewMode = "list" | "kanban";
type SourceFilter = "all" | "linear" | "triage";
type GroupBy = "status" | "project" | "priority";
type ActionMenu = "status" | "assign" | "project" | "priority" | "create" | null;

interface TaskState {
  name: string;
  type: string;
  color?: string;
}

interface TaskProject {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

interface TaskLabel {
  id: string;
  name: string;
  color?: string;
}

interface TaskAssignee {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface Task {
  id: string;
  source: "linear" | "triage";
  identifier: string | null;
  title: string;
  description: string | null;
  url: string | null;
  priority: number;
  dueDate: string | null;
  state: TaskState;
  team: { id: string; name: string; key: string } | null;
  project: TaskProject | null;
  labels: TaskLabel[];
  assignee: TaskAssignee | null;
  createdAt: string;
  updatedAt: string;
}

interface TasksContext {
  viewer?: { id: string; name: string; email: string };
  teams?: Array<{ id: string; name: string; key: string }>;
  projects?: Array<{
    id: string;
    name: string;
    state: string;
    color?: string;
    icon?: string;
  }>;
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
  team: { id: string; name: string };
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

// -- Constants --

const STATE_TYPE_ORDER: Record<string, number> = {
  urgent: 0,
  started: 1,
  unstarted: 2,
  backlog: 3,
  triage: 4,
  completed: 5,
  canceled: 6,
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "No priority", color: "text-muted-foreground" },
  1: { label: "Urgent", color: "text-status-urgent" },
  2: { label: "High", color: "text-status-high" },
  3: { label: "Normal", color: "text-status-normal" },
  4: { label: "Low", color: "text-status-low" },
};

const STATE_TYPE_COLORS: Record<string, string> = {
  started: "text-yellow-500",
  unstarted: "text-muted-foreground",
  backlog: "text-muted-foreground/50",
  triage: "text-purple-400",
  completed: "text-green-500",
  canceled: "text-red-400",
};

// -- Component --

export function TasksClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [context, setContext] = useState<TasksContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Detail panel
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  // Action menu state
  const [actionMenu, setActionMenu] = useState<ActionMenu>(null);

  // Metadata for action menus
  const [workflowStates, setWorkflowStates] = useState<WorkflowState[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [metadataLoaded, setMetadataLoaded] = useState(false);

  // Fetch tasks
  const fetchTasks = useCallback(async (showRefreshState = false) => {
    if (showRefreshState) setIsRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (selectedProject) {
        params.set("projectIds", selectedProject);
      }
      const response = await fetch(`/api/tasks?${params}`);
      if (!response.ok) throw new Error("Failed to fetch tasks");
      const data = await response.json();
      const seen = new Set<string>();
      const uniqueTasks = (data.tasks || []).filter((t: Task) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      setTasks(uniqueTasks);
      setContext(data.context || null);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
      toast.error("Failed to load tasks");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedProject]);

  // Fetch metadata (states, members) on first action menu open
  const fetchMetadata = useCallback(async () => {
    if (metadataLoaded) return;
    try {
      const response = await fetch("/api/tasks/metadata");
      if (!response.ok) throw new Error("Failed to fetch metadata");
      const data = await response.json();
      setWorkflowStates(data.states || []);
      setTeamMembers(data.members || []);
      // Merge projects from metadata if context doesn't have them yet
      if (data.projects && context) {
        setContext((prev) =>
          prev ? { ...prev, projects: data.projects, teams: data.teams } : prev
        );
      }
      setMetadataLoaded(true);
    } catch (error) {
      console.error("Failed to fetch metadata:", error);
      toast.error("Failed to load options");
    }
  }, [metadataLoaded, context]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Eagerly fetch metadata (states, members) so actions work immediately
  useEffect(() => {
    fetchMetadata();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (sourceFilter !== "all") {
      result = result.filter((t) => t.source === sourceFilter);
    }
    return result;
  }, [tasks, sourceFilter]);

  // Group tasks
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, { label: string; color?: string; tasks: Task[] }>();

    for (const task of filteredTasks) {
      let key: string;
      let label: string;
      let color: string | undefined;

      switch (groupBy) {
        case "status":
          key = task.state.type;
          label = task.state.name;
          color = task.state.color;
          break;
        case "project":
          key = task.project?.id ?? "no-project";
          label = task.project?.name ?? "No Project";
          color = task.project?.color;
          break;
        case "priority":
          key = String(task.priority);
          label = PRIORITY_LABELS[task.priority]?.label ?? "Unknown";
          break;
      }

      if (!groups.has(key)) {
        groups.set(key, { label, color, tasks: [] });
      }
      groups.get(key)!.tasks.push(task);
    }

    const sortedEntries = Array.from(groups.entries()).sort(([a], [b]) => {
      if (groupBy === "status") {
        return (STATE_TYPE_ORDER[a] ?? 99) - (STATE_TYPE_ORDER[b] ?? 99);
      }
      if (groupBy === "priority") {
        return (parseInt(a) || 99) - (parseInt(b) || 99);
      }
      return a.localeCompare(b);
    });

    for (const [, group] of sortedEntries) {
      group.tasks.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    return sortedEntries;
  }, [filteredTasks, groupBy]);

  // Flat list of task IDs for keyboard nav
  const flatTaskIds = useMemo(
    () => groupedTasks.flatMap(([, g]) => g.tasks.map((t) => t.id)),
    [groupedTasks]
  );

  // Counts
  const counts = useMemo(
    () => ({
      all: tasks.length,
      linear: tasks.filter((t) => t.source === "linear").length,
      triage: tasks.filter((t) => t.source === "triage").length,
    }),
    [tasks]
  );

  // Derive detail task from tasks array (stays in sync with optimistic updates)
  const detailTask = useMemo(
    () => (detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null),
    [detailTaskId, tasks]
  );

  // Filter workflow states by selected/focused tasks' teams
  const filteredStatusStates = useMemo(() => {
    const targetIds =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : focusedId
          ? [focusedId]
          : [];
    const teamIds = new Set(
      targetIds
        .map((id) => tasks.find((t) => t.id === id)?.team?.id)
        .filter((id): id is string => !!id)
    );
    if (teamIds.size === 0) return workflowStates;
    return workflowStates.filter((s) => teamIds.has(s.team.id));
  }, [selectedIds, focusedId, tasks, workflowStates]);

  // Get effective targets: selected tasks, or focused task
  const getTargetIds = useCallback((): string[] => {
    if (selectedIds.size > 0) return Array.from(selectedIds);
    if (focusedId) return [focusedId];
    return [];
  }, [selectedIds, focusedId]);

  const getTargetTasks = useCallback((): Task[] => {
    const ids = getTargetIds();
    return tasks.filter((t) => ids.includes(t.id));
  }, [getTargetIds, tasks]);

  // Toggle selection
  const toggleSelect = useCallback(
    (id: string, additive = false) => {
      setSelectedIds((prev) => {
        const next = new Set(additive ? prev : []);
        if (prev.has(id) && additive) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setFocusedId(id);
    },
    []
  );

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Open action menu (with metadata prefetch)
  const openActionMenu = useCallback(
    (menu: ActionMenu) => {
      if (getTargetIds().length === 0 && menu !== "create") {
        toast.info("Select a task first");
        return;
      }
      fetchMetadata();
      setActionMenu(menu);
    },
    [getTargetIds, fetchMetadata]
  );

  // Apply update to selected tasks (or explicit targets)
  const applyUpdate = useCallback(
    async (update: Record<string, unknown>, label: string, explicitTargetIds?: string[]) => {
      const targetIds = (explicitTargetIds ?? getTargetIds()).filter((id) => {
        const task = tasks.find((t) => t.id === id);
        return task?.source === "linear";
      });

      if (targetIds.length === 0) {
        toast.info("No Linear tasks selected");
        setActionMenu(null);
        return;
      }

      setActionMenu(null);

      // Optimistic: apply locally
      setTasks((prev) =>
        prev.map((t) => {
          if (!targetIds.includes(t.id)) return t;
          const updated = { ...t };
          if (update.stateId && workflowStates.length > 0) {
            const ws = workflowStates.find((s) => s.id === update.stateId);
            if (ws) updated.state = { name: ws.name, type: ws.type, color: ws.color };
          }
          if (update.assigneeId !== undefined) {
            if (update.assigneeId === null) {
              updated.assignee = null;
            } else {
              const member = teamMembers.find((m) => m.id === update.assigneeId);
              if (member)
                updated.assignee = {
                  id: member.id,
                  name: member.name,
                  avatarUrl: member.avatarUrl,
                };
            }
          }
          if (update.projectId !== undefined) {
            if (update.projectId === null) {
              updated.project = null;
            } else {
              const proj = context?.projects?.find(
                (p) => p.id === update.projectId
              );
              if (proj)
                updated.project = {
                  id: proj.id,
                  name: proj.name,
                  color: proj.color,
                  icon: proj.icon,
                };
            }
          }
          if (update.priority !== undefined) {
            updated.priority = update.priority as number;
          }
          return updated;
        })
      );

      // Fire API calls
      const results = await Promise.allSettled(
        targetIds.map((id) =>
          fetch(`/api/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(update),
          })
        )
      );

      const failures = results.filter((r) => r.status === "rejected").length;
      if (failures > 0) {
        toast.error(`${failures} update(s) failed`);
        fetchTasks();
      } else {
        toast.success(
          targetIds.length === 1
            ? label
            : `${label} (${targetIds.length} tasks)`
        );
      }

      if (!explicitTargetIds) clearSelection();
    },
    [
      getTargetIds,
      tasks,
      workflowStates,
      teamMembers,
      context,
      clearSelection,
      fetchTasks,
    ]
  );

  // Create task
  const handleCreateTask = useCallback(
    async (data: {
      title: string;
      description?: string;
      teamId: string;
      stateId?: string;
      assigneeId?: string;
      projectId?: string;
      priority?: number;
    }) => {
      setActionMenu(null);
      try {
        const response = await fetch("/api/tasks/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error("Failed to create task");
        toast.success("Task created");
        fetchTasks(true);
      } catch (error) {
        console.error("Failed to create task:", error);
        toast.error("Failed to create task");
      }
    },
    [fetchTasks]
  );

  // Quick complete: find the "completed" state for the task's team and apply it
  const handleQuickComplete = useCallback(
    (taskId: string) => {
      if (workflowStates.length === 0) {
        fetchMetadata();
        toast.info("Loading...");
        return;
      }
      const task = tasks.find((t) => t.id === taskId);
      if (!task?.team) return;
      const doneState = workflowStates.find(
        (s) => s.team.id === task.team!.id && s.type === "completed"
      );
      if (doneState) {
        applyUpdate({ stateId: doneState.id }, "Marked complete", [taskId]);
      }
    },
    [tasks, workflowStates, fetchMetadata, applyUpdate]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      // Ignore if action menu is open (let the menu handle its own keys)
      if (actionMenu) {
        if (e.key === "Escape") {
          e.preventDefault();
          setActionMenu(null);
        }
        return;
      }

      // Close detail panel
      if (e.key === "Escape") {
        if (detailTaskId) {
          e.preventDefault();
          setDetailTaskId(null);
          return;
        }
        if (selectedIds.size > 0) {
          e.preventDefault();
          clearSelection();
          return;
        }
      }

      switch (e.key) {
        case "s":
        case "S":
          e.preventDefault();
          openActionMenu("status");
          break;
        case "a":
        case "A":
          e.preventDefault();
          openActionMenu("assign");
          break;
        case "m":
        case "M":
          e.preventDefault();
          openActionMenu("project");
          break;
        case "p":
        case "P":
          e.preventDefault();
          openActionMenu("priority");
          break;
        case "c":
        case "C":
          e.preventDefault();
          fetchMetadata();
          setActionMenu("create");
          break;
        case "Enter": {
          e.preventDefault();
          if (focusedId) setDetailTaskId(focusedId);
          break;
        }
        case "ArrowDown":
        case "j": {
          e.preventDefault();
          const idx = focusedId ? flatTaskIds.indexOf(focusedId) : -1;
          const nextIdx = Math.min(idx + 1, flatTaskIds.length - 1);
          if (flatTaskIds[nextIdx]) {
            setFocusedId(flatTaskIds[nextIdx]);
            if (e.shiftKey) toggleSelect(flatTaskIds[nextIdx], true);
          }
          break;
        }
        case "ArrowUp":
        case "k": {
          e.preventDefault();
          const idx = focusedId ? flatTaskIds.indexOf(focusedId) : flatTaskIds.length;
          const prevIdx = Math.max(idx - 1, 0);
          if (flatTaskIds[prevIdx]) {
            setFocusedId(flatTaskIds[prevIdx]);
            if (e.shiftKey) toggleSelect(flatTaskIds[prevIdx], true);
          }
          break;
        }
        case "x": {
          e.preventDefault();
          if (focusedId) toggleSelect(focusedId, true);
          break;
        }
        case "l":
        case "L": {
          // Open in Linear
          const target = focusedId
            ? tasks.find((t) => t.id === focusedId)
            : null;
          if (target?.url) {
            e.preventDefault();
            window.open(target.url, "_blank", "noopener,noreferrer");
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    actionMenu,
    detailTaskId,
    selectedIds,
    focusedId,
    flatTaskIds,
    tasks,
    clearSelection,
    openActionMenu,
    fetchMetadata,
    toggleSelect,
  ]);

  // Loading state
  if (isLoading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading tasks from Linear...</span>
          </div>
        </div>
      </AppShell>
    );
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <AppShell
      rightSidebar={
        detailTask ? (
          <DetailPanel
            task={detailTask}
            onClose={() => setDetailTaskId(null)}
            workflowStates={workflowStates}
            teamMembers={teamMembers}
            projects={context?.projects ?? []}
            onUpdate={(taskId, update, label) =>
              applyUpdate(update, label, [taskId])
            }
            onQuickComplete={handleQuickComplete}
          />
        ) : undefined
      }
      wideSidebar={!!detailTask}
      sidebarWidth={detailTask ? 420 : undefined}
    >
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-xl text-gold">Tasks</h1>
              <span className="text-sm text-muted-foreground font-mono">
                {filteredTasks.length} tasks
              </span>
              {hasSelection && (
                <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded-full">
                  {selectedIds.size} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Create task */}
              <button
                onClick={() => {
                  fetchMetadata();
                  setActionMenu("create");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gold/20 text-gold hover:bg-gold/30 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>

              {/* View mode toggle */}
              <div className="flex items-center border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                    viewMode === "list"
                      ? "bg-gold/20 text-gold"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  List
                </button>
                <button
                  onClick={() => setViewMode("kanban")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                    viewMode === "kanban"
                      ? "bg-gold/20 text-gold"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <Columns3 className="w-3.5 h-3.5" />
                  Board
                </button>
              </div>

              {/* Refresh */}
              <button
                onClick={() => fetchTasks(true)}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")}
                />
                Sync
              </button>
            </div>
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-4">
            {/* Source filter */}
            <div className="flex items-center gap-2">
              {(
                [
                  { value: "all", label: "All", icon: Filter },
                  { value: "linear", label: "Linear", icon: LayoutList },
                  { value: "triage", label: "Triage", icon: Inbox },
                ] as const
              ).map((filter) => {
                const Icon = filter.icon;
                const count = counts[filter.value];
                const isActive = sourceFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    onClick={() => setSourceFilter(filter.value)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      isActive
                        ? "bg-gold/20 text-gold border border-gold/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{filter.label}</span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded-full text-[10px]",
                        isActive ? "bg-gold/30" : "bg-secondary"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="w-px h-5 bg-border" />

            {/* Group by */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Group:</span>
              {(
                [
                  { value: "status", label: "Status", icon: Circle },
                  { value: "project", label: "Project", icon: FolderKanban },
                  { value: "priority", label: "Priority", icon: AlertCircle },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                const isActive = groupBy === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setGroupBy(option.value)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                      isActive
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {option.label}
                  </button>
                );
              })}
            </div>

            {/* Project filter */}
            {context?.projects && context.projects.length > 0 && (
              <>
                <div className="w-px h-5 bg-border" />
                <div className="relative">
                  <button
                    onClick={() =>
                      setShowProjectDropdown(!showProjectDropdown)
                    }
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      selectedProject
                        ? "bg-purple-400/20 text-purple-400 border border-purple-400/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
                    )}
                  >
                    <FolderKanban className="w-3.5 h-3.5" />
                    {selectedProject
                      ? context.projects.find(
                          (p) => p.id === selectedProject
                        )?.name ?? "Project"
                      : "All Projects"}
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  {showProjectDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                      <button
                        onClick={() => {
                          setSelectedProject(null);
                          setShowProjectDropdown(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-secondary transition-colors",
                          !selectedProject && "text-gold"
                        )}
                      >
                        All Projects
                      </button>
                      {context.projects
                        .filter(
                          (p) =>
                            p.state === "started" || p.state === "planned"
                        )
                        .map((project) => (
                          <button
                            key={project.id}
                            onClick={() => {
                              setSelectedProject(project.id);
                              setShowProjectDropdown(false);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-xs hover:bg-secondary transition-colors flex items-center gap-2",
                              selectedProject === project.id && "text-gold"
                            )}
                          >
                            {project.color && (
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: project.color }}
                              />
                            )}
                            {project.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        {/* Selection action bar */}
        {hasSelection && (
          <div className="px-6 py-2 bg-gold/10 border-b border-gold/20 flex items-center gap-3 shrink-0">
            <button
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-medium">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-1 ml-2">
              <ActionBarButton
                label="Status"
                shortcut="S"
                onClick={() => openActionMenu("status")}
              />
              <ActionBarButton
                label="Assign"
                shortcut="A"
                onClick={() => openActionMenu("assign")}
              />
              <ActionBarButton
                label="Move"
                shortcut="M"
                onClick={() => openActionMenu("project")}
              />
              <ActionBarButton
                label="Priority"
                shortcut="P"
                onClick={() => openActionMenu("priority")}
              />
            </div>
          </div>
        )}

        {/* Content */}
        {filteredTasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <CheckCircle2 className="w-16 h-16 text-muted-foreground" />
            <h2 className="font-serif text-2xl text-gold">All clear</h2>
            <p className="text-muted-foreground text-center max-w-md">
              {sourceFilter !== "all"
                ? `No ${sourceFilter} tasks found. Try switching filters.`
                : "No tasks found. Connect Linear or accept triage tasks to see them here."}
            </p>
          </div>
        ) : viewMode === "list" ? (
          <ListView
            groups={groupedTasks}
            selectedIds={selectedIds}
            focusedId={focusedId}
            onToggleSelect={toggleSelect}
            onFocus={setFocusedId}
            onOpenDetail={(task) => setDetailTaskId(task.id)}
            onOpenChat={(task) => {
              window.open(`/chat?context=task&taskId=${task.id}&taskTitle=${encodeURIComponent(task.identifier ? `${task.identifier}: ${task.title}` : task.title)}`, "_blank");
            }}
            onQuickComplete={handleQuickComplete}
          />
        ) : (
          <KanbanView
            groups={groupedTasks}
            selectedIds={selectedIds}
            focusedId={focusedId}
            onToggleSelect={toggleSelect}
            onFocus={setFocusedId}
            onOpenDetail={(task) => setDetailTaskId(task.id)}
            onQuickComplete={handleQuickComplete}
          />
        )}

        {/* Bottom keyboard hints */}
        {!hasSelection && (
          <div className="px-6 py-2 border-t border-border bg-background shrink-0">
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  j/k
                </kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  x
                </kbd>{" "}
                select
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  Enter
                </kbd>{" "}
                detail
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  S
                </kbd>{" "}
                status
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  A
                </kbd>{" "}
                assign
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  M
                </kbd>{" "}
                move
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  P
                </kbd>{" "}
                priority
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  C
                </kbd>{" "}
                create
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
                  L
                </kbd>{" "}
                open
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action menu overlays */}
      {actionMenu === "status" && (
        <CommandPalette
          title="Change Status"
          items={filteredStatusStates.map((s) => ({
            id: s.id,
            label: s.name,
            color: s.color,
            meta: s.team.name,
          }))}
          onSelect={(id) => applyUpdate({ stateId: id }, "Status updated")}
          onClose={() => setActionMenu(null)}
        />
      )}

      {actionMenu === "assign" && (
        <CommandPalette
          title="Assign To"
          items={[
            { id: "__unassign", label: "Unassigned", meta: "Remove assignee" },
            ...teamMembers.map((m) => ({
              id: m.id,
              label: m.name,
              meta: m.email,
              avatarUrl: m.avatarUrl,
            })),
          ]}
          onSelect={(id) =>
            applyUpdate(
              { assigneeId: id === "__unassign" ? null : id },
              "Assignee updated"
            )
          }
          onClose={() => setActionMenu(null)}
        />
      )}

      {actionMenu === "project" && (
        <CommandPalette
          title="Move to Project"
          items={[
            { id: "__none", label: "No Project", meta: "Remove from project" },
            ...(context?.projects ?? [])
              .filter((p) => p.state === "started" || p.state === "planned")
              .map((p) => ({
                id: p.id,
                label: p.name,
                color: p.color,
              })),
          ]}
          onSelect={(id) =>
            applyUpdate(
              { projectId: id === "__none" ? null : id },
              "Project updated"
            )
          }
          onClose={() => setActionMenu(null)}
        />
      )}

      {actionMenu === "priority" && (
        <CommandPalette
          title="Set Priority"
          items={[
            { id: "0", label: "No priority" },
            { id: "1", label: "Urgent", color: "hsl(0, 72%, 51%)" },
            { id: "2", label: "High", color: "hsl(30, 80%, 50%)" },
            { id: "3", label: "Normal", color: "hsl(195, 50%, 40%)" },
            { id: "4", label: "Low", color: "hsl(240, 5%, 55%)" },
          ]}
          onSelect={(id) =>
            applyUpdate({ priority: parseInt(id) }, "Priority updated")
          }
          onClose={() => setActionMenu(null)}
        />
      )}

      {actionMenu === "create" && (
        <CreateTaskDialog
          teams={context?.teams ?? []}
          projects={context?.projects ?? []}
          members={teamMembers}
          states={workflowStates}
          onSubmit={handleCreateTask}
          onClose={() => setActionMenu(null)}
        />
      )}
    </AppShell>
  );
}

// -- Action Bar Button --

function ActionBarButton({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs hover:bg-secondary transition-colors"
    >
      <kbd className="px-1 py-0.5 rounded bg-secondary border border-border font-mono text-[10px]">
        {shortcut}
      </kbd>
      <span>{label}</span>
    </button>
  );
}

// -- Command Palette --

function CommandPalette({
  title,
  items,
  onSelect,
  onClose,
}: {
  title: string;
  items: Array<{
    id: string;
    label: string;
    color?: string;
    meta?: string;
    avatarUrl?: string;
  }>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(search.toLowerCase()) ||
      item.meta?.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    setHighlightIdx(0);
  }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIdx]) {
        onSelect(filtered[highlightIdx].id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-[420px] max-h-[60vh] bg-popover border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-3">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={title}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border font-mono text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Items */}
        <div ref={listRef} className="overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                  idx === highlightIdx
                    ? "bg-gold/10 text-foreground"
                    : "text-foreground hover:bg-secondary"
                )}
              >
                {item.avatarUrl ? (
                  <img
                    src={item.avatarUrl}
                    alt={item.label}
                    className="w-5 h-5 rounded-full shrink-0"
                  />
                ) : item.color ? (
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                ) : (
                  <span className="w-3 h-3 shrink-0" />
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.meta && (
                  <span className="text-xs text-muted-foreground truncate">
                    {item.meta}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// -- Create Task Dialog --

function CreateTaskDialog({
  teams,
  projects,
  members,
  states,
  onSubmit,
  onClose,
}: {
  teams: Array<{ id: string; name: string; key: string }>;
  projects: Array<{
    id: string;
    name: string;
    state: string;
    color?: string;
  }>;
  members: TeamMember[];
  states: WorkflowState[];
  onSubmit: (data: {
    title: string;
    description?: string;
    teamId: string;
    stateId?: string;
    assigneeId?: string;
    projectId?: string;
    priority?: number;
  }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [stateId, setStateId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const teamStates = states.filter((s) => s.team.id === teamId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !teamId) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      teamId,
      stateId: stateId || undefined,
      assigneeId: assigneeId || undefined,
      projectId: projectId || undefined,
      priority: priority || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" />
      <div
        className="relative w-[520px] bg-popover border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-medium">Create Task</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Title */}
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />

            {/* Description */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description..."
              rows={3}
              className="w-full bg-secondary/50 rounded-lg px-3 py-2 text-sm outline-none resize-none placeholder:text-muted-foreground border border-border focus:border-gold/50"
            />

            {/* Fields grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Team */}
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">
                  Team
                </label>
                <select
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    setStateId("");
                  }}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-xs border border-border outline-none"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">
                  Status
                </label>
                <select
                  value={stateId}
                  onChange={(e) => setStateId(e.target.value)}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-xs border border-border outline-none"
                >
                  <option value="">Default</option>
                  {teamStates.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assignee */}
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">
                  Assignee
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-xs border border-border outline-none"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project */}
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">
                  Project
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-xs border border-border outline-none"
                >
                  <option value="">No project</option>
                  {projects
                    .filter(
                      (p) => p.state === "started" || p.state === "planned"
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Priority */}
              <div className="col-span-2">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">
                  Priority
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 0, label: "None" },
                    { value: 1, label: "Urgent" },
                    { value: 2, label: "High" },
                    { value: 3, label: "Normal" },
                    { value: 4, label: "Low" },
                  ].map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                        priority === p.value
                          ? "bg-gold/20 text-gold border-gold/30"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !teamId}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-gold text-background hover:bg-gold/90 transition-colors disabled:opacity-50"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -- Detail Panel (right sidebar) --

function DetailPanel({
  task,
  onClose,
  workflowStates,
  teamMembers,
  projects,
  onUpdate,
  onQuickComplete,
}: {
  task: Task;
  onClose: () => void;
  workflowStates: WorkflowState[];
  teamMembers: TeamMember[];
  projects: Array<{
    id: string;
    name: string;
    state: string;
    color?: string;
    icon?: string;
  }>;
  onUpdate: (
    taskId: string,
    update: Record<string, unknown>,
    label: string
  ) => void;
  onQuickComplete: (taskId: string) => void;
}) {
  const [editingField, setEditingField] = useState<
    "status" | "priority" | "assignee" | "project" | null
  >(null);

  const isLinear = task.source === "linear";

  // Filter states to this task's team only
  const teamStates = useMemo(
    () =>
      workflowStates
        .filter((s) => s.team.id === task.team?.id)
        .sort((a, b) => a.position - b.position),
    [workflowStates, task.team?.id]
  );

  const doneState = teamStates.find((s) => s.type === "completed");
  const isCompleted =
    task.state.type === "completed" || task.state.type === "canceled";

  return (
    <div className="h-full border-l border-border bg-background flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {task.identifier && (
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {task.identifier}
            </span>
          )}
          <StateIcon stateType={task.state.type} color={task.state.color} />
        </div>
        <div className="flex items-center gap-1.5">
          {/* Quick complete */}
          {isLinear && doneState && !isCompleted && (
            <button
              onClick={() => onQuickComplete(task.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-green-500 hover:bg-green-500/10 transition-colors"
              title="Mark complete"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Done
            </button>
          )}
          {task.url && (
            <button
              onClick={() =>
                window.open(task.url!, "_blank", "noopener,noreferrer")
              }
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Open in Linear"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() =>
              window.open(
                `/chat?context=task&taskId=${task.id}&taskTitle=${encodeURIComponent(task.identifier ? `${task.identifier}: ${task.title}` : task.title)}`,
                "_blank"
              )
            }
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Open in Chat"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        <h2 className="text-base font-medium leading-snug">{task.title}</h2>

        {/* Metadata */}
        <div className="space-y-3">
          {/* Status - clickable */}
          <DetailField label="Status">
            <div className="relative">
              <button
                onClick={() =>
                  isLinear &&
                  setEditingField(
                    editingField === "status" ? null : "status"
                  )
                }
                className={cn(
                  "flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-lg transition-colors",
                  isLinear
                    ? "hover:bg-secondary cursor-pointer"
                    : "cursor-default"
                )}
              >
                <StateIcon
                  stateType={task.state.type}
                  color={task.state.color}
                />
                <span className="text-sm">{task.state.name}</span>
              </button>
              {editingField === "status" && (
                <FieldDropdown
                  items={teamStates.map((s) => ({
                    id: s.id,
                    label: s.name,
                    color: s.color,
                  }))}
                  onSelect={(id) => {
                    onUpdate(task.id, { stateId: id }, "Status updated");
                    setEditingField(null);
                  }}
                  onClose={() => setEditingField(null)}
                />
              )}
            </div>
          </DetailField>

          {/* Priority - clickable */}
          <DetailField label="Priority">
            <div className="relative">
              <button
                onClick={() =>
                  isLinear &&
                  setEditingField(
                    editingField === "priority" ? null : "priority"
                  )
                }
                className={cn(
                  "flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-lg transition-colors",
                  isLinear
                    ? "hover:bg-secondary cursor-pointer"
                    : "cursor-default"
                )}
              >
                <PriorityIcon priority={task.priority} />
                <span className="text-sm">
                  {PRIORITY_LABELS[task.priority]?.label ?? "None"}
                </span>
              </button>
              {editingField === "priority" && (
                <FieldDropdown
                  items={[
                    { id: "0", label: "No priority" },
                    { id: "1", label: "Urgent", color: "hsl(0, 72%, 51%)" },
                    { id: "2", label: "High", color: "hsl(30, 80%, 50%)" },
                    { id: "3", label: "Normal", color: "hsl(195, 50%, 40%)" },
                    { id: "4", label: "Low", color: "hsl(240, 5%, 55%)" },
                  ]}
                  onSelect={(id) => {
                    onUpdate(
                      task.id,
                      { priority: parseInt(id) },
                      "Priority updated"
                    );
                    setEditingField(null);
                  }}
                  onClose={() => setEditingField(null)}
                />
              )}
            </div>
          </DetailField>

          {/* Assignee - clickable */}
          <DetailField label="Assignee">
            <div className="relative">
              <button
                onClick={() =>
                  isLinear &&
                  setEditingField(
                    editingField === "assignee" ? null : "assignee"
                  )
                }
                className={cn(
                  "flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-lg transition-colors",
                  isLinear
                    ? "hover:bg-secondary cursor-pointer"
                    : "cursor-default"
                )}
              >
                {task.assignee ? (
                  <>
                    {task.assignee.avatarUrl ? (
                      <img
                        src={task.assignee.avatarUrl}
                        alt={task.assignee.name}
                        className="w-5 h-5 rounded-full"
                      />
                    ) : (
                      <User className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-sm">{task.assignee.name}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Unassigned
                  </span>
                )}
              </button>
              {editingField === "assignee" && (
                <FieldDropdown
                  items={[
                    {
                      id: "__unassign",
                      label: "Unassigned",
                      meta: "Remove assignee",
                    },
                    ...teamMembers.map((m) => ({
                      id: m.id,
                      label: m.name,
                      avatarUrl: m.avatarUrl,
                      meta: m.email,
                    })),
                  ]}
                  onSelect={(id) => {
                    onUpdate(
                      task.id,
                      { assigneeId: id === "__unassign" ? null : id },
                      "Assignee updated"
                    );
                    setEditingField(null);
                  }}
                  onClose={() => setEditingField(null)}
                />
              )}
            </div>
          </DetailField>

          {/* Project - clickable */}
          <DetailField label="Project">
            <div className="relative">
              <button
                onClick={() =>
                  isLinear &&
                  setEditingField(
                    editingField === "project" ? null : "project"
                  )
                }
                className={cn(
                  "flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-lg transition-colors",
                  isLinear
                    ? "hover:bg-secondary cursor-pointer"
                    : "cursor-default"
                )}
              >
                {task.project ? (
                  <>
                    {task.project.color && (
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: task.project.color }}
                      />
                    )}
                    <span className="text-sm">{task.project.name}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No project
                  </span>
                )}
              </button>
              {editingField === "project" && (
                <FieldDropdown
                  items={[
                    {
                      id: "__none",
                      label: "No Project",
                      meta: "Remove from project",
                    },
                    ...projects
                      .filter(
                        (p) => p.state === "started" || p.state === "planned"
                      )
                      .map((p) => ({
                        id: p.id,
                        label: p.name,
                        color: p.color,
                      })),
                  ]}
                  onSelect={(id) => {
                    onUpdate(
                      task.id,
                      { projectId: id === "__none" ? null : id },
                      "Project updated"
                    );
                    setEditingField(null);
                  }}
                  onClose={() => setEditingField(null)}
                />
              )}
            </div>
          </DetailField>

          {task.labels.length > 0 && (
            <DetailField label="Labels">
              <div className="flex flex-wrap gap-1">
                {task.labels.map((label) => (
                  <span
                    key={label.id}
                    className="text-xs px-2 py-0.5 rounded-full border"
                    style={{
                      backgroundColor: label.color
                        ? `${label.color}20`
                        : undefined,
                      color: label.color || undefined,
                      borderColor: label.color
                        ? `${label.color}40`
                        : undefined,
                    }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </DetailField>
          )}

          {task.dueDate && (
            <DetailField label="Due Date">
              <DueDateBadge dueDate={task.dueDate} />
            </DetailField>
          )}

          <DetailField label="Created">
            <span className="text-sm text-muted-foreground">
              {new Date(task.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </DetailField>
        </div>

        {/* Description */}
        {task.description && (
          <div className="pt-2 border-t border-border">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {task.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-muted-foreground w-16 shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// -- Inline Field Dropdown --

function FieldDropdown({
  items,
  onSelect,
  onClose,
}: {
  items: Array<{
    id: string;
    label: string;
    color?: string;
    avatarUrl?: string;
    meta?: string;
  }>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const filtered = items.filter(
    (i) =>
      i.label.toLowerCase().includes(search.toLowerCase()) ||
      i.meta?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50"
    >
      {items.length > 5 && (
        <div className="px-3 py-2 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}
      <div className="max-h-52 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">
            No matches
          </div>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-secondary transition-colors"
            >
              {item.avatarUrl ? (
                <img
                  src={item.avatarUrl}
                  alt={item.label}
                  className="w-4 h-4 rounded-full shrink-0"
                />
              ) : item.color ? (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
              ) : (
                <span className="w-2.5 h-2.5 shrink-0" />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.meta && (
                <span className="text-muted-foreground truncate text-[10px]">
                  {item.meta}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// -- List View --

function ListView({
  groups,
  selectedIds,
  focusedId,
  onToggleSelect,
  onFocus,
  onOpenDetail,
  onOpenChat,
  onQuickComplete,
}: {
  groups: Array<[string, { label: string; color?: string; tasks: Task[] }]>;
  selectedIds: Set<string>;
  focusedId: string | null;
  onToggleSelect: (id: string, additive?: boolean) => void;
  onFocus: (id: string) => void;
  onOpenDetail: (task: Task) => void;
  onOpenChat: (task: Task) => void;
  onQuickComplete: (taskId: string) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map(([key, group]) => {
        const isCollapsed = collapsedGroups.has(key);
        return (
          <div key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="w-full flex items-center gap-2 px-6 py-2.5 bg-secondary/50 border-b border-border hover:bg-secondary transition-colors sticky top-0 z-10"
            >
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-muted-foreground transition-transform",
                  isCollapsed && "-rotate-90"
                )}
              />
              {group.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span className="text-sm font-medium">{group.label}</span>
              <span className="text-xs text-muted-foreground ml-1">
                {group.tasks.length}
              </span>
            </button>
            {!isCollapsed && (
              <div>
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isSelected={selectedIds.has(task.id)}
                    isFocused={focusedId === task.id}
                    onToggleSelect={onToggleSelect}
                    onFocus={onFocus}
                    onOpenDetail={onOpenDetail}
                    onOpenChat={onOpenChat}
                    onQuickComplete={onQuickComplete}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -- Kanban View --

function KanbanView({
  groups,
  selectedIds,
  focusedId,
  onToggleSelect,
  onFocus,
  onOpenDetail,
  onQuickComplete,
}: {
  groups: Array<[string, { label: string; color?: string; tasks: Task[] }]>;
  selectedIds: Set<string>;
  focusedId: string | null;
  onToggleSelect: (id: string, additive?: boolean) => void;
  onFocus: (id: string) => void;
  onOpenDetail: (task: Task) => void;
  onQuickComplete: (taskId: string) => void;
}) {
  return (
    <div className="flex-1 overflow-x-auto p-4">
      <div className="flex gap-4 min-h-full">
        {groups.map(([key, group]) => (
          <div
            key={key}
            className="flex-shrink-0 w-72 flex flex-col bg-secondary/30 rounded-xl border border-border"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              {group.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span className="text-sm font-medium truncate">
                {group.label}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {group.tasks.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {group.tasks.map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isFocused={focusedId === task.id}
                  onToggleSelect={onToggleSelect}
                  onFocus={onFocus}
                  onOpenDetail={onOpenDetail}
                  onQuickComplete={onQuickComplete}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Task Row (List View) --

function TaskRow({
  task,
  isSelected,
  isFocused,
  onToggleSelect,
  onFocus,
  onOpenDetail,
  onOpenChat,
  onQuickComplete,
}: {
  task: Task;
  isSelected: boolean;
  isFocused: boolean;
  onToggleSelect: (id: string, additive?: boolean) => void;
  onFocus: (id: string) => void;
  onOpenDetail: (task: Task) => void;
  onOpenChat: (task: Task) => void;
  onQuickComplete: (taskId: string) => void;
}) {
  return (
    <div
      onClick={(e) => {
        onFocus(task.id);
        if (e.metaKey || e.ctrlKey) {
          onToggleSelect(task.id, true);
        } else {
          onOpenDetail(task);
        }
      }}
      className={cn(
        "flex items-center gap-3 px-6 py-3 border-b border-border hover:bg-secondary/50 transition-colors cursor-pointer group",
        isSelected && "bg-gold/5 border-l-2 border-l-gold",
        isFocused && !isSelected && "bg-secondary/30"
      )}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(task.id, true);
        }}
        className={cn(
          "w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors",
          isSelected
            ? "bg-gold border-gold text-background"
            : "border-border group-hover:border-muted-foreground"
        )}
      >
        {isSelected && <Check className="w-3 h-3" />}
      </button>

      <PriorityIcon priority={task.priority} />
      <StateIcon stateType={task.state.type} color={task.state.color} />

      {task.identifier && (
        <span className="text-xs text-muted-foreground font-mono shrink-0 w-16">
          {task.identifier}
        </span>
      )}
      {task.source === "triage" && (
        <span className="text-xs text-purple-400 font-mono shrink-0 w-16">
          TRIAGE
        </span>
      )}

      <span className="text-sm flex-1 truncate">{task.title}</span>

      {task.labels.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="text-[10px] px-1.5 py-0.5 rounded-full border border-border"
              style={{
                backgroundColor: label.color ? `${label.color}20` : undefined,
                color: label.color || undefined,
                borderColor: label.color ? `${label.color}40` : undefined,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      {task.project && (
        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
          {task.project.color && (
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: task.project.color }}
            />
          )}
          {task.project.name}
        </span>
      )}

      {task.dueDate && <DueDateBadge dueDate={task.dueDate} />}

      {task.assignee?.avatarUrl && (
        <img
          src={task.assignee.avatarUrl}
          alt={task.assignee.name}
          className="w-5 h-5 rounded-full shrink-0"
        />
      )}

      {/* Quick complete */}
      {task.source === "linear" && task.state.type !== "completed" && task.state.type !== "canceled" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onQuickComplete(task.id);
          }}
          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-green-500 hover:bg-secondary transition-all shrink-0"
          title="Mark complete"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Chat button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenChat(task);
        }}
        className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all shrink-0"
        title="Open in Chat"
      >
        <MessageSquare className="w-3.5 h-3.5" />
      </button>

      {task.url && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.open(task.url!, "_blank", "noopener,noreferrer");
          }}
          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all shrink-0"
          title="Open in Linear"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// -- Kanban Card --

function KanbanCard({
  task,
  isSelected,
  isFocused,
  onToggleSelect,
  onFocus,
  onOpenDetail,
  onQuickComplete,
}: {
  task: Task;
  isSelected: boolean;
  isFocused: boolean;
  onToggleSelect: (id: string, additive?: boolean) => void;
  onFocus: (id: string) => void;
  onOpenDetail: (task: Task) => void;
  onQuickComplete: (taskId: string) => void;
}) {
  return (
    <div
      onClick={() => {
        onFocus(task.id);
        onOpenDetail(task);
      }}
      className={cn(
        "p-3 bg-background rounded-lg border transition-colors group cursor-pointer",
        isSelected
          ? "border-gold bg-gold/5"
          : isFocused
            ? "border-gold/30"
            : "border-border hover:border-gold/30"
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(task.id, true);
            }}
            className={cn(
              "w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors",
              isSelected
                ? "bg-gold border-gold text-background"
                : "border-border group-hover:border-muted-foreground"
            )}
          >
            {isSelected && <Check className="w-2.5 h-2.5" />}
          </button>
          <PriorityIcon priority={task.priority} size="sm" />
          {task.identifier && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {task.identifier}
            </span>
          )}
          {task.source === "triage" && (
            <span className="text-[10px] text-purple-400 font-mono">
              TRIAGE
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {task.source === "linear" && task.state.type !== "completed" && task.state.type !== "canceled" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickComplete(task.id);
              }}
              className="p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-green-500 transition-all"
              title="Mark complete"
            >
              <CheckCircle2 className="w-3 h-3" />
            </button>
          )}
          {task.url && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(task.url!, "_blank", "noopener,noreferrer");
              }}
              className="p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <p className="text-sm leading-snug mb-2 line-clamp-2">{task.title}</p>

      <div className="flex items-center gap-2 flex-wrap">
        {task.labels.slice(0, 2).map((label) => (
          <span
            key={label.id}
            className="text-[10px] px-1.5 py-0.5 rounded-full border"
            style={{
              backgroundColor: label.color ? `${label.color}20` : undefined,
              color: label.color || undefined,
              borderColor: label.color ? `${label.color}40` : undefined,
            }}
          >
            {label.name}
          </span>
        ))}
        {task.project && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            {task.project.color && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: task.project.color }}
              />
            )}
            {task.project.name}
          </span>
        )}
        {task.dueDate && <DueDateBadge dueDate={task.dueDate} size="sm" />}
        {task.assignee?.avatarUrl && (
          <img
            src={task.assignee.avatarUrl}
            alt={task.assignee.name}
            className="w-4 h-4 rounded-full ml-auto"
          />
        )}
      </div>
    </div>
  );
}

// -- Priority Icon --

function PriorityIcon({
  priority,
  size = "md",
}: {
  priority: number;
  size?: "sm" | "md";
}) {
  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  switch (priority) {
    case 1:
      return (
        <AlertCircle className={cn(iconSize, "text-status-urgent shrink-0")} />
      );
    case 2:
      return (
        <ArrowUp className={cn(iconSize, "text-status-high shrink-0")} />
      );
    case 3:
      return (
        <Minus className={cn(iconSize, "text-status-normal shrink-0")} />
      );
    case 4:
      return (
        <ArrowDown className={cn(iconSize, "text-status-low shrink-0")} />
      );
    default:
      return (
        <Minus className={cn(iconSize, "text-muted-foreground/40 shrink-0")} />
      );
  }
}

// -- State Icon --

function StateIcon({
  stateType,
  color,
}: {
  stateType: string;
  color?: string;
}) {
  const colorClass = STATE_TYPE_COLORS[stateType] ?? "text-muted-foreground";
  switch (stateType) {
    case "completed":
      return <CheckCircle2 className={cn("w-4 h-4 shrink-0", colorClass)} />;
    case "canceled":
      return <XCircle className={cn("w-4 h-4 shrink-0", colorClass)} />;
    case "started":
      return (
        <div
          className="w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center"
          style={{ borderColor: color || "currentColor" }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: color || "currentColor" }}
          />
        </div>
      );
    case "triage":
      return <Inbox className="w-4 h-4 shrink-0 text-purple-400" />;
    default:
      return (
        <div
          className="w-4 h-4 rounded-full border-2 shrink-0"
          style={{ borderColor: color || "hsl(var(--muted-foreground))" }}
        />
      );
  }
}

// -- Due Date Badge --

function DueDateBadge({
  dueDate,
  size = "md",
}: {
  dueDate: string;
  size?: "sm" | "md";
}) {
  const date = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  let colorClass = "text-muted-foreground";
  if (diffDays < 0) colorClass = "text-status-urgent";
  else if (diffDays <= 2) colorClass = "text-status-high";
  else if (diffDays <= 7) colorClass = "text-status-normal";

  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  return (
    <span
      className={cn("flex items-center gap-1 shrink-0", colorClass, textSize)}
    >
      <Clock className={size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
    </span>
  );
}
