import { db } from "@/lib/db";
import { activityLog, eventTypeEnum, actorEnum } from "@/lib/db/schema";

type EventType = (typeof eventTypeEnum.enumValues)[number];
type Actor = (typeof actorEnum.enumValues)[number];

interface LogActivityParams {
  eventType: EventType;
  actor: Actor;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity({
  eventType,
  actor,
  description,
  metadata,
}: LogActivityParams) {
  const [entry] = await db
    .insert(activityLog)
    .values({
      eventType,
      actor,
      description,
      metadata,
    })
    .returning();

  return entry;
}

export async function getRecentActivity(limit = 50) {
  return db.query.activityLog.findMany({
    orderBy: (log, { desc }) => [desc(log.createdAt)],
    limit,
  });
}
