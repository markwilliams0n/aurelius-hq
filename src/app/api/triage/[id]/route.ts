import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems, type InboxItem } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { syncArchiveToGmail, syncSpamToGmail, markActionNeeded } from "@/lib/gmail/actions";
import { logActivity } from "@/lib/activity";
import { checkForProposals, createProposedRule } from "@/lib/triage/rule-proposals";

// Log the user's actual triage decision into the classification column.
// Fire-and-forget: errors are caught and logged, never block the response.
function logDecision(item: InboxItem, actualAction: string, clientTriagePath?: string) {
  if (item.connector !== "gmail") return;
  const classification = item.classification as Record<string, unknown> | null;
  if (!classification?.recommendation) return;

  const recommendedArchive = classification.recommendation === "archive";
  const userArchived = actualAction === "archived" || actualAction === "spam";
  const wasOverride = recommendedArchive !== userArchived;

  // Derive triagePath:
  // - If client sent one (e.g. 'bulk'), use it
  // - If action is archive/spam and no client path: check if a prior non-archive action exists → 'engaged', else 'quick'
  // - If action is anything else (flag, snooze, etc.) → always 'engaged'
  let triagePath: string;
  if (clientTriagePath) {
    triagePath = clientTriagePath;
  } else if (actualAction === "archived" || actualAction === "spam") {
    const priorAction = classification.actualAction as string | undefined;
    triagePath = priorAction && priorAction !== "archived" && priorAction !== "spam"
      ? "engaged"
      : "quick";
  } else {
    triagePath = "engaged";
  }

  // Cast needed: the classification column type doesn't include decision fields,
  // but we're enriching the existing JSON with learning-loop metadata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrichedClassification = {
    ...classification,
    actualAction,
    wasOverride,
    triagePath,
    decidedAt: new Date().toISOString(),
  } as any;

  db.update(inboxItems)
    .set({ classification: enrichedClassification })
    .where(eq(inboxItems.id, item.id))
    .catch((err) => console.error("[Triage] Decision log failed:", err));
}

// Check if string is a valid UUID
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Find item by id (UUID) or externalId (string)
async function findItem(id: string) {
  // Only compare against id column if it's a valid UUID to avoid DB errors
  if (isUUID(id)) {
    const items = await db
      .select()
      .from(inboxItems)
      .where(or(eq(inboxItems.id, id), eq(inboxItems.externalId, id)))
      .limit(1);
    return items[0];
  } else {
    // Not a UUID, only search by externalId
    const items = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.externalId, id))
      .limit(1);
    return items[0];
  }
}

// GET /api/triage/[id] - Get single item
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const item = await findItem(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}

// POST /api/triage/[id] - Perform action on item
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { action, ...actionData } = body;

  const item = await findItem(id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  let updates: Partial<typeof inboxItems.$inferInsert> = {
    updatedAt: new Date(),
  };

  // Track background tasks for this action
  const backgroundTasks: Promise<void>[] = [];

  switch (action) {
    case "archive":
      updates.status = "archived";
      updates.snoozedUntil = null;
      // Sync to Gmail in background (don't wait)
      if (item.connector === "gmail") {
        backgroundTasks.push(
          syncArchiveToGmail(item.id).catch((error) => {
            console.error("[Triage] Background Gmail archive failed:", error);
          })
        );
      }
      logDecision(item, "archived", actionData.triagePath);
      break;

    case "snooze":
      // Accept either snoozeUntil (ISO string) or duration
      let snoozeUntil: Date;
      if (actionData.snoozeUntil) {
        snoozeUntil = new Date(actionData.snoozeUntil);
      } else {
        const duration = actionData.duration || "1h";
        snoozeUntil = calculateSnoozeTime(duration);
      }
      updates.status = "snoozed";
      updates.snoozedUntil = snoozeUntil;
      logDecision(item, "snoozed");
      break;

    case "flag":
      const currentTags = item.tags || [];
      updates.tags = currentTags.includes("flagged")
        ? currentTags.filter((t) => t !== "flagged")
        : [...currentTags, "flagged"];
      logDecision(item, "flagged");
      break;

    case "priority":
      updates.priority = actionData.priority || "high";
      break;

    case "tag":
      const tag = actionData.tag;
      const existingTags = item.tags || [];
      if (!existingTags.includes(tag)) {
        updates.tags = [...existingTags, tag];
      }
      break;

    case "actioned":
      updates.status = "actioned";
      updates.snoozedUntil = null;
      logDecision(item, "actioned");
      break;

    case "spam":
      updates.status = "archived";
      updates.snoozedUntil = null;
      // Mark as spam in Gmail in background (don't wait)
      if (item.connector === "gmail") {
        backgroundTasks.push(
          syncSpamToGmail(item.id).catch((error) => {
            console.error("[Triage] Background Gmail spam failed:", error);
          })
        );
      }
      logDecision(item, "spam");
      break;

    case "action-needed": {
      const actionSnoozeUntil = new Date();
      actionSnoozeUntil.setDate(actionSnoozeUntil.getDate() + 3);

      // Merge actionNeededDate into existing enrichment
      const currentEnrichment = (item.enrichment as Record<string, unknown>) || {};

      updates.status = "snoozed";
      updates.snoozedUntil = actionSnoozeUntil;
      updates.enrichment = {
        ...currentEnrichment,
        actionNeededDate: new Date().toISOString(),
      };

      // Apply Gmail label in background (don't await)
      if (item.connector === "gmail") {
        backgroundTasks.push(
          markActionNeeded(item.id).catch((err) => {
            console.error("[Action Needed] Gmail label failed:", err);
          })
        );
      }
      logDecision(item, "action-needed");
      break;
    }

    case "restore": {
      updates.status = "new";
      updates.snoozedUntil = null;

      // If restoring from action-needed, clear actionNeededDate from enrichment
      if (actionData.previousAction === "action-needed") {
        const currentEnrichment = (item.enrichment as Record<string, unknown>) || {};
        const { actionNeededDate, ...restEnrichment } = currentEnrichment;
        updates.enrichment = restEnrichment;
      }
      break;
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }

  // Update in database - this we await since we return the item
  const [updatedItem] = await db
    .update(inboxItems)
    .set(updates)
    .where(eq(inboxItems.id, item.id))
    .returning();

  // Log action to activity log in background (don't wait)
  const actionDescriptions: Record<string, string> = {
    archive: `Archived: ${item.subject}`,
    snooze: `Snoozed: ${item.subject}`,
    spam: `Marked as spam: ${item.subject}`,
    "action-needed": `Marked for action: ${item.subject}`,
    restore: `Restored: ${item.subject}`,
    flag: `Flagged: ${item.subject}`,
    actioned: `Marked done: ${item.subject}`,
  };

  backgroundTasks.push(
    logActivity({
      eventType: "triage_action",
      actor: "user",
      description: actionDescriptions[action] || `${action}: ${item.subject}`,
      metadata: {
        action,
        itemId: item.externalId || item.id,
        connector: item.connector,
        subject: item.subject,
        sender: item.senderName || item.sender,
        previousStatus: item.status,
        newStatus: updates.status,
        ...(action === "snooze" && { snoozeUntil: updates.snoozedUntil }),
      },
    }).then(() => {}, (error) => {
      console.error("[Triage] Background activity logging failed:", error);
    })
  );

  // Fire all background tasks without waiting
  if (backgroundTasks.length > 0) {
    Promise.all(backgroundTasks).catch(() => {
      // Errors already logged in individual catch blocks
    });
  }

  // Check for rule proposals (only for gmail archive/engage actions)
  let proposal = null;
  if (item.connector === "gmail" && ["archive", "actioned", "action-needed"].includes(action)) {
    const proposalResult = await checkForProposals(item.sender, item.senderName).catch(() => null);
    if (proposalResult) {
      const ruleId = await createProposedRule(proposalResult).catch(() => null);
      if (ruleId) {
        proposal = {
          id: ruleId,
          type: proposalResult.type,
          ruleText: proposalResult.ruleText,
          sender: proposalResult.sender,
          senderName: proposalResult.senderName,
          evidence: proposalResult.evidence,
        };
      }
    }
  }

  return NextResponse.json({
    success: true,
    action,
    item: updatedItem,
    proposal,
  });
}

// Helper to calculate snooze time from duration string
function calculateSnoozeTime(duration: string): Date {
  const now = new Date();

  switch (duration) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "3h":
      return new Date(now.getTime() + 3 * 60 * 60 * 1000);
    case "4h":
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "1d":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "1w":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "tomorrow":
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    case "nextweek":
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
      nextWeek.setHours(9, 0, 0, 0);
      return nextWeek;
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}
