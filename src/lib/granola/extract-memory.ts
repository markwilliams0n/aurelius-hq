/**
 * Extract memory (entities and facts) from Granola meeting content
 * using AI to analyze transcripts and attendee information.
 */

import { chat, type Message } from "@/lib/ai/client";

export interface ExtractedEntity {
  name: string;
  type: "person" | "company" | "project";
  role?: string; // e.g., "attendee", "mentioned", "client"
  facts: string[];
}

export interface ExtractedFact {
  content: string;
  category: "status" | "preference" | "relationship" | "context" | "milestone";
  entityName?: string;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedActionItem {
  description: string;
  assignee?: string;
  dueDate?: string;
}

export interface MeetingMemoryExtraction {
  entities: ExtractedEntity[];
  facts: ExtractedFact[];
  actionItems: ExtractedActionItem[];
  summary: string;
  topics: string[];
}

const EXTRACTION_PROMPT = `You are analyzing a meeting transcript to extract important information for a personal knowledge management system.

Extract the following from the meeting:

1. **Entities** (people, companies, projects mentioned):
   - For each person: their name, role/relationship, and any facts learned about them
   - For companies: name and any relevant facts
   - For projects: name and status/context

2. **Key Facts** to remember:
   - Decisions made
   - Important updates or status changes
   - Preferences expressed
   - Relationships between people/companies
   - Milestones or deadlines mentioned

3. **Action Items**:
   - Tasks mentioned with assignee if clear
   - Follow-ups needed

4. **Summary**: 2-3 sentence summary of the meeting

5. **Topics**: List of main topics discussed

Respond in JSON format:
{
  "entities": [
    {"name": "...", "type": "person|company|project", "role": "...", "facts": ["..."]}
  ],
  "facts": [
    {"content": "...", "category": "status|preference|relationship|context|milestone", "entityName": "...", "confidence": "high|medium|low"}
  ],
  "actionItems": [
    {"description": "...", "assignee": "...", "dueDate": "..."}
  ],
  "summary": "...",
  "topics": ["..."]
}

Focus on extractable, actionable information. Skip small talk and irrelevant details.
Only include facts with medium or high confidence.`;

/**
 * Extract memory from a Granola meeting
 */
export async function extractMeetingMemory(
  title: string,
  attendees: Array<{ name?: string; email?: string }>,
  transcript: string,
  notes?: string
): Promise<MeetingMemoryExtraction> {
  // Build context for the AI
  const attendeeList = attendees
    .map((a) => a.name || a.email || "Unknown")
    .filter(Boolean)
    .join(", ");

  const content = `
Meeting: ${title}
Attendees: ${attendeeList}

${notes ? `Notes:\n${notes}\n\n` : ""}
${transcript ? `Transcript:\n${transcript}` : "No transcript available."}
`.trim();

  // Truncate if too long (keep first and last parts)
  const maxLength = 12000;
  let truncatedContent = content;
  if (content.length > maxLength) {
    const halfLength = Math.floor(maxLength / 2);
    truncatedContent =
      content.slice(0, halfLength) +
      "\n\n[... transcript truncated ...]\n\n" +
      content.slice(-halfLength);
  }

  try {
    const messages: Message[] = [
      { role: "user", content: truncatedContent },
    ];

    const response = await chat(messages, EXTRACTION_PROMPT);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Granola Extract] No JSON found in response");
      return getEmptyExtraction();
    }

    const parsed = JSON.parse(jsonMatch[0]) as MeetingMemoryExtraction;

    // Validate and clean up
    return {
      entities: (parsed.entities || []).filter(
        (e) => e.name && e.type && ["person", "company", "project"].includes(e.type)
      ),
      facts: (parsed.facts || []).filter(
        (f) => f.content && f.confidence !== "low"
      ),
      actionItems: parsed.actionItems || [],
      summary: parsed.summary || "",
      topics: parsed.topics || [],
    };
  } catch (error) {
    console.error("[Granola Extract] Failed to extract memory:", error);
    return getEmptyExtraction();
  }
}

/**
 * Quick extraction from attendees only (no AI call)
 * Used as fallback or for meetings without transcripts
 */
export function extractAttendeesAsEntities(
  attendees: Array<{ displayName?: string; email?: string }>
): ExtractedEntity[] {
  return attendees
    .filter((a) => a.displayName || a.email)
    .map((a) => {
      const name = a.displayName || a.email?.split("@")[0] || "Unknown";
      const email = a.email || "";
      const domain = email.includes("@") ? email.split("@")[1] : "";

      const entity: ExtractedEntity = {
        name,
        type: "person",
        role: "attendee",
        facts: [],
      };

      // Extract company from email domain
      if (domain && !isPersonalDomain(domain)) {
        entity.facts.push(`Works at ${domainToCompanyName(domain)}`);
      }

      return entity;
    });
}

function isPersonalDomain(domain: string): boolean {
  const personalDomains = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "protonmail.com",
    "aol.com",
    "live.com",
    "msn.com",
  ];
  return personalDomains.includes(domain.toLowerCase());
}

function domainToCompanyName(domain: string): string {
  return domain
    .replace(/\.(com|io|co|net|org|dev|app|ai)$/i, "")
    .split(".")[0]
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getEmptyExtraction(): MeetingMemoryExtraction {
  return {
    entities: [],
    facts: [],
    actionItems: [],
    summary: "",
    topics: [],
  };
}
