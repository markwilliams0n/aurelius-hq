/**
 * Ollama client for local LLM inference
 * Used for entity extraction in heartbeat process
 */

import { emitMemoryEvent } from './events';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
}

interface ExtractedEntity {
  name: string;
  type: 'person' | 'company' | 'project';
  facts: string[];
  reasoning?: string;
}

/**
 * Check if Ollama is available
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Generate text using Ollama
 */
export async function generate(
  prompt: string,
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const { model = DEFAULT_MODEL, temperature = 0.1, maxTokens = 2000 } = options;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    }),
    signal: AbortSignal.timeout(60000), // 60 second timeout
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data: OllamaResponse = await response.json();
  return data.response;
}

export interface ExistingEntityHint {
  name: string;
  type: 'person' | 'company' | 'project';
  recentFacts: string[];
}

/**
 * Extract entities from text using local LLM
 *
 * @param content - The text to extract entities from
 * @param source - Source identifier for logging
 * @param existingEntities - Optional list of known entities to help with name resolution
 */
export async function extractEntitiesWithLLM(
  content: string,
  source: string,
  existingEntities?: ExistingEntityHint[]
): Promise<ExtractedEntity[]> {
  // Build context about known entities
  let knownEntitiesContext = '';
  if (existingEntities && existingEntities.length > 0) {
    const people = existingEntities.filter(e => e.type === 'person').slice(0, 15);
    const companies = existingEntities.filter(e => e.type === 'company').slice(0, 10);
    const projects = existingEntities.filter(e => e.type === 'project').slice(0, 10);

    knownEntitiesContext = `
KNOWN ENTITIES (prefer matching to these when applicable):

People: ${people.map(p => `${p.name}${p.recentFacts.length > 0 ? ` (${p.recentFacts[0]})` : ''}`).join(', ')}

Companies: ${companies.map(c => c.name).join(', ')}

Projects: ${projects.map(p => p.name).join(', ')}

IMPORTANT: If the text mentions someone by first name only (e.g., "Adam") and a known person matches (e.g., "Adam Watson"), use the FULL NAME from the known entities list.
`;
  }

  const prompt = `You are an entity extraction system. Extract ONLY people, companies, and projects from the following text.

STRICT RULES - READ CAREFULLY:

PERSON = actual human beings with names
- Extract: "John Smith", "Sarah Chen", "Adam Watson"
- DO NOT extract: cities, locations, or places used as shorthand for people (e.g., "Austin" the city, not a person)

COMPANY = businesses, organizations, corporations
- Extract: "Google", "ROSTR", "StubHub", "Live Nation"
- DO NOT extract: generic industry terms

PROJECT = MAJOR named initiatives with proper names
- Extract: "ROSTR Pro", "Project Atlas", "iPhone"
- DO NOT extract: generic work items like "API redesign", "backend systems", "UI ramp-up", "beta milestone"
- A project needs a PROPER NAME, not just a description of work

ABSOLUTELY DO NOT EXTRACT:
- Cities/locations: San Francisco, Austin, Ojai, Córdoba, San Diego, Lagos, Toronto, Rio, New York
- Work descriptions: "core API redesign", "artist profile components", "dashboard integration"
- Generic terms: "pilot talks", "beta milestone", "UI ramp-up"
- Abbreviations without context

When a first name matches a known person, USE THEIR FULL NAME
${knownEntitiesContext}
For each entity, provide:
- name: The entity's name (use full name for people when available)
- type: One of "person", "company", or "project"
- facts: Array of specific facts about this entity from the text
- reasoning: A brief explanation of WHY this entity was extracted (what makes it noteworthy)

Output ONLY valid JSON array. No explanation, no markdown, just JSON.

Example output:
[
  {"name": "John Smith", "type": "person", "facts": ["Works at Acme Corp", "Based in Austin"], "reasoning": "Named individual mentioned as key contact"},
  {"name": "Acme Corp", "type": "company", "facts": ["John Smith works here", "Headquartered in SF"], "reasoning": "Company where John works, relevant business relationship"}
]

Text to analyze:
---
${content.slice(0, 4000)}
---

Extract entities (JSON array only):`;

  try {
    const response = await generate(prompt, { temperature: 0.1 });

    // Try to extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[Ollama] No JSON array found in response');
      return [];
    }

    // Clean up common LLM JSON issues before parsing
    let jsonStr = jsonMatch[0]
      .replace(/,\s*\]/g, ']')           // Remove trailing commas in arrays
      .replace(/,\s*\}/g, '}')           // Remove trailing commas in objects
      .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control characters
      .replace(/\n/g, ' ')               // Normalize newlines
      .replace(/"\s*\n\s*"/g, '", "')    // Fix split strings
      .replace(/\\'/g, "'")              // Fix escaped single quotes
      .replace(/'/g, '"')                // Replace single quotes with double
      .replace(/,\s*,/g, ',');           // Remove double commas

    let entities: ExtractedEntity[];
    try {
      entities = JSON.parse(jsonStr);
    } catch (parseError) {
      // Log the problematic JSON for debugging
      console.warn('[Ollama] JSON parse failed, trying to salvage...');
      console.warn('[Ollama] Raw response length:', jsonStr.length);

      // Try to parse individual objects
      const objectMatches = jsonStr.matchAll(/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"\s*,\s*"facts"\s*:\s*\[([^\]]*)\]\s*\}/g);
      entities = [];
      for (const match of objectMatches) {
        try {
          const facts = match[3]
            .split(',')
            .map(f => f.trim().replace(/^"|"$/g, ''))
            .filter(f => f.length > 0);
          entities.push({
            name: match[1],
            type: match[2] as 'person' | 'company' | 'project',
            facts
          });
        } catch {
          // Skip malformed entity
        }
      }

      if (entities.length === 0) {
        throw parseError;
      }
      console.log(`[Ollama] Salvaged ${entities.length} entities from malformed JSON`);
    }

    // Known locations to filter out (common false positives)
    const locationBlacklist = new Set([
      'san francisco', 'san diego', 'new york', 'los angeles', 'chicago',
      'austin', 'toronto', 'london', 'paris', 'tokyo', 'berlin', 'sydney',
      'lagos', 'rio', 'ojai', 'córdoba', 'cordoba', 'ba', 'buenos aires',
      'sf', 'nyc', 'la', 'uk', 'us', 'usa',
    ]);

    // Generic work descriptions to filter out (not real projects)
    const genericProjectBlacklist = new Set([
      'api redesign', 'core api redesign', 'backend systems', 'ui ramp-up',
      'beta milestone', 'artist profile components', 'dashboard integration',
      'full-stack dashboard integration', 'pilot talks', 'shopify pilot talks',
    ]);

    // Validate and clean entities
    return entities
      .filter(e => e.name && e.type && Array.isArray(e.facts))
      .map(e => ({
        name: String(e.name).trim(),
        type: ['person', 'company', 'project'].includes(e.type) ? e.type : 'person',
        facts: e.facts.map(f => String(f).trim()).filter(f => f.length > 0),
        reasoning: e.reasoning ? String(e.reasoning).trim() : undefined,
      }))
      .filter(e => {
        const nameLower = e.name.toLowerCase();
        // Filter out locations
        if (locationBlacklist.has(nameLower)) {
          console.log(`[Ollama] Filtering out location: ${e.name}`);
          return false;
        }
        // Filter out generic project descriptions
        if (e.type === 'project' && genericProjectBlacklist.has(nameLower)) {
          console.log(`[Ollama] Filtering out generic project: ${e.name}`);
          return false;
        }
        // Filter out very short names (likely abbreviations)
        if (e.name.length < 3) {
          console.log(`[Ollama] Filtering out short name: ${e.name}`);
          return false;
        }
        return true;
      });
  } catch (error) {
    console.error('[Ollama] Entity extraction failed:', error);
    return [];
  }
}

/**
 * Check if a new fact is semantically redundant with existing facts
 * Returns true if the fact should be SKIPPED (it's redundant)
 *
 * NOTE: We use strict string matching only. LLM-based semantic checks
 * were too aggressive and incorrectly marked different facts as redundant.
 */
export async function isFactRedundant(
  newFact: string,
  existingFacts: string[],
  entityName: string
): Promise<boolean> {
  if (existingFacts.length === 0) return false;

  // String-based check - only skip obviously duplicate facts
  const newLower = newFact.toLowerCase().trim();

  for (const existing of existingFacts) {
    const existingLower = existing.toLowerCase().trim();

    // Exact match
    if (existingLower === newLower) {
      console.log(`[Redundancy] Exact match: "${newFact.slice(0, 50)}..."`);
      return true;
    }

    // Very high similarity (one contains the other AND similar length)
    if (existingLower.includes(newLower) || newLower.includes(existingLower)) {
      const ratio = Math.min(existingLower.length, newLower.length) /
                    Math.max(existingLower.length, newLower.length);
      // Only skip if VERY similar (>85% overlap)
      if (ratio > 0.85) {
        console.log(`[Redundancy] High similarity (${(ratio * 100).toFixed(0)}%): "${newFact.slice(0, 50)}..."`);
        return true;
      }
    }

    // Check for same key information (numbers, dates) in similar context
    // Extract numbers from both facts
    const newNumbers: string[] = newLower.match(/\d+\.?\d*/g) || [];
    const existingNumbers: string[] = existingLower.match(/\d+\.?\d*/g) || [];

    // If both have the same numbers and similar words, likely duplicate
    if (newNumbers.length > 0 && existingNumbers.length > 0) {
      const sameNumbers = newNumbers.filter(n => existingNumbers.includes(n));
      if (sameNumbers.length === newNumbers.length && sameNumbers.length === existingNumbers.length) {
        // Same numbers - check if similar words
        const newWords = new Set(newLower.split(/\s+/).filter(w => w.length > 3));
        const existingWords = new Set(existingLower.split(/\s+/).filter(w => w.length > 3));
        const overlap = [...newWords].filter(w => existingWords.has(w)).length;
        const overlapRatio = overlap / Math.max(newWords.size, existingWords.size);
        if (overlapRatio > 0.5) {
          console.log(`[Redundancy] Same numbers + similar words: "${newFact.slice(0, 50)}..."`);
          return true;
        }
      }
    }
  }

  return false; // Allow the fact
}

/**
 * Generate a summary for an entity based on its facts
 */
export async function generateEntitySummary(
  name: string,
  type: string,
  facts: string[]
): Promise<string> {
  if (facts.length === 0) {
    return `${name} is a ${type} in my knowledge base.`;
  }

  const prompt = `Write a brief 1-2 sentence summary about ${name} (a ${type}) based on these facts:

${facts.map(f => `- ${f}`).join('\n')}

Write ONLY the summary, no introduction or explanation:`;

  try {
    const response = await generate(prompt, { temperature: 0.3, maxTokens: 200 });
    return response.trim() || `${name} is a ${type} in my knowledge base.`;
  } catch (error) {
    console.error('[Ollama] Summary generation failed:', error);
    return `${name} is a ${type} in my knowledge base.`;
  }
}

/**
 * Email memory extraction result
 */
export interface EmailMemoryExtraction {
  entities: Array<{
    name: string;
    type: 'person' | 'company' | 'project';
    facts: string[];
    reasoning?: string;
  }>;
  facts: Array<{
    content: string;
    category: 'status' | 'preference' | 'relationship' | 'context' | 'milestone' | 'metric';
    entityName?: string;
    reasoning?: string;
  }>;
  actionItems: Array<{
    description: string;
    dueDate?: string;
  }>;
  summary: string;
  skipped?: Array<{
    item: string;
    reasoning: string;
  }>;
}

/**
 * Extract memory from email content using local LLM
 */
export async function extractEmailMemory(
  subject: string,
  sender: string,
  senderName: string | undefined,
  content: string,
  existingEntities?: ExistingEntityHint[],
  connector?: string
): Promise<EmailMemoryExtraction> {
  const startTime = Date.now();

  // Build context about known entities
  let knownEntitiesContext = '';
  if (existingEntities && existingEntities.length > 0) {
    const people = existingEntities.filter(e => e.type === 'person').slice(0, 10);
    const companies = existingEntities.filter(e => e.type === 'company').slice(0, 5);

    if (people.length > 0 || companies.length > 0) {
      knownEntitiesContext = `
KNOWN ENTITIES (match to these when applicable):
People: ${people.map(p => p.name).join(', ')}
Companies: ${companies.map(c => c.name).join(', ')}
`;
    }
  }

  const prompt = `You are extracting memorable information from an email for a personal knowledge management system.

EMAIL:
From: ${senderName || sender} <${sender}>
Subject: ${subject}

Content:
${content.slice(0, 6000)}

${knownEntitiesContext}

CRITICAL: Extract SPECIFIC DATA, not vague summaries.

For ANALYTICS/METRICS emails (Google Search Console, analytics reports, performance data):
- Extract ACTUAL NUMBERS: clicks, impressions, CTR, positions, percentages
- Extract TRENDS: "up X% from last month", "down Y clicks"
- Extract TOP ITEMS: "Top page: /jobs with X clicks", "Best performer: X"
- Example good fact: "jobs.rostr.cc got 1,234 clicks and 45,678 impressions in January (2.7% CTR)"
- Example bad fact: "January search performance" (too vague - useless)

For TRANSACTION emails (receipts, confirmations, orders):
- Extract amounts, dates, order numbers, items purchased
- Example: "Paid $49.99 to Spotify on Jan 15"

For PERSONAL emails:
- Extract commitments, deadlines, decisions, asks
- Who said what, what was agreed upon

Extract:

1. **Entities** - People, companies, or projects with SPECIFIC facts about them

2. **Facts** - SPECIFIC, DATA-RICH facts worth remembering:
   - Always include numbers, percentages, dates when available
   - "Clicks: 1,234" not "Got some clicks"
   - "Meeting scheduled for Feb 10 at 2pm" not "Meeting upcoming"

3. **Action Items** - ONLY tasks EXPLICITLY stated in the email
   - Must be something the email ASKS you to do
   - Good: "Please review the attached document", "Let me know by Friday"
   - BAD: Navigation labels ("Full report", "Learn more", "View dashboard")
   - BAD: Made-up tasks not in the email
   - If unsure, return empty array - don't guess

4. **Skipped** - Items you considered extracting but decided NOT to, with reasoning for why they were skipped

5. **Summary** - What this email tells us, with key numbers

For each entity and fact, include a brief "reasoning" explaining WHY it was extracted. Also include a "skipped" array with items you considered but rejected, with reasoning.

Output ONLY valid JSON:
{
  "entities": [{"name": "...", "type": "person|company|project", "facts": ["..."], "reasoning": "why this entity was extracted"}],
  "facts": [{"content": "...", "category": "status|preference|relationship|context|milestone|metric", "entityName": "...", "reasoning": "why this fact matters"}],
  "actionItems": [{"description": "...", "dueDate": "..."}],
  "skipped": [{"item": "...", "reasoning": "why this was not worth extracting"}],
  "summary": "..."
}

JSON only, no explanation:`;

  try {
    const response = await generate(prompt, { temperature: 0.1, maxTokens: 2000 });

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Ollama] No JSON found in email extraction response');
      return getEmptyEmailExtraction(subject, senderName || sender);
    }

    // Clean up common JSON issues
    let jsonStr = jsonMatch[0]
      .replace(/,\s*\]/g, ']')
      .replace(/,\s*\}/g, '}')
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/\n/g, ' ');

    const parsed = JSON.parse(jsonStr) as EmailMemoryExtraction;

    // Validate and return
    const result: EmailMemoryExtraction = {
      entities: (parsed.entities || []).filter(e => e.name && e.type),
      facts: (parsed.facts || []).filter(f => f.content),
      actionItems: parsed.actionItems || [],
      summary: parsed.summary || `Email from ${senderName || sender}: ${subject}`,
      skipped: parsed.skipped || [],
    };

    emitMemoryEvent({
      eventType: 'extract',
      trigger: 'triage',
      summary: `Extracted ${result.entities.length} entities, ${result.facts.length} facts from "${subject.slice(0, 60)}"`,
      payload: {
        input: { subject, sender, senderName, contentLength: content.length },
        output: result,
        rawOllamaResponse: response,
        filteredEntities: (parsed.entities || []).filter(e => !e.name || !e.type),
        filteredFacts: (parsed.facts || []).filter(f => !f.content),
      },
      reasoning: {
        entities: result.entities.map(e => ({ name: e.name, reasoning: e.reasoning })),
        facts: result.facts.map(f => ({ content: f.content.slice(0, 80), reasoning: f.reasoning })),
        skipped: parsed.skipped || [],
      },
      durationMs: Date.now() - startTime,
      metadata: { model: DEFAULT_MODEL, connector: connector || 'email' },
    }).catch(() => {});

    return result;
  } catch (error) {
    console.error('[Ollama] Email memory extraction failed:', error);
    return getEmptyEmailExtraction(subject, senderName || sender);
  }
}

function getEmptyEmailExtraction(subject: string, sender: string): EmailMemoryExtraction {
  return {
    entities: [],
    facts: [],
    actionItems: [],
    summary: `Email from ${sender}: ${subject}`,
  };
}
