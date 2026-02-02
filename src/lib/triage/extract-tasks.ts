/**
 * Extract potential tasks/action items from triage item content
 * using AI to analyze and categorize by assignee.
 */

import { chat, type Message } from "@/lib/ai/client";
import { db } from "@/lib/db";
import { suggestedTasks, type NewSuggestedTask } from "@/lib/db/schema";

export interface ExtractedTask {
  description: string;
  assignee: string | null;
  assigneeType: "self" | "other" | "unknown";
  dueDate: string | null;
  confidence: "high" | "medium" | "low";
}

export interface TaskExtractionResult {
  tasks: ExtractedTask[];
  forYou: ExtractedTask[];
  forOthers: ExtractedTask[];
}

/**
 * Get user identity context for task extraction.
 * This helps the AI determine "for you" vs "for others".
 */
function getUserIdentity(): { names: string[]; emails: string[] } {
  // TODO: Read from soul.md config or user settings
  // For now, use environment variable or defaults
  const primaryEmail = process.env.USER_EMAIL || "mark@rostr.cc";
  const primaryName = process.env.USER_NAME || "Mark Williamson";

  // Extract name variants
  const names = [
    primaryName,
    primaryName.split(" ")[0], // First name
    primaryName.toLowerCase(),
    primaryName.split(" ")[0].toLowerCase(),
  ];

  const emails = [primaryEmail, primaryEmail.toLowerCase()];

  return { names, emails };
}

const TASK_EXTRACTION_PROMPT = `You are analyzing content to extract potential action items and tasks.

## User Identity
The user's identity is provided below. Tasks assigned to them should be marked as "self".
{USER_IDENTITY}

## Instructions

Extract actionable tasks from the content. For each task:

1. **description**: Clear, actionable description of what needs to be done
2. **assignee**: Person's name if mentioned, null if unclear
3. **assigneeType**:
   - "self" if the task is for the user (matches their name/email, or uses "I will", "I need to", directed at them with "you", "Can you", etc.)
   - "other" if clearly assigned to someone else by name
   - "unknown" if assignee is unclear
4. **dueDate**: If a deadline is mentioned (e.g., "by Friday", "tomorrow", "next week"), include it. Otherwise null.
5. **confidence**:
   - "high" if explicitly stated as a task/action item
   - "medium" if implied or suggested
   - "low" if only vaguely mentioned

## Context Clues for "self"
- Sender field shows who wrote the content
- If user is the sender and says "I will...", that's a self task
- If someone else is the sender and says "Can you..." or "Please...", that's a self task (directed at user)
- Meeting transcripts: look for name mentions in action items

## Output Format
Respond with JSON only, no other text:
{
  "tasks": [
    {
      "description": "Send the proposal to Sarah",
      "assignee": "Mark",
      "assigneeType": "self",
      "dueDate": "Friday",
      "confidence": "high"
    }
  ]
}

If no tasks are found, return: {"tasks": []}

Focus on concrete, actionable items. Skip vague mentions or general discussion.`;

/**
 * Extract tasks from content using AI
 */
export async function extractTasksFromContent(
  content: string,
  context: {
    connector: string;
    sender?: string;
    senderName?: string;
    subject?: string;
    // For Granola meetings
    attendees?: string;
    transcript?: string;
  }
): Promise<TaskExtractionResult> {
  const identity = getUserIdentity();

  // Build identity context for prompt
  const identityContext = `- Names: ${identity.names.join(", ")}
- Email: ${identity.emails.join(", ")}`;

  // Build content for analysis
  const contentParts: string[] = [];

  if (context.subject) {
    contentParts.push(`Subject: ${context.subject}`);
  }

  if (context.sender || context.senderName) {
    contentParts.push(`From: ${context.senderName || context.sender}`);
  }

  if (context.attendees) {
    contentParts.push(`Attendees: ${context.attendees}`);
  }

  contentParts.push("");
  contentParts.push("Content:");
  contentParts.push(content);

  if (context.transcript) {
    contentParts.push("");
    contentParts.push("Meeting Transcript:");
    contentParts.push(context.transcript);
  }

  const fullContent = contentParts.join("\n");

  // Truncate if too long
  const maxLength = 10000;
  const truncatedContent =
    fullContent.length > maxLength
      ? fullContent.slice(0, maxLength) + "\n\n[... content truncated ...]"
      : fullContent;

  try {
    const prompt = TASK_EXTRACTION_PROMPT.replace(
      "{USER_IDENTITY}",
      identityContext
    );

    const messages: Message[] = [{ role: "user", content: truncatedContent }];

    const response = await chat(messages, prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Task Extract] No JSON found in response");
      return { tasks: [], forYou: [], forOthers: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { tasks: ExtractedTask[] };
    const tasks = (parsed.tasks || []).filter(
      (t) => t.description && t.confidence !== "low"
    );

    // Categorize tasks
    const forYou = tasks.filter((t) => t.assigneeType === "self");
    const forOthers = tasks.filter((t) => t.assigneeType === "other");

    return { tasks, forYou, forOthers };
  } catch (error) {
    console.error("[Task Extract] Failed to extract tasks:", error);
    return { tasks: [], forYou: [], forOthers: [] };
  }
}

/**
 * Extract and save tasks for a triage item
 */
export async function extractAndSaveTasks(
  sourceItemId: string,
  content: string,
  context: {
    connector: string;
    sender?: string;
    senderName?: string;
    subject?: string;
    attendees?: string;
    transcript?: string;
  }
): Promise<TaskExtractionResult> {
  const result = await extractTasksFromContent(content, context);

  if (result.tasks.length === 0) {
    return result;
  }

  // Save tasks to database
  const tasksToInsert: NewSuggestedTask[] = result.tasks.map((task) => ({
    sourceItemId,
    description: task.description,
    assignee: task.assignee,
    assigneeType: task.assigneeType,
    dueDate: task.dueDate,
    confidence: task.confidence,
    status: "suggested" as const,
  }));

  try {
    await db.insert(suggestedTasks).values(tasksToInsert);
    console.log(
      `[Task Extract] Saved ${tasksToInsert.length} tasks for item ${sourceItemId}`
    );
  } catch (error) {
    console.error("[Task Extract] Failed to save tasks:", error);
  }

  return result;
}

/**
 * Quick extraction for items that already have action items (like Granola)
 * Converts existing actionItems to our format
 */
export function convertActionItemsToTasks(
  actionItems: Array<{ description: string; assignee?: string; dueDate?: string }>,
  userIdentity?: { names: string[]; emails: string[] }
): ExtractedTask[] {
  const identity = userIdentity || getUserIdentity();
  const userNameLower = identity.names.map((n) => n.toLowerCase());

  return actionItems.map((item) => {
    let assigneeType: "self" | "other" | "unknown" = "unknown";

    if (item.assignee) {
      const assigneeLower = item.assignee.toLowerCase();
      // Check if assignee matches user
      if (
        userNameLower.some(
          (name) => assigneeLower.includes(name) || name.includes(assigneeLower)
        )
      ) {
        assigneeType = "self";
      } else {
        assigneeType = "other";
      }
    }

    return {
      description: item.description,
      assignee: item.assignee || null,
      assigneeType,
      dueDate: item.dueDate || null,
      confidence: "high" as const, // Granola action items are explicitly stated
    };
  });
}
