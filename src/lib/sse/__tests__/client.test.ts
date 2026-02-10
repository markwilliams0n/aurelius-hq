import { describe, it, expect } from "vitest";
import { parseSSELines } from "../client";

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
