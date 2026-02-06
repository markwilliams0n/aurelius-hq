import type { Capability } from '../types';
import { CONFIG_TOOL_DEFINITIONS, handleConfigTool } from './tools';

const PROMPT = `# Configuration

You can read and modify your own configuration using tools.

## When to use

- When the user asks you to change your behavior, personality, or prompts
- When the user wants to see your current configuration
- When you want to propose changes to capability instructions

## How it works

- Changes are NOT applied immediately — they create a pending change
- The user must explicitly approve changes before they take effect
- Always read the current config before proposing changes
- Explain clearly what you're changing and why

## Available configs

- **soul** — Your personality and behavioral instructions
- **system_prompt** — Core system prompt defining your capabilities
- **agents** — Specialized sub-agent configurations (reserved)
- **processes** — Automated process definitions (reserved)`;

export const configCapability: Capability = {
  name: 'config',
  tools: CONFIG_TOOL_DEFINITIONS,
  prompt: PROMPT,
  handleTool: handleConfigTool,
};
