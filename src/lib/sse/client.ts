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
