const encoder = new TextEncoder();

/** Encode a data object as a UTF-8 SSE `data:` frame */
export function sseEncode(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Create a ReadableStream wired to an emit/close pair.
 * Use `emit(data)` to push SSE frames and `close()` to end the stream.
 */
export function createSSEStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return {
    stream,
    emit(data: Record<string, unknown>) {
      controller.enqueue(sseEncode(data));
    },
    close() {
      controller.close();
    },
  };
}

/** Standard SSE response headers */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
