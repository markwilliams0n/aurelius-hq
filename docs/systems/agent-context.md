# Agent Context System

> How agents (chat, Telegram, etc.) get memory context for conversations.

## Overview

All agents use a centralized context builder to get memory context. This ensures consistent memory access across all interfaces.

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────┐
│           buildAgentContext()                    │
│                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ Recent Notes│  │ QMD Search  │  │  Soul   │ │
│  │  (24h)      │  │ (life/)     │  │ Config  │ │
│  └──────┬──────┘  └──────┬──────┘  └────┬────┘ │
│         │                │              │       │
│         └────────────────┼──────────────┘       │
│                          ▼                      │
│                  System Prompt                  │
└─────────────────────────────────────────────────┘
                       │
                       ▼
                 AI Response
```

## Quick Start

```typescript
import { buildAgentContext } from '@/lib/ai/context';

// Basic usage - get system prompt with full memory
const { systemPrompt } = await buildAgentContext({
  query: userMessage
});

// Use with your AI call
const response = await chat(messages, systemPrompt);
```

## API Reference

### `buildAgentContext(options)`

The single entry point for all agents to get memory context.

**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `query` | `string` | Yes | User's message - used for semantic search |
| `modelId` | `string` | No | Model ID (defaults to DEFAULT_MODEL) |
| `additionalContext` | `string` | No | Extra context to append to prompt |

**Returns:**

```typescript
interface AgentContext {
  systemPrompt: string;      // Complete prompt with all memory
  recentNotes: string | null; // Raw recent notes (if needed separately)
  memoryContext: string | null; // Raw QMD results (if needed separately)
  soulConfig: string | null;  // Soul config content
  modelId: string;           // Model being used
}
```

## Memory Sources

### 1. Recent Notes (Last 24 Hours)

**Source:** `memory/*.md` (daily notes files)

**Function:** `getRecentNotes()` from `@/lib/memory/daily-notes`

**What it contains:**
- Today's conversations
- Triage items saved to memory
- Meeting summaries from Granola
- Manual notes

**When included:** Always (if notes exist)

**In prompt as:** `## Recent Activity (Last 24 Hours)`

### 2. QMD Semantic Search

**Source:** `life/` directory (entities, projects, resources)

**Function:** `buildMemoryContext()` from `@/lib/memory/search`

**What it contains:**
- People (life/areas/people/)
- Companies (life/areas/companies/)
- Projects (life/projects/)
- Resources (life/resources/)

**When included:** When semantic search finds relevant results

**In prompt as:** `## Relevant Memory (Long-term)`

### 3. Soul Configuration

**Source:** Database config table

**Function:** `getConfig('soul')` from `@/lib/config`

**What it contains:** Personality customization, behavioral instructions

**When included:** If configured

**In prompt as:** `## Your Soul Configuration`

## How the Agent Uses Memory

The system prompt explicitly tells agents:

1. **Check Recent Activity FIRST** for anything recent (people mentioned today, triage items, ongoing conversations)

2. **Check Relevant Memory** for older, indexed knowledge about people, companies, projects

3. **Check BOTH sections** when asked "what do you know about X" - recent info may not be indexed yet

## Adding Context for Specific Agents

Use `additionalContext` for agent-specific instructions:

```typescript
// Telegram bot example
const { systemPrompt } = await buildAgentContext({
  query: userMessage,
  additionalContext: `## Telegram Context
You're responding via Telegram. Keep responses concise and mobile-friendly.
The user is ${userName}.`,
});

// Slack bot example
const { systemPrompt } = await buildAgentContext({
  query: userMessage,
  additionalContext: `## Slack Context
You're in a Slack workspace. Use Slack markdown formatting.
Channel: #${channelName}`,
});
```

## Creating a New Agent

1. Import the context builder:
   ```typescript
   import { buildAgentContext } from '@/lib/ai/context';
   ```

2. Build context with user's query:
   ```typescript
   const { systemPrompt } = await buildAgentContext({
     query: userMessage,
     additionalContext: '...' // optional agent-specific context
   });
   ```

3. Call the AI with the system prompt:
   ```typescript
   import { chatStreamWithTools, type Message } from '@/lib/ai/client';

   const messages: Message[] = [
     ...history,
     { role: 'user', content: userMessage }
   ];

   for await (const event of chatStreamWithTools(messages, systemPrompt)) {
     // Handle streaming response
   }
   ```

4. Save memorable content (optional):
   ```typescript
   import { extractAndSaveMemories, containsMemorableContent } from '@/lib/memory/extraction';

   if (containsMemorableContent(userMessage)) {
     await extractAndSaveMemories(userMessage, assistantResponse);
   }
   ```

## Architecture

```
src/lib/ai/
├── context.ts      # buildAgentContext() - THE entry point
├── client.ts       # AI client, streaming, tools
└── prompts.ts      # System prompt templates

src/lib/memory/
├── daily-notes.ts  # getRecentNotes() - recent 24h
├── search.ts       # buildMemoryContext() - QMD search
├── extraction.ts   # extractAndSaveMemories() - save to notes
└── heartbeat.ts    # Background indexing
```

## Performance

`buildAgentContext()` runs three operations in parallel:
- `getRecentNotes()` - File read (~5ms)
- `buildMemoryContext()` - QMD search (~50-200ms)
- `getConfig('soul')` - DB query (~10ms)

Total typical time: ~200ms

## Related Documentation

- [Memory System](./memory.md) - How all memory layers work
- [Heartbeat System](./heartbeat.md) - Background indexing and synthesis
- [Daily Notes](./daily-notes.md) - Short-term memory storage
