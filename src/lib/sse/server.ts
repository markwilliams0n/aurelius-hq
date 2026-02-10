const encoder = new TextEncoder();

/** Encode a data object as a UTF-8 SSE `data:` frame */
export function sseEncode(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** Standard SSE response headers */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
