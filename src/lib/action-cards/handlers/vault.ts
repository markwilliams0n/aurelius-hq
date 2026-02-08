import { registerCardHandler } from "../registry";
import { generateSummary, sendToSupermemory } from "@/lib/vault/supermemory";

registerCardHandler("vault:supermemory", {
  label: "Send to SuperMemory",
  successMessage: "Sent to SuperMemory!",

  async execute(data) {
    const itemId = data.vault_item_id as string | undefined;
    if (!itemId) {
      return { status: "error", error: "Missing vault item ID" };
    }

    try {
      // Generate a medium summary (good default for long-term memory)
      const summary = await generateSummary(itemId, "medium");
      await sendToSupermemory(itemId, summary, "medium");
      return { status: "confirmed" };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});
