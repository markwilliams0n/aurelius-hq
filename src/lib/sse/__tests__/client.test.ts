import { describe, it, expect } from "vitest";
import { parseSSELines, readSSEStream } from "../client";

describe("parseSSELines", () => {
  it("parses complete SSE data lines", () => {
    const events: unknown[] = [];
    const buffer = parseSSELines(
      'data: {"type":"text","content":"hello"}\n\ndata: {"type":"done"}\n\n',
      (data) => events.push(data),
    );
    expect(events).toEqual([
      { type: "text", content: "hello" },
      { type: "done" },
    ]);
    expect(buffer).toBe("");
  });

  it("returns incomplete line as buffer remainder", () => {
    const events: unknown[] = [];
    const buffer = parseSSELines(
      'data: {"type":"text","content":"hel',
      (data) => events.push(data),
    );
    expect(events).toEqual([]);
    expect(buffer).toBe('data: {"type":"text","content":"hel');
  });

  it("skips non-data lines", () => {
    const events: unknown[] = [];
    parseSSELines('event: ping\ndata: {"type":"text"}\n\n', (data) =>
      events.push(data),
    );
    expect(events).toEqual([{ type: "text" }]);
  });

  it("skips malformed JSON gracefully", () => {
    const events: unknown[] = [];
    parseSSELines("data: {invalid json}\n\n", (data) => events.push(data));
    expect(events).toEqual([]);
  });
});

describe("readSSEStream", () => {
  function makeResponse(chunks: string[]): Response {
    let idx = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (idx < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[idx++]));
        } else {
          controller.close();
        }
      },
    });
    return new Response(stream);
  }

  it("reads a complete SSE stream", async () => {
    const events: unknown[] = [];
    const response = makeResponse([
      'data: {"type":"text","content":"hello"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);
    await readSSEStream(response, (data) => events.push(data));
    expect(events).toEqual([
      { type: "text", content: "hello" },
      { type: "done" },
    ]);
  });

  it("handles split chunks correctly", async () => {
    const events: unknown[] = [];
    const response = makeResponse([
      'data: {"type":"te',
      'xt","content":"hi"}\n\n',
    ]);
    await readSSEStream(response, (data) => events.push(data));
    expect(events).toEqual([{ type: "text", content: "hi" }]);
  });

  it("throws when response has no body", async () => {
    const response = new Response(null);
    // Response(null) creates a body that's null — readSSEStream should throw
    await expect(
      readSSEStream(response, () => {}),
    ).rejects.toThrow("No response body");
  });
});
