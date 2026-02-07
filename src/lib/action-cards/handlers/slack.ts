import { registerCardHandler } from "../registry";
import { sendDirectMessage, sendChannelMessage, type SendAs } from "@/lib/slack/actions";

registerCardHandler("slack:send-message", {
  label: "Send",
  successMessage: "Slack message sent!",

  async execute(data) {
    const recipientType = data.recipientType as string | undefined;
    const recipientId = data.recipientId as string | undefined;
    const message = data.message as string | undefined;
    const myUserId = (data.myUserId as string) || "";
    const threadTs = data.threadTs as string | undefined;
    const sendAs = (data.sendAs as SendAs) || "bot";

    if (!recipientType || !recipientId || !message) {
      return { status: "error", error: "Missing required fields: recipientId or message" };
    }

    const result = recipientType === "dm"
      ? await sendDirectMessage(recipientId, myUserId, message, sendAs)
      : await sendChannelMessage(recipientId, myUserId, message, threadTs, sendAs);

    if (result.ok) {
      return { status: "confirmed", resultUrl: result.permalink };
    }

    return { status: "error", error: result.error || "Slack send failed" };
  },
});
