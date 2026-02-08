export type CardPattern = "approval" | "config" | "confirmation" | "info" | "vault";

export type CardStatus = "pending" | "confirmed" | "dismissed" | "error";

export interface ActionCardData {
  id: string;
  messageId?: string;
  conversationId?: string;
  pattern: CardPattern;
  status: CardStatus;
  title: string;
  data: Record<string, unknown>;
  handler?: string | null; // e.g. "slack:send-message"
  result?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}
