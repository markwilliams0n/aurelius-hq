import type { NewInboxItem } from "@/lib/db/schema";
import { isOllamaAvailable, generate } from '@/lib/memory/ollama';
import { searchMemory } from '@/lib/memory/search';

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

// Search memory for context about the sender/subject
async function getContextFromMemory(item: NewInboxItem): Promise<string | undefined> {
  try {
    const query = `${item.senderName || item.sender} ${item.subject}`;
    const results = searchMemory(query, { limit: 3, _skipEvent: true });
    if (results.length === 0) return undefined;
    return results.map(r => r.content).join('\n');
  } catch {
    return undefined;
  }
}

// Enrich a triage item using Ollama LLM
async function enrichWithOllama(
  item: NewInboxItem,
  memoryContext: string | undefined,
  linkedEntities: EnrichmentResult["linkedEntities"]
): Promise<EnrichmentResult> {
  const prompt = `Analyze this triage item and provide enrichment.

Item:
- Connector: ${item.connector}
- From: ${item.senderName || ''} <${item.sender}>
- Subject: ${item.subject}
- Content: ${(item.content || '').slice(0, 2000)}

Memory context about sender:
${memoryContext || "No previous context"}

Classify priority as one of: urgent, high, normal, low
Suggest 1-5 relevant tags (short labels like: meeting, bug, feature, finance, legal, feedback, deploy, hiring, security, partnership)
Write a 1-2 sentence summary
Suggest 1-3 actions

Respond with ONLY valid JSON:
{
  "priority": "urgent|high|normal|low",
  "tags": ["tag1", "tag2"],
  "summary": "1-2 sentence summary",
  "actions": [{"type": "reply|task|snooze|archive|delegate", "label": "short label", "reason": "brief reason"}]
}`;

  const response = await generate(prompt, { temperature: 0.1, maxTokens: 500 });

  // Extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in Ollama response');
  }

  // Clean up common LLM JSON issues
  const jsonStr = jsonMatch[0]
    .replace(/,\s*\]/g, ']')           // Remove trailing commas in arrays
    .replace(/,\s*\}/g, '}')           // Remove trailing commas in objects
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control characters
    .replace(/\n/g, ' ');              // Normalize newlines

  const parsed = JSON.parse(jsonStr);

  // Validate and normalize priority
  const validPriorities = ['urgent', 'high', 'normal', 'low'] as const;
  const priority = validPriorities.includes(parsed.priority) ? parsed.priority : 'normal';

  // Validate and normalize tags
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t: unknown) => typeof t === 'string').slice(0, 5)
    : [];

  // Validate and normalize actions
  const validActionTypes = ['reply', 'task', 'snooze', 'archive', 'delegate'] as const;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .filter((a: { type?: string; label?: string; reason?: string }) =>
          a && typeof a.type === 'string' && typeof a.label === 'string' && typeof a.reason === 'string'
        )
        .map((a: { type: string; label: string; reason: string }) => ({
          type: (validActionTypes.includes(a.type as typeof validActionTypes[number]) ? a.type : 'reply') as EnrichmentResult["suggestedActions"][number]["type"],
          label: String(a.label),
          reason: String(a.reason),
        }))
        .slice(0, 3)
    : [];

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'New message for review',
    suggestedPriority: priority,
    suggestedTags: tags,
    linkedEntities,
    suggestedActions: actions.length > 0 ? actions : [{ type: 'reply' as const, label: 'Review and respond', reason: 'Standard message requiring attention' }],
    contextFromMemory: memoryContext,
  };
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
export async function enrichTriageItem(item: NewInboxItem): Promise<EnrichmentResult> {
  const ollamaAvailable = await isOllamaAvailable();

  // Entity extraction (works with both paths)
  const linkedEntities = extractEntities(item);

  // Memory context (real search, not hardcoded)
  const contextFromMemory = await getContextFromMemory(item);

  if (ollamaAvailable) {
    try {
      return await enrichWithOllama(item, contextFromMemory, linkedEntities);
    } catch (error) {
      console.error('[Enrichment] Ollama failed, using regex fallback:', error);
    }
  }

  // Existing regex fallback
  const priority = classifyPriority(item);
  return {
    summary: generateSummary(item),
    suggestedPriority: priority,
    suggestedTags: suggestTags(item),
    linkedEntities,
    suggestedActions: suggestActions(item, priority),
    contextFromMemory,
  };
}

// Batch enrichment for multiple items
export async function enrichTriageItems(
  items: NewInboxItem[]
): Promise<Array<NewInboxItem & { enrichment: EnrichmentResult }>> {
  const results = await Promise.all(
    items.map(async (item) => ({
      ...item,
      enrichment: await enrichTriageItem(item),
    }))
  );
  return results;
}
