# Gmail Connector

Gmail integration for inbox-zero workflow. Syncs emails into triage, enables fast processing with AI assistance, and syncs actions back to Gmail.

## Overview

| Property | Value |
|----------|-------|
| Connector ID | `gmail` |
| Status | Planned |
| Authentication | Service Account (Google Workspace) |
| Supports Reply | Yes (drafts initially, direct send via setting) |
| Supports Archive | Yes (syncs back to Gmail) |
| Custom Enrichment | Yes |
| Auto Memory Extraction | No (manual only) |
| Task Extraction | Yes |

## Core Workflow

```
┌─────────────────────────────────────────────────────────┐
│                    HEARTBEAT                            │
│              (triggers all syncs)                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  GMAIL SYNC                             │
│  1. Fetch unarchived emails from Gmail                  │
│  2. Dedupe by message ID (skip already-triaged)         │
│  3. AI enrichment (summary, intent, phishing check)     │
│  4. Extract suggested tasks                             │
│  5. Insert to inbox_items                               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    TRIAGE                               │
│  User processes emails with keyboard shortcuts          │
│  AI pre-vets and suggests actions                       │
│  Rules auto-process matching emails                     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                 SYNC BACK TO GMAIL                      │
│  Archive in triage → Archive in Gmail                   │
│  Spam in triage → Report spam in Gmail                  │
│  Reply/Draft → Create draft or send in Gmail            │
└─────────────────────────────────────────────────────────┘
```

## Authentication

Uses **Service Account with domain-wide delegation** (Google Workspace):

1. Create service account in GCP, enable domain-wide delegation
2. Download JSON key file
3. In Google Admin Console → Security → API Controls → Domain-wide delegation
4. Add service account client ID with scopes:
   - `https://www.googleapis.com/auth/gmail.modify` (read, archive, labels)
   - `https://www.googleapis.com/auth/gmail.send` (when ready for replies)
5. Service account impersonates your Workspace email

**Environment variables:**
```bash
GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
GOOGLE_IMPERSONATE_EMAIL=you@yourworkspace.com
GMAIL_ENABLE_SEND=false  # Set true when ready for direct sending
```

## Content Mapping

| Triage Field | Gmail Source | Notes |
|--------------|--------------|-------|
| `externalId` | Message ID | Deduplication |
| `threadId` | Thread ID | For threading in triage |
| `sender` | From header | Email address |
| `senderName` | From header | Display name portion |
| `senderAvatar` | Gravatar | MD5 hash of email |
| `subject` | Subject header | |
| `content` | Body | Plain text preferred, HTML fallback |
| `preview` | Snippet | Gmail's preview text |
| `receivedAt` | internalDate | When received |
| `cc` | Cc header | CC recipients |
| `bcc` | Bcc header | BCC recipients (usually empty) |
| `attachments` | Attachment metadata | Name, size, mime type |

## Threading

- **Primary item**: Latest unarchived email in thread
- **Thread history**: Previous messages shown collapsed in detail view
- **Deduplication**: By thread ID - new message to archived thread creates new item
- **Display**: Thread indicator on card shows message count

```
┌──────────────────────────────────────┐
│ 📧 John Smith                    3 📬 │  ← Thread indicator
│ Re: Q4 Planning                      │
│ Thanks for the update. I think we... │
└──────────────────────────────────────┘
         │
         ▼ (expand in detail view)
┌──────────────────────────────────────┐
│ ▼ Thread (3 messages)                │
│   ├─ You (Jan 15): Here's the plan...│
│   ├─ John (Jan 16): Looks good...    │
│   └─ John (Jan 17): Thanks for...    │  ← Current
└──────────────────────────────────────┘
```

## Attachments

- **Display**: Show attachment list with name, type, size
- **View**: Click to download or preview
- **Memory extraction**: Optional per-attachment "Extract to memory" action
- **No auto-processing**: Most attachments ignored unless user chooses to parse

## AI Enrichment

### Standard Fields
- `summary` - Email summary
- `suggestedPriority` - Urgency assessment
- `suggestedTags` - Topic tags
- `linkedEntities` - People, companies mentioned
- `contextFromMemory` - Relevant memory context

### Gmail-Specific Fields

| Field | Description |
|-------|-------------|
| `intent` | What sender wants: FYI, needs response, action required, question |
| `deadline` | Any mentioned deadlines or time sensitivity |
| `sentiment` | Tone: urgent, friendly, formal, frustrated |
| `threadSummary` | Summary of full thread context |

### Smart Sender Tags

Auto-applied based on sender analysis:

| Tag | Logic |
|-----|-------|
| `Internal` | Sender domain matches your domain (e.g., `@rostr.cc`) |
| `New` | Sender not found in memory |
| `Direct` | You're in To field (primary recipient) |
| `CC'd` | You're in CC field |
| `VIP` | Sender marked as important in memory or settings |
| `Auto` | Automated sender (`noreply@`, `notifications@`, etc.) |
| `Newsletter` | Has `List-Unsubscribe` header or matches newsletter patterns |
| `Group` | Many recipients (5+) |
| `⚠️ Suspicious` | Phishing indicators detected |

### Phishing Detection

Checks performed on each email:

| Check | What it catches |
|-------|-----------------|
| Display name mismatch | Display says "Stripe" but domain isn't `stripe.com` |
| Lookalike domain | `str1pe.com`, `stripe-support.net`, `arnazon.com` |
| Mismatched reply-to | From shows one domain, reply-to is different |
| Suspicious urgency | "Account suspended", "Act now", "Verify immediately" |
| Known brand impersonation | Protected brands: Stripe, Amazon, Apple, banks, etc. |

Suspicious emails get `⚠️ Suspicious` tag with explanation in enrichment.

## Keyboard Shortcuts

| Key | Action | Notes |
|-----|--------|-------|
| `←` | Archive | Archives in triage AND Gmail |
| `↑` | Memory | Extract to memory |
| `→` | Actions | Opens action palette |
| `↓` | Reply | Open reply composer |
| `⇧↓` | AI Draft | AI drafts reply, you review before send |
| `S` | Snooze | Snooze to time |
| `U` | Unsubscribe | Uses List-Unsubscribe header |
| `!` | Spam | Report spam in Gmail + archive |
| `A` | Always Archive | Create rule to auto-archive this sender |
| `T` | To Action | Defer to task manager, archive email |

## Actions

### Archive
- Marks as archived in triage
- Archives in Gmail (removes from inbox)
- Bi-directional sync keeps both clean

### Reply
- Opens reply composer
- Includes thread context
- Options: Reply to sender only, Reply all
- **Draft mode** (default): Creates Gmail draft for review
- **Send mode** (`GMAIL_ENABLE_SEND=true`): Sends directly

### AI Draft Reply
- AI generates reply based on email content + style guide
- Always creates draft first (never auto-sends)
- You review and edit before sending

### Unsubscribe
- Uses `List-Unsubscribe` header if present (one-click)
- Falls back to "header not available" message
- Archives email after unsubscribe

### Mark as Spam
- Reports to Gmail as spam
- Archives in triage

### Always Archive (Create Rule)
- Creates triage rule: auto-archive from this sender
- Applies to future emails immediately

### To Action (Defer to Task)
- Creates task linked to email
- Archives email (out of inbox)
- Task appears in task manager
- Can reply from task context later

## Rules & Style Guide

Gmail has two types of per-connector configuration:

### Triage Rules
Automated actions on matching emails:

```typescript
{
  connector: "gmail",
  trigger: {
    senderDomain: "linear.app",
    subjectContains: "sprint"
  },
  action: { type: "archive" }
}
```

Examples:
- Auto-archive all newsletter receipts
- High priority for emails from VIP domains
- Auto-tag invoices with "finance"

### Style Guide
AI-readable guidance for communication (chat-updatable):

```
Reply Tone: Professional but warm. Use first names.
Formality: Match the sender's level of formality.
Signature: Use "Best, Mark"
Investors: More formal, always CC alex@rostr.cc
Quick replies: Keep under 3 sentences when possible.
Language: Reply in the language they wrote in.
```

**Chat to update:**
```
You: "Be more casual with internal emails"
Agent: Updated Gmail style guide.

You: "Always archive shipping notifications"
Agent: Created rule: auto-archive emails matching "shipping" + "notification"
```

## AI Pre-Vetting

Goal: Minimize keystrokes, maximize throughput.

| Feature | What it does |
|---------|--------------|
| Auto-priority | High = needs you, Low = FYI/automated |
| Intent detection | Categorizes: needs response, FYI, action required |
| Pre-drafted replies | Common responses ready for review |
| Suggested action | "Archive?" "Unsubscribe?" based on patterns |
| Batch suggestions | "5 newsletters - archive all?" |
| Learn from behavior | You always archive X → suggest rule |

## Sync Behavior

- **Trigger**: Heartbeat (default 15 min, configurable in settings)
- **Query**: All emails not in Gmail archive
- **Deduplication**: By thread ID - skip already-imported threads
- **Updates**: New message to archived thread → new triage item
- **Bi-directional**: Archive/spam actions sync back to Gmail

## Task Extraction

AI extracts action items from emails:
- Explicit requests ("Can you send me...")
- Deadlines mentioned ("by Friday")
- Questions requiring response
- Commitments made by sender

Tasks linked to source email for context when actioning.

## Memory Integration

- **Manual only** - You press `↑` to extract memory
- High email volume, low signal - you pick what matters
- Attachment parsing available on-demand

## Configuration

### Environment Variables

```bash
# Required
GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
GOOGLE_IMPERSONATE_EMAIL=you@workspace.com

# Optional
GMAIL_ENABLE_SEND=false          # Enable direct sending (vs drafts only)
GMAIL_SYNC_DAYS=30               # How far back to sync on first run
```

### App Settings (via Settings UI)

- Heartbeat interval (affects all syncs)
- Gmail style guide (chat-updatable)
- VIP domains/senders
- Auto-archive patterns

## Files

| File | Purpose |
|------|---------|
| `src/lib/gmail/client.ts` | Gmail API client (service account auth) |
| `src/lib/gmail/sync.ts` | Sync logic (fetch, enrich, insert) |
| `src/lib/gmail/actions.ts` | Archive, reply, spam, unsubscribe |
| `src/lib/gmail/enrichment.ts` | AI enrichment, phishing detection |
| `src/lib/gmail/types.ts` | TypeScript types |
| `src/app/api/gmail/sync/route.ts` | Manual sync endpoint |
| `src/app/api/gmail/reply/route.ts` | Reply/draft endpoint |

## UI Elements

### Card Display
- Sender avatar (Gravatar)
- Sender name + email
- Subject line
- Preview snippet
- Thread indicator (message count)
- Attachment icons
- Smart tags (Internal, New, VIP, etc.)
- Phishing warning if suspicious

### Detail View
- Full email content
- Collapsible thread history
- CC/BCC display
- Attachment list with download/preview
- "View in Gmail" link
- Reply options (reply / reply all)

### Action Palette (→)
- Reply
- Reply All
- Forward
- Unsubscribe
- Mark as Spam
- Always Archive
- To Action (defer to task)
- View in Gmail

## Implementation Phases

### Phase 1: Core Sync
- [ ] Service account authentication
- [ ] Fetch unarchived emails
- [ ] Content mapping + deduplication
- [ ] Basic enrichment (summary, priority)
- [ ] Insert to inbox_items

### Phase 2: Smart Features
- [ ] Thread handling (collapse/expand)
- [ ] Smart sender tags
- [ ] Phishing detection
- [ ] Intent + deadline detection
- [ ] Gravatar avatars

### Phase 3: Actions
- [ ] Archive (sync to Gmail)
- [ ] Reply (draft mode)
- [ ] Unsubscribe
- [ ] Spam
- [ ] Always Archive (rule creation)

### Phase 4: AI Power Features
- [ ] AI draft replies
- [ ] Pre-vetting + suggested actions
- [ ] Style guide integration
- [ ] Learn from behavior
- [ ] Batch operations

### Phase 5: Polish
- [ ] To Action (task integration)
- [ ] Attachment preview/memory extraction
- [ ] Direct send mode
- [ ] Settings UI for style guide
