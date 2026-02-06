import { NewInboxItem } from "@/lib/db/schema";

/**
 * Sort triage items by priority then date (newest first).
 * Only returns items with status "new".
 */
export function getTriageQueue(items: NewInboxItem[]): NewInboxItem[] {
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

  return items
    .filter((item) => item.status === "new")
    .sort((a, b) => {
      // First by priority
      const priorityDiff =
        priorityOrder[a.priority as keyof typeof priorityOrder] -
        priorityOrder[b.priority as keyof typeof priorityOrder];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by date (newest first)
      const dateA = a.receivedAt instanceof Date ? a.receivedAt : new Date(a.receivedAt!);
      const dateB = b.receivedAt instanceof Date ? b.receivedAt : new Date(b.receivedAt!);
      return dateB.getTime() - dateA.getTime();
    });
}
