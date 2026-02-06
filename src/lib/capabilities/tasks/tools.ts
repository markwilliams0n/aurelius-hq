import {
  fetchAllMyTasks,
  fetchViewerContext,
  fetchTeamMembers,
  fetchWorkflowStates,
  createIssue,
  updateIssue,
} from "@/lib/linear/issues";
import { db } from "@/lib/db";
import { suggestedTasks } from "@/lib/db/schema/tasks";
import { eq } from "drizzle-orm";
import type { ToolDefinition, ToolResult } from "../types";

// Priority labels for display
const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Normal",
  4: "Low",
};

// Tool definitions for Claude (OpenAI function calling format)
export const TASK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_tasks",
    description:
      "List current tasks from Linear. Returns all active tasks assigned to the user.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in Linear. Looks up team, project, and assignee by name.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the task",
        },
        description: {
          type: "string",
          description: "Optional description/details for the task",
        },
        teamName: {
          type: "string",
          description: "Team name (default: 'Personal')",
        },
        projectName: {
          type: "string",
          description: "Project name to associate the task with",
        },
        assigneeName: {
          type: "string",
          description:
            "Name of the person to assign the task to (partial match supported)",
        },
        priority: {
          type: "number",
          description:
            "Priority level: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description:
      "Update an existing Linear task. Looks up status, assignee, and project by name. Use 'none' for assigneeName or projectName to unassign/remove.",
    parameters: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "The Linear issue ID to update",
        },
        statusName: {
          type: "string",
          description: "New status name (e.g. 'In Progress', 'Done')",
        },
        assigneeName: {
          type: "string",
          description:
            "Name of assignee (partial match). Use 'none' to unassign.",
        },
        projectName: {
          type: "string",
          description:
            "Project name to move to. Use 'none' to remove from project.",
        },
        priority: {
          type: "number",
          description:
            "Priority level: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low",
        },
        title: {
          type: "string",
          description: "New title for the task",
        },
        description: {
          type: "string",
          description: "New description for the task",
        },
      },
      required: ["issueId"],
    },
  },
  {
    name: "get_team_context",
    description:
      "Get workspace context: viewer info, teams, projects, and team members. Useful for understanding the workspace before creating or assigning tasks.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_suggested_tasks",
    description:
      "Get suggested tasks from triage (extracted from meetings, emails, etc.). Filter by status.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by status: 'suggested' (default), 'accepted', 'dismissed', or 'all'",
          enum: ["suggested", "accepted", "dismissed", "all"],
        },
      },
      required: [],
    },
  },
];

// Tool handler — returns null for unrecognized tool names
export async function handleTaskTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  switch (toolName) {
    case "list_tasks": {
      try {
        const { issues, context } = await fetchAllMyTasks();

        const taskList = issues.map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.state?.name,
          priority: issue.priority != null
            ? `${issue.priority} (${PRIORITY_LABELS[issue.priority] ?? "Unknown"})`
            : undefined,
          project: issue.project?.name,
          team: issue.team?.name,
          assignee: issue.assignee?.name,
          dueDate: issue.dueDate,
          url: issue.url,
        }));

        return {
          result: JSON.stringify(
            {
              tasks: taskList,
              count: taskList.length,
              viewer: context.viewer.name,
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          result: JSON.stringify({
            error: "Failed to fetch tasks from Linear",
            details: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    }

    case "create_task": {
      try {
        const title = toolInput.title;
        if (!title || typeof title !== "string") {
          return {
            result: JSON.stringify({
              error:
                "Missing required parameter: title. Please provide a title for the task.",
            }),
          };
        }

        const teamName =
          typeof toolInput.teamName === "string"
            ? toolInput.teamName
            : "Personal";
        const projectName =
          typeof toolInput.projectName === "string"
            ? toolInput.projectName
            : undefined;
        const assigneeName =
          typeof toolInput.assigneeName === "string"
            ? toolInput.assigneeName
            : undefined;
        const description =
          typeof toolInput.description === "string"
            ? toolInput.description
            : undefined;
        const priority =
          typeof toolInput.priority === "number"
            ? toolInput.priority
            : undefined;

        // Look up team, project, and assignee by name
        const [context, members] = await Promise.all([
          fetchViewerContext(),
          assigneeName ? fetchTeamMembers() : Promise.resolve([]),
        ]);

        // Find team by name (case-insensitive)
        const team = context.teams.find(
          (t) => t.name.toLowerCase() === teamName.toLowerCase(),
        );
        if (!team) {
          return {
            result: JSON.stringify({
              error: `Team "${teamName}" not found. Available teams: ${context.teams.map((t) => t.name).join(", ")}`,
            }),
          };
        }

        // Find project by name (case-insensitive) if specified
        let projectId: string | undefined;
        if (projectName) {
          const project = context.projects.find(
            (p) => p.name.toLowerCase() === projectName.toLowerCase(),
          );
          if (!project) {
            return {
              result: JSON.stringify({
                error: `Project "${projectName}" not found. Available projects: ${context.projects.map((p) => p.name).join(", ")}`,
              }),
            };
          }
          projectId = project.id;
        }

        // Find assignee by name (case-insensitive partial match) if specified
        let assigneeId: string | undefined;
        if (assigneeName) {
          const member = members.find((m) =>
            m.name.toLowerCase().includes(assigneeName.toLowerCase()),
          );
          if (!member) {
            return {
              result: JSON.stringify({
                error: `Team member "${assigneeName}" not found. Available members: ${members.map((m) => m.name).join(", ")}`,
              }),
            };
          }
          assigneeId = member.id;
        }

        const result = await createIssue({
          title,
          description,
          teamId: team.id,
          projectId,
          assigneeId,
          priority,
        });

        if (!result.success || !result.issue) {
          return {
            result: JSON.stringify({
              error: "Failed to create task in Linear",
            }),
          };
        }

        return {
          result: JSON.stringify(
            {
              success: true,
              task: {
                id: result.issue.id,
                identifier: result.issue.identifier,
                title: result.issue.title,
                team: result.issue.team?.name,
                project: result.issue.project?.name,
                assignee: result.issue.assignee?.name,
                url: result.issue.url,
              },
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          result: JSON.stringify({
            error: "Failed to create task in Linear",
            details: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    }

    case "update_task": {
      try {
        const issueId = toolInput.issueId;
        if (!issueId || typeof issueId !== "string") {
          return {
            result: JSON.stringify({
              error:
                "Missing required parameter: issueId. Please provide the Linear issue ID.",
            }),
          };
        }

        const statusName =
          typeof toolInput.statusName === "string"
            ? toolInput.statusName
            : undefined;
        const assigneeName =
          typeof toolInput.assigneeName === "string"
            ? toolInput.assigneeName
            : undefined;
        const projectName =
          typeof toolInput.projectName === "string"
            ? toolInput.projectName
            : undefined;
        const priority =
          typeof toolInput.priority === "number"
            ? toolInput.priority
            : undefined;
        const title =
          typeof toolInput.title === "string" ? toolInput.title : undefined;
        const description =
          typeof toolInput.description === "string"
            ? toolInput.description
            : undefined;

        const updates: {
          stateId?: string;
          assigneeId?: string | null;
          projectId?: string | null;
          priority?: number;
          title?: string;
          description?: string;
        } = {};

        // Look up status by name if provided
        if (statusName) {
          const states = await fetchWorkflowStates();
          const state = states.find(
            (s) => s.name.toLowerCase() === statusName.toLowerCase(),
          );
          if (!state) {
            return {
              result: JSON.stringify({
                error: `Status "${statusName}" not found. Available statuses: ${states.map((s) => `${s.name} (${s.team.name})`).join(", ")}`,
              }),
            };
          }
          updates.stateId = state.id;
        }

        // Look up assignee by name if provided
        if (assigneeName !== undefined) {
          if (assigneeName.toLowerCase() === "none") {
            updates.assigneeId = null;
          } else {
            const members = await fetchTeamMembers();
            const member = members.find((m) =>
              m.name.toLowerCase().includes(assigneeName.toLowerCase()),
            );
            if (!member) {
              return {
                result: JSON.stringify({
                  error: `Team member "${assigneeName}" not found. Available members: ${members.map((m) => m.name).join(", ")}`,
                }),
              };
            }
            updates.assigneeId = member.id;
          }
        }

        // Look up project by name if provided
        if (projectName !== undefined) {
          if (projectName.toLowerCase() === "none") {
            updates.projectId = null;
          } else {
            const context = await fetchViewerContext();
            const project = context.projects.find(
              (p) => p.name.toLowerCase() === projectName.toLowerCase(),
            );
            if (!project) {
              return {
                result: JSON.stringify({
                  error: `Project "${projectName}" not found. Available projects: ${context.projects.map((p) => p.name).join(", ")}`,
                }),
              };
            }
            updates.projectId = project.id;
          }
        }

        if (priority !== undefined) updates.priority = priority;
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;

        const result = await updateIssue(issueId, updates);

        if (!result.success || !result.issue) {
          return {
            result: JSON.stringify({
              error: "Failed to update task in Linear",
            }),
          };
        }

        return {
          result: JSON.stringify(
            {
              success: true,
              task: {
                id: result.issue.id,
                identifier: result.issue.identifier,
                title: result.issue.title,
                status: result.issue.state?.name,
                assignee: result.issue.assignee?.name,
                project: result.issue.project?.name,
                priority: result.issue.priority != null
                  ? `${result.issue.priority} (${PRIORITY_LABELS[result.issue.priority] ?? "Unknown"})`
                  : undefined,
                url: result.issue.url,
              },
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          result: JSON.stringify({
            error: "Failed to update task in Linear",
            details: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    }

    case "get_team_context": {
      try {
        const [context, members] = await Promise.all([
          fetchViewerContext(),
          fetchTeamMembers(),
        ]);

        return {
          result: JSON.stringify(
            {
              viewer: context.viewer,
              teams: context.teams,
              projects: context.projects,
              members: members.map((m) => ({
                id: m.id,
                name: m.name,
                email: m.email,
              })),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          result: JSON.stringify({
            error: "Failed to fetch team context from Linear",
            details: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    }

    case "get_suggested_tasks": {
      try {
        const statusFilter =
          typeof toolInput.status === "string" ? toolInput.status : "suggested";

        let rows;
        if (statusFilter === "all") {
          rows = await db.select().from(suggestedTasks);
        } else {
          rows = await db
            .select()
            .from(suggestedTasks)
            .where(eq(suggestedTasks.status, statusFilter as "suggested" | "accepted" | "dismissed"));
        }

        return {
          result: JSON.stringify(
            {
              suggestedTasks: rows.map((row) => ({
                id: row.id,
                description: row.description,
                assignee: row.assignee,
                assigneeType: row.assigneeType,
                dueDate: row.dueDate,
                status: row.status,
                confidence: row.confidence,
                extractedAt: row.extractedAt,
                sourceItemId: row.sourceItemId,
              })),
              count: rows.length,
              filter: statusFilter,
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          result: JSON.stringify({
            error: "Failed to fetch suggested tasks",
            details: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    }

    default:
      return null;
  }
}
