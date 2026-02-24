import { db } from "@/lib/db";
import { triageRules } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

interface SenderPattern {
  sender: string;
  senderName: string | null;
  bulk: number;
  quick: number;
  engaged: number;
  total: number;
}

export interface ProposalResult {
  type: "archive" | "surface";
  sender: string;
  senderName: string | null;
  evidence: {
    bulk: number;
    quick: number;
    engaged: number;
    total: number;
    overrideCount?: number;
  };
  ruleText: string;
}

const THRESHOLDS = [3, 5, 8];
const MAX_DISMISSALS = 3;

/**
 * Check for behavioral patterns that warrant rule proposals.
 * Called after triage actions (archive, engage, override).
 */
export async function checkForProposals(
  sender: string,
  senderName: string | null
): Promise<ProposalResult | null> {
  // 1. Check if there's already an active or proposed rule for this sender
  const existingRule = await db
    .select()
    .from(triageRules)
    .where(
      and(
        sql`${triageRules.patternKey} = ${sender}`,
        sql`${triageRules.status} IN ('active', 'proposed')`
      )
    )
    .limit(1);

  if (existingRule.length > 0) return null;

  // 2. Count dismissals for this pattern
  const dismissedRules = await db
    .select()
    .from(triageRules)
    .where(
      and(
        sql`${triageRules.patternKey} = ${sender}`,
        eq(triageRules.status, "dismissed")
      )
    );

  const dismissalCount = dismissedRules.length;
  if (dismissalCount >= MAX_DISMISSALS) return null;

  // 3. Determine the current threshold based on dismissals
  const threshold = THRESHOLDS[Math.min(dismissalCount, THRESHOLDS.length - 1)];

  // 4. Query triage path counts for this sender
  const rows = await db.execute(sql`
    SELECT
      classification->>'triagePath' as triage_path,
      count(*)::int as count
    FROM inbox_items
    WHERE connector = 'gmail'
      AND sender = ${sender}
      AND status != 'new'
      AND classification->>'triagePath' IS NOT NULL
    GROUP BY classification->>'triagePath'
  `);

  const counts: SenderPattern = {
    sender,
    senderName,
    bulk: 0,
    quick: 0,
    engaged: 0,
    total: 0,
  };

  for (const row of rows as unknown as Array<{ triage_path: string; count: number }>) {
    if (row.triage_path === "bulk") counts.bulk = row.count;
    else if (row.triage_path === "quick") counts.quick = row.count;
    else if (row.triage_path === "engaged") counts.engaged = row.count;
  }
  counts.total = counts.bulk + counts.quick + counts.engaged;

  if (counts.total < threshold) return null;

  // 5. Check for noise pattern: all bulk/quick, no engaged
  const noiseCount = counts.bulk + counts.quick;
  if (noiseCount === counts.total && counts.total >= threshold) {
    const displayName = senderName || sender;
    return {
      type: "archive",
      sender,
      senderName,
      evidence: { ...counts },
      ruleText: `Always archive emails from ${displayName}`,
    };
  }

  // 6. Check for override/engagement pattern
  const overrideRows = await db.execute(sql`
    SELECT count(*)::int as count
    FROM inbox_items
    WHERE connector = 'gmail'
      AND sender = ${sender}
      AND classification->>'wasOverride' = 'true'
      AND classification->>'triagePath' = 'engaged'
  `);

  const overrideCount = (overrideRows as unknown as Array<{ count: number }>)[0]?.count ?? 0;

  if (overrideCount >= 2) {
    const displayName = senderName || sender;
    return {
      type: "surface",
      sender,
      senderName,
      evidence: { ...counts, overrideCount },
      ruleText: `Always surface emails from ${displayName}`,
    };
  }

  // 7. Check for high engagement pattern
  if (counts.engaged === counts.total && counts.total >= threshold) {
    const displayName = senderName || sender;
    return {
      type: "surface",
      sender,
      senderName,
      evidence: { ...counts },
      ruleText: `Always surface emails from ${displayName}`,
    };
  }

  return null;
}

/**
 * Create a proposed rule in the database.
 */
export async function createProposedRule(proposal: ProposalResult): Promise<string> {
  const [rule] = await db
    .insert(triageRules)
    .values({
      name: proposal.ruleText,
      type: "guidance",
      source: "learned",
      status: "proposed",
      guidance: proposal.ruleText,
      patternKey: proposal.sender,
      evidence: proposal.evidence,
      description: `Auto-proposed based on ${proposal.evidence.total} triage actions`,
    })
    .returning();

  return rule.id;
}

/**
 * Accept a proposed rule — set status to active.
 */
export async function acceptProposal(ruleId: string): Promise<void> {
  await db
    .update(triageRules)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(triageRules.id, ruleId));
}

/**
 * Dismiss a proposed rule.
 */
export async function dismissProposal(ruleId: string): Promise<void> {
  await db
    .update(triageRules)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(triageRules.id, ruleId));
}
