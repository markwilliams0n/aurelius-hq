"use client";

import type { ActionCardData } from "@/lib/types/action-card";

interface InfoCardContentProps {
  card: ActionCardData;
}

/**
 * Info pattern: "FYI, no action required."
 * Renders markdown content or structured data.
 */
export function InfoCardContent({ card }: InfoCardContentProps) {
  const content = (card.data.content || card.data.message || card.data.body) as string | undefined;
  const items = card.data.items as string[] | undefined;

  return (
    <div className="space-y-2 text-sm">
      {content && (
        <div className="whitespace-pre-wrap text-foreground">{content}</div>
      )}
      {items && (
        <ul className="list-disc list-inside space-y-0.5 text-foreground">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {!content && !items && (
        <div className="space-y-1">
          {Object.entries(card.data).map(([key, value]) => (
            <p key={key}>
              <span className="text-muted-foreground">{key}: </span>
              <span>{String(value)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
