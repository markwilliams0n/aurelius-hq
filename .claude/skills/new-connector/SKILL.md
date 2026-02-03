---
name: new-connector
description: Design and plan a new triage connector through guided brainstorming. Use when the user says "new connector", "add connector", "integrate with", or wants to connect a new data source to the triage system.
---

# New Connector Setup

This skill guides you through designing a new connector for the Aurelius triage system using a structured brainstorming process.

## Instructions

When this skill is invoked:

1. **Read the connector documentation** to understand the current architecture:
   - Read `docs/connectors/index.md` for the **connector registry** (all connectors, their status, capabilities)
   - Read `docs/connectors/README.md` for the setup wizard interview
   - Read `docs/systems/triage.md` for triage system overview
   - Read `docs/connectors/granola.md` as a reference implementation

2. **Review existing connectors** to understand patterns:
   - Check `src/lib/db/schema/triage.ts` for the connector enum and schema
   - Check `src/app/triage/triage-client.tsx` for `CONNECTOR_ACTIONS` config
   - Look at existing connector implementations in `src/lib/` (e.g., `src/lib/granola/`)

3. **Start the brainstorming process** using the interview from `docs/connectors/README.md`:
   - Ask questions ONE AT A TIME
   - Use multiple choice when possible
   - Lead with your recommendation based on patterns from existing connectors

4. **Cover these key design decisions**:
   - Basic info (name, data source, auth method)
   - Content field mapping (what maps to subject, content, sender, etc.)
   - Supported actions (reply capability, custom actions)
   - AI enrichment (standard + connector-specific fields)
   - Smart tagging (auto-tags based on content/sender analysis)
   - Memory integration (auto-extract vs manual)
   - Task extraction (source provides tasks? AI supplement?)
   - Sync behavior (heartbeat-triggered, window, deduplication, bi-directional?)
   - Style guide (what AI guidance is needed for this connector?)
   - Connector-specific rules (what auto-actions make sense?)
   - UI customization needs

5. **After gathering requirements**, present the design in sections for validation

6. **Create documentation** at `docs/connectors/{connector-name}.md`

7. **Optionally create implementation plan** using the superpowers:writing-plans skill

## Existing Connectors Reference

| Connector | Reply | Custom Enrichment | Auto Memory | Tasks | Style Guide | Status |
|-----------|-------|-------------------|-------------|-------|-------------|--------|
| `gmail` | Yes | Yes (intent, sentiment) | No | Yes | Yes | Designed |
| `slack` | Yes | No | No | Yes | Planned | Stub |
| `linear` | No | No | No | Yes | Planned | Stub |
| `granola` | No | Yes (meeting data) | Yes | Yes | Planned | Active |
| `manual` | No | No | No | Yes | No | Active |

### Gmail as Reference (Most Complete Design)

Gmail is the most thoroughly designed connector with:
- Custom enrichment: `intent`, `deadline`, `sentiment`, `threadSummary`
- Smart sender tags: Internal, New, Direct, VIP, Auto, Newsletter, Suspicious
- Phishing detection
- Bi-directional sync (archive syncs back to Gmail)
- Thread handling (latest message = item, history collapsed)
- Rich action set: Reply, Unsubscribe, Spam, Always Archive, To Action
- Style guide for reply tone, formality, signature
- Connector-specific rules

See `docs/connectors/gmail.md` for the full design.

### Granola as Reference (Active Implementation)

Granola is the most complete **implemented** connector:
- Custom enrichment fields: `attendees`, `meetingTime`, `topics`, `actionItems`, `extractedMemory`
- Auto memory extraction during sync
- Task extraction from existing action items + AI supplement
- Full sync with deduplication

Use it as a template for connectors that need rich AI analysis.

## Key Architecture Points

### Database Schema
```typescript
// Connector type enum in src/lib/db/schema/triage.ts
export const connectorTypeEnum = pgEnum("connector_type", [
  "gmail", "slack", "linear", "granola", "manual"
  // New connectors added here
]);

// Enrichment is JSONB - can store any connector-specific fields
enrichment: jsonb("enrichment").$type<{
  // Standard fields...
  // Add connector-specific fields as needed
}>()
```

### Triage Client Config
```typescript
// In src/app/triage/triage-client.tsx
const CONNECTOR_ACTIONS: Record<string, {
  canReply: boolean;
  canArchive: boolean;
  canAddToMemory: boolean;
  canTakeActions: boolean;
  canChat: boolean;
}> = {
  // Configure per-connector capabilities
};
```

### Typical Connector Structure
```
src/lib/{connector}/
  ├── client.ts          # API client for external service
  ├── sync.ts            # Sync logic (fetch, transform, save)
  ├── actions.ts         # Connector-specific actions (reply, archive back, etc.)
  ├── enrichment.ts      # AI enrichment logic
  ├── extract-memory.ts  # AI memory extraction (if auto-extract)
  └── types.ts           # TypeScript types (optional)

src/app/api/{connector}/
  ├── sync/route.ts      # Manual sync endpoint
  └── webhook/route.ts   # Webhook receiver (if push-based)
```

### Style Guides

Each connector can have an AI-readable style guide that influences how the agent handles items:

```typescript
// Per-connector style guide (chat-updatable)
{
  connector: "gmail",
  styleGuide: `
    Reply Tone: Professional but warm. Use first names.
    Formality: Match the sender's level of formality.
    Signature: Use "Best, Mark"
    Quick replies: Keep under 3 sentences when possible.
  `
}
```

**What style guides cover:**
- Reply tone and formality
- Signature preferences
- Language handling
- VIP treatment
- Summarization preferences

**Users update via chat:**
```
You: "Be more casual in Slack replies"
Agent: Updated Slack style guide.
```

### Connector-Specific Rules

Triage rules can be scoped to specific connectors:

```typescript
{
  connector: "gmail",           // Only applies to Gmail
  trigger: {
    senderDomain: "linear.app",
    subjectContains: "sprint"
  },
  action: { type: "archive" }
}
```

**Common connector rule patterns:**
- Auto-archive notifications from specific services
- High priority for VIP senders
- Auto-tag based on content patterns
- Spam/phishing detection rules

### Sync Trigger: Heartbeat

All connectors sync via the central **Heartbeat** (default 15 min, configurable):

```
Heartbeat (every N minutes)
├── Sync Gmail
├── Sync Granola
├── Sync [other connectors]
├── Memory consolidation
└── Other agent maintenance
```

When designing a connector, specify:
- Does it need heartbeat sync? (most do)
- Any special sync timing needs?
- Bi-directional sync? (actions sync back to source)

## Example Session Flow

```
User: /new-connector

Claude: I'll help you design a new connector for the triage system.
        Let me first review the current architecture...
        [Reads docs and existing code]

        What service or data source do you want to connect?
        1. External API (like Gmail, Notion, Asana)
        2. Local app (like Granola, Obsidian)
        3. Webhook receiver (external service pushes to us)
        4. Other

User: 1 - I want to connect Notion

Claude: Great choice! For Notion, I'd recommend:
        - OAuth authentication (Notion uses OAuth 2.0)
        - Sync database items or pages

        What type of Notion content should flow into triage?
        1. Database items (Recommended - structured data)
        2. Pages (free-form content)
        3. Both
        ...
```

## Output

After completing the brainstorm:

1. **Design document** saved to `docs/connectors/{name}.md`
   - Overview and capabilities table
   - Content mapping
   - Enrichment fields (standard + custom)
   - Smart tagging logic
   - Supported actions and keyboard shortcuts
   - Sync behavior (heartbeat, deduplication, bi-directional?)
   - Style guide template
   - Suggested connector-specific rules
   - Implementation phases
2. **Update connector registry** at `docs/connectors/index.md`
3. **Summary** of all design decisions
4. **Next steps** for implementation
5. **Optional**: Implementation plan via superpowers:writing-plans

## Interview Questions Checklist

Make sure to cover these topics (ask one at a time):

### Basic
- [ ] What service/data source?
- [ ] What content should flow into triage?
- [ ] Authentication method?

### Data Mapping
- [ ] Field mapping (subject, content, sender, etc.)
- [ ] Additional fields to capture (threads, attachments, CC/BCC, etc.)

### Actions
- [ ] Reply support? (direct, draft, none)
- [ ] Custom actions? (unsubscribe, spam, etc.)
- [ ] Bi-directional sync? (archive syncs back to source?)

### AI Features
- [ ] Custom enrichment fields?
- [ ] Smart tagging? (what auto-tags make sense?)
- [ ] Phishing/spam detection?
- [ ] Memory integration? (auto vs manual)
- [ ] Task extraction?

### Sync
- [ ] Heartbeat-triggered?
- [ ] Sync window? (how far back)
- [ ] Deduplication strategy?
- [ ] Update existing items or insert-only?

### Configuration
- [ ] Style guide needs? (reply tone, formality, etc.)
- [ ] Connector-specific rules? (auto-archive patterns, VIP lists, etc.)
- [ ] UI customization?
