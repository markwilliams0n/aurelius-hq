export type ChatSurface = "main" | "triage" | "panel";

export interface TriageItemContext {
  connector: string;
  sender: string;
  senderName?: string;
  subject: string;
  content?: string;
  preview?: string;
}

export interface ChatContext {
  surface: ChatSurface;
  triageItem?: TriageItemContext;
  pageContext?: string;
  overrides?: {
    skipSupermemory?: boolean;
  };
}
