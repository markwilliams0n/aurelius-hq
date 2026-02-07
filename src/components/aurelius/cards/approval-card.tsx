"use client";

import type { ActionCardData } from "@/lib/types/action-card";
import { SlackMessageCardContent } from "./slack-message-card";
import { GmailCardContent } from "./gmail-card";
import { LinearCardContent } from "./linear-card";

interface ApprovalCardContentProps {
  card: ActionCardData;
  onDataChange?: (data: Record<string, unknown>) => void;
  onAction?: (action: string, data?: Record<string, unknown>) => void;
}

/**
 * Approval pattern: "Review this and decide."
 * Routes to handler-specific renderers for rich content,
 * falls back to a generic markdown/field display.
 */
export function ApprovalCardContent({ card, onDataChange, onAction }: ApprovalCardContentProps) {
  // Handler-specific renderers
  if (card.handler?.startsWith("slack:")) {
    return <SlackMessageCardContent card={card} onDataChange={onDataChange} onAction={onAction} />;
  }

  if (card.handler?.startsWith("gmail:")) {
    return <GmailCardContent card={card} onDataChange={onDataChange} onAction={onAction} />;
  }

  if (card.handler?.startsWith("linear:")) {
    return <LinearCardContent card={card} onDataChange={onDataChange} onAction={onAction} />;
  }

  // Generic approval: show message/content field + any metadata
  const data = card.data;
  const message = (data.message || data.content || data.body) as string | undefined;
  const recipient = (data.recipientName || data.to) as string | undefined;

  return (
    <div className="space-y-2 text-sm">
      {recipient && (
        <div className="text-muted-foreground">
          To: <span className="text-foreground font-medium">{recipient}</span>
        </div>
      )}
      {message ? (
        <div className="rounded-md bg-muted/50 p-3 whitespace-pre-wrap text-foreground">
          {message}
        </div>
      ) : (
        <div className="space-y-1">
          {Object.entries(data).map(([key, value]) => (
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
