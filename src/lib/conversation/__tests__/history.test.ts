import { describe, it, expect } from "vitest";
import { trimHistory } from "../history";
import type { Message } from "@/lib/ai/client";

describe("trimHistory", () => {
  it("returns all messages when under budget", () => {
    const messages: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = trimHistory(messages, 10000);
    expect(result).toEqual(messages);
  });

  it("trims oldest messages when over budget", () => {
    const messages: Message[] = [
      { role: "user", content: "a".repeat(1000) },
      { role: "assistant", content: "b".repeat(1000) },
      { role: "user", content: "c".repeat(1000) },
      { role: "assistant", content: "d".repeat(1000) },
      { role: "user", content: "latest question" },
    ];
    // Budget of 600 tokens (~2400 chars) should keep only last few messages
    const result = trimHistory(messages, 600);
    // Should always keep the latest user message
    expect(result[result.length - 1].content).toBe("latest question");
    // Should have dropped some older messages
    expect(result.length).toBeLessThan(messages.length);
  });

  it("always keeps at least the last user message", () => {
    const messages: Message[] = [
      { role: "user", content: "a".repeat(10000) },
    ];
    const result = trimHistory(messages, 10); // impossibly small budget
    expect(result.length).toBe(1);
    expect(result[0].content).toBe("a".repeat(10000));
  });

  it("preserves message pairs (user+assistant together)", () => {
    const messages: Message[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "old reply" },
      { role: "user", content: "new" },
      { role: "assistant", content: "new reply" },
      { role: "user", content: "latest" },
    ];
    const result = trimHistory(messages, 100);
    // If trimmed, should not leave orphaned assistant without user
    const roles = result.map((m) => m.role);
    // First message should be "user" (not orphaned "assistant")
    expect(roles[0]).toBe("user");
  });

  it("returns empty array for empty input", () => {
    expect(trimHistory([], 8000)).toEqual([]);
  });
});
