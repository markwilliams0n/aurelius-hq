import { describe, it, expect } from "vitest";
import {
  formatDecisionHistory,
  type DecisionSummary,
} from "../decision-history";

describe("formatDecisionHistory", () => {
  it("formats a sender who has been mostly archived", () => {
    const summary: DecisionSummary = {
      sender: "notifications@github.com",
      senderDomain: "github.com",
      senderDecisions: { archived: 8, snoozed: 0, actioned: 1, total: 9 },
      domainDecisions: { archived: 12, snoozed: 1, actioned: 2, total: 15 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).toContain("archived 8/9");
    expect(result).toContain("acted on 1");
    expect(result).toContain("Sender notifications@github.com");
    expect(result).toContain("Domain github.com");
  });

  it("returns no-history message for a new sender with zero decisions", () => {
    const summary: DecisionSummary = {
      sender: "new@unknown.com",
      senderDomain: "unknown.com",
      senderDecisions: { archived: 0, snoozed: 0, actioned: 0, total: 0 },
      domainDecisions: { archived: 0, snoozed: 0, actioned: 0, total: 0 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).toBe(
      "No prior history with new@unknown.com or domain unknown.com."
    );
  });

  it("formats mixed actions correctly", () => {
    const summary: DecisionSummary = {
      sender: "team@company.com",
      senderDomain: "company.com",
      senderDecisions: { archived: 3, snoozed: 2, actioned: 5, total: 10 },
      domainDecisions: { archived: 10, snoozed: 3, actioned: 7, total: 20 },
    };

    const result = formatDecisionHistory(summary);

    // Sender line
    expect(result).toContain("archived 3/10");
    expect(result).toContain("acted on 5");
    expect(result).toContain("snoozed 2");

    // Domain line
    expect(result).toContain("archived 10/20");
    expect(result).toContain("acted on 7");
    expect(result).toContain("snoozed 3");
  });

  it("omits sender line when only domain has history", () => {
    const summary: DecisionSummary = {
      sender: "new-person@known.com",
      senderDomain: "known.com",
      senderDecisions: { archived: 0, snoozed: 0, actioned: 0, total: 0 },
      domainDecisions: { archived: 5, snoozed: 0, actioned: 1, total: 6 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).not.toContain("Sender new-person@known.com");
    expect(result).toContain("Domain known.com");
    expect(result).toContain("archived 5/6");
  });

  it("omits domain line when only sender has history", () => {
    const summary: DecisionSummary = {
      sender: "solo@personal.com",
      senderDomain: "personal.com",
      senderDecisions: { archived: 2, snoozed: 0, actioned: 0, total: 2 },
      domainDecisions: { archived: 0, snoozed: 0, actioned: 0, total: 0 },
    };

    const result = formatDecisionHistory(summary);

    expect(result).toContain("Sender solo@personal.com");
    expect(result).toContain("archived 2/2");
    expect(result).not.toContain("Domain personal.com");
  });

  it("shows only non-zero action types in output", () => {
    const summary: DecisionSummary = {
      sender: "alerts@service.com",
      senderDomain: "service.com",
      senderDecisions: { archived: 5, snoozed: 0, actioned: 0, total: 5 },
      domainDecisions: { archived: 5, snoozed: 0, actioned: 0, total: 5 },
    };

    const result = formatDecisionHistory(summary);

    // Should have archived but NOT "acted on" or "snoozed"
    expect(result).toContain("archived 5/5");
    expect(result).not.toContain("acted on");
    expect(result).not.toContain("snoozed");
  });
});
