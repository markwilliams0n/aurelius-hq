/**
 * Capability Registry
 *
 * Auto-collects all capabilities and provides:
 * - getAllTools(): all tool definitions for the LLM
 * - getCapabilityPrompts(): all capability.md contents for the system prompt
 * - handleToolCall(): dispatches a tool call to the right capability
 * - seedCapabilityDefaults(): seeds default prompts into DB on first run
 */

import type { Capability, ToolDefinition, ToolResult } from './types';
import { getConfig, updateConfig } from '@/lib/config';
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

/**
 * Load a capability prompt from DB, seeding the default if no entry exists.
 * This makes the DB the single source of truth — first access seeds it.
 * When cap.promptVersion is set and exceeds the DB version, the code
 * default is pushed to DB (preserving upgrades while allowing runtime edits).
 */
async function loadCapabilityPrompt(cap: Capability): Promise<string> {
  const configKey = `capability:${cap.name}` as ConfigKey;
  try {
    const config = await getConfig(configKey);

    if (config?.content) {
      // If code defines a promptVersion, use it to detect upgrades.
      // DB version numbers are 1-based (first seed = v1), so
      // promptVersion 3 means "needs at least DB v3".
      if (cap.promptVersion && config.version < cap.promptVersion) {
        await updateConfig(configKey, cap.prompt, 'user');
        console.log(`[Capabilities] Upgraded ${configKey} to code v${cap.promptVersion}`);
        return cap.prompt.trim();
      }
      return config.content.trim();
    }

    // No DB entry yet — seed the default
    await updateConfig(configKey, cap.prompt, 'user');
    console.log(`[Capabilities] Seeded default for ${configKey}`);
    return cap.prompt.trim();
  } catch {
    // DB not available — use hardcoded as last resort
    return cap.prompt.trim();
  }
}

/** Get formatted capability prompts for the system prompt */
export async function getCapabilityPrompts(): Promise<string> {
  const sections = await Promise.all(
    ALL_CAPABILITIES.map(cap => loadCapabilityPrompt(cap))
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
