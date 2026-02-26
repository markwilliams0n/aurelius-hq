import { describe, it, expect } from "vitest";
import {
  buildClassificationPrompt,
  parseClassificationResponse,
} from "../classify-email";

// ---------------------------------------------------------------------------
// parseClassificationResponse
// ---------------------------------------------------------------------------

describe("parseClassificationResponse", () => {
  it("parses valid JSON into an EmailClassification", () => {
    const json = JSON.stringify({
      recommendation: "archive",
      confidence: 0.95,
      reasoning: "User archives 100% from this sender",
      signals: {
        senderHistory: "Archived 10/10",
        relationshipContext: "Automated notification service",
        contentAnalysis: "Build notification email",
      },
    });

    const result = parseClassificationResponse(json);

    expect(result.recommendation).toBe("archive");
    expect(result.confidence).toBe(0.95);
    expect(result.reasoning).toBe("User archives 100% from this sender");
    expect(result.signals.senderHistory).toBe("Archived 10/10");
    expect(result.signals.relationshipContext).toBe(
      "Automated notification service"
    );
    expect(result.signals.contentAnalysis).toBe("Build notification email");
  });

  it("parses JSON wrapped in markdown fences", () => {
    const response = `\`\`\`json
{
  "recommendation": "review",
  "confidence": 0.7,
  "reasoning": "Might be important",
  "signals": {
    "senderHistory": "Mixed history",
    "relationshipContext": "Known contact",
    "contentAnalysis": "Newsletter with updates"
  }
}
\`\`\``;

    const result = parseClassificationResponse(response);

    expect(result.recommendation).toBe("review");
    expect(result.confidence).toBe(0.7);
    expect(result.reasoning).toBe("Might be important");
  });

  it("parses JSON with extra whitespace", () => {
    const response = `

    {
      "recommendation": "attention",
      "confidence": 0.85,
      "reasoning": "Direct personal email",
      "signals": {
        "senderHistory": "Frequent contact",
        "relationshipContext": "Colleague",
        "contentAnalysis": "Meeting request"
      }
    }

    `;

    const result = parseClassificationResponse(response);

    expect(result.recommendation).toBe("attention");
    expect(result.confidence).toBe(0.85);
  });

  it("returns fallback for completely invalid JSON", () => {
    const result = parseClassificationResponse("This is not JSON at all");

    expect(result.recommendation).toBe("attention");
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("Could not classify");
    expect(result.signals.senderHistory).toBe("unknown");
    expect(result.signals.relationshipContext).toBe("unknown");
    expect(result.signals.contentAnalysis).toBe("unknown");
  });

  it("returns fallback for empty string", () => {
    const result = parseClassificationResponse("");

    expect(result.recommendation).toBe("attention");
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("Could not classify");
  });

  it("clamps confidence above 1 to 1", () => {
    const json = JSON.stringify({
      recommendation: "archive",
      confidence: 1.5,
      reasoning: "Over-confident",
      signals: {
        senderHistory: "test",
        relationshipContext: "test",
        contentAnalysis: "test",
      },
    });

    const result = parseClassificationResponse(json);

    expect(result.confidence).toBe(1);
  });

  it("clamps confidence below 0 to 0", () => {
    const json = JSON.stringify({
      recommendation: "archive",
      confidence: -0.3,
      reasoning: "Negative confidence",
      signals: {
        senderHistory: "test",
        relationshipContext: "test",
        contentAnalysis: "test",
      },
    });

    const result = parseClassificationResponse(json);

    expect(result.confidence).toBe(0);
  });

  it("defaults unknown recommendation to 'attention'", () => {
    const json = JSON.stringify({
      recommendation: "delete",
      confidence: 0.8,
      reasoning: "Unknown category",
      signals: {
        senderHistory: "test",
        relationshipContext: "test",
        contentAnalysis: "test",
      },
    });

    const result = parseClassificationResponse(json);

    expect(result.recommendation).toBe("attention");
  });

  it("handles missing signals gracefully", () => {
    const json = JSON.stringify({
      recommendation: "review",
      confidence: 0.6,
      reasoning: "Partial response",
    });

    const result = parseClassificationResponse(json);

    expect(result.recommendation).toBe("review");
    expect(result.confidence).toBe(0.6);
    expect(result.signals.senderHistory).toBe("unknown");
    expect(result.signals.relationshipContext).toBe("unknown");
    expect(result.signals.contentAnalysis).toBe("unknown");
  });

  it("handles non-numeric confidence by defaulting to 0", () => {
    const json = JSON.stringify({
      recommendation: "archive",
      confidence: "high",
      reasoning: "String confidence",
      signals: {
        senderHistory: "test",
        relationshipContext: "test",
        contentAnalysis: "test",
      },
    });

    const result = parseClassificationResponse(json);

    expect(result.confidence).toBe(0);
  });

  it("strips markdown fences without language tag", () => {
    const response = `\`\`\`
{
  "recommendation": "archive",
  "confidence": 0.9,
  "reasoning": "No lang tag",
  "signals": {
    "senderHistory": "test",
    "relationshipContext": "test",
    "contentAnalysis": "test"
  }
}
\`\`\``;

    const result = parseClassificationResponse(response);

    expect(result.recommendation).toBe("archive");
    expect(result.confidence).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// buildClassificationPrompt
// ---------------------------------------------------------------------------

describe("buildClassificationPrompt", () => {
  const baseEmail = {
    sender: "alice@example.com",
    senderName: "Alice Smith",
    subject: "Quarterly report",
    preview: "Here is the quarterly report for Q4...",
    senderTags: ["internal", "finance"],
  };

  const baseContext = {
    decisionHistory: "Sender alice@example.com: archived 2/5, acted on 3",
    senderMemoryContext: "Alice is the VP of Finance at Acme Corp.",
    rules: [
      "Always surface emails from direct reports",
      "Archive marketing newsletters",
    ],
  };

  it("includes the sender email address", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("alice@example.com");
  });

  it("includes the sender display name", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("Alice Smith");
  });

  it("includes the subject", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("Quarterly report");
  });

  it("includes the preview", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("Here is the quarterly report for Q4...");
  });

  it("includes sender tags", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("internal, finance");
  });

  it("includes decision history", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("archived 2/5, acted on 3");
  });

  it("includes sender memory context", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("VP of Finance at Acme Corp");
  });

  it("includes rules as bullet points", () => {
    const prompt = buildClassificationPrompt(baseEmail, baseContext);

    expect(prompt).toContain("- Always surface emails from direct reports");
    expect(prompt).toContain("- Archive marketing newsletters");
  });

  it("omits sender context section when memory context is empty", () => {
    const prompt = buildClassificationPrompt(baseEmail, {
      ...baseContext,
      senderMemoryContext: "",
    });

    expect(prompt).not.toContain("SENDER CONTEXT");
  });

  it("omits rules section when rules are empty", () => {
    const prompt = buildClassificationPrompt(baseEmail, {
      ...baseContext,
      rules: [],
    });

    expect(prompt).not.toContain("TRIAGE RULES");
  });

  it("shows 'No prior decisions.' when decision history is empty", () => {
    const prompt = buildClassificationPrompt(baseEmail, {
      ...baseContext,
      decisionHistory: "",
    });

    expect(prompt).toContain("No prior decisions.");
  });

  it("handles sender with no display name", () => {
    const prompt = buildClassificationPrompt(
      { ...baseEmail, senderName: null },
      baseContext
    );

    // Should show just the email, not "null <email>"
    expect(prompt).toContain("From: alice@example.com");
    expect(prompt).not.toContain("null");
  });

  it("handles email with no preview", () => {
    const prompt = buildClassificationPrompt(
      { ...baseEmail, preview: null },
      baseContext
    );

    expect(prompt).not.toContain("Preview:");
  });

  it("handles email with no sender tags", () => {
    const prompt = buildClassificationPrompt(
      { ...baseEmail, senderTags: [] },
      baseContext
    );

    expect(prompt).not.toContain("Sender tags:");
  });
});
