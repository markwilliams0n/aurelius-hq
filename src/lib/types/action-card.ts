export type ActionCardStatus = "pending" | "confirmed" | "canceled" | "sent" | "error";

export type ActionCardType = "slack_message" | "task" | "email_draft";

export interface ActionCardData {
  id: string;
  cardType: ActionCardType;
  status: ActionCardStatus;
  data: Record<string, unknown>;
  actions: string[];
  error?: string;
  resultUrl?: string;
}
