import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export interface DecisionCounts {
  archived: number;
  snoozed: number;
  actioned: number;
  total: number;
}

export interface DecisionSummary {
  sender: string;
  senderDomain: string;
  senderDecisions: DecisionCounts;
  domainDecisions: DecisionCounts;
}

function emptyDecisionCounts(): DecisionCounts {
  return { archived: 0, snoozed: 0, actioned: 0, total: 0 };
}

function rowsToCounts(
  rows: Array<{ status: string; count: number }>
): DecisionCounts {
  const counts = emptyDecisionCounts();
  for (const row of rows) {
    if (row.status === "archived") counts.archived = row.count;
    else if (row.status === "snoozed") counts.snoozed = row.count;
    else if (row.status === "actioned") counts.actioned = row.count;
  }
  counts.total = counts.archived + counts.snoozed + counts.actioned;
  return counts;
}

/**
 * Query past triage decisions for a sender and their domain.
 * Returns counts of archived/snoozed/actioned emails for both the
 * exact sender address and the sender's domain.
 */
export async function getDecisionHistory(
  sender: string,
  senderDomain: string
): Promise<DecisionSummary> {
  const [senderRows, domainRows] = await Promise.all([
    // Exact sender match
    db
      .select({
        status: inboxItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.connector, "gmail"),
          eq(inboxItems.sender, sender),
          sql`${inboxItems.status} != 'new'`
        )
      )
      .groupBy(inboxItems.status),

    // Domain match (sender LIKE '%@domain')
    db
      .select({
        status: inboxItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.connector, "gmail"),
          sql`${inboxItems.sender} LIKE '%@' || ${senderDomain}`,
          sql`${inboxItems.status} != 'new'`
        )
      )
      .groupBy(inboxItems.status),
  ]);

  return {
    sender,
    senderDomain,
    senderDecisions: rowsToCounts(senderRows),
    domainDecisions: rowsToCounts(domainRows),
  };
}

/**
 * Format a DecisionSummary into human-readable text for the LLM prompt.
 * Returns lines like:
 *   "Sender notifications@github.com: archived 8/9, acted on 1"
 *   "Domain github.com: archived 12/15, acted on 2, snoozed 1"
 * Or for new senders:
 *   "No prior history with new@unknown.com or domain unknown.com."
 */
export function formatDecisionHistory(summary: DecisionSummary): string {
  const { sender, senderDomain, senderDecisions, domainDecisions } = summary;

  // No history at all
  if (senderDecisions.total === 0 && domainDecisions.total === 0) {
    return `No prior history with ${sender} or domain ${senderDomain}.`;
  }

  const lines: string[] = [];

  if (senderDecisions.total > 0) {
    lines.push(
      `Sender ${sender}: ${formatCounts(senderDecisions)}`
    );
  }

  if (domainDecisions.total > 0) {
    lines.push(
      `Domain ${senderDomain}: ${formatCounts(domainDecisions)}`
    );
  }

  return lines.join("\n");
}

function formatCounts(counts: DecisionCounts): string {
  const parts: string[] = [];

  if (counts.archived > 0) {
    parts.push(`archived ${counts.archived}/${counts.total}`);
  }
  if (counts.actioned > 0) {
    parts.push(`acted on ${counts.actioned}`);
  }
  if (counts.snoozed > 0) {
    parts.push(`snoozed ${counts.snoozed}`);
  }

  return parts.join(", ");
}
