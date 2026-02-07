# Gmail Draft & Send Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable composing, drafting, and sending email replies from the triage UI with a two-step safe flow (draft first, explicit send).

**Architecture:** Add CC/BCC support to the Gmail client, create an AI draft generation endpoint using Kimi via OpenRouter, and rewrite the reply composer with recipient fields and two-step flow (Save Draft → Send).

**Tech Stack:** Next.js API routes, Gmail API (googleapis), OpenRouter SDK with Kimi (moonshotai/kimi-k2), React

---

### Task 1: Add CC/BCC support to Gmail client

**Files:**
- Modify: `src/lib/gmail/client.ts:349-421` (createDraft + sendEmail)

**Step 1: Update `createDraft` to accept cc/bcc**

Change the options type and add CC/BCC headers to the raw RFC 2822 message:

```typescript
export async function createDraft(options: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  cc?: string;
  bcc?: string;
}): Promise<string> {
  const gmail = await getGmailClient();

  const message = [
    `To: ${options.to}`,
    options.cc ? `Cc: ${options.cc}` : '',
    options.bcc ? `Bcc: ${options.bcc}` : '',
    `Subject: ${options.subject}`,
    options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : '',
    options.inReplyTo ? `References: ${options.inReplyTo}` : '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body,
  ].filter(Boolean).join('\r\n');

  const encodedMessage = Buffer.from(message).toString('base64url');

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        threadId: options.threadId,
        raw: encodedMessage,
      },
    },
  });

  return response.data.id || '';
}
```

**Step 2: Update `sendEmail` the same way**

Same pattern — add `cc?: string` and `bcc?: string` to options, add headers to the raw message.

**Step 3: Commit**

```bash
git add src/lib/gmail/client.ts
git commit -m "feat: add CC/BCC support to Gmail draft and send"
```

---

### Task 2: Update actions and API route to pass recipients

**Files:**
- Modify: `src/lib/gmail/actions.ts:79-126` (replyToEmail)
- Modify: `src/app/api/gmail/reply/route.ts` (POST handler)

**Step 1: Update `replyToEmail` to accept recipient overrides**

```typescript
export async function replyToEmail(
  itemId: string,
  body: string,
  options?: {
    replyAll?: boolean;
    forceDraft?: boolean;
    to?: string;
    cc?: string;
    bcc?: string;
  }
): Promise<{ draftId?: string; messageId?: string; wasDraft: boolean }> {
```

Inside the function, use `options.to` if provided, otherwise fall back to `item.sender`. Pass `cc` and `bcc` through to `createDraft`/`sendEmail`.

For replyAll without explicit recipients: pull `to`, `cc` from `rawPayload` and merge into CC (excluding self).

**Step 2: Update the API route to accept `to`, `cc`, `bcc`**

Extract them from the request JSON body, validate as strings, pass to `replyToEmail`:

```typescript
const { itemId, body, replyAll, forceDraft, to, cc, bcc } = json;
// ... existing validation ...
const result = await replyToEmail(itemId, sanitizedBody, {
  replyAll, forceDraft, to, cc, bcc,
});
```

**Step 3: Commit**

```bash
git add src/lib/gmail/actions.ts src/app/api/gmail/reply/route.ts
git commit -m "feat: pass recipient overrides (to/cc/bcc) through reply API"
```

---

### Task 3: Create AI draft generation endpoint

**Files:**
- Create: `src/app/api/gmail/draft-ai/route.ts`

**Step 1: Create the API route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { inboxItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { chat } from '@/lib/ai/client';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId } = await request.json();
  if (!itemId) {
    return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  }

  const [item] = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  const draft = await chat(
    `Write a professional email reply to the following email.

From: ${item.senderName || item.sender}
Subject: ${item.subject}

---
${item.content}
---

Write ONLY the reply body text. No subject line, no greeting preamble, no "Here's a draft" wrapper. Start with an appropriate greeting and end with a sign-off. Keep it concise and professional.`,
    'You are drafting email replies. Output ONLY the email body text, nothing else.'
  );

  return NextResponse.json({ draft: draft.trim() });
}
```

**Step 2: Commit**

```bash
git add src/app/api/gmail/draft-ai/route.ts
git commit -m "feat: AI draft generation endpoint using Kimi via OpenRouter"
```

---

### Task 4: Rewrite the reply composer UI

**Files:**
- Modify: `src/components/aurelius/triage-reply-composer.tsx` (full rewrite)
- Modify: `src/app/triage/triage-client.tsx:694-704` (wire up real API calls)

**Step 1: Rewrite `triage-reply-composer.tsx`**

New component features:
- **Recipient fields**: To, CC, BCC — pre-populated from `item.rawPayload`, editable. BCC collapsed by default with "Show BCC" toggle.
- **Generate Draft button**: Calls `/api/gmail/draft-ai` with `itemId`, populates textarea.
- **Save Draft button** (primary): Calls `/api/gmail/reply` with `forceDraft: true` and recipient fields. Shows success toast with "Draft saved in Gmail". Returns `{ draftId, wasDraft: true }`.
- **Send button** (explicit, secondary): Only enabled after draft saved OR user chooses to send directly. Calls `/api/gmail/reply` with `forceDraft: false`. Confirmation prompt: "Send this email to X?" before actually calling.
- **Keyboard shortcut**: `Cmd+Enter` = Save Draft (NOT send). Remove the current send-on-enter behavior.

Props change:
```typescript
interface TriageReplyComposerProps {
  item: TriageItem;
  onComplete: (result: { wasDraft: boolean }) => void;
  onClose: () => void;
}
```

State:
```typescript
const [message, setMessage] = useState("");
const [to, setTo] = useState("");       // pre-populated from rawPayload
const [cc, setCc] = useState("");       // pre-populated from rawPayload
const [bcc, setBcc] = useState("");     // empty by default
const [showBcc, setShowBcc] = useState(false);
const [isGenerating, setIsGenerating] = useState(false);
const [isSaving, setIsSaving] = useState(false);
const [isSending, setIsSending] = useState(false);
const [draftSaved, setDraftSaved] = useState(false);
```

Pre-populate recipients on mount from `item.rawPayload`:
```typescript
useEffect(() => {
  const raw = item.rawPayload;
  if (raw && item.connector === 'gmail') {
    // Reply-to: set To as original sender
    setTo(item.sender);
    // CC: from original email's CC (minus self)
    const ccList = (raw.cc as Array<{email: string; name?: string}>) || [];
    setCc(ccList.map(r => r.email).join(', '));
    // BCC: empty for replies
  }
}, [item]);
```

Layout — recipient fields above textarea:
```
To:  [john@example.com                    ]
CC:  [alice@example.com, bob@example.com   ]  [Show BCC]
BCC: [hidden@example.com                   ]  (if shown)
─────────────────────────────────────────────
[Write your reply...                        ]
─────────────────────────────────────────────
[✨ Generate draft]          [Save Draft] [Send]
```

**Step 2: Wire up triage-client.tsx**

Replace the simulated `onSend` callback:

```typescript
{viewMode === "reply" && currentItem && (
  <TriageReplyComposer
    item={currentItem}
    onComplete={(result) => {
      if (result.wasDraft) {
        toast.success("Draft saved in Gmail");
      } else {
        toast.success("Email sent");
      }
      handleActionComplete("actioned");
    }}
    onClose={handleCloseOverlay}
  />
)}
```

**Step 3: Delete `generateDraftResponses` function**

Remove the fake template function (lines 166-240 of triage-reply-composer.tsx).

**Step 4: Commit**

```bash
git add src/components/aurelius/triage-reply-composer.tsx src/app/triage/triage-client.tsx
git commit -m "feat: real Gmail reply composer with recipients, AI drafts, and two-step send"
```

---

### Task 5: Type check and verify

**Step 1: Run TypeScript check**

```bash
bunx tsc --noEmit
```

Fix any type errors.

**Step 2: Verify dev server loads**

```bash
# Check the triage page loads without errors
curl -s http://localhost:3333/triage | head -20
```

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix: type errors from Gmail reply composer"
```
