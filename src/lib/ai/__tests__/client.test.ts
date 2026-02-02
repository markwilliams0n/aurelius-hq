import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock OpenRouter before importing
vi.mock("@openrouter/sdk", () => {
  class MockOpenRouter {
    callModel() {
      return {
        getText: async () => "Hello! How can I help you?",
        getTextStream: async function* () {
          yield "Hello";
          yield "!";
        },
      };
    }
  }

  return {
    OpenRouter: MockOpenRouter,
  };
});

describe("ai client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("chat", () => {
    it("returns text response from model", async () => {
      const { chat } = await import("../client");

      const result = await chat("Hello");

      expect(result).toBe("Hello! How can I help you?");
    });
  });

  describe("chatStream", () => {
    it("yields text chunks from model", async () => {
      const { chatStream } = await import("../client");

      const chunks: string[] = [];
      for await (const chunk of chatStream("Hello")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Hello", "!"]);
    });
  });
});
