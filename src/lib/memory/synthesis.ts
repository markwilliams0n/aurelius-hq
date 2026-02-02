/**
 * Memory Synthesis and Decay
 * Manages memory tiers and regenerates entity summaries
 */

import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { isOllamaAvailable, generateEntitySummary } from './ollama';

const LIFE_DIR = path.join(process.cwd(), 'life');

// Decay thresholds (in days)
const HOT_THRESHOLD = 7;      // Accessed in last 7 days
const WARM_THRESHOLD = 30;    // Accessed 8-30 days ago
// Cold: 30+ days without access

// High access count resists decay
const HIGH_ACCESS_THRESHOLD = 10;

interface EntityFact {
  id: string;
  fact: string;
  category: string;
  timestamp: string;
  source: string;
  status: 'active' | 'superseded' | 'archived';
  supersededBy: string | null;
  relatedEntities: string[];
  lastAccessed: string;
  accessCount: number;
  tier?: 'hot' | 'warm' | 'cold';
}

interface SynthesisResult {
  entitiesProcessed: number;
  factsArchived: number;
  summariesRegenerated: number;
  errors: string[];
}

/**
 * Calculate the tier for a fact based on access patterns
 */
function calculateTier(fact: EntityFact): 'hot' | 'warm' | 'cold' {
  const now = new Date();
  const lastAccessed = fact.lastAccessed ? new Date(fact.lastAccessed) : new Date(fact.timestamp);
  const daysSinceAccess = Math.floor((now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24));

  // High access count resists decay
  if (fact.accessCount >= HIGH_ACCESS_THRESHOLD) {
    return daysSinceAccess <= WARM_THRESHOLD ? 'hot' : 'warm';
  }

  if (daysSinceAccess <= HOT_THRESHOLD) {
    return 'hot';
  } else if (daysSinceAccess <= WARM_THRESHOLD) {
    return 'warm';
  } else {
    return 'cold';
  }
}

/**
 * Process a single entity: calculate tiers, archive cold facts, regenerate summary
 */
async function processEntity(
  entityPath: string,
  useOllama: boolean
): Promise<{ factsArchived: number; summaryRegenerated: boolean; error?: string }> {
  const itemsPath = path.join(LIFE_DIR, entityPath, 'items.json');
  const summaryPath = path.join(LIFE_DIR, entityPath, 'summary.md');

  try {
    // Read facts
    let facts: EntityFact[] = [];
    try {
      const content = await fs.readFile(itemsPath, 'utf-8');
      facts = JSON.parse(content);
    } catch {
      // No items.json - nothing to process
      return { factsArchived: 0, summaryRegenerated: false };
    }

    // Calculate tiers for all facts
    let factsArchived = 0;
    const updatedFacts = facts.map(f => {
      const tier = calculateTier(f);

      // Archive cold facts (keep in items.json but mark as archived)
      if (tier === 'cold' && f.status === 'active') {
        factsArchived++;
        return { ...f, tier, status: 'archived' as const };
      }

      return { ...f, tier };
    });

    // Write updated facts
    await fs.writeFile(itemsPath, JSON.stringify(updatedFacts, null, 2));

    // Get active facts (hot and warm) for summary
    const activeFacts = updatedFacts
      .filter(f => f.status === 'active' && (f.tier === 'hot' || f.tier === 'warm'))
      .map(f => f.fact);

    // Read current summary to get entity info
    let entityName = entityPath.split('/').pop()?.replace(/-/g, ' ') || 'Unknown';
    let entityType = 'entity';
    try {
      const summaryContent = await fs.readFile(summaryPath, 'utf-8');
      const nameMatch = summaryContent.match(/^# (.+)$/m);
      const typeMatch = summaryContent.match(/\*\*Type:\*\* (.+)$/m);
      if (nameMatch) entityName = nameMatch[1];
      if (typeMatch) entityType = typeMatch[1];
    } catch {
      // No summary file
    }

    // Regenerate summary if we have active facts
    let summaryRegenerated = false;
    if (activeFacts.length > 0 || factsArchived > 0) {
      let newSummary: string;

      if (useOllama && activeFacts.length > 0) {
        try {
          newSummary = await generateEntitySummary(entityName, entityType, activeFacts);
        } catch {
          // Fall back to simple summary
          newSummary = activeFacts.slice(0, 3).join('. ') + '.';
        }
      } else if (activeFacts.length > 0) {
        newSummary = activeFacts.slice(0, 3).join('. ') + '.';
      } else {
        newSummary = `${entityName} is a ${entityType} with archived knowledge.`;
      }

      // Calculate stats
      const hotCount = updatedFacts.filter(f => f.tier === 'hot' && f.status === 'active').length;
      const warmCount = updatedFacts.filter(f => f.tier === 'warm' && f.status === 'active').length;
      const coldCount = updatedFacts.filter(f => f.status === 'archived').length;

      const summaryContent = `# ${entityName}

**Type:** ${entityType}
**Last Synthesis:** ${new Date().toISOString().split('T')[0]}

## Summary

${newSummary}

## Memory Stats

- Hot facts: ${hotCount}
- Warm facts: ${warmCount}
- Archived: ${coldCount}
`;

      await fs.writeFile(summaryPath, summaryContent);
      summaryRegenerated = true;
    }

    return { factsArchived, summaryRegenerated };
  } catch (error) {
    return {
      factsArchived: 0,
      summaryRegenerated: false,
      error: `Failed to process ${entityPath}: ${error}`,
    };
  }
}

/**
 * List all entity paths in the knowledge graph
 */
async function listAllEntities(): Promise<string[]> {
  const entities: string[] = [];
  const dirs = [
    'areas/people',
    'areas/companies',
    'projects',
    'resources',
  ];

  for (const dir of dirs) {
    const dirPath = path.join(LIFE_DIR, dir);
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('_')) {
          entities.push(`${dir}/${item.name}`);
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return entities;
}

/**
 * Run the weekly synthesis process
 * - Calculate decay tiers for all facts
 * - Archive cold facts
 * - Regenerate entity summaries with active facts
 * - Reindex QMD
 */
export async function runWeeklySynthesis(): Promise<SynthesisResult> {
  console.log('[Synthesis] Starting weekly synthesis...');

  const result: SynthesisResult = {
    entitiesProcessed: 0,
    factsArchived: 0,
    summariesRegenerated: 0,
    errors: [],
  };

  // Check if Ollama is available for summary generation
  const useOllama = await isOllamaAvailable();
  console.log(`[Synthesis] Summary generation: ${useOllama ? 'Ollama LLM' : 'Simple concatenation'}`);

  // Get all entities
  const entities = await listAllEntities();
  console.log(`[Synthesis] Processing ${entities.length} entities...`);

  // Process each entity
  for (const entityPath of entities) {
    const entityResult = await processEntity(entityPath, useOllama);

    result.entitiesProcessed++;
    result.factsArchived += entityResult.factsArchived;
    if (entityResult.summaryRegenerated) {
      result.summariesRegenerated++;
    }
    if (entityResult.error) {
      result.errors.push(entityResult.error);
    }
  }

  // Reindex QMD
  try {
    execSync('qmd update', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 60000,
    });
    execSync('qmd embed', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 120000,
    });
    console.log('[Synthesis] QMD reindexed');
  } catch (error) {
    console.error('[Synthesis] QMD reindex failed:', error);
    result.errors.push('QMD reindex failed');
  }

  console.log(`[Synthesis] Complete - processed: ${result.entitiesProcessed}, archived: ${result.factsArchived}, regenerated: ${result.summariesRegenerated}`);

  return result;
}

/**
 * Get decay statistics for an entity
 */
export async function getEntityDecayStats(entityPath: string): Promise<{
  hot: number;
  warm: number;
  cold: number;
  total: number;
} | null> {
  const itemsPath = path.join(LIFE_DIR, entityPath, 'items.json');

  try {
    const content = await fs.readFile(itemsPath, 'utf-8');
    const facts: EntityFact[] = JSON.parse(content);

    const stats = { hot: 0, warm: 0, cold: 0, total: facts.length };

    for (const fact of facts) {
      const tier = fact.tier || calculateTier(fact);
      stats[tier]++;
    }

    return stats;
  } catch {
    return null;
  }
}
