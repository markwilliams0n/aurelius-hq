/**
 * Parse raw text containing SSE frames, calling `onEvent` for each
 * successfully parsed `data:` line. Returns any incomplete trailing text
 * so the caller can prepend it to the next chunk.
 */
export function parseSSELines(
  raw: string,
  onEvent: (data: Record<string, unknown>) => void,
): string {
  const lines = raw.split("\n");
  const remainder = lines.pop() || "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(line.slice(6));
      onEvent(data);
    } catch {
      // Skip malformed JSON
    }
  }

  return remainder;
}

/**
 * Read an SSE response stream, parsing each event and calling `onEvent`.
 * Handles chunked reads, buffering, and remainder flushing.
 */
export async function readSSEStream(
  response: Response,
  onEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSSELines(buffer, onEvent);
  }

  // Flush any trailing data
  if (buffer) {
    parseSSELines(buffer + "\n", onEvent);
  }
}
