import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TriageRule } from "@/lib/db/schema";

// Mock the database module before importing anything that uses it
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  },
}));

import { matchRule } from "../rules";
import type { MatchableItem } from "../rules";

// Helper to create a minimal structured rule for testing
function makeRule(overrides: Partial<TriageRule> = {}): TriageRule {
  return {
    id: "rule-1",
    name: "Test Rule",
    description: null,
    type: "structured",
    trigger: {},
    action: { type: "batch", batchType: "archive" },
    guidance: null,
    status: "active",
    source: "user_chat",
    version: 1,
    createdBy: "user",
    matchCount: 0,
    lastMatchedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create a minimal inbox item for testing
function makeItem(overrides: Partial<MatchableItem> = {}): MatchableItem {
  return {
    connector: "gmail",
    sender: "alice@example.com",
    subject: "Hello World",
    content: "This is a test message",
    ...overrides,
  };
}

describe("matchRule", () => {
  describe("basic trigger matching", () => {
    it("matches by sender (exact match)", () => {
      const rule = makeRule({
        trigger: { sender: "alice@example.com" },
      });
      const item = makeItem({ sender: "alice@example.com" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("does not match a different sender", () => {
      const rule = makeRule({
        trigger: { sender: "bob@example.com" },
      });
      const item = makeItem({ sender: "alice@example.com" });
      expect(matchRule(rule, item)).toBe(false);
    });

    it("matches by connector", () => {
      const rule = makeRule({
        trigger: { connector: "slack" },
      });
      const item = makeItem({ connector: "slack" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("does not match a different connector", () => {
      const rule = makeRule({
        trigger: { connector: "slack" },
      });
      const item = makeItem({ connector: "gmail" });
      expect(matchRule(rule, item)).toBe(false);
    });

    it("matches by sender domain", () => {
      const rule = makeRule({
        trigger: { senderDomain: "example.com" },
      });
      const item = makeItem({ sender: "alice@example.com" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("does not match a different sender domain", () => {
      const rule = makeRule({
        trigger: { senderDomain: "other.com" },
      });
      const item = makeItem({ sender: "alice@example.com" });
      expect(matchRule(rule, item)).toBe(false);
    });

    it("handles sender with no @ for domain matching", () => {
      const rule = makeRule({
        trigger: { senderDomain: "example.com" },
      });
      const item = makeItem({ sender: "#general" });
      expect(matchRule(rule, item)).toBe(false);
    });
  });

  describe("keyword matching", () => {
    it("matches subjectContains (case-insensitive)", () => {
      const rule = makeRule({
        trigger: { subjectContains: "urgent" },
      });
      const item = makeItem({ subject: "URGENT: Please respond" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("matches subjectContains with mixed case", () => {
      const rule = makeRule({
        trigger: { subjectContains: "HELLO" },
      });
      const item = makeItem({ subject: "hello world" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("does not match when subject doesn't contain keyword", () => {
      const rule = makeRule({
        trigger: { subjectContains: "invoice" },
      });
      const item = makeItem({ subject: "Hello World" });
      expect(matchRule(rule, item)).toBe(false);
    });

    it("matches contentContains (case-insensitive)", () => {
      const rule = makeRule({
        trigger: { contentContains: "deadline" },
      });
      const item = makeItem({ content: "The DEADLINE is tomorrow" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("does not match when content doesn't contain keyword", () => {
      const rule = makeRule({
        trigger: { contentContains: "deadline" },
      });
      const item = makeItem({ content: "This is a normal message" });
      expect(matchRule(rule, item)).toBe(false);
    });
  });

  describe("pattern (regex) matching", () => {
    it("matches regex pattern against subject", () => {
      const rule = makeRule({
        trigger: { pattern: "invoice\\s*#\\d+" },
      });
      const item = makeItem({ subject: "Invoice #12345" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("matches regex pattern against content", () => {
      const rule = makeRule({
        trigger: { pattern: "\\bPER-\\d+\\b" },
      });
      const item = makeItem({ content: "Working on PER-221 now" });
      expect(matchRule(rule, item)).toBe(true);
    });

    it("does not match when pattern is not found in subject or content", () => {
      const rule = makeRule({
        trigger: { pattern: "\\bPER-\\d+\\b" },
      });
      const item = makeItem({
        subject: "Hello",
        content: "No issue references here",
      });
      expect(matchRule(rule, item)).toBe(false);
    });

    it("handles invalid regex gracefully (returns false)", () => {
      const rule = makeRule({
        trigger: { pattern: "[invalid(regex" },
      });
      const item = makeItem();
      expect(matchRule(rule, item)).toBe(false);
    });
  });

  describe("AND logic (all triggers must match)", () => {
    it("requires all trigger fields to match", () => {
      const rule = makeRule({
        trigger: {
          connector: "gmail",
          sender: "alice@example.com",
          subjectContains: "invoice",
        },
      });

      // All match
      const matchingItem = makeItem({
        connector: "gmail",
        sender: "alice@example.com",
        subject: "New Invoice #100",
      });
      expect(matchRule(rule, matchingItem)).toBe(true);

      // Connector matches, sender matches, but subject doesn't contain "invoice"
      const mismatchItem = makeItem({
        connector: "gmail",
        sender: "alice@example.com",
        subject: "Hello World",
      });
      expect(matchRule(rule, mismatchItem)).toBe(false);
    });

    it("fails when any one trigger field doesn't match", () => {
      const rule = makeRule({
        trigger: {
          connector: "gmail",
          senderDomain: "acme.com",
        },
      });

      // Connector matches but domain doesn't
      const item = makeItem({
        connector: "gmail",
        sender: "bob@example.com",
      });
      expect(matchRule(rule, item)).toBe(false);
    });
  });

  describe("guidance rules", () => {
    it("returns false for guidance rules (no deterministic match)", () => {
      const rule = makeRule({
        type: "guidance",
        trigger: null,
        guidance: "Be extra careful with emails from VIP clients",
      });
      const item = makeItem();
      expect(matchRule(rule, item)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false when trigger is null", () => {
      const rule = makeRule({ trigger: null });
      const item = makeItem();
      expect(matchRule(rule, item)).toBe(false);
    });

    it("matches when trigger is an empty object (no conditions = match all)", () => {
      const rule = makeRule({ trigger: {} });
      const item = makeItem();
      expect(matchRule(rule, item)).toBe(true);
    });
  });
});
