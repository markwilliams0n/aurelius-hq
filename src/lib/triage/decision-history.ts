import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface TriagePathCounts {
  bulk: number;
  quick: number;
  engaged: number;
  total: number;
}

export interface DecisionSummary {
  sender: string;
  senderDomain: string;
  senderDecisions: TriagePathCounts;
  domainDecisions: TriagePathCounts;
}

function emptyTriagePathCounts(): TriagePathCounts {
  return { bulk: 0, quick: 0, engaged: 0, total: 0 };
}

function rowsToCounts(
  rows: Array<{ triage_path: string; count: number }>
): TriagePathCounts {
  const counts = emptyTriagePathCounts();
  for (const row of rows) {
    if (row.triage_path === "bulk") counts.bulk = row.count;
    else if (row.triage_path === "quick") counts.quick = row.count;
    else if (row.triage_path === "engaged") counts.engaged = row.count;
  }
  counts.total = counts.bulk + counts.quick + counts.engaged;
  return counts;
}

/**
 * Query triage path history for a sender and their domain.
 * Extracts triagePath from the classification JSONB column.
 */
export async function getDecisionHistory(
  sender: string,
  senderDomain: string
): Promise<DecisionSummary> {
  const [senderRows, domainRows] = await Promise.all([
    db.execute(sql`
      SELECT classification->>'triagePath' as triage_path, count(*)::int as count
      FROM inbox_items
      WHERE connector = 'gmail'
        AND sender = ${sender}
        AND status != 'new'
        AND classification->>'triagePath' IS NOT NULL
      GROUP BY classification->>'triagePath'
    `),
    db.execute(sql`
      SELECT classification->>'triagePath' as triage_path, count(*)::int as count
      FROM inbox_items
      WHERE connector = 'gmail'
        AND split_part(sender, '@', 2) = ${senderDomain}
        AND status != 'new'
        AND classification->>'triagePath' IS NOT NULL
      GROUP BY classification->>'triagePath'
    `),
  ]);

  return {
    sender,
    senderDomain,
    senderDecisions: rowsToCounts(
      senderRows as unknown as Array<{ triage_path: string; count: number }>
    ),
    domainDecisions: rowsToCounts(
      domainRows as unknown as Array<{ triage_path: string; count: number }>
    ),
  };
}

/**
 * Format decision history for the classifier prompt.
 * New format: "Sender x@y.com: bulk-archived 6/9, quick-archived 2/9, engaged 1/9"
 */
export function formatDecisionHistory(summary: DecisionSummary): string {
  const { sender, senderDomain, senderDecisions, domainDecisions } = summary;

  if (senderDecisions.total === 0 && domainDecisions.total === 0) {
    return `No prior history with ${sender} or domain ${senderDomain}.`;
  }

  const lines: string[] = [];

  if (senderDecisions.total > 0) {
    lines.push(`Sender ${sender}: ${formatTriageCounts(senderDecisions)}`);
  }

  if (domainDecisions.total > 0) {
    lines.push(`Domain ${senderDomain}: ${formatTriageCounts(domainDecisions)}`);
  }

  return lines.join("\n");
}

function formatTriageCounts(counts: TriagePathCounts): string {
  const parts: string[] = [];
  if (counts.bulk > 0) parts.push(`bulk-archived ${counts.bulk}/${counts.total}`);
  if (counts.quick > 0) parts.push(`quick-archived ${counts.quick}/${counts.total}`);
  if (counts.engaged > 0) parts.push(`engaged ${counts.engaged}/${counts.total}`);
  return parts.join(", ");
}
