import { describe, it, expect } from "vitest";
import {
  formatDecisionHistory,
  type DecisionSummary,
} from "../decision-history";

describe("formatDecisionHistory", () => {
  it("formats a sender who has been mostly bulk-archived", () => {
    const summary: DecisionSummary = {
      sender: "notifications@github.com",
      senderDomain: "github.com",
      senderDecisions: { bulk: 6, quick: 2, engaged: 1, total: 9 },
      domainDecisions: { bulk: 10, quick: 3, engaged: 2, total: 15 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).toContain("bulk-archived 6/9");
    expect(result).toContain("quick-archived 2/9");
    expect(result).toContain("engaged 1/9");
    expect(result).toContain("Sender notifications@github.com");
    expect(result).toContain("Domain github.com");
  });

  it("returns no-history message for a new sender with zero decisions", () => {
    const summary: DecisionSummary = {
      sender: "new@unknown.com",
      senderDomain: "unknown.com",
      senderDecisions: { bulk: 0, quick: 0, engaged: 0, total: 0 },
      domainDecisions: { bulk: 0, quick: 0, engaged: 0, total: 0 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).toBe(
      "No prior history with new@unknown.com or domain unknown.com."
    );
  });

  it("formats mixed triage paths correctly", () => {
    const summary: DecisionSummary = {
      sender: "team@company.com",
      senderDomain: "company.com",
      senderDecisions: { bulk: 3, quick: 2, engaged: 5, total: 10 },
      domainDecisions: { bulk: 10, quick: 3, engaged: 7, total: 20 },
    };

    const result = formatDecisionHistory(summary);

    // Sender line
    expect(result).toContain("bulk-archived 3/10");
    expect(result).toContain("quick-archived 2/10");
    expect(result).toContain("engaged 5/10");

    // Domain line
    expect(result).toContain("bulk-archived 10/20");
    expect(result).toContain("quick-archived 3/20");
    expect(result).toContain("engaged 7/20");
  });

  it("omits sender line when only domain has history", () => {
    const summary: DecisionSummary = {
      sender: "new-person@known.com",
      senderDomain: "known.com",
      senderDecisions: { bulk: 0, quick: 0, engaged: 0, total: 0 },
      domainDecisions: { bulk: 5, quick: 0, engaged: 1, total: 6 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).not.toContain("Sender new-person@known.com");
    expect(result).toContain("Domain known.com");
    expect(result).toContain("bulk-archived 5/6");
  });

  it("omits domain line when only sender has history", () => {
    const summary: DecisionSummary = {
      sender: "solo@personal.com",
      senderDomain: "personal.com",
      senderDecisions: { bulk: 2, quick: 0, engaged: 0, total: 2 },
      domainDecisions: { bulk: 0, quick: 0, engaged: 0, total: 0 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).toContain("Sender solo@personal.com");
    expect(result).toContain("bulk-archived 2/2");
    expect(result).not.toContain("Domain personal.com");
  });

  it("shows only non-zero triage paths in output", () => {
    const summary: DecisionSummary = {
      sender: "alerts@service.com",
      senderDomain: "service.com",
      senderDecisions: { bulk: 5, quick: 0, engaged: 0, total: 5 },
      domainDecisions: { bulk: 5, quick: 0, engaged: 0, total: 5 },
    };

    const result = formatDecisionHistory(summary);

    // Should have bulk-archived but NOT "quick-archived" or "engaged"
    expect(result).toContain("bulk-archived 5/5");
    expect(result).not.toContain("quick-archived");
    expect(result).not.toContain("engaged");
  });
});
