import { describe, it, expect } from "vitest";
import { sseEncode, SSE_HEADERS } from "../server";

describe("sseEncode", () => {
  it("encodes an object as an SSE data line", () => {
    const result = sseEncode({ type: "text", content: "hello" });
    const text = new TextDecoder().decode(result);
    expect(text).toBe('data: {"type":"text","content":"hello"}\n\n');
  });

  it("handles special characters in content", () => {
    const result = sseEncode({ type: "text", content: "line1\nline2" });
    const text = new TextDecoder().decode(result);
    const parsed = JSON.parse(text.replace("data: ", "").trim());
    expect(parsed.content).toBe("line1\nline2");
  });
});

describe("SSE_HEADERS", () => {
  it("has the correct content type", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
  });
});
