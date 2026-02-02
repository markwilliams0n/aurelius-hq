import { getConfig, getAllConfigs, proposePendingChange, CONFIG_DESCRIPTIONS, ConfigKey } from "@/lib/config";
import { configKeyEnum } from "@/lib/db/schema";

// Tool definitions for Claude
export const CONFIG_TOOLS = [
  {
    name: "list_configs",
    description: "List all available configuration keys and their descriptions. Use this to see what configs can be modified.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "read_config",
    description: "Read the current content of a specific configuration. Use this to see the current state before proposing changes.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The configuration key to read",
          enum: configKeyEnum.enumValues,
        },
      },
      required: ["key"],
    },
  },
  {
    name: "propose_config_change",
    description: "Propose a change to a configuration. This will NOT apply immediately - it creates a pending change that the user must approve. Always explain what you're changing and why.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The configuration key to modify",
          enum: configKeyEnum.enumValues,
        },
        proposedContent: {
          type: "string",
          description: "The complete new content for this configuration",
        },
        reason: {
          type: "string",
          description: "A clear explanation of what is being changed and why",
        },
      },
      required: ["key", "proposedContent", "reason"],
    },
  },
];

// Tool handlers
export async function handleConfigTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<{ result: string; pendingChangeId?: string }> {
  switch (toolName) {
    case "list_configs": {
      const configs = await getAllConfigs();
      const configList = configKeyEnum.enumValues.map((key) => {
        const current = configs.find((c) => c.key === key);
        return {
          key,
          description: CONFIG_DESCRIPTIONS[key],
          hasContent: !!current,
          version: current?.version ?? 0,
          lastUpdated: current?.createdAt ?? null,
        };
      });

      return {
        result: JSON.stringify({
          configs: configList,
          note: "Use read_config to see the full content of any configuration.",
        }, null, 2),
      };
    }

    case "read_config": {
      const key = toolInput.key as ConfigKey;
      const config = await getConfig(key);

      if (!config) {
        return {
          result: JSON.stringify({
            key,
            description: CONFIG_DESCRIPTIONS[key],
            content: null,
            note: "This configuration has not been set yet. You can propose initial content using propose_config_change.",
          }, null, 2),
        };
      }

      return {
        result: JSON.stringify({
          key: config.key,
          description: CONFIG_DESCRIPTIONS[key],
          content: config.content,
          version: config.version,
          createdBy: config.createdBy,
          createdAt: config.createdAt,
        }, null, 2),
      };
    }

    case "propose_config_change": {
      const key = toolInput.key as ConfigKey;
      const proposedContent = toolInput.proposedContent as string;
      const reason = toolInput.reason as string;

      const pending = await proposePendingChange(key, proposedContent, reason, conversationId);

      return {
        result: JSON.stringify({
          success: true,
          pendingChangeId: pending.id,
          message: `I've proposed a change to the "${key}" configuration. The change is now pending your approval. You can review and approve/reject it in the System settings.`,
          key,
          reason,
        }, null, 2),
        pendingChangeId: pending.id,
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
  }
}

// Check if a tool name is a config tool
export function isConfigTool(toolName: string): boolean {
  return CONFIG_TOOLS.some((t) => t.name === toolName);
}
