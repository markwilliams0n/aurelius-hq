export type ChatSurface = "main" | "triage" | "panel" | "vault" | "code";

export interface TriageItemContext {
  connector: string;
  sender: string;
  senderName?: string;
  subject: string;
  content?: string;
  preview?: string;
  /** Number of other unreviewed items from the same sender */
  senderItemCount?: number;
}

export interface ChatContext {
  surface: ChatSurface;
  triageItem?: TriageItemContext;
  pageContext?: string;
  overrides?: {
    skipSupermemory?: boolean;
  };
}
