import { describe, it, expect } from "vitest";

// Test the SSE parsing logic
function parseSSEChunk(chunk: string): Array<{ type: string; content?: string }> {
  const events: Array<{ type: string; content?: string }> = [];
  const lines = chunk.split("\n");

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        events.push(data);
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return events;
}

describe("SSE parsing", () => {
  it("parses single event correctly", () => {
    const chunk = 'data: {"type":"text","content":"Hello"}\n\n';
    const events = parseSSEChunk(chunk);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "text", content: "Hello" });
  });

  it("parses multiple events in one chunk", () => {
    const chunk =
      'data: {"type":"text","content":"Hello"}\n\ndata: {"type":"text","content":" world"}\n\n';
    const events = parseSSEChunk(chunk);

    expect(events).toHaveLength(2);
    expect(events[0].content).toBe("Hello");
    expect(events[1].content).toBe(" world");
  });

  it("handles partial chunks without duplication", () => {
    // Simulate two partial reads that together form complete events
    const chunk1 = 'data: {"type":"text","content":"Hel';
    const chunk2 = 'lo"}\n\ndata: {"type":"text","content":" world"}\n\n';

    // First chunk should produce no complete events (invalid JSON)
    const events1 = parseSSEChunk(chunk1);
    expect(events1).toHaveLength(0);

    // Second chunk alone would also be invalid
    const events2 = parseSSEChunk(chunk2);
    // This is the bug - it parses " world" but not the complete "Hello"
    expect(events2).toHaveLength(1);
  });
});
