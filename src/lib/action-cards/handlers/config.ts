import { registerCardHandler } from "../registry";
import { updateConfig, type ConfigKey } from "@/lib/config";
import { configKeyEnum } from "@/lib/db/schema";

registerCardHandler("config:save", {
  label: "Save",
  successMessage: "Configuration saved!",

  async execute(data) {
    const key = data.key as string | undefined;
    const entries = data.entries as Array<{ key: string; value: string }> | undefined;
    const content = data.content as string | undefined;

    if (!key) {
      return { status: "error", error: "Missing config key" };
    }

    // Validate config key
    if (!configKeyEnum.enumValues.includes(key as ConfigKey)) {
      return { status: "error", error: `Invalid config key: ${key}` };
    }

    try {
      // If entries-based, serialize back to content
      let newContent: string;
      if (entries) {
        newContent = entries.map((e) => `${e.key}: ${e.value}`).join("\n");
      } else if (content) {
        newContent = content;
      } else {
        return { status: "error", error: "No content to save" };
      }

      await updateConfig(key as ConfigKey, newContent, "aurelius");
      return { status: "confirmed" };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});
