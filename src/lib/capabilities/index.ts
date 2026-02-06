/**
 * Capability Registry
 *
 * Auto-collects all capabilities and provides:
 * - getAllTools(): all tool definitions for the LLM
 * - getCapabilityPrompts(): all capability.md contents for the system prompt
 * - handleToolCall(): dispatches a tool call to the right capability
 */

import type { Capability, ToolDefinition, ToolResult } from './types';

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

/** Get formatted capability prompts for the system prompt */
export function getCapabilityPrompts(): string {
  const sections = ALL_CAPABILITIES
    .filter(cap => cap.prompt.trim().length > 0)
    .map(cap => cap.prompt);

  if (sections.length === 0) return '';
  return `## Available Capabilities\n\n${sections.join('\n\n---\n\n')}`;
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
