"use client";

import type { ActionCardData } from "@/lib/types/action-card";

interface ConfirmationCardContentProps {
  card: ActionCardData;
}

/**
 * Confirmation pattern: "Yes or no, quick."
 * Short description, no editing, no rich content.
 */
export function ConfirmationCardContent({ card }: ConfirmationCardContentProps) {
  const description = (card.data.description || card.data.message) as string | undefined;

  return (
    <div className="text-sm">
      {description && (
        <p className="text-foreground">{description}</p>
      )}
    </div>
  );
}
