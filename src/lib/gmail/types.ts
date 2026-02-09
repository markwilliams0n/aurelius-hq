/**
 * Gmail Connector Types
 */

// Gmail message from API
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string; // Unix timestamp in ms
  payload: GmailMessagePayload;
}

export interface GmailMessagePayload {
  mimeType: string;
  headers: GmailHeader[];
  body?: GmailMessageBody;
  parts?: GmailMessagePart[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessageBody {
  attachmentId?: string;
  size: number;
  data?: string; // Base64 encoded
}

export interface GmailMessagePart {
  partId: string;
  mimeType: string;
  filename?: string;
  headers: GmailHeader[];
  body: GmailMessageBody;
  parts?: GmailMessagePart[];
}

// Parsed email for our use
export interface ParsedEmail {
  messageId: string;
  rfc822MessageId?: string;
  threadId: string;
  from: {
    email: string;
    name?: string;
  };
  to: Array<{ email: string; name?: string }>;
  cc: Array<{ email: string; name?: string }>;
  bcc: Array<{ email: string; name?: string }>;
  subject: string;
  body: string;
  bodyHtml?: string;
  snippet: string;
  receivedAt: Date;
  labels: string[];
  attachments: GmailAttachment[];
  hasUnsubscribe: boolean;
  hasListId: boolean;
  unsubscribeUrl?: string;
}

export interface GmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

// Thread with messages
export interface GmailThread {
  id: string;
  messages: ParsedEmail[];
  latestMessage: ParsedEmail;
  messageCount: number;
}

// Sync state
export interface GmailSyncState {
  lastSyncedAt?: string;
  historyId?: string; // For incremental sync
}

// Gmail enrichment (added to standard enrichment)
export interface GmailEnrichment {
  // Standard fields inherited from base
  summary?: string;
  suggestedPriority?: string;
  suggestedTags?: string[];
  linkedEntities?: Array<{ id: string; name: string; type: string }>;
  contextFromMemory?: string;

  // Gmail-specific
  intent?: 'fyi' | 'needs_response' | 'action_required' | 'question' | 'confirmation';
  deadline?: string;
  sentiment?: 'urgent' | 'friendly' | 'formal' | 'frustrated' | 'neutral';
  threadSummary?: string;

  // Smart sender tags
  senderTags?: string[]; // 'Internal', 'New', 'Direct', 'CC', 'VIP', 'Auto', 'Newsletter', 'Suspicious'

  // Phishing detection
  phishingIndicators?: string[];
  isSuspicious?: boolean;

  // Thread info
  threadId?: string;
  messageCount?: number;

  // Attachments
  attachments?: GmailAttachment[];

  // Recipients (To/CC with internal filter)
  recipients?: {
    to: Array<{ email: string; name?: string }>;
    cc: Array<{ email: string; name?: string }>;
    internal: Array<{ email: string; name?: string }>;
  };
}

// Sync result
export interface GmailSyncResult {
  synced: number;
  skipped: number;
  errors: number;
  /** Triage items auto-archived because email was removed from Gmail inbox */
  archived: number;
  emails: Array<{ id: string; threadId: string; subject: string }>;
}
