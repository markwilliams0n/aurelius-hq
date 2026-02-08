export type CardHandlerResult = {
  status: "confirmed" | "error";
  resultUrl?: string;
  error?: string;
};

export type CardHandler = {
  /** Execute the primary action for this card type */
  execute: (data: Record<string, unknown>) => Promise<CardHandlerResult>;
  /** Label for the primary action button (e.g. "Send", "Create") */
  label: string;
  /** Toast message on success */
  successMessage: string;
};

const handlers = new Map<string, CardHandler>();

/**
 * Register a handler for a given handler ID (e.g. "slack:send-message").
 */
export function registerCardHandler(handlerId: string, handler: CardHandler) {
  handlers.set(handlerId, handler);
}

/**
 * Get a registered handler by ID.
 */
export function getCardHandler(handlerId: string): CardHandler | undefined {
  return handlers.get(handlerId);
}

/**
 * Dispatch a card action. Generic actions (cancel, dismiss, edit) are handled
 * inline. Primary actions are dispatched to the registered handler.
 */
export async function dispatchCardAction(
  handlerId: string | null | undefined,
  action: string,
  data: Record<string, unknown>
): Promise<{ status: "pending" | "confirmed" | "dismissed" | "error"; result?: Record<string, unknown>; successMessage?: string }> {
  // Generic status-only actions
  if (action === "cancel" || action === "dismiss") {
    return { status: "dismissed" };
  }
  if (action === "edit") {
    return { status: "pending" };
  }

  // Primary action — requires a handler
  if (!handlerId) {
    return { status: "confirmed" };
  }

  // Try action-specific handler first (e.g. "vault:supermemory" handler + "delete" action → try "vault:delete")
  const prefix = handlerId.split(":")[0];
  const actionHandlerId = `${prefix}:${action}`;
  const handler = handlers.get(actionHandlerId) ?? handlers.get(handlerId);
  if (!handler) {
    return {
      status: "error",
      result: { error: `No handler registered for "${handlerId}"` },
    };
  }

  try {
    const handlerResult = await handler.execute(data);

    if (handlerResult.status === "error") {
      return {
        status: "error",
        result: { error: handlerResult.error },
      };
    }

    return {
      status: handlerResult.status,
      result: handlerResult.resultUrl ? { resultUrl: handlerResult.resultUrl } : undefined,
      successMessage: handler.successMessage,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      result: { error: errMsg },
    };
  }
}
