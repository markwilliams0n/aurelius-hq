/**
 * Centralized Agent Context Builder
 *
 * Provides a single entry point for all agents (web chat, Telegram, etc.)
 * to get their memory context and system prompt.
 */

import { buildChatPrompt } from './prompts';
import { DEFAULT_MODEL } from './client';
import { buildMemoryContext } from '@/lib/memory/search';
import { getRecentNotes } from '@/lib/memory/daily-notes';
import { getConfig } from '@/lib/config';
import { emitMemoryEvent } from '@/lib/memory/events';
import { getCapabilityPrompts } from '@/lib/capabilities';
import type { ChatContext } from '@/lib/types/chat-context';

export interface AgentContextOptions {
  /** The user's message - used for semantic search */
  query: string;
  /** Optional model ID override */
  modelId?: string;
  /** Optional additional context to append to system prompt */
  additionalContext?: string;
  /** Optional chat context for surface-specific behavior */
  context?: ChatContext;
}

export interface AgentContext {
  /** The complete system prompt with all memory context */
  systemPrompt: string;
  /** Raw recent notes (if you need them separately) */
  recentNotes: string | null;
  /** Supermemory profile/search results (if you need them separately) */
  memoryContext: string | null;
  /** Soul configuration content */
  soulConfig: string | null;
  /** Model ID being used */
  modelId: string;
}

function buildSurfaceContext(context?: ChatContext): string | null {
  if (!context) return null;

  switch (context.surface) {
    case "triage": {
      if (!context.triageItem) return null;
      const item = context.triageItem;
      return `You are currently helping the user with a specific triage item.

Current triage item:
- Type: ${item.connector}
- From: ${item.senderName || item.sender}
- Subject: ${item.subject}
- Preview: ${(item.preview || item.content || "").slice(0, 500)}

You can help the user with this item using your available tools — send Slack messages, create Linear tasks, save information to memory, update configuration, etc. Use the tools naturally based on what the user asks.`;
    }

    case "panel": {
      if (!context.pageContext) return null;
      return `The user is chatting via the quick-access panel. Page context: ${context.pageContext}`;
    }

    case "vault":
      return `You are currently helping the user manage their personal vault — a filing system for important documents, facts, credentials, and references.

Your tools here are save_to_vault and search_vault.
- When the user provides content to save, use save_to_vault immediately
- When the user asks about saved items, use search_vault
- NEVER print sensitive values (SSN, passport numbers, etc.) in your response text — they appear in action cards only
- Suggest organization (tags, titles) when saving items`;

    default:
      return null;
  }
}

/**
 * Build complete agent context with memory
 *
 * This is the single entry point for all agents to get their context.
 * Handles:
 * - Recent daily notes (last 24h)
 * - Supermemory profile search for relevant memories
 * - Soul configuration
 * - System prompt assembly
 *
 * @example
 * ```ts
 * const ctx = await buildAgentContext({ query: userMessage });
 * const response = await chat(messages, ctx.systemPrompt);
 * ```
 */
export async function buildAgentContext(
  options: AgentContextOptions
): Promise<AgentContext> {
  const { query, modelId = DEFAULT_MODEL, additionalContext } = options;

  // Gather all context pieces in parallel
  const startTime = Date.now();
  const [recentNotes, memoryContext, soulConfigResult, capabilityPrompts] = await Promise.all([
    getRecentNotes(),
    buildMemoryContext(query),
    getConfig('soul'),
    getCapabilityPrompts(),
  ]);

  const soulConfig = soulConfigResult?.content || null;

  // Build the system prompt
  let systemPrompt = buildChatPrompt({
    recentNotes,
    memoryContext,
    soulConfig,
    modelId,
  });

  // Add capability instructions
  if (capabilityPrompts) {
    systemPrompt += `\n\n${capabilityPrompts}`;
  }

  // Append any additional context (e.g., Telegram-specific info)
  if (additionalContext) {
    systemPrompt += `\n\n${additionalContext}`;
  }

  // Append surface-specific context
  const surfaceContext = buildSurfaceContext(options.context);
  if (surfaceContext) {
    systemPrompt += `\n\n${surfaceContext}`;
  }

  // Emit memory recall event (fire-and-forget)
  const durationMs = Date.now() - startTime;
  emitMemoryEvent({
    eventType: 'recall',
    trigger: 'chat',
    summary: `Recalled memory for: "${query.slice(0, 80)}${query.length > 80 ? '...' : ''}"`,
    payload: {
      query,
      recentNotes: recentNotes ? recentNotes.slice(0, 2000) : null,
      memoryContext,
      hasRecentNotes: !!recentNotes,
      hasMemoryContext: !!memoryContext,
      systemPromptLength: systemPrompt.length,
    },
    durationMs,
    metadata: { modelId, collection: 'life' },
  }).catch(() => {}); // fire-and-forget

  return {
    systemPrompt,
    recentNotes,
    memoryContext,
    soulConfig,
    modelId,
  };
}
