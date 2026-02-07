import { registerCardHandler } from "../registry";
import { createIssue } from "@/lib/linear/issues";

registerCardHandler("linear:create-issue", {
  label: "Create",
  successMessage: "Linear issue created!",

  async execute(data) {
    const title = data.title as string | undefined;
    const description = data.description as string | undefined;
    const teamId = data.teamId as string | undefined;
    const assigneeId = data.assigneeId as string | undefined;
    const projectId = data.projectId as string | undefined;
    const priority = data.priority as number | undefined;

    if (!title || !teamId) {
      return { status: "error", error: "Missing required fields: title and teamId" };
    }

    try {
      const result = await createIssue({
        title,
        description,
        teamId,
        assigneeId,
        projectId,
        priority,
      });

      if (result.success && result.issue) {
        return {
          status: "confirmed",
          resultUrl: result.issue.url,
        };
      }

      return { status: "error", error: "Failed to create issue" };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});
