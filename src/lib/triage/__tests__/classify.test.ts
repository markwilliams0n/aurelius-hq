import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InboxItem, TriageRule } from "@/lib/db/schema";

// Mock the database module
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

// Mock rules module
vi.mock("../rules", () => ({
  matchRule: vi.fn(),
  getActiveRules: vi.fn().mockResolvedValue([]),
  incrementRuleMatchCount: vi.fn().mockResolvedValue(undefined),
  getGuidanceNotes: vi.fn().mockResolvedValue([]),
}));

// Mock Ollama classifier
vi.mock("../classify-ollama", () => ({
  classifyWithOllama: vi.fn(),
}));

// Mock Kimi classifier
vi.mock("../classify-kimi", () => ({
  classifyWithKimi: vi.fn(),
}));

import { classifyItem } from "../classify";
import { matchRule } from "../rules";
import { classifyWithOllama } from "../classify-ollama";
import { classifyWithKimi } from "../classify-kimi";

// Helper to create a minimal inbox item for testing
function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "item-1",
    connector: "gmail",
    externalId: null,
    sender: "alice@example.com",
    senderName: "Alice",
    senderAvatar: null,
    subject: "Hello World",
    content: "This is a test message",
    preview: null,
    rawPayload: null,
    status: "new",
    snoozedUntil: null,
    priority: "normal",
    tags: [],
    enrichment: null,
    classification: null,
    receivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create a minimal structured rule for testing
function makeRule(overrides: Partial<TriageRule> = {}): TriageRule {
  return {
    id: "rule-1",
    name: "Test Rule",
    description: null,
    type: "structured",
    trigger: { sender: "alice@example.com" },
    action: { type: "batch", batchType: "archive" },
    guidance: null,
    status: "active",
    source: "user_chat",
    order: 0,
    version: 1,
    createdBy: "user",
    matchCount: 0,
    lastMatchedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("classifyItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rule classification when a structured rule matches", async () => {
    const item = makeItem();
    const rule = makeRule({
      name: "Archive Alice",
      action: { type: "batch", batchType: "archive" },
    });

    vi.mocked(matchRule).mockReturnValue(true);

    const { classification } = await classifyItem(item, [rule]);

    expect(classification.tier).toBe("rule");
    expect(classification.confidence).toBe(1.0);
    expect(classification.batchType).toBe("archive");
    expect(classification.ruleId).toBe("rule-1");
    expect(classification.reason).toContain("Archive Alice");
  });

  it("falls through to Ollama when no rule matches", async () => {
    const item = makeItem();
    const rule = makeRule();

    vi.mocked(matchRule).mockReturnValue(false);
    vi.mocked(classifyWithOllama).mockResolvedValue({
      batchType: "note-archive",
      confidence: 0.85,
      reason: "FYI update from colleague",
    });

    const { classification } = await classifyItem(item, [rule]);

    expect(classification.tier).toBe("ollama");
    expect(classification.confidence).toBe(0.85);
    expect(classification.batchType).toBe("note-archive");
    expect(classifyWithOllama).toHaveBeenCalledOnce();
  });

  it("falls through to Kimi when Ollama confidence is below threshold", async () => {
    const item = makeItem();

    vi.mocked(matchRule).mockReturnValue(false);
    vi.mocked(classifyWithOllama).mockResolvedValue({
      batchType: "archive",
      confidence: 0.5, // Below 0.7 threshold
      reason: "Uncertain classification",
    });
    vi.mocked(classifyWithKimi).mockResolvedValue({
      classification: {
        batchType: "attention",
        confidence: 0.9,
        reason: "Contains action items",
      },
      enrichment: {
        summary: "Request for review",
        suggestedPriority: "high",
        suggestedTags: ["review"],
      },
    });

    const { classification, enrichment } = await classifyItem(item, []);

    expect(classification.tier).toBe("kimi");
    expect(classification.confidence).toBe(0.9);
    expect(classification.batchType).toBe("attention");
    expect(enrichment).toBeDefined();
    expect(enrichment?.summary).toBe("Request for review");
    expect(classifyWithKimi).toHaveBeenCalledOnce();
  });

  it("falls through to Kimi when Ollama is unavailable (returns null)", async () => {
    const item = makeItem();

    vi.mocked(matchRule).mockReturnValue(false);
    vi.mocked(classifyWithOllama).mockResolvedValue(null);
    vi.mocked(classifyWithKimi).mockResolvedValue({
      classification: {
        batchType: "spam",
        confidence: 0.95,
        reason: "Phishing attempt",
      },
      enrichment: {},
    });

    const { classification } = await classifyItem(item, []);

    expect(classification.tier).toBe("kimi");
    expect(classification.batchType).toBe("spam");
    expect(classifyWithOllama).toHaveBeenCalledOnce();
    expect(classifyWithKimi).toHaveBeenCalledOnce();
  });

  it("returns null batchType as fallback when everything fails", async () => {
    const item = makeItem();

    vi.mocked(matchRule).mockReturnValue(false);
    vi.mocked(classifyWithOllama).mockResolvedValue(null);
    vi.mocked(classifyWithKimi).mockResolvedValue(null);

    const { classification } = await classifyItem(item, []);

    expect(classification.tier).toBe("kimi");
    expect(classification.batchType).toBeNull();
    expect(classification.confidence).toBe(0);
    expect(classification.reason).toBe("Classification failed");
  });

  it("passes guidance notes from guidance rules to AI classifiers", async () => {
    const item = makeItem();
    const structuredRule = makeRule({
      id: "rule-s",
      type: "structured",
      trigger: { sender: "nobody@nowhere.com" },
    });
    const guidanceRule = makeRule({
      id: "rule-g",
      type: "guidance",
      trigger: null,
      guidance: "Be careful with VIP clients",
    });

    vi.mocked(matchRule).mockReturnValue(false);
    vi.mocked(classifyWithOllama).mockResolvedValue(null);
    vi.mocked(classifyWithKimi).mockResolvedValue({
      classification: {
        batchType: null,
        confidence: 0.8,
        reason: "VIP sender, needs attention",
      },
      enrichment: {},
    });

    await classifyItem(item, [structuredRule, guidanceRule]);

    // The guidance note should be passed to classifiers
    const ollamaCall = vi.mocked(classifyWithOllama).mock.calls[0];
    expect(ollamaCall[1]).toContain("Be careful with VIP clients");

    const kimiCall = vi.mocked(classifyWithKimi).mock.calls[0];
    expect(kimiCall[1]).toContain("Be careful with VIP clients");
  });
});
