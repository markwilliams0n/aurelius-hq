/**
 * Ollama client for local LLM inference
 * Used for entity extraction in heartbeat process
 */

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

Output ONLY valid JSON array. No explanation, no markdown, just JSON.

Example output:
[
  {"name": "John Smith", "type": "person", "facts": ["Works at Acme Corp", "Based in Austin"]},
  {"name": "Acme Corp", "type": "company", "facts": ["John Smith works here", "Headquartered in SF"]}
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
 */
export async function isFactRedundant(
  newFact: string,
  existingFacts: string[],
  entityName: string
): Promise<boolean> {
  if (existingFacts.length === 0) return false;

  // Quick string-based pre-check to avoid LLM calls for obvious cases
  const newLower = newFact.toLowerCase().trim();
  for (const existing of existingFacts) {
    const existingLower = existing.toLowerCase().trim();
    // Exact or near-exact match
    if (existingLower === newLower) return true;
    // One contains the other
    if (existingLower.includes(newLower) || newLower.includes(existingLower)) {
      const ratio = Math.min(existingLower.length, newLower.length) /
                    Math.max(existingLower.length, newLower.length);
      if (ratio > 0.7) return true;
    }
  }

  // Use LLM for semantic check
  const prompt = `You are checking if a new fact about "${entityName}" is redundant with existing facts.

EXISTING FACTS:
${existingFacts.slice(0, 10).map((f, i) => `${i + 1}. ${f}`).join('\n')}

NEW FACT: "${newFact}"

Is the new fact redundant? A fact is redundant if:
- It says the same thing as an existing fact (even in different words)
- It's a less specific version of an existing fact
- The information is already captured elsewhere

Answer ONLY "yes" or "no":`;

  try {
    const response = await generate(prompt, { temperature: 0, maxTokens: 10 });
    const answer = response.toLowerCase().trim();
    return answer.startsWith('yes');
  } catch (error) {
    console.warn('[Ollama] Redundancy check failed, allowing fact:', error);
    return false; // If check fails, allow the fact
  }
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
