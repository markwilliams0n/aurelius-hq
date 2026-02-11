import type { Capability, ToolDefinition, ToolResult } from '../types';
import { findInboxItem } from '@/lib/gmail/queries';
import { searchEmails, getThread, getAttachment, getGravatarUrl, isConfigured } from '@/lib/gmail/client';
import { insertInboxItemWithTasks } from '@/lib/triage/insert-with-tasks';
import type { GmailEnrichment } from '@/lib/gmail/types';

const PROMPT = `# Email Search, Retrieval & Drafting

You can search Gmail, retrieve email content, and draft replies using these tools.

## search_gmail

Search Gmail using Gmail query syntax. Use this when the user asks about emails.

**Query syntax:**
- \`from:email@domain.com\` — Emails from a sender
- \`to:email@domain.com\` — Emails to a recipient
- \`subject:keyword\` — Subject contains keyword
- \`after:2025/01/01\` — Emails after date (YYYY/MM/DD)
- \`before:2025/12/31\` — Emails before date
- \`has:attachment\` — Has attachments
- \`is:unread\` — Unread only
- \`in:inbox\` — Inbox only
- \`label:labelname\` — By label
- Combine freely: \`from:sarah subject:invoice after:2025/06/01 has:attachment\`

**Examples of when to use:**
- "Find emails from opendate.io" → \`search_gmail(query: "from:opendate.io")\`
- "Any emails about the contract?" → \`search_gmail(query: "subject:contract OR contract")\`
- "Unread emails this week" → \`search_gmail(query: "is:unread after:2025/02/03")\`

## get_email

Get the full thread for a specific email. Use after search_gmail to read complete content.

## get_attachment

Download and read email attachments. For text files (CSV, JSON, TXT), returns content inline. Can save to vault.

## save_email_to_triage

Import a searched email into the triage inbox. This lets the user track it, snooze it, or act on it like any other triage item. Safe to call multiple times (deduplicates by thread ID).

## draft_email

Draft a reply to a triage inbox item. Returns an action card for user approval. Never sends directly.

## Workflow guidance

1. User asks about emails → use search_gmail
2. Need full content → use get_email with the threadId
3. Email has attachments → use get_attachment to describe/save them
4. User wants to track it → use save_email_to_triage
5. User wants to reply → use draft_email (requires the email to be in triage first)

## Important notes

- Search results include body previews (1500 chars). Use get_email for full content.
- Attachments show metadata in search results. Use get_attachment to read content.
- Always show the user what you found before taking action.
- For reply workflows: save to triage first, then use draft_email with the triage item ID.`;

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
  {
    name: 'search_gmail',
    description:
      'Search Gmail messages using Gmail query syntax. Returns matching emails with subject, sender, date, snippet, and attachment info. Use this when the user asks about emails not in triage.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Gmail search query. Examples: "from:sarah@example.com", "subject:invoice after:2025/01/01", "has:attachment from:opendate.io", "is:unread in:inbox"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum results to return (default: 10, max: 50)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_email',
    description:
      'Get the full content of an email thread by thread ID. Returns all messages in the thread with full body text. Use after search_gmail to read the complete email.',
    parameters: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Gmail thread ID (from search_gmail results or triage item externalId)',
        },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'save_email_to_triage',
    description:
      'Import a Gmail email into the triage inbox for processing. Use when the user wants to track, act on, or save an email found via search. Deduplicates by thread ID — safe to call multiple times.',
    parameters: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Gmail thread ID to import into triage',
        },
      },
      required: ['thread_id'],
    },
  },
  {
    name: 'get_attachment',
    description:
      'Download and describe a Gmail attachment. Can save it to vault if requested. Returns attachment metadata and a text summary for supported types (text, CSV, JSON). For binary files (PDF, images), returns metadata only.',
    parameters: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'Gmail message ID containing the attachment',
        },
        attachment_id: {
          type: 'string',
          description: 'Attachment ID (from search_gmail or get_email results)',
        },
        filename: {
          type: 'string',
          description: 'Original filename of the attachment',
        },
        save_to_vault: {
          type: 'boolean',
          description: 'If true, save the attachment content to the vault (for text-based files)',
        },
      },
      required: ['message_id', 'attachment_id', 'filename'],
    },
  },
];

// Text-readable MIME types for attachment handling
const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/csv', 'text/html', 'text/markdown',
  'application/json', 'application/xml', 'text/xml',
  'application/csv',
]);

const TEXT_EXTENSIONS = new Set([
  'txt', 'csv', 'json', 'xml', 'md', 'html', 'yml', 'yaml', 'log', 'tsv',
]);

async function handleSearchGmail(
  toolInput: Record<string, unknown>,
): Promise<ToolResult> {
  if (!isConfigured()) {
    return {
      result: JSON.stringify({
        error: 'Gmail is not configured. Set GOOGLE_SERVICE_ACCOUNT_PATH and GOOGLE_IMPERSONATE_EMAIL.',
      }),
    };
  }

  const query = String(toolInput.query || '').trim();
  if (!query) {
    return { result: JSON.stringify({ error: '"query" is required' }) };
  }

  const maxResults = Math.min(Number(toolInput.max_results || 10), 50);

  try {
    const { emails, totalEstimate, nextPageToken } = await searchEmails({
      query,
      maxResults,
    });

    if (emails.length === 0) {
      return {
        result: JSON.stringify({
          query,
          count: 0,
          message: `No emails found for "${query}"`,
        }),
      };
    }

    const results = emails.map(email => {
      const result: Record<string, unknown> = {
        threadId: email.threadId,
        messageId: email.messageId,
        from: email.from.name
          ? `${email.from.name} <${email.from.email}>`
          : email.from.email,
        subject: email.subject,
        date: email.receivedAt.toISOString(),
        snippet: email.snippet,
      };

      if (email.body) {
        result.body = email.body.slice(0, 1500);
        if (email.body.length > 1500) {
          result.bodyTruncated = true;
          result.fullBodyLength = email.body.length;
        }
      }

      if (email.to.length > 0) {
        result.to = email.to.map(r => r.name ? `${r.name} <${r.email}>` : r.email);
      }
      if (email.cc.length > 0) {
        result.cc = email.cc.map(r => r.name ? `${r.name} <${r.email}>` : r.email);
      }

      if (email.attachments.length > 0) {
        result.attachments = email.attachments.map(a => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          id: a.id,
        }));
      }

      return result;
    });

    return {
      result: JSON.stringify({
        query,
        count: results.length,
        totalEstimate,
        hasMore: !!nextPageToken,
        results,
      }),
    };
  } catch (err: any) {
    const status = err?.response?.status || err?.code;

    if (status === 401 || status === 403) {
      return {
        result: JSON.stringify({
          error: 'Gmail authentication failed. Service account may need re-authorization.',
          details: err?.message,
        }),
      };
    }

    if (status === 429) {
      return {
        result: JSON.stringify({
          error: 'Gmail rate limit exceeded. Try again in a moment or reduce max_results.',
        }),
      };
    }

    return {
      result: JSON.stringify({
        error: `Gmail search failed: ${err?.message || 'Unknown error'}`,
      }),
    };
  }
}

async function handleGetEmail(
  toolInput: Record<string, unknown>,
): Promise<ToolResult> {
  if (!isConfigured()) {
    return {
      result: JSON.stringify({ error: 'Gmail is not configured.' }),
    };
  }

  const threadId = String(toolInput.thread_id || '').trim();
  if (!threadId) {
    return { result: JSON.stringify({ error: '"thread_id" is required' }) };
  }

  try {
    const messages = await getThread(threadId);

    if (messages.length === 0) {
      return {
        result: JSON.stringify({
          error: `No messages found for thread ${threadId}`,
        }),
      };
    }

    const formatted = messages.map(msg => {
      const entry: Record<string, unknown> = {
        messageId: msg.messageId,
        from: msg.from.name
          ? `${msg.from.name} <${msg.from.email}>`
          : msg.from.email,
        to: msg.to.map(r => r.name ? `${r.name} <${r.email}>` : r.email),
        date: msg.receivedAt.toISOString(),
        subject: msg.subject,
        body: msg.body.slice(0, 3000),
      };

      if (msg.body.length > 3000) {
        entry.bodyTruncated = true;
        entry.fullBodyLength = msg.body.length;
      }

      if (msg.cc.length > 0) {
        entry.cc = msg.cc.map(r => r.name ? `${r.name} <${r.email}>` : r.email);
      }

      if (msg.attachments.length > 0) {
        entry.attachments = msg.attachments.map(a => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          id: a.id,
        }));
      }

      return entry;
    });

    return {
      result: JSON.stringify({
        threadId,
        messageCount: formatted.length,
        subject: messages[0].subject,
        messages: formatted,
      }),
    };
  } catch (err: any) {
    const status = err?.response?.status || err?.code;

    if (status === 404) {
      return {
        result: JSON.stringify({
          error: `Thread ${threadId} not found. It may have been deleted.`,
        }),
      };
    }

    return {
      result: JSON.stringify({
        error: `Failed to get email thread: ${err?.message || 'Unknown error'}`,
      }),
    };
  }
}

async function handleSaveToTriage(
  toolInput: Record<string, unknown>,
): Promise<ToolResult> {
  if (!isConfigured()) {
    return {
      result: JSON.stringify({ error: 'Gmail is not configured.' }),
    };
  }

  const threadId = String(toolInput.thread_id || '').trim();
  if (!threadId) {
    return { result: JSON.stringify({ error: '"thread_id" is required' }) };
  }

  try {
    const messages = await getThread(threadId);
    if (messages.length === 0) {
      return { result: JSON.stringify({ error: `Thread ${threadId} not found` }) };
    }

    // Use the latest message in the thread (same pattern as heartbeat sync)
    const latest = messages[messages.length - 1];

    // Build content in same markdown format as sync.ts
    const content = [
      `# ${latest.subject}`,
      '',
      `**From:** ${latest.from.name || latest.from.email}`,
      latest.to.length > 0
        ? `**To:** ${latest.to.map(r => r.name || r.email).join(', ')}`
        : '',
      latest.cc.length > 0
        ? `**CC:** ${latest.cc.map(r => r.name || r.email).join(', ')}`
        : '',
      '',
      '---',
      '',
      latest.body.slice(0, 8000),
    ].filter(Boolean).join('\n');

    const item = await insertInboxItemWithTasks({
      connector: 'gmail',
      externalId: threadId,
      sender: latest.from.email,
      senderName: latest.from.name || null,
      senderAvatar: getGravatarUrl(latest.from.email),
      subject: latest.subject,
      content,
      preview: latest.snippet || latest.body.slice(0, 200),
      receivedAt: latest.receivedAt,
      status: 'new',
      priority: 'normal',
      tags: [],
      rawPayload: {
        messageId: latest.messageId,
        rfc822MessageId: latest.rfc822MessageId,
        threadId: latest.threadId,
        to: latest.to,
        cc: latest.cc,
        bcc: latest.bcc,
        labels: latest.labels,
        hasUnsubscribe: latest.hasUnsubscribe,
        unsubscribeUrl: latest.unsubscribeUrl,
        bodyHtml: latest.bodyHtml,
      },
      enrichment: {
        messageCount: messages.length,
        attachments: latest.attachments.length > 0 ? latest.attachments : undefined,
        recipients: {
          to: latest.to,
          cc: latest.cc,
          internal: [],
        },
      } as GmailEnrichment,
    });

    return {
      result: JSON.stringify({
        summary: `Imported "${latest.subject}" from ${latest.from.name || latest.from.email} into triage`,
        itemId: item.id,
        status: item.status,
      }),
    };
  } catch (err: any) {
    return {
      result: JSON.stringify({
        error: `Failed to save to triage: ${err?.message || 'Unknown error'}`,
      }),
    };
  }
}

async function handleGetAttachment(
  toolInput: Record<string, unknown>,
): Promise<ToolResult> {
  if (!isConfigured()) {
    return { result: JSON.stringify({ error: 'Gmail is not configured.' }) };
  }

  const messageId = String(toolInput.message_id || '').trim();
  const attachmentId = String(toolInput.attachment_id || '').trim();
  const filename = String(toolInput.filename || '').trim();
  const saveToVault = Boolean(toolInput.save_to_vault);

  if (!messageId || !attachmentId) {
    return {
      result: JSON.stringify({
        error: '"message_id" and "attachment_id" are required',
      }),
    };
  }

  try {
    const { data, size } = await getAttachment(messageId, attachmentId);

    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const isTextLike = TEXT_MIME_TYPES.has(ext) || TEXT_EXTENSIONS.has(ext);

    const result: Record<string, unknown> = {
      filename,
      size,
      sizeHuman: size < 1024 ? `${size} B`
        : size < 1048576 ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / 1048576).toFixed(1)} MB`,
    };

    if (isTextLike && size < 500_000) {
      const textContent = data.toString('utf-8');
      result.content = textContent.slice(0, 5000);
      if (textContent.length > 5000) {
        result.contentTruncated = true;
        result.fullContentLength = textContent.length;
      }

      if (saveToVault) {
        const { createVaultItem } = await import('@/lib/vault');
        const { classifyVaultItem } = await import('@/lib/vault/classify');
        const classification = await classifyVaultItem(textContent.slice(0, 2000), {
          title: filename,
        });

        await createVaultItem({
          content: textContent,
          title: classification.title || filename,
          type: 'document',
          sensitive: classification.sensitive,
          tags: [...classification.tags, 'email-attachment'],
          sourceUrl: null,
          supermemoryStatus: 'none',
        });

        result.savedToVault = true;
        result.vaultTitle = classification.title || filename;
      }
    } else {
      result.content = null;
      result.reason = isTextLike
        ? `File too large to read inline (${result.sizeHuman})`
        : `Binary file type — cannot display inline`;

      if (saveToVault && isTextLike) {
        result.vaultNote = 'File too large to save as vault text. Consider downloading manually.';
      }
    }

    return { result: JSON.stringify(result) };
  } catch (err: any) {
    return {
      result: JSON.stringify({
        error: `Failed to get attachment: ${err?.message || 'Unknown error'}`,
      }),
    };
  }
}

async function handleDraftEmail(
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
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
      summary: `Drafted reply to ${item.senderName || item.sender}: ${subject}`,
    }),
    actionCard: {
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
  };
}

async function handleGmailTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  if (toolName === 'draft_email') {
    return handleDraftEmail(toolInput);
  }

  if (toolName === 'search_gmail') {
    return handleSearchGmail(toolInput);
  }

  if (toolName === 'get_email') {
    return handleGetEmail(toolInput);
  }

  if (toolName === 'save_email_to_triage') {
    return handleSaveToTriage(toolInput);
  }

  if (toolName === 'get_attachment') {
    return handleGetAttachment(toolInput);
  }

  return null;
}

export const gmailCapability: Capability = {
  name: 'gmail',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 2,
  handleTool: handleGmailTool,
};
