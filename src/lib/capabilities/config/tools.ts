import { getConfig, getAllConfigs, proposePendingChange, CONFIG_DESCRIPTIONS, ConfigKey } from "@/lib/config";
import { configKeyEnum } from "@/lib/db/schema";
import type { ToolDefinition, ToolResult } from "../types";

// Tool definitions for Claude (OpenAI function calling format)
export const CONFIG_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_configs",
    description: "List all available configuration keys and their descriptions. Use this to see what configs can be modified.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "show_config_card",
    description: "Show a configuration to the user as an editable card in the chat. Use this when the user asks to see or review a config — it provides an inline editing experience.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The configuration key to show",
          enum: configKeyEnum.enumValues,
        },
      },
      required: ["key"],
    },
  },
  {
    name: "read_config",
    description: "Read the current content of a specific configuration. Use this to see the current state before proposing changes.",
    parameters: {
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
    parameters: {
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

// Helper to validate config key
function isValidConfigKey(key: unknown): key is ConfigKey {
  return typeof key === "string" && key !== "" && configKeyEnum.enumValues.includes(key as ConfigKey);
}

// Tool handler — returns null for unrecognized tool names
export async function handleConfigTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationId?: string
): Promise<ToolResult | null> {
  switch (toolName) {
    case "show_config_card": {
      const key = toolInput.key;

      if (!key || !isValidConfigKey(key)) {
        return {
          result: JSON.stringify({
            error: `Invalid config key: "${key}". Valid keys are: ${configKeyEnum.enumValues.join(", ")}`,
          }),
        };
      }

      const config = await getConfig(key);
      const description = CONFIG_DESCRIPTIONS[key];
      const content = config?.content || "";

      // Detect simple key-value configs (e.g., "setting: value" per line).
      // Must not contain markdown indicators like #, -, *, > or blank lines.
      const lines = content.split("\n").filter((l: string) => l.trim());
      const simpleKvPattern = /^[a-zA-Z0-9_\s]+:\s*.+$/;
      const isKeyValueFormat = lines.length > 0
        && lines.length <= 20
        && lines.every((l: string) => simpleKvPattern.test(l.trim()));

      const cardData: Record<string, unknown> = {
        key,
        description,
        version: config?.version ?? 0,
      };

      if (isKeyValueFormat) {
        cardData.entries = lines.map((l: string) => {
          const [k, ...rest] = l.split(":");
          return { key: k.trim(), value: rest.join(":").trim(), editable: true };
        });
      } else {
        cardData.content = content;
      }

      return {
        result: JSON.stringify({
          action_card: {
            pattern: "config",
            handler: "config:save",
            title: `Config: ${key}`,
            data: cardData,
          },
          summary: `Showing ${key} configuration`,
        }),
      };
    }

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
      const key = toolInput.key;

      // Validate key is provided and non-empty
      if (!key || typeof key !== "string" || key === "") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: key. Please specify which configuration to read.",
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      // Validate key is a valid config key
      if (!isValidConfigKey(key)) {
        return {
          result: JSON.stringify({
            error: `Invalid config key: "${key}". Valid keys are: ${configKeyEnum.enumValues.join(", ")}`,
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

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
      console.log("[Config Tool] propose_config_change called with:", JSON.stringify(toolInput, null, 2));
      const key = toolInput.key;
      const proposedContent = toolInput.proposedContent;
      const reason = toolInput.reason;

      // Validate all required parameters
      if (!key || typeof key !== "string" || key === "") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: key. Please specify which configuration to modify.",
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      if (!isValidConfigKey(key)) {
        return {
          result: JSON.stringify({
            error: `Invalid config key: "${key}". Valid keys are: ${configKeyEnum.enumValues.join(", ")}`,
            validKeys: configKeyEnum.enumValues,
          }),
        };
      }

      if (!proposedContent || typeof proposedContent !== "string") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: proposedContent. Please provide the new content for the configuration.",
          }),
        };
      }

      if (!reason || typeof reason !== "string") {
        return {
          result: JSON.stringify({
            error: "Missing required parameter: reason. Please explain why this change is being made.",
          }),
        };
      }

      const pending = await proposePendingChange(key, proposedContent, reason, conversationId);
      console.log("[Config Tool] Pending change created:", pending.id);

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
      return null;
  }
}
