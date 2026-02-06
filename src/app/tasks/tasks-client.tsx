"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AppShell } from "@/components/aurelius/app-shell";
import { toast } from "sonner";
import {
  LayoutList,
  Columns3,
  RefreshCw,
  ExternalLink,
  Filter,
  ChevronDown,
  Circle,
  AlertCircle,
  ArrowUp,
  Minus,
  ArrowDown,
  Inbox,
  Tag,
  FolderKanban,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// -- Types --

type ViewMode = "list" | "kanban";

type SourceFilter = "all" | "linear" | "triage";

type GroupBy = "status" | "project" | "priority";

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
      // Deduplicate by ID (same issue can appear in multiple Linear queries)
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

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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

    // Sort groups
    const sortedEntries = Array.from(groups.entries()).sort(([a], [b]) => {
      if (groupBy === "status") {
        return (STATE_TYPE_ORDER[a] ?? 99) - (STATE_TYPE_ORDER[b] ?? 99);
      }
      if (groupBy === "priority") {
        const pa = parseInt(a) || 99;
        const pb = parseInt(b) || 99;
        return pa - pb;
      }
      return a.localeCompare(b);
    });

    // Sort tasks within groups by priority then updated
    for (const [, group] of sortedEntries) {
      group.tasks.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    return sortedEntries;
  }, [filteredTasks, groupBy]);

  // Counts
  const counts = useMemo(() => ({
    all: tasks.length,
    linear: tasks.filter((t) => t.source === "linear").length,
    triage: tasks.filter((t) => t.source === "triage").length,
  }), [tasks]);

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

  return (
    <AppShell>
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-xl text-gold">Tasks</h1>
              <span className="text-sm text-muted-foreground font-mono">
                {filteredTasks.length} tasks
              </span>
            </div>
            <div className="flex items-center gap-2">
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
                <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
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

            {/* Divider */}
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
                    onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      selectedProject
                        ? "bg-purple-400/20 text-purple-400 border border-purple-400/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
                    )}
                  >
                    <FolderKanban className="w-3.5 h-3.5" />
                    {selectedProject
                      ? context.projects.find((p) => p.id === selectedProject)?.name ?? "Project"
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
                        .filter((p) => p.state === "started" || p.state === "planned")
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
          <ListView groups={groupedTasks} groupBy={groupBy} />
        ) : (
          <KanbanView groups={groupedTasks} groupBy={groupBy} />
        )}
      </div>
    </AppShell>
  );
}

// -- List View --

function ListView({
  groups,
  groupBy,
}: {
  groups: Array<[string, { label: string; color?: string; tasks: Task[] }]>;
  groupBy: GroupBy;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map(([key, group]) => {
        const isCollapsed = collapsedGroups.has(key);

        return (
          <div key={key}>
            {/* Group header */}
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

            {/* Tasks */}
            {!isCollapsed && (
              <div>
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
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
  groupBy,
}: {
  groups: Array<[string, { label: string; color?: string; tasks: Task[] }]>;
  groupBy: GroupBy;
}) {
  return (
    <div className="flex-1 overflow-x-auto p-4">
      <div className="flex gap-4 min-h-full">
        {groups.map(([key, group]) => (
          <div
            key={key}
            className="flex-shrink-0 w-72 flex flex-col bg-secondary/30 rounded-xl border border-border"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              {group.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span className="text-sm font-medium truncate">{group.label}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {group.tasks.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {group.tasks.map((task) => (
                <KanbanCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Task Row (List View) --

function TaskRow({ task }: { task: Task }) {
  const handleClick = () => {
    if (task.url) {
      window.open(task.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "flex items-center gap-3 px-6 py-3 border-b border-border hover:bg-secondary/50 transition-colors group",
        task.url && "cursor-pointer"
      )}
    >
      {/* Priority indicator */}
      <PriorityIcon priority={task.priority} />

      {/* State icon */}
      <StateIcon stateType={task.state.type} color={task.state.color} />

      {/* Identifier */}
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

      {/* Title */}
      <span className="text-sm flex-1 truncate">{task.title}</span>

      {/* Labels */}
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

      {/* Project */}
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

      {/* Due date */}
      {task.dueDate && (
        <DueDateBadge dueDate={task.dueDate} />
      )}

      {/* Assignee avatar */}
      {task.assignee?.avatarUrl && (
        <img
          src={task.assignee.avatarUrl}
          alt={task.assignee.name}
          className="w-5 h-5 rounded-full shrink-0"
        />
      )}

      {/* External link icon */}
      {task.url && (
        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

// -- Kanban Card --

function KanbanCard({ task }: { task: Task }) {
  const handleClick = () => {
    if (task.url) {
      window.open(task.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "p-3 bg-background rounded-lg border border-border hover:border-gold/30 transition-colors group",
        task.url && "cursor-pointer"
      )}
    >
      {/* Top row: identifier + priority */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <PriorityIcon priority={task.priority} size="sm" />
          {task.identifier && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {task.identifier}
            </span>
          )}
          {task.source === "triage" && (
            <span className="text-[10px] text-purple-400 font-mono">TRIAGE</span>
          )}
        </div>
        {task.url && (
          <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      {/* Title */}
      <p className="text-sm leading-snug mb-2 line-clamp-2">{task.title}</p>

      {/* Bottom row: labels, project, due date */}
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
        {task.dueDate && (
          <DueDateBadge dueDate={task.dueDate} size="sm" />
        )}
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
      return <AlertCircle className={cn(iconSize, "text-status-urgent shrink-0")} />;
    case 2:
      return <ArrowUp className={cn(iconSize, "text-status-high shrink-0")} />;
    case 3:
      return <Minus className={cn(iconSize, "text-status-normal shrink-0")} />;
    case 4:
      return <ArrowDown className={cn(iconSize, "text-status-low shrink-0")} />;
    default:
      return <Minus className={cn(iconSize, "text-muted-foreground/40 shrink-0")} />;
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
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let colorClass = "text-muted-foreground";
  if (diffDays < 0) colorClass = "text-status-urgent";
  else if (diffDays <= 2) colorClass = "text-status-high";
  else if (diffDays <= 7) colorClass = "text-status-normal";

  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  return (
    <span className={cn("flex items-center gap-1 shrink-0", colorClass, textSize)}>
      <Clock className={size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
    </span>
  );
}
