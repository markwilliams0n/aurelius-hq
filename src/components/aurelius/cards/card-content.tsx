"use client";

import type { ActionCardData } from "@/lib/types/action-card";
import { ApprovalCardContent } from "./approval-card";
import { ConfigCardContent } from "./config-card";
import { ConfirmationCardContent } from "./confirmation-card";
import { InfoCardContent } from "./info-card";
import { VaultCardContent } from "./vault-card";

interface CardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

/**
 * Routes card rendering to the appropriate pattern component.
 */
export function CardContent({ card, onDataChange, onAction }: CardContentProps) {
  switch (card.pattern) {
    case "approval":
      return <ApprovalCardContent card={card} onDataChange={onDataChange} onAction={onAction} />;
    case "config":
      return <ConfigCardContent card={card} onDataChange={onDataChange} />;
    case "confirmation":
      return <ConfirmationCardContent card={card} />;
    case "info":
      return <InfoCardContent card={card} />;
    case "vault":
      return <VaultCardContent card={card} />;
    default:
      // Fallback: raw data
      return (
        <div className="space-y-1 text-sm">
          {Object.entries(card.data).map(([key, value]) => (
            <p key={key}>
              <span className="text-muted-foreground">{key}: </span>
              <span>{String(value)}</span>
            </p>
          ))}
        </div>
      );
  }
}
