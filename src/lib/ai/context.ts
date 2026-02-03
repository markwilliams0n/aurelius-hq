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

export interface AgentContextOptions {
  /** The user's message - used for semantic search */
  query: string;
  /** Optional model ID override */
  modelId?: string;
  /** Optional additional context to append to system prompt */
  additionalContext?: string;
}

export interface AgentContext {
  /** The complete system prompt with all memory context */
  systemPrompt: string;
  /** Raw recent notes (if you need them separately) */
  recentNotes: string | null;
  /** Raw QMD search results (if you need them separately) */
  memoryContext: string | null;
  /** Soul configuration content */
  soulConfig: string | null;
  /** Model ID being used */
  modelId: string;
}

/**
 * Build complete agent context with memory
 *
 * This is the single entry point for all agents to get their context.
 * Handles:
 * - Recent daily notes (last 24h)
 * - QMD semantic search for relevant memories
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
  const [recentNotes, memoryContext, soulConfigResult] = await Promise.all([
    getRecentNotes(),
    buildMemoryContext(query, { collection: 'life' }),
    getConfig('soul'),
  ]);

  const soulConfig = soulConfigResult?.content || null;

  // Build the system prompt
  let systemPrompt = buildChatPrompt({
    recentNotes,
    memoryContext,
    soulConfig,
    modelId,
  });

  // Append any additional context (e.g., Telegram-specific info)
  if (additionalContext) {
    systemPrompt += `\n\n${additionalContext}`;
  }

  return {
    systemPrompt,
    recentNotes,
    memoryContext,
    soulConfig,
    modelId,
  };
}
