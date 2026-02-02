import type { NewInboxItem } from "@/lib/db/schema";

// Enrichment result type
export type EnrichmentResult = {
  summary: string;
  suggestedPriority: "urgent" | "high" | "normal" | "low";
  suggestedTags: string[];
  linkedEntities: Array<{
    id: string;
    name: string;
    type: "person" | "company" | "project" | "team" | "topic";
  }>;
  suggestedActions: Array<{
    type: "reply" | "task" | "snooze" | "archive" | "delegate";
    label: string;
    reason: string;
  }>;
  contextFromMemory?: string;
};

// Keyword-based priority classification
const URGENT_KEYWORDS = [
  "urgent",
  "asap",
  "immediately",
  "critical",
  "emergency",
  "alert",
  "outage",
  "down",
  "broken",
  "incident",
  "escalation",
  "blocker",
];

const HIGH_PRIORITY_KEYWORDS = [
  "important",
  "priority",
  "deadline",
  "due",
  "action required",
  "follow up",
  "waiting on you",
  "please review",
  "approval needed",
  "contract",
  "enterprise",
];

const LOW_PRIORITY_KEYWORDS = [
  "newsletter",
  "update",
  "fyi",
  "no action needed",
  "automated",
  "notification",
  "digest",
  "weekly",
  "monthly",
];

// Tag detection patterns
const TAG_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /meeting|schedule|calendar|sync|call/i, tag: "meeting" },
  { pattern: /bug|issue|error|fix|broken/i, tag: "bug" },
  { pattern: /feature|request|enhancement/i, tag: "feature" },
  { pattern: /invoice|payment|bill|cost|price/i, tag: "finance" },
  { pattern: /contract|agreement|sign|legal/i, tag: "legal" },
  { pattern: /feedback|review|opinion/i, tag: "feedback" },
  { pattern: /partnership|collaborate|integrate/i, tag: "partnership" },
  { pattern: /security|vulnerability|audit/i, tag: "security" },
  { pattern: /deploy|release|ship|launch/i, tag: "deploy" },
  { pattern: /hire|candidate|interview/i, tag: "hiring" },
];

// Simple entity extraction from text
function extractEntities(
  item: NewInboxItem
): EnrichmentResult["linkedEntities"] {
  const entities: EnrichmentResult["linkedEntities"] = [];

  // Sender is always a person entity
  if (item.senderName || item.sender) {
    entities.push({
      id: crypto.randomUUID(),
      name: item.senderName || item.sender,
      type: "person",
    });
  }

  // Extract company from email domain
  if (item.sender && item.sender.includes("@")) {
    const domain = item.sender.split("@")[1];
    if (domain && !isPersonalDomain(domain)) {
      const companyName = domainToCompanyName(domain);
      entities.push({
        id: crypto.randomUUID(),
        name: companyName,
        type: "company",
      });
    }
  }

  // For Linear items, the sender is the project
  if (item.connector === "linear" && item.sender) {
    entities.push({
      id: crypto.randomUUID(),
      name: item.sender,
      type: "project",
    });
  }

  // For Slack, extract channel as team
  if (item.connector === "slack" && item.sender?.startsWith("#")) {
    entities.push({
      id: crypto.randomUUID(),
      name: item.sender.replace("#", ""),
      type: "team",
    });
  }

  return entities;
}

// Classify priority based on content analysis
function classifyPriority(item: NewInboxItem): EnrichmentResult["suggestedPriority"] {
  const text = `${item.subject} ${item.content}`.toLowerCase();

  // Check for urgent keywords
  if (URGENT_KEYWORDS.some((kw) => text.includes(kw))) {
    return "urgent";
  }

  // Check for high priority keywords
  if (HIGH_PRIORITY_KEYWORDS.some((kw) => text.includes(kw))) {
    return "high";
  }

  // Check for low priority keywords
  if (LOW_PRIORITY_KEYWORDS.some((kw) => text.includes(kw))) {
    return "low";
  }

  // Default to normal
  return "normal";
}

// Suggest tags based on content
function suggestTags(item: NewInboxItem): string[] {
  const text = `${item.subject} ${item.content}`;
  const tags = new Set<string>();

  // Add connector as tag
  tags.add(item.connector);

  // Match patterns
  for (const { pattern, tag } of TAG_PATTERNS) {
    if (pattern.test(text)) {
      tags.add(tag);
    }
  }

  // Limit to 5 tags
  return Array.from(tags).slice(0, 5);
}

// Generate summary
function generateSummary(item: NewInboxItem): string {
  const subject = item.subject.toLowerCase();
  const content = item.content.toLowerCase();

  // Detect the type of message
  if (subject.includes("re:") || subject.includes("fwd:")) {
    return "Follow-up on previous conversation";
  }

  if (content.includes("meeting") || content.includes("schedule")) {
    return "Scheduling request - may need calendar response";
  }

  if (content.includes("urgent") || content.includes("critical")) {
    return "Urgent matter requiring immediate attention";
  }

  if (content.includes("invoice") || content.includes("payment")) {
    return "Financial matter - review required";
  }

  if (content.includes("partnership") || content.includes("collaborate")) {
    return "Potential partnership opportunity";
  }

  if (content.includes("feedback") || content.includes("review")) {
    return "Feedback or review request";
  }

  if (item.connector === "linear") {
    if (subject.includes("[bug]")) {
      return "Bug report requiring attention";
    }
    if (subject.includes("[feature]")) {
      return "Feature request for consideration";
    }
    return "Development task or issue";
  }

  if (item.connector === "slack") {
    return "Team communication - may need response";
  }

  // Default
  return "New message for review";
}

// Suggest actions based on content
function suggestActions(
  item: NewInboxItem,
  priority: EnrichmentResult["suggestedPriority"]
): EnrichmentResult["suggestedActions"] {
  const actions: EnrichmentResult["suggestedActions"] = [];
  const text = `${item.subject} ${item.content}`.toLowerCase();

  // Urgent items need quick response
  if (priority === "urgent") {
    actions.push({
      type: "reply",
      label: "Quick reply",
      reason: "Urgent items typically need acknowledgment",
    });
  }

  // Meeting requests
  if (text.includes("meeting") || text.includes("schedule") || text.includes("call")) {
    actions.push({
      type: "reply",
      label: "Schedule meeting",
      reason: "Contains scheduling request",
    });
  }

  // Task-worthy items
  if (
    text.includes("action required") ||
    text.includes("please review") ||
    text.includes("deadline")
  ) {
    actions.push({
      type: "task",
      label: "Create task",
      reason: "Contains actionable request with deadline",
    });
  }

  // Newsletters and updates can be archived
  if (
    text.includes("newsletter") ||
    text.includes("update") ||
    text.includes("digest")
  ) {
    actions.push({
      type: "archive",
      label: "Archive",
      reason: "Informational content - no action needed",
    });
  }

  // If no specific actions, suggest review
  if (actions.length === 0) {
    actions.push({
      type: "reply",
      label: "Review and respond",
      reason: "Standard message requiring attention",
    });
  }

  return actions.slice(0, 3); // Max 3 suggestions
}

// Simulate context from memory (would use vector search in production)
function getContextFromMemory(item: NewInboxItem): string | undefined {
  // In production, this would search the memory system for related facts
  // For now, return simulated context based on sender

  const senderContexts: Record<string, string> = {
    "sarah.chen@acme.io":
      "Sarah is the CTO at Acme Corp. Previous conversations about Q3 planning and API migration.",
    "james@startup.co":
      "James is founder of Startup Co. Discussed partnership opportunities last month.",
    "m.park@venture.vc":
      "Michael is a VC partner. Met at conference, interested in seed round.",
  };

  if (item.sender && senderContexts[item.sender]) {
    return senderContexts[item.sender];
  }

  // Random context for demo
  const genericContexts = [
    "First interaction with this sender",
    "Frequent collaborator - typically responds within 24h",
    "Key stakeholder for ongoing project",
  ];

  return genericContexts[Math.floor(Math.random() * genericContexts.length)];
}

// Helper functions
function isPersonalDomain(domain: string): boolean {
  const personalDomains = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "protonmail.com",
    "aol.com",
  ];
  return personalDomains.includes(domain.toLowerCase());
}

function domainToCompanyName(domain: string): string {
  // Remove common TLDs and format
  return domain
    .replace(/\.(com|io|co|net|org|dev|app)$/i, "")
    .split(".")[0]
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Main enrichment function
export function enrichTriageItem(item: NewInboxItem): EnrichmentResult {
  const priority = classifyPriority(item);

  return {
    summary: generateSummary(item),
    suggestedPriority: priority,
    suggestedTags: suggestTags(item),
    linkedEntities: extractEntities(item),
    suggestedActions: suggestActions(item, priority),
    contextFromMemory: getContextFromMemory(item),
  };
}

// Batch enrichment for multiple items
export function enrichTriageItems(
  items: NewInboxItem[]
): Array<NewInboxItem & { enrichment: EnrichmentResult }> {
  return items.map((item) => ({
    ...item,
    enrichment: enrichTriageItem(item),
  }));
}
