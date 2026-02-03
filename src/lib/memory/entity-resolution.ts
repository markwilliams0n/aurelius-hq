/**
 * Entity Resolution System
 *
 * Resolves extracted entity mentions (e.g., "Adam") to existing entities
 * (e.g., "Adam Watson") using:
 * - QMD semantic search with context
 * - Name similarity scoring
 * - Access recency (decay)
 * - Fact overlap
 */

import { promises as fs } from 'fs';
import path from 'path';
import { keywordSearch, type SearchResult } from './search';
import { isOllamaAvailable, generate } from './ollama';

const LIFE_DIR = path.join(process.cwd(), 'life');

type EntityType = 'person' | 'company' | 'project';

interface ExtractedEntity {
  name: string;
  type: EntityType;
  facts: string[];
}

interface ExistingEntity {
  slug: string;
  name: string;
  type: EntityType;
  path: string;
  facts: string[];
  lastAccessed: string | null;
  accessCount: number;
}

interface ResolutionCandidate {
  entity: ExistingEntity;
  score: number;
  reasons: string[];
}

export interface ResolvedEntity {
  /** The original extracted entity */
  extracted: ExtractedEntity;
  /** The matched existing entity, or null if new */
  match: ExistingEntity | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this should create a new entity */
  isNew: boolean;
  /** Explanation of the resolution */
  reason: string;
}

/**
 * Get the type-specific directory for an entity type
 */
function getTypeDir(type: EntityType): string {
  switch (type) {
    case 'person': return 'areas/people';
    case 'company': return 'areas/companies';
    case 'project': return 'projects';
  }
}

/**
 * Load all existing entities of a given type
 */
async function loadExistingEntities(type: EntityType): Promise<ExistingEntity[]> {
  const typeDir = path.join(LIFE_DIR, getTypeDir(type));
  const entities: ExistingEntity[] = [];

  try {
    const items = await fs.readdir(typeDir, { withFileTypes: true });

    for (const item of items) {
      if (!item.isDirectory() || item.name.startsWith('_')) continue;

      const entityPath = path.join(typeDir, item.name);
      const itemsPath = path.join(entityPath, 'items.json');

      // Read facts and access stats
      let facts: string[] = [];
      let lastAccessed: string | null = null;
      let accessCount = 0;

      try {
        const content = await fs.readFile(itemsPath, 'utf-8');
        const parsed = JSON.parse(content);
        facts = parsed
          .filter((f: { status?: string }) => f.status === 'active')
          .map((f: { fact: string }) => f.fact);

        // Get most recent access
        for (const f of parsed) {
          if (f.lastAccessed) {
            if (!lastAccessed || f.lastAccessed > lastAccessed) {
              lastAccessed = f.lastAccessed;
            }
          }
          accessCount += f.accessCount || 0;
        }
      } catch {
        // No items.json or parse error
      }

      // Convert slug to display name
      const displayName = item.name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      entities.push({
        slug: item.name,
        name: displayName,
        type,
        path: entityPath,
        facts,
        lastAccessed,
        accessCount,
      });
    }
  } catch {
    // Directory doesn't exist
  }

  return entities;
}

/**
 * Calculate name similarity score (0-1)
 * Handles partial matches like "Adam" -> "Adam Watson"
 */
function calculateNameSimilarity(extracted: string, existing: string): number {
  const extractedLower = extracted.toLowerCase().trim();
  const existingLower = existing.toLowerCase().trim();

  // Exact match
  if (extractedLower === existingLower) return 1.0;

  // Extracted is a prefix of existing (e.g., "Adam" matches "Adam Watson")
  if (existingLower.startsWith(extractedLower + ' ')) {
    // Score based on how much of the name we matched
    return 0.7 + (0.2 * extractedLower.length / existingLower.length);
  }

  // Existing contains extracted as a word
  const existingWords = existingLower.split(/\s+/);
  const extractedWords = extractedLower.split(/\s+/);

  const matchingWords = extractedWords.filter(w => existingWords.includes(w));
  if (matchingWords.length > 0) {
    return 0.5 + (0.3 * matchingWords.length / existingWords.length);
  }

  // Check for substring match (less confident)
  if (existingLower.includes(extractedLower)) {
    return 0.3;
  }

  return 0;
}

/**
 * Calculate recency score based on last access time
 * More recent = higher score, decays over time
 */
function calculateRecencyScore(lastAccessed: string | null): number {
  if (!lastAccessed) return 0.1; // Baseline for never-accessed

  const now = Date.now();
  const accessTime = new Date(lastAccessed).getTime();
  const hoursSinceAccess = (now - accessTime) / (1000 * 60 * 60);

  // Decay function: score decreases over time
  // - Within 1 hour: 1.0
  // - Within 24 hours: 0.8-1.0
  // - Within 1 week: 0.5-0.8
  // - Older: 0.1-0.5
  if (hoursSinceAccess < 1) return 1.0;
  if (hoursSinceAccess < 24) return 0.8 + (0.2 * (1 - hoursSinceAccess / 24));
  if (hoursSinceAccess < 168) return 0.5 + (0.3 * (1 - hoursSinceAccess / 168));
  return Math.max(0.1, 0.5 * Math.exp(-hoursSinceAccess / 720)); // Exponential decay
}

/**
 * Calculate context overlap score using keyword matching
 * Checks if the extracted facts mention things related to existing entity
 */
function calculateContextScore(
  extractedFacts: string[],
  existingFacts: string[]
): number {
  if (extractedFacts.length === 0 || existingFacts.length === 0) return 0;

  const extractedText = extractedFacts.join(' ').toLowerCase();
  const existingText = existingFacts.join(' ').toLowerCase();

  // Extract significant words (skip common words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'at', 'in', 'on', 'for', 'to', 'of', 'and', 'or']);
  const extractWords = (text: string) =>
    text.split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));

  const extractedWords = new Set(extractWords(extractedText));
  const existingWords = extractWords(existingText);

  // Count overlapping words
  let overlap = 0;
  for (const word of existingWords) {
    if (extractedWords.has(word)) overlap++;
  }

  if (existingWords.length === 0) return 0;
  return Math.min(1, overlap / Math.sqrt(existingWords.length));
}

/**
 * Use QMD to find potentially matching entities
 */
async function searchForCandidates(
  extracted: ExtractedEntity
): Promise<SearchResult[]> {
  // Build search query from name + context from facts
  const contextKeywords = extracted.facts
    .join(' ')
    .split(/\W+/)
    .filter(w => w.length > 3)
    .slice(0, 5)
    .join(' ');

  const query = `${extracted.name} ${contextKeywords}`.trim();

  // Search in the life collection
  const results = keywordSearch(query, { collection: 'life', limit: 10 });

  // Filter to only entity paths matching the type
  const typeDir = getTypeDir(extracted.type);
  return results.filter(r => r.path.includes(typeDir));
}

/**
 * Use Ollama to make final resolution decision when scores are ambiguous
 */
async function llmResolve(
  extracted: ExtractedEntity,
  candidates: ResolutionCandidate[],
  originalContent?: string
): Promise<{ matchIndex: number; confidence: number; reason: string }> {
  const candidateDescriptions = candidates
    .slice(0, 3) // Only top 3
    .map((c, i) => {
      const recency = c.entity.lastAccessed
        ? `Last accessed: ${new Date(c.entity.lastAccessed).toLocaleDateString()}`
        : 'Never accessed';
      return `${i + 1}. "${c.entity.name}" (${c.entity.type})
   Known facts: ${c.entity.facts.slice(0, 5).join('; ') || 'None'}
   ${recency}, ${c.entity.accessCount} total accesses`;
    })
    .join('\n\n');

  // Include original content for better context
  const contextSnippet = originalContent
    ? `\nORIGINAL TEXT:\n"${originalContent.slice(0, 500)}${originalContent.length > 500 ? '...' : ''}"\n`
    : '';

  const prompt = `You are resolving an entity mention to an existing entity in a personal knowledge base.

EXTRACTED MENTION:
Name: "${extracted.name}"
Type: ${extracted.type}
Extracted facts: ${extracted.facts.join('; ') || 'None'}
${contextSnippet}
CANDIDATE MATCHES:
${candidateDescriptions}

0. None of the above (create new entity)

Which candidate is the SAME entity as the extracted mention?

IMPORTANT CONSIDERATIONS:
- Partial names often match full names (e.g., "Adam" → "Adam Watson" if context matches)
- Context matters: if the text mentions a company/project and a candidate has related facts, that's a strong signal
- Recently accessed entities are more likely to be mentioned again
- Only create new if you're confident this is truly a different entity

Think step by step:
1. Does the name match or partially match any candidate?
2. Does the context (facts, company/project mentions) align with any candidate?
3. How confident are you in this match?

Respond with ONLY a JSON object:
{"match": <number 0-3>, "confidence": <0.0-1.0>, "reason": "<brief explanation>"}`;

  try {
    const response = await generate(prompt, { temperature: 0, maxTokens: 150 });

    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // Clean up common LLM JSON issues
      let jsonStr = jsonMatch[0]
        .replace(/,\s*\}/g, '}')           // Remove trailing commas
        .replace(/'/g, '"')                // Single to double quotes
        .replace(/(\w+):/g, '"$1":')       // Unquoted keys
        .replace(/""+/g, '"')              // Multiple quotes
        .replace(/:\s*"([^"]*)"([^,}\s])/g, ': "$1$2"'); // Fix split strings

      try {
        const parsed = JSON.parse(jsonStr);
        return {
          matchIndex: typeof parsed.match === 'number' ? parsed.match : 0,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          reason: String(parsed.reason || 'LLM resolution'),
        };
      } catch {
        // Try regex extraction as fallback
        const matchNum = response.match(/["']?match["']?\s*:\s*(\d)/);
        const confNum = response.match(/["']?confidence["']?\s*:\s*([\d.]+)/);
        const reasonMatch = response.match(/["']?reason["']?\s*:\s*["']([^"']+)["']/);

        if (matchNum) {
          return {
            matchIndex: parseInt(matchNum[1], 10),
            confidence: confNum ? parseFloat(confNum[1]) : 0.5,
            reason: reasonMatch ? reasonMatch[1] : 'LLM resolution (parsed)',
          };
        }
      }
    }
  } catch (error) {
    console.warn('[EntityResolution] LLM resolution failed:', error);
  }

  // Fallback: use highest scoring candidate if score is good
  if (candidates.length > 0 && candidates[0].score > 0.6) {
    return {
      matchIndex: 1,
      confidence: candidates[0].score,
      reason: 'Highest scoring candidate (LLM unavailable)',
    };
  }

  return { matchIndex: 0, confidence: 0.3, reason: 'No confident match found' };
}

/**
 * Resolve a single extracted entity to an existing entity or mark as new
 *
 * @param extracted - The entity extracted from text
 * @param existingEntities - Optional pre-loaded list of existing entities
 * @param originalContent - Optional original text for better context
 */
export async function resolveEntity(
  extracted: ExtractedEntity,
  existingEntities?: ExistingEntity[],
  originalContent?: string
): Promise<ResolvedEntity> {
  // Load existing entities of the same type if not provided
  const entities = existingEntities || await loadExistingEntities(extracted.type);

  if (entities.length === 0) {
    return {
      extracted,
      match: null,
      confidence: 1.0,
      isNew: true,
      reason: 'No existing entities of this type',
    };
  }

  // Score each existing entity
  const candidates: ResolutionCandidate[] = [];

  for (const entity of entities) {
    const nameScore = calculateNameSimilarity(extracted.name, entity.name);

    // Skip if name doesn't match at all
    if (nameScore === 0) continue;

    const recencyScore = calculateRecencyScore(entity.lastAccessed);
    const contextScore = calculateContextScore(extracted.facts, entity.facts);

    // Weighted combination
    // Name is most important, then context, then recency
    const score = (nameScore * 0.5) + (contextScore * 0.35) + (recencyScore * 0.15);

    const reasons: string[] = [];
    if (nameScore > 0.7) reasons.push(`name match: ${(nameScore * 100).toFixed(0)}%`);
    if (contextScore > 0.3) reasons.push(`context overlap: ${(contextScore * 100).toFixed(0)}%`);
    if (recencyScore > 0.5) reasons.push(`recently active`);

    candidates.push({ entity, score, reasons });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // If no candidates, it's new
  if (candidates.length === 0) {
    return {
      extracted,
      match: null,
      confidence: 0.9,
      isNew: true,
      reason: 'No name matches found',
    };
  }

  const topCandidate = candidates[0];

  // High confidence match
  if (topCandidate.score > 0.8) {
    return {
      extracted,
      match: topCandidate.entity,
      confidence: topCandidate.score,
      isNew: false,
      reason: `Strong match: ${topCandidate.reasons.join(', ')}`,
    };
  }

  // Clear winner (big gap to second place)
  if (candidates.length > 1 && topCandidate.score > 0.5) {
    const gap = topCandidate.score - candidates[1].score;
    if (gap > 0.2) {
      return {
        extracted,
        match: topCandidate.entity,
        confidence: topCandidate.score,
        isNew: false,
        reason: `Best match with clear margin: ${topCandidate.reasons.join(', ')}`,
      };
    }
  }

  // Ambiguous - use LLM if available
  const ollamaAvailable = await isOllamaAvailable();
  if (ollamaAvailable && candidates.length > 0 && topCandidate.score > 0.3) {
    const llmResult = await llmResolve(extracted, candidates, originalContent);

    if (llmResult.matchIndex > 0 && llmResult.matchIndex <= candidates.length) {
      const matchedCandidate = candidates[llmResult.matchIndex - 1];
      return {
        extracted,
        match: matchedCandidate.entity,
        confidence: llmResult.confidence,
        isNew: false,
        reason: `LLM resolved: ${llmResult.reason}`,
      };
    }

    // LLM said create new
    return {
      extracted,
      match: null,
      confidence: llmResult.confidence,
      isNew: true,
      reason: `LLM decided new entity: ${llmResult.reason}`,
    };
  }

  // Low confidence - create new to be safe
  if (topCandidate.score < 0.4) {
    return {
      extracted,
      match: null,
      confidence: 0.6,
      isNew: true,
      reason: `Low match confidence (${(topCandidate.score * 100).toFixed(0)}%), creating new`,
    };
  }

  // Medium confidence - match to top candidate
  return {
    extracted,
    match: topCandidate.entity,
    confidence: topCandidate.score,
    isNew: false,
    reason: `Best available match: ${topCandidate.reasons.join(', ')}`,
  };
}

/**
 * Resolve multiple extracted entities
 * Optimized to load existing entities once per type
 *
 * @param extracted - Entities extracted from text
 * @param originalContent - Optional original text for better context in resolution
 */
export async function resolveEntities(
  extracted: ExtractedEntity[],
  originalContent?: string
): Promise<ResolvedEntity[]> {
  // Load existing entities for all types upfront (for cross-type checking)
  const entityCache = new Map<EntityType, ExistingEntity[]>();
  for (const type of ['person', 'company', 'project'] as EntityType[]) {
    entityCache.set(type, await loadExistingEntities(type));
  }

  // Track names we've already decided to create (to prevent batch duplicates)
  const pendingCreations = new Set<string>();

  const results: ResolvedEntity[] = [];

  for (const entity of extracted) {
    const nameLower = entity.name.toLowerCase();
    const nameSlug = nameLower.replace(/[^a-z0-9]+/g, '-');

    // Check if we're already creating this entity in this batch
    if (pendingCreations.has(nameSlug)) {
      console.log(`[EntityResolution] Skipping duplicate in batch: ${entity.name} (${entity.type})`);
      continue;
    }

    // Cross-type check: if this name exists as a different type, don't create duplicate
    let crossTypeMatch: { match: ExistingEntity; type: EntityType } | null = null;
    for (const [otherType, otherEntities] of entityCache) {
      if (otherType !== entity.type) {
        const match = otherEntities.find(e =>
          e.name.toLowerCase() === nameLower ||
          e.slug === nameSlug
        );
        if (match) {
          crossTypeMatch = { match, type: otherType };
          break;
        }
      }
    }

    if (crossTypeMatch) {
      console.log(`[EntityResolution] "${entity.name}" exists as ${crossTypeMatch.type}, redirecting from ${entity.type}`);
      // Add facts to existing entity instead
      results.push({
        extracted: entity,
        match: crossTypeMatch.match,
        confidence: 0.9,
        isNew: false,
        reason: `Cross-type match: exists as ${crossTypeMatch.type}`,
      });
      continue;
    }

    const existing = entityCache.get(entity.type)!;
    const resolved = await resolveEntity(entity, existing, originalContent);

    results.push(resolved);

    // If creating new, add to pending to prevent batch duplicates
    if (resolved.isNew) {
      pendingCreations.add(nameSlug);
      existing.push({
        slug: nameSlug,
        name: entity.name,
        type: entity.type,
        path: '', // Will be created later
        facts: entity.facts,
        lastAccessed: null,
        accessCount: 0,
      });
    }
  }

  return results;
}
