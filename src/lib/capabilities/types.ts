/**
 * Agent Capability System
 *
 * Each capability is a self-contained module that provides:
 * - Tools: Functions the LLM can call during chat
 * - Prompt: Instructions for the agent (from capability.md)
 * - Handler: Dispatches tool calls to the right function
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  result: string;
  pendingChangeId?: string;
}

export interface Capability {
  /** Unique name for this capability */
  name: string;
  /** Tool definitions (OpenAI function calling format) */
  tools: ToolDefinition[];
  /** Agent instructions from capability.md */
  prompt: string;
  /** Bump this when the code prompt changes to propagate to DB */
  promptVersion?: number;
  /** Handle a tool call — return null if tool name not recognized */
  handleTool: (
    toolName: string,
    toolInput: Record<string, unknown>,
    conversationId?: string
  ) => Promise<ToolResult | null>;
}
