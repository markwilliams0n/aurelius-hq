/**
 * Capability Registry
 *
 * Auto-collects all capabilities and provides:
 * - getAllTools(): all tool definitions for the LLM
 * - getCapabilityPrompts(): all capability.md contents for the system prompt
 * - handleToolCall(): dispatches a tool call to the right capability
 */

import type { Capability, ToolDefinition, ToolResult } from './types';
import { getConfig } from '@/lib/config';
import type { ConfigKey } from '@/lib/config';

// Import capabilities — add new ones here as they're created
import { configCapability } from './config';
import { tasksCapability } from './tasks';

const ALL_CAPABILITIES: Capability[] = [
  configCapability,
  tasksCapability,
];

/** Get all tool definitions from all capabilities (OpenAI function calling format) */
export function getAllTools(): { type: "function"; function: ToolDefinition }[] {
  return ALL_CAPABILITIES.flatMap(cap =>
    cap.tools.map(t => ({ type: "function" as const, function: t }))
  );
}

/** Load capability prompt from DB if modified, otherwise use default */
async function loadCapabilityPrompt(capabilityName: string, defaultPrompt: string): Promise<string> {
  try {
    const configKey = `capability:${capabilityName}` as ConfigKey;
    const config = await getConfig(configKey);
    if (config?.content) return config.content;
  } catch {
    // DB not available or key doesn't exist — use default
  }
  return defaultPrompt;
}

/** Get formatted capability prompts for the system prompt */
export async function getCapabilityPrompts(): Promise<string> {
  const sections = await Promise.all(
    ALL_CAPABILITIES.map(async cap => {
      const prompt = await loadCapabilityPrompt(cap.name, cap.prompt);
      return prompt.trim();
    })
  );

  const nonEmpty = sections.filter(s => s.length > 0);
  if (nonEmpty.length === 0) return '';
  return `## Available Capabilities\n\n${nonEmpty.join('\n\n---\n\n')}`;
}

/** Dispatch a tool call to the right capability handler */
export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult> {
  for (const cap of ALL_CAPABILITIES) {
    const result = await cap.handleTool(toolName, toolInput, conversationId);
    if (result !== null) return result;
  }
  return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
}

export type { Capability, ToolDefinition, ToolResult };
