import type { Capability, ToolDefinition, ToolResult } from '../types';
import { findInboxItem } from '@/lib/gmail/queries';

const PROMPT = `# Email Drafting

You can draft email replies using draft_email.
- Provide the inbox item ID (from triage) and the reply body
- Optionally override to/cc/bcc addresses
- Emails are always drafted for user approval — never sent automatically
- Whether the email sends or saves as draft depends on GMAIL_ENABLE_SEND setting
- Use the triage context to write appropriate replies

## When to use

- User asks you to reply to an email ("reply to that email from Sarah")
- Triage suggests an email needs a response
- User asks you to draft an email for a specific inbox item

## How it works

1. You call draft_email with the inbox item ID and reply body
2. The system resolves the item and pre-fills email metadata (to, subject, thread)
3. An Action Card appears for the user to review and edit the draft
4. User confirms → email is sent or saved as draft via Gmail API
5. Card updates with status`;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'draft_email',
    description:
      'Draft an email reply to a triage inbox item. Returns an action card for user review — never sends directly.',
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The inbox item ID (UUID) or external ID to reply to',
        },
        body: {
          type: 'string',
          description: 'The reply body text (plain text)',
        },
        to: {
          type: 'string',
          description: 'Override recipient email address (defaults to original sender)',
        },
        cc: {
          type: 'string',
          description: 'CC recipients (comma-separated email addresses)',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipients (comma-separated email addresses)',
        },
      },
      required: ['item_id', 'body'],
    },
  },
];

async function handleGmailTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  if (toolName !== 'draft_email') return null;

  const itemId = String(toolInput.item_id || '');
  const body = String(toolInput.body || '');
  const to = toolInput.to ? String(toolInput.to) : undefined;
  const cc = toolInput.cc ? String(toolInput.cc) : undefined;
  const bcc = toolInput.bcc ? String(toolInput.bcc) : undefined;

  if (!itemId || !body) {
    return { result: JSON.stringify({ error: 'Both "item_id" and "body" are required' }) };
  }

  const item = await findInboxItem(itemId);

  if (!item) {
    return { result: JSON.stringify({ error: `Inbox item "${itemId}" not found` }) };
  }

  if (item.connector !== 'gmail') {
    return { result: JSON.stringify({ error: `Item "${itemId}" is not a Gmail item (connector: ${item.connector})` }) };
  }

  const recipient = to || item.sender;
  const subject = item.subject.startsWith('Re:') ? item.subject : `Re: ${item.subject}`;

  return {
    result: JSON.stringify({
      action_card: {
        pattern: 'approval',
        handler: 'gmail:send-email',
        title: `Email reply to ${item.senderName || item.sender}`,
        data: {
          itemId: item.id,
          to: recipient,
          cc: cc || undefined,
          bcc: bcc || undefined,
          subject,
          body,
          senderName: item.senderName || item.sender,
          senderEmail: item.sender,
        },
      },
      summary: `Drafted reply to ${item.senderName || item.sender}: ${subject}`,
    }),
  };
}

export const gmailCapability: Capability = {
  name: 'gmail',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleGmailTool,
};
