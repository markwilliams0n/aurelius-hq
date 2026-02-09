import { db } from "@/lib/db";
import { triageRules, type TriageRule, type NewTriageRule } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// ── Seed rules for common automated services ─────────────────────────────────

const SEED_RULES: Array<{
  name: string;
  trigger: NewTriageRule["trigger"];
  batchType: string;
}> = [
  // Notifications — domain-level
  { name: "GitHub → notifications", trigger: { senderDomain: "github.com" }, batchType: "notifications" },
  { name: "Figma → notifications", trigger: { senderDomain: "figma.com" }, batchType: "notifications" },
  { name: "Slack → notifications", trigger: { senderDomain: "slack.com" }, batchType: "notifications" },
  { name: "Airtable → notifications", trigger: { senderDomain: "airtable.com" }, batchType: "notifications" },
  { name: "Linear → notifications", trigger: { senderDomain: "linear.app" }, batchType: "notifications" },
  { name: "Vercel → notifications", trigger: { senderDomain: "vercel.com" }, batchType: "notifications" },
  { name: "Granola → notifications", trigger: { senderDomain: "granola.ai" }, batchType: "notifications" },
  { name: "Railway → notifications", trigger: { senderDomain: "railway.app" }, batchType: "notifications" },
  { name: "Neon → notifications", trigger: { senderDomain: "neon.tech" }, batchType: "notifications" },
  { name: "Sentry → notifications", trigger: { senderDomain: "sentry.io" }, batchType: "notifications" },
  { name: "Google Alerts → notifications", trigger: { sender: "googlealerts-noreply@google.com" }, batchType: "notifications" },
  { name: "Google Search Console → notifications", trigger: { sender: "sc-noreply@google.com" }, batchType: "notifications" },
  // Finance — domain-level
  { name: "Venmo → finance", trigger: { senderDomain: "venmo.com" }, batchType: "finance" },
  { name: "PayPal → finance", trigger: { senderDomain: "paypal.com" }, batchType: "finance" },
  { name: "Stripe → finance", trigger: { senderDomain: "stripe.com" }, batchType: "finance" },
  { name: "QuickBooks → finance", trigger: { senderDomain: "intuit.com" }, batchType: "finance" },
  // Calendar — subject pattern
  { name: "Calendar invites → calendar", trigger: { subjectContains: "invitation:" }, batchType: "calendar" },
  { name: "Calendar updates → calendar", trigger: { subjectContains: "Updated invitation:" }, batchType: "calendar" },
  { name: "Calendar cancellations → calendar", trigger: { subjectContains: "Canceled event:" }, batchType: "calendar" },
  { name: "Calendar RSVPs → calendar", trigger: { subjectContains: "accepted this invitation" }, batchType: "calendar" },
  // Newsletters — domain-level
  { name: "Substack → newsletters", trigger: { senderDomain: "substack.com" }, batchType: "newsletters" },
  { name: "Beehiiv → newsletters", trigger: { senderDomain: "beehiiv.com" }, batchType: "newsletters" },
];

/**
 * Ensure seed rules exist in the database. Skips any rule whose name already exists.
 * Returns the number of new rules created.
 */
export async function seedDefaultRules(): Promise<number> {
  const existing = await db.select({ name: triageRules.name }).from(triageRules);
  const existingNames = new Set(existing.map((r) => r.name));

  let created = 0;
  for (const seed of SEED_RULES) {
    if (existingNames.has(seed.name)) continue;
    await db.insert(triageRules).values({
      name: seed.name,
      type: "structured",
      source: "user_settings",
      trigger: seed.trigger,
      action: { type: "batch", batchType: seed.batchType },
      description: "Default rule — auto-created",
    });
    created++;
  }

  if (created > 0) {
    console.log(`[Rules] Seeded ${created} default rules`);
  }
  return created;
}

// Minimal inbox item shape for rule matching (avoids coupling to full InboxItem type)
export type MatchableItem = {
  connector: string;
  sender: string;
  subject: string;
  content: string;
};

/**
 * Check if an inbox item matches a structured rule's trigger conditions.
 * Returns false for guidance rules (they have no deterministic trigger).
 * All trigger fields use AND logic — every specified field must match.
 */
export function matchRule(rule: TriageRule, item: MatchableItem): boolean {
  // Guidance rules are context for the AI, not deterministic matches
  if (rule.type === "guidance") return false;

  const trigger = rule.trigger;
  if (!trigger) return false;

  // Every specified trigger field must match (AND logic)

  if (trigger.connector && trigger.connector !== item.connector) {
    return false;
  }

  if (trigger.sender && trigger.sender !== item.sender) {
    return false;
  }

  if (trigger.senderDomain) {
    const atIndex = item.sender.indexOf("@");
    const domain = atIndex >= 0 ? item.sender.slice(atIndex + 1) : "";
    if (domain !== trigger.senderDomain) {
      return false;
    }
  }

  if (trigger.subjectContains) {
    if (!item.subject.toLowerCase().includes(trigger.subjectContains.toLowerCase())) {
      return false;
    }
  }

  if (trigger.contentContains) {
    if (!item.content.toLowerCase().includes(trigger.contentContains.toLowerCase())) {
      return false;
    }
  }

  if (trigger.pattern) {
    try {
      const regex = new RegExp(trigger.pattern, "i");
      if (!regex.test(item.subject) && !regex.test(item.content)) {
        return false;
      }
    } catch {
      // Invalid regex pattern — treat as non-match
      return false;
    }
  }

  return true;
}

/**
 * Get all active rules (status = "active")
 */
export async function getActiveRules(): Promise<TriageRule[]> {
  return db.select().from(triageRules).where(eq(triageRules.status, "active"));
}

/**
 * Get all rules regardless of status
 */
export async function getAllRules(): Promise<TriageRule[]> {
  return db.select().from(triageRules);
}

/**
 * Get guidance text from active guidance-type rules.
 * Returns an array of guidance strings for inclusion in AI context.
 */
export async function getGuidanceNotes(): Promise<string[]> {
  const rules = await db
    .select()
    .from(triageRules)
    .where(eq(triageRules.status, "active"));

  return rules
    .filter((r) => r.type === "guidance" && r.guidance)
    .map((r) => r.guidance!);
}

/**
 * Create a new triage rule
 */
export async function createRule(rule: NewTriageRule): Promise<TriageRule> {
  const [created] = await db.insert(triageRules).values(rule).returning();
  return created;
}

/**
 * Update a rule by ID. Returns the updated rule, or null if not found.
 */
export async function updateRule(
  id: string,
  updates: Partial<NewTriageRule>
): Promise<TriageRule | null> {
  const [updated] = await db
    .update(triageRules)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(triageRules.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Delete a rule by ID. Returns true if a row was deleted.
 */
export async function deleteRule(id: string): Promise<boolean> {
  const result = await db
    .delete(triageRules)
    .where(eq(triageRules.id, id))
    .returning();
  return result.length > 0;
}

/**
 * Increment a rule's match count and update lastMatchedAt timestamp.
 */
export async function incrementRuleMatchCount(id: string): Promise<void> {
  await db
    .update(triageRules)
    .set({
      matchCount: sql`${triageRules.matchCount} + 1`,
      lastMatchedAt: new Date(),
    })
    .where(eq(triageRules.id, id));
}
