import type { Capability, ToolDefinition, ToolResult } from '../types';
import { createVaultItem, getVaultItem, searchVaultItems } from '@/lib/vault';
import { classifyVaultItem } from '@/lib/vault/classify';
import type { VaultItem } from '@/lib/db/schema/vault';

const PROMPT = `# Vault — Document Library & Fact Store

You can save and search items in the user's personal vault using these tools.

## save_to_vault
- Use when the user shares information they want to keep: passwords, IDs, policy details, links, facts, notes
- The system auto-classifies type, sensitivity, title, and tags — but the user can override any of those
- Sensitive items (SSN, passport numbers, credentials) are stored securely and never shown in chat responses
- Always confirm what was saved by showing the action card

## search_vault
- Use when the user asks about something that may be stored: "what's my passport number?", "find my insurance details"
- Search by text query, tags, or type
- For sensitive items: you will receive METADATA ONLY (title, type, tags). The actual value is never returned to you.
- Present sensitive results with a "Reveal" action card — the client will handle showing the value directly to the user
- For non-sensitive items: full content is returned and you can reference it in your response

## When to use
- User says "remember this", "save this", "store this"
- User shares a specific ID, number, or credential
- User asks "what's my...", "find my...", "do you have my..."
- User asks to look something up from their vault`;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'save_to_vault',
    description:
      'Save an item to the vault. Auto-classifies type, sensitivity, and tags. Returns an action card confirming what was saved.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to save (text, number, URL, etc.)',
        },
        title: {
          type: 'string',
          description: 'Optional title. If omitted, one is auto-generated.',
        },
        type: {
          type: 'string',
          description:
            'Optional type override: "document", "fact", "credential", or "reference"',
        },
        sensitive: {
          type: 'boolean',
          description:
            'Optional sensitivity override. If omitted, auto-detected from content.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags. Merged with auto-generated tags.',
        },
        sourceUrl: {
          type: 'string',
          description: 'Optional source URL where this information came from.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_vault',
    description:
      'Search the vault by text query, ID, tags, or type. Sensitive items return metadata only — never the actual value.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search query (full-text search across title and content)',
        },
        id: {
          type: 'string',
          description: 'Direct lookup by vault item ID',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags',
        },
        type: {
          type: 'string',
          description: 'Filter by type: "document", "fact", "credential", or "reference"',
        },
      },
    },
  },
];

/** Format a vault item for the tool result, redacting sensitive content */
function formatVaultItem(item: VaultItem): Record<string, unknown> {
  if (item.sensitive) {
    // NEVER include content for sensitive items
    return {
      vault_item_id: item.id,
      title: item.title,
      type: item.type,
      tags: item.tags,
      sensitive: true,
      created_at: item.createdAt,
    };
  }

  return {
    vault_item_id: item.id,
    title: item.title,
    type: item.type,
    tags: item.tags,
    sensitive: false,
    content: item.content,
    source_url: item.sourceUrl,
    created_at: item.createdAt,
  };
}

async function handleSave(
  toolInput: Record<string, unknown>,
): Promise<ToolResult> {
  const content = String(toolInput.content || '');
  if (!content) {
    return { result: JSON.stringify({ error: '"content" is required' }) };
  }

  const hints: { title?: string; type?: string; sensitive?: boolean } = {};
  if (toolInput.title) hints.title = String(toolInput.title);
  if (toolInput.type) hints.type = String(toolInput.type);
  if (typeof toolInput.sensitive === 'boolean') hints.sensitive = toolInput.sensitive;

  // Classify via Ollama + pattern matching
  const classification = await classifyVaultItem(content, hints);

  // Merge user-provided tags with AI-generated tags (deduplicate)
  const userTags = Array.isArray(toolInput.tags)
    ? (toolInput.tags as string[]).map(t => String(t))
    : [];
  const allTags = [...new Set([...userTags, ...classification.tags])];

  // Build stored content: use normalized version if available, append search keywords
  const storedContent = classification.normalizedContent || content;
  const keywordSuffix = classification.searchKeywords?.length
    ? `\n\n[keywords: ${classification.searchKeywords.join(', ')}]`
    : '';

  // Create the vault item
  const item = await createVaultItem({
    content: storedContent + keywordSuffix,
    title: classification.title,
    type: classification.type,
    sensitive: classification.sensitive,
    tags: allTags,
    sourceUrl: toolInput.sourceUrl ? String(toolInput.sourceUrl) : null,
    supermemoryStatus: 'none',
  });

  return {
    result: JSON.stringify({
      action_card: {
        pattern: 'vault',
        handler: 'vault:supermemory',
        title: `Saved to Vault: ${item.title}`,
        data: {
          vault_item_id: item.id,
          title: item.title,
          type: item.type,
          tags: item.tags,
          sensitive: item.sensitive,
          supermemoryStatus: item.supermemoryStatus,
        },
      },
      summary: `Saved "${item.title}" to vault as ${item.type}${item.sensitive ? ' (sensitive)' : ''}`,
    }),
  };
}

async function handleSearch(
  toolInput: Record<string, unknown>,
): Promise<ToolResult> {
  // Direct lookup by ID
  if (toolInput.id) {
    const item = await getVaultItem(String(toolInput.id));
    if (!item) {
      return { result: JSON.stringify({ error: `Vault item not found: ${toolInput.id}` }) };
    }

    const formatted = formatVaultItem(item);

    if (item.sensitive) {
      return {
        result: JSON.stringify({
          action_card: {
            pattern: 'vault',
            handler: null,
            title: `Vault: ${item.title}`,
            data: {
              ...formatted,
              reveal_available: true,
            },
          },
          summary: `Found "${item.title}" (sensitive — use Reveal to view value)`,
        }),
      };
    }

    return {
      result: JSON.stringify({
        item: formatted,
        summary: `Found "${item.title}"`,
      }),
    };
  }

  // Full-text search
  const query = String(toolInput.query || '');
  if (!query) {
    return { result: JSON.stringify({ error: 'Either "query" or "id" is required' }) };
  }

  const filters: { tags?: string[]; type?: string } = {};
  if (Array.isArray(toolInput.tags)) {
    filters.tags = (toolInput.tags as string[]).map(t => String(t));
  }
  if (toolInput.type) {
    filters.type = String(toolInput.type);
  }

  const items = await searchVaultItems(query, filters);

  if (items.length === 0) {
    return { result: JSON.stringify({ results: [], summary: `No vault items found for "${query}"` }) };
  }

  // Format results, redacting sensitive content
  const results = items.map(item => {
    const formatted = formatVaultItem(item);
    if (item.sensitive) {
      return { ...formatted, reveal_available: true };
    }
    return formatted;
  });

  const sensitiveCount = items.filter(i => i.sensitive).length;
  const sensitiveNote = sensitiveCount > 0
    ? ` (${sensitiveCount} sensitive — metadata only)`
    : '';

  // If any sensitive items, include an action card for the first one
  const firstSensitive = items.find(i => i.sensitive);
  if (firstSensitive) {
    return {
      result: JSON.stringify({
        action_card: {
          pattern: 'vault',
          handler: null,
          title: `Vault search: ${items.length} result${items.length === 1 ? '' : 's'}`,
          data: {
            results,
            first_sensitive_id: firstSensitive.id,
          },
        },
        summary: `Found ${items.length} result${items.length === 1 ? '' : 's'} for "${query}"${sensitiveNote}`,
      }),
    };
  }

  return {
    result: JSON.stringify({
      results,
      summary: `Found ${items.length} result${items.length === 1 ? '' : 's'} for "${query}"`,
    }),
  };
}

async function handleVaultTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolResult | null> {
  switch (toolName) {
    case 'save_to_vault':
      return handleSave(toolInput);
    case 'search_vault':
      return handleSearch(toolInput);
    default:
      return null;
  }
}

export const vaultCapability: Capability = {
  name: 'vault',
  tools: TOOL_DEFINITIONS,
  prompt: PROMPT,
  promptVersion: 1,
  handleTool: handleVaultTool,
};
