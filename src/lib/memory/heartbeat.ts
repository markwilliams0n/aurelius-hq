import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { listDailyNotes, readDailyNote } from './daily-notes';
import { isOllamaAvailable, extractEntitiesWithLLM } from './ollama';
import { syncGranolaMeetings, type GranolaSyncResult } from '@/lib/granola';

const LIFE_DIR = path.join(process.cwd(), 'life');

type EntityType = 'person' | 'company' | 'project';

interface ExtractedEntity {
  name: string;
  type: EntityType;
  facts: string[];
}

interface EntityFact {
  id: string;
  fact: string;
  category: 'relationship' | 'milestone' | 'status' | 'preference' | 'context';
  timestamp: string;
  source: string;
  status: 'active' | 'superseded';
  supersededBy: string | null;
  relatedEntities: string[];
  lastAccessed: string;
  accessCount: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getEntityPath(type: EntityType, slug: string): string {
  const typeDir = type === 'person' ? 'areas/people'
    : type === 'company' ? 'areas/companies'
    : 'projects';

  return path.join(LIFE_DIR, typeDir, slug);
}

async function entityExists(type: EntityType, name: string): Promise<boolean> {
  const entityPath = getEntityPath(type, slugify(name));
  try {
    await fs.access(entityPath);
    return true;
  } catch {
    return false;
  }
}

async function createEntity(
  type: EntityType,
  name: string,
  summary: string,
  initialFacts: Omit<EntityFact, 'id' | 'lastAccessed' | 'accessCount'>[] = []
): Promise<void> {
  const slug = slugify(name);
  const entityPath = getEntityPath(type, slug);

  // Create directory
  await fs.mkdir(entityPath, { recursive: true });

  // Create summary.md
  const summaryContent = `# ${name}

**Type:** ${type}
**Created:** ${new Date().toISOString().split('T')[0]}

## Summary

${summary}
`;
  await fs.writeFile(path.join(entityPath, 'summary.md'), summaryContent);

  // Create items.json
  const facts: EntityFact[] = initialFacts.map((f, i) => ({
    ...f,
    id: `${slug}-${Date.now()}-${i}`,
    lastAccessed: new Date().toISOString(),
    accessCount: 0
  }));

  await fs.writeFile(
    path.join(entityPath, 'items.json'),
    JSON.stringify(facts, null, 2)
  );
}

async function addFactToEntity(
  type: EntityType,
  name: string,
  fact: Omit<EntityFact, 'id' | 'lastAccessed' | 'accessCount'>
): Promise<void> {
  const slug = slugify(name);
  const entityPath = getEntityPath(type, slug);
  const itemsPath = path.join(entityPath, 'items.json');

  // Read existing facts
  let facts: EntityFact[] = [];
  try {
    const content = await fs.readFile(itemsPath, 'utf-8');
    facts = JSON.parse(content);
  } catch {
    // File doesn't exist, start fresh
  }

  // Check for duplicate facts
  const factExists = facts.some(f =>
    f.fact.toLowerCase() === fact.fact.toLowerCase() &&
    f.status === 'active'
  );

  if (factExists) {
    return; // Don't add duplicate facts
  }

  // Add new fact
  const newFact: EntityFact = {
    ...fact,
    id: `${slug}-${Date.now()}`,
    lastAccessed: new Date().toISOString(),
    accessCount: 0
  };

  facts.push(newFact);

  await fs.writeFile(itemsPath, JSON.stringify(facts, null, 2));
}

export interface EntityDetail {
  name: string;
  type: EntityType;
  facts: string[];
  action: 'created' | 'updated';
  source: string;
}

export interface HeartbeatResult {
  entitiesCreated: number;
  entitiesUpdated: number;
  reindexed: boolean;
  entities: EntityDetail[];
  extractionMethod: 'ollama' | 'pattern';
  granola?: GranolaSyncResult;
}

/**
 * Run the heartbeat process:
 * 1. Scan recent daily notes
 * 2. Extract entities and facts (using Ollama LLM or pattern matching fallback)
 * 3. Create/update entity files
 * 4. Reindex QMD
 */
export async function runHeartbeat(): Promise<HeartbeatResult> {
  console.log('[Heartbeat] Starting...');

  let entitiesCreated = 0;
  let entitiesUpdated = 0;
  const entityDetails: EntityDetail[] = [];

  // Check if Ollama is available for LLM extraction
  const useOllama = await isOllamaAvailable();
  console.log(`[Heartbeat] Extraction method: ${useOllama ? 'Ollama LLM' : 'Pattern matching'}`);

  // 1. Get recent daily notes (last 3 days)
  const notes = await listDailyNotes();
  const recentNotes = notes.slice(0, 3);

  for (const noteFile of recentNotes) {
    const date = noteFile.replace('.md', '');
    const content = await readDailyNote(date);
    if (!content) continue;

    // 2. Extract entities (try Ollama first, fall back to patterns)
    let extracted: ExtractedEntity[];
    if (useOllama) {
      try {
        extracted = await extractEntitiesWithLLM(content, `memory/${date}.md`);
        console.log(`[Heartbeat] Ollama extracted ${extracted.length} entities from ${date}`);
      } catch (error) {
        console.warn('[Heartbeat] Ollama extraction failed, using pattern matching:', error);
        extracted = extractEntitiesFromNote(content, date);
      }
    } else {
      extracted = extractEntitiesFromNote(content, date);
    }

    // 3. Create/update entity files
    for (const entity of extracted) {
      const exists = await entityExists(entity.type, entity.name);

      if (!exists) {
        await createEntity(
          entity.type,
          entity.name,
          `Extracted from daily notes on ${date}`,
          entity.facts.map(f => ({
            fact: f,
            category: 'context' as const,
            timestamp: date,
            source: `memory/${date}.md`,
            status: 'active' as const,
            supersededBy: null,
            relatedEntities: []
          }))
        );
        console.log(`[Heartbeat] Created entity: ${entity.name} (${entity.type})`);
        entitiesCreated++;
        entityDetails.push({
          name: entity.name,
          type: entity.type,
          facts: entity.facts,
          action: 'created',
          source: `memory/${date}.md`
        });
      } else {
        // Add new facts to existing entity
        for (const fact of entity.facts) {
          await addFactToEntity(entity.type, entity.name, {
            fact,
            category: 'context',
            timestamp: date,
            source: `memory/${date}.md`,
            status: 'active',
            supersededBy: null,
            relatedEntities: []
          });
        }
        console.log(`[Heartbeat] Updated entity: ${entity.name}`);
        entitiesUpdated++;
        entityDetails.push({
          name: entity.name,
          type: entity.type,
          facts: entity.facts,
          action: 'updated',
          source: `memory/${date}.md`
        });
      }
    }
  }

  // 4. Sync Granola meetings to triage
  let granolaResult: GranolaSyncResult | undefined;
  try {
    granolaResult = await syncGranolaMeetings();
    if (granolaResult.synced > 0) {
      console.log(`[Heartbeat] Granola: synced ${granolaResult.synced} meetings`);
    }
  } catch (error) {
    console.error('[Heartbeat] Granola sync failed:', error);
  }

  // 5. Reindex QMD
  const reindexed = await reindexQMD();

  console.log(`[Heartbeat] Complete - created: ${entitiesCreated}, updated: ${entitiesUpdated}`);

  return {
    entitiesCreated,
    entitiesUpdated,
    reindexed,
    entities: entityDetails,
    extractionMethod: useOllama ? 'ollama' : 'pattern',
    granola: granolaResult,
  };
}

/**
 * Simple fallback extraction using basic pattern matching.
 * Only used when Ollama is unavailable. Keeps it minimal since
 * the LLM handles context much better.
 */
function extractEntitiesFromNote(content: string, date: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seenNames = new Set<string>();

  const addEntity = (name: string, type: EntityType, fact: string) => {
    if (!name || name.length < 4) return;
    const key = `${type}:${name.toLowerCase()}`;
    if (seenNames.has(key)) return;
    seenNames.add(key);
    entities.push({ name, type, facts: [fact] });
  };

  // Simple pattern: "First Last" names (two capitalized words)
  const namePattern = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
  let match;
  while ((match = namePattern.exec(content)) !== null) {
    const name = `${match[1]} ${match[2]}`;
    addEntity(name, 'person', `Mentioned on ${date}`);
  }

  // Simple pattern: "Project X" or "X Project"
  const projectPattern = /(?:Project|project)\s+([A-Z][A-Za-z]+)/g;
  while ((match = projectPattern.exec(content)) !== null) {
    addEntity(`Project ${match[1]}`, 'project', `Mentioned on ${date}`);
  }

  return entities;
}

/**
 * Reindex QMD collections
 */
async function reindexQMD(): Promise<boolean> {
  try {
    execSync('qmd update', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 60000
    });

    execSync('qmd embed', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 120000
    });

    console.log('[Heartbeat] QMD reindexed');
    return true;
  } catch (error) {
    console.error('[Heartbeat] QMD reindex failed:', error);
    return false;
  }
}
