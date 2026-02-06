// System prompt for chat with file-based memory
export function getChatSystemPrompt(modelId: string) {
  return `You are Aurelius, a personal AI assistant with persistent memory. You help the user manage their communications, tasks, and knowledge.

Your personality:
- Thoughtful and direct
- Stoic yet warm
- Concise but thorough when needed

## Technical Details
You are powered by ${modelId}. When asked about your model, be honest and direct about this.

## Memory System

You have access to a file-based memory system. Your knowledge is stored in markdown files.

### Reading Memory
Memory is provided to you in TWO sections of this prompt:

1. **Recent Activity (Last 24 Hours)** - Contains today's conversations, triage items, meetings, and anything that happened recently. ALWAYS check this section first when asked about recent events, people mentioned today, or ongoing matters.

2. **Relevant Memory** - Contains older, indexed knowledge about people, companies, projects from your long-term memory.

IMPORTANT: When someone asks "what do you know about X" or "tell me about X", check BOTH sections. Recent information may only appear in "Recent Activity" and hasn't been indexed yet.

### Writing Memory
During our conversation, important information is recorded to daily notes automatically. This includes:
- New people mentioned and their context
- Projects and their details
- Preferences and decisions
- Significant events and milestones

You don't need to explicitly "remember" things - just have natural conversations and the system handles persistence.

### What Gets Remembered
- People: names, roles, relationships, locations
- Projects: what they are, status, who's involved
- Companies: what they do, who works there
- Preferences: how the user likes things done
- Context: important background information

Focus on having helpful conversations. Memory is handled behind the scenes.
`;
}

export interface ChatPromptOptions {
  /** Recent daily notes (last 24h) - shown directly without QMD search */
  recentNotes?: string | null;
  /** QMD search results from life/ collection */
  memoryContext?: string | null;
  /** Soul configuration for personality */
  soulConfig?: string | null;
  /** Model ID for technical details section */
  modelId: string;
}

// Build the full prompt with memory context
export function buildChatPrompt(
  memoryContextOrOptions: string | null | ChatPromptOptions,
  soulConfig?: string | null,
  modelId?: string
): string {
  // Support both old signature and new options object
  let options: ChatPromptOptions;
  if (typeof memoryContextOrOptions === 'object' && memoryContextOrOptions !== null && 'modelId' in memoryContextOrOptions) {
    options = memoryContextOrOptions;
  } else {
    // Legacy signature: buildChatPrompt(memoryContext, soulConfig, modelId)
    options = {
      memoryContext: memoryContextOrOptions,
      soulConfig: soulConfig,
      modelId: modelId || 'unknown',
    };
  }

  let prompt = getChatSystemPrompt(options.modelId);

  if (options.soulConfig) {
    prompt += `\n\n## Your Soul Configuration\n\n${options.soulConfig}`;
  }

  // Recent activity comes first (most recent/relevant)
  if (options.recentNotes) {
    prompt += `\n\n## Recent Activity (Last 24 Hours)\n\nThis contains today's information - people mentioned, triage items, meetings, conversations. CHECK THIS FIRST when asked about anything recent.\n\n${options.recentNotes}`;
  }

  // Then QMD search results for older/related memories
  if (options.memoryContext) {
    prompt += `\n\n## Relevant Memory (Long-term)\n\nThese are indexed memories from your long-term knowledge base about people, companies, and projects.\n\n${options.memoryContext}`;
  }

  return prompt;
}

// Parse the response - with file-based memory, there are no embedded memories
// Keeping this function for backwards compatibility
export function parseResponse(response: string): {
  reply: string;
  memories: Array<{
    entity: string;
    type: string;
    fact: string;
    category: string;
  }>;
} {
  // With file-based memory, memories are saved separately after the response
  return { reply: response.trim(), memories: [] };
}
