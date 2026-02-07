import { registerCardHandler } from "../registry";
import { replyToEmail } from "@/lib/gmail/actions";

registerCardHandler("gmail:send-email", {
  label: "Send",
  successMessage: "Email sent!",

  async execute(data) {
    const itemId = data.itemId as string | undefined;
    const body = data.body as string | undefined;
    const to = data.to as string | undefined;
    const cc = data.cc as string | undefined;
    const bcc = data.bcc as string | undefined;
    const forceDraft = data.forceDraft as boolean | undefined;

    if (!itemId || !body) {
      return { status: "error", error: "Missing required fields: itemId and body" };
    }

    try {
      const result = await replyToEmail(itemId, body, { to, cc, bcc, forceDraft });

      if (result.wasDraft) {
        return {
          status: "confirmed",
          resultUrl: `https://mail.google.com/mail/u/0/#drafts`,
        };
      }

      return { status: "confirmed" };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});

registerCardHandler("gmail:create-draft", {
  label: "Create Draft",
  successMessage: "Draft created!",

  async execute(data) {
    const itemId = data.itemId as string | undefined;
    const body = data.body as string | undefined;
    const to = data.to as string | undefined;
    const cc = data.cc as string | undefined;

    if (!itemId || !body) {
      return { status: "error", error: "Missing required fields: itemId and body" };
    }

    try {
      const result = await replyToEmail(itemId, body, { to, cc, forceDraft: true });
      return {
        status: "confirmed",
        resultUrl: `https://mail.google.com/mail/u/0/#drafts`,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});
