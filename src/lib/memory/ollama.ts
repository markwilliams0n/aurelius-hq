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

/**
 * Extract entities from text using local LLM
 */
export async function extractEntitiesWithLLM(
  content: string,
  source: string
): Promise<ExtractedEntity[]> {
  const prompt = `You are an entity extraction system. Extract ONLY people, companies, and projects from the following text.

IMPORTANT RULES:
- "person" = actual human beings with names (first+last preferred, or recognizable single names)
- "company" = businesses, organizations, corporations, startups
- "project" = named software projects, products, initiatives
- DO NOT extract: cities, countries, locations, generic terms, abbreviations

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

    // Validate and clean entities
    return entities
      .filter(e => e.name && e.type && Array.isArray(e.facts))
      .map(e => ({
        name: String(e.name).trim(),
        type: ['person', 'company', 'project'].includes(e.type) ? e.type : 'person',
        facts: e.facts.map(f => String(f).trim()).filter(f => f.length > 0),
      }));
  } catch (error) {
    console.error('[Ollama] Entity extraction failed:', error);
    return [];
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
