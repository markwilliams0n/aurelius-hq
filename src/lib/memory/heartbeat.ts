import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { listDailyNotes, readDailyNote } from './daily-notes';
import { isOllamaAvailable, extractEntitiesWithLLM, isFactRedundant, type ExistingEntityHint } from './ollama';
import { resolveEntities, type ResolvedEntity } from './entity-resolution';
import { syncGranolaMeetings, type GranolaSyncResult } from '@/lib/granola';
import { syncGmailMessages, type GmailSyncResult } from '@/lib/gmail';
import { syncLinearNotifications, type LinearSyncResult } from '@/lib/linear';
import { syncSlackMessages, type SlackSyncResult, startSocketMode, isSocketConfigured } from '@/lib/slack';
import { createBackup, type BackupResult } from './backup';

const LIFE_DIR = path.join(process.cwd(), 'life');
const HEARTBEAT_STATE_FILE = path.join(LIFE_DIR, 'system', 'heartbeat-state.json');

type EntityType = 'person' | 'company' | 'project';

interface HeartbeatState {
  /** Map of note filename to last processed section timestamp (HH:MM format) */
  processedNotes: Record<string, string>;
  lastRun: string;
}

/**
 * Parse daily note into sections by ## HH:MM timestamps
 * Returns sections newer than the given timestamp
 */
function getNewSections(content: string, afterTimestamp: string | null): { content: string; latestTimestamp: string | null } {
  // Split by ## HH:MM pattern
  const sectionPattern = /^## (\d{2}:\d{2})/gm;
  const sections: Array<{ timestamp: string; content: string }> = [];

  let lastIndex = 0;
  let lastTimestamp: string | null = null;
  let match;

  // Find all section headers
  const matches: Array<{ timestamp: string; index: number }> = [];
  while ((match = sectionPattern.exec(content)) !== null) {
    matches.push({ timestamp: match[1], index: match.index });
  }

  // Extract sections
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : content.length;
    sections.push({
      timestamp: matches[i].timestamp,
      content: content.slice(start, end)
    });
  }

  if (sections.length === 0) {
    // No sections found, return entire content
    return { content, latestTimestamp: null };
  }

  // Filter to only new sections
  const newSections = afterTimestamp
    ? sections.filter(s => s.timestamp > afterTimestamp)
    : sections;

  // Find latest timestamp
  const latestTimestamp = sections.length > 0
    ? sections[sections.length - 1].timestamp
    : null;

  return {
    content: newSections.map(s => s.content).join('\n'),
    latestTimestamp
  };
}

interface ParsedDailyNoteEntry {
  sender: string;
  connector: string;
  subject: string;
  summary?: string;
  memorySaved: string[];
  actionItems: string[];
  timestamp: string;
}

/**
 * Parse pre-extracted content from daily note sections.
 * Daily notes from triage already have **Memory Saved:** and **Action Items:** sections
 * that we should use instead of re-extracting.
 */
function parsePreExtractedContent(content: string): ParsedDailyNoteEntry[] {
  const entries: ParsedDailyNoteEntry[] = [];

  // Split into sections by ## HH:MM
  const sectionPattern = /^## (\d{2}:\d{2})\s*\n([\s\S]*?)(?=^## \d{2}:\d{2}|\Z)/gm;
  let match;

  // Use a different approach - split by section headers
  const sections = content.split(/(?=^## \d{2}:\d{2})/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Get timestamp
    const timestampMatch = section.match(/^## (\d{2}:\d{2})/);
    if (!timestampMatch) continue;
    const timestamp = timestampMatch[1];

    // Get sender line: **Name** via connector: "Subject"
    const senderMatch = section.match(/\*\*([^*]+)\*\*\s+via\s+(\w+)[^:]*:\s*"([^"]+)"/);
    if (!senderMatch) continue;

    const entry: ParsedDailyNoteEntry = {
      sender: senderMatch[1].trim(),
      connector: senderMatch[2].trim(),
      subject: senderMatch[3].trim(),
      memorySaved: [],
      actionItems: [],
      timestamp,
    };

    // Get summary (blockquote after header)
    const summaryMatch = section.match(/>\s*([^\n]+(?:\n>[^\n]*)*)/);
    if (summaryMatch) {
      entry.summary = summaryMatch[1].replace(/\n>\s*/g, ' ').trim();
    }

    // Get Memory Saved section
    const memorySavedMatch = section.match(/\*\*(?:Memory Saved|Key Facts):\*\*\s*\n((?:- [^\n]+\n?)+)/);
    if (memorySavedMatch) {
      entry.memorySaved = memorySavedMatch[1]
        .split('\n')
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(line => line && !line.startsWith('_(+'));  // Skip overflow indicators
    }

    // Get Action Items section
    const actionItemsMatch = section.match(/\*\*Action Items:\*\*\s*\n((?:- \[[ x]\][^\n]+\n?)+)/);
    if (actionItemsMatch) {
      entry.actionItems = actionItemsMatch[1]
        .split('\n')
        .map(line => line.replace(/^-\s*\[[ x]\]\s*/, '').trim())
        .filter(line => line);
    }

    entries.push(entry);
  }

  return entries;
}

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

import { createHash } from 'crypto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Simple hash of content to detect changes */
function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 16);
}

async function loadHeartbeatState(): Promise<HeartbeatState> {
  try {
    const content = await fs.readFile(HEARTBEAT_STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedNotes: {}, lastRun: '' };
  }
}

async function saveHeartbeatState(state: HeartbeatState): Promise<void> {
  await fs.mkdir(path.dirname(HEARTBEAT_STATE_FILE), { recursive: true });
  await fs.writeFile(HEARTBEAT_STATE_FILE, JSON.stringify(state, null, 2));
}

function getEntityPath(type: EntityType, slug: string): string {
  const typeDir = type === 'person' ? 'areas/people'
    : type === 'company' ? 'areas/companies'
    : 'projects';

  return path.join(LIFE_DIR, typeDir, slug);
}

/**
 * Load existing entities as hints for the extraction LLM
 * Prioritizes recently accessed entities
 */
async function loadExistingEntityHints(): Promise<ExistingEntityHint[]> {
  const hints: ExistingEntityHint[] = [];

  const typeDirs: Array<{ dir: string; type: 'person' | 'company' | 'project' }> = [
    { dir: 'areas/people', type: 'person' },
    { dir: 'areas/companies', type: 'company' },
    { dir: 'projects', type: 'project' },
  ];

  for (const { dir, type } of typeDirs) {
    const fullDir = path.join(LIFE_DIR, dir);
    try {
      const items = await fs.readdir(fullDir, { withFileTypes: true });

      for (const item of items) {
        if (!item.isDirectory() || item.name.startsWith('_')) continue;

        const entityPath = path.join(fullDir, item.name);
        const itemsPath = path.join(entityPath, 'items.json');

        // Convert slug to display name
        const displayName = item.name
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        let recentFacts: string[] = [];
        let lastAccessed: string | null = null;

        try {
          const content = await fs.readFile(itemsPath, 'utf-8');
          const facts = JSON.parse(content);

          // Get most recent access time for sorting
          for (const f of facts) {
            if (f.lastAccessed && (!lastAccessed || f.lastAccessed > lastAccessed)) {
              lastAccessed = f.lastAccessed;
            }
          }

          // Get a few recent facts for context
          recentFacts = facts
            .filter((f: { status?: string }) => f.status === 'active')
            .slice(0, 2)
            .map((f: { fact: string }) => f.fact);
        } catch {
          // No items file
        }

        hints.push({
          name: displayName,
          type,
          recentFacts,
          _lastAccessed: lastAccessed, // For sorting
        } as ExistingEntityHint & { _lastAccessed: string | null });
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Sort by recency (most recently accessed first)
  hints.sort((a, b) => {
    const aTime = (a as ExistingEntityHint & { _lastAccessed: string | null })._lastAccessed || '1970-01-01';
    const bTime = (b as ExistingEntityHint & { _lastAccessed: string | null })._lastAccessed || '1970-01-01';
    return bTime.localeCompare(aTime);
  });

  // Clean up internal property
  for (const hint of hints) {
    delete (hint as ExistingEntityHint & { _lastAccessed?: string | null })._lastAccessed;
  }

  return hints;
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

async function getExistingFacts(type: EntityType, name: string): Promise<string[]> {
  const entityPath = getEntityPath(type, slugify(name));
  const itemsPath = path.join(entityPath, 'items.json');
  try {
    const content = await fs.readFile(itemsPath, 'utf-8');
    const facts: EntityFact[] = JSON.parse(content);
    return facts.filter(f => f.status === 'active').map(f => f.fact);
  } catch {
    return [];
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

  // Build summary with facts included (for QMD indexing)
  const factsList = initialFacts.map(f => f.fact);
  const factsSection = factsList.length > 0
    ? `\n## Facts\n\n${factsList.map(f => `- ${f}`).join('\n')}\n`
    : '';

  // Create summary.md (include facts for QMD search)
  const summaryContent = `# ${name}

**Type:** ${type}
**Created:** ${new Date().toISOString().split('T')[0]}

## Summary

${summary}
${factsSection}`;
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

/**
 * Add a fact to an entity if it doesn't already exist.
 * Returns true if the fact was added, false if it was a duplicate.
 */
async function addFactToEntity(
  type: EntityType,
  name: string,
  fact: Omit<EntityFact, 'id' | 'lastAccessed' | 'accessCount'>
): Promise<boolean> {
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

  // Check for duplicate facts (case-insensitive, also check similar wording)
  const factLower = fact.fact.toLowerCase().trim();
  const factExists = facts.some(f => {
    const existingLower = f.fact.toLowerCase().trim();
    // Exact match
    if (existingLower === factLower) return true;
    // Very similar (one contains the other and similar length)
    if (existingLower.includes(factLower) || factLower.includes(existingLower)) {
      const lengthRatio = Math.min(existingLower.length, factLower.length) /
                          Math.max(existingLower.length, factLower.length);
      if (lengthRatio > 0.8) return true;
    }
    return false;
  });

  if (factExists) {
    return false; // Don't add duplicate facts
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

  // Update summary.md with new facts (for QMD indexing)
  const summaryPath = path.join(entityPath, 'summary.md');
  try {
    const summaryContent = await fs.readFile(summaryPath, 'utf-8');
    // Replace or add Facts section
    const activeFacts = facts.filter(f => f.status === 'active').map(f => f.fact);
    const factsSection = `## Facts\n\n${activeFacts.map(f => `- ${f}`).join('\n')}\n`;

    if (summaryContent.includes('## Facts')) {
      // Replace existing Facts section
      const updated = summaryContent.replace(/## Facts[\s\S]*?(?=\n## |$)/, factsSection);
      await fs.writeFile(summaryPath, updated);
    } else {
      // Append Facts section
      await fs.writeFile(summaryPath, summaryContent.trim() + '\n\n' + factsSection);
    }
  } catch {
    // Summary doesn't exist, skip
  }

  return true; // Fact was added
}

export interface EntityDetail {
  name: string;
  type: EntityType;
  facts: string[];
  action: 'created' | 'updated';
  source: string;
}

export interface HeartbeatOptions {
  /** Skip daily backup (backup still runs once per day by default) */
  skipBackup?: boolean;
  /** Skip QMD reindex (faster heartbeat, but new content won't be searchable until next full run) */
  skipReindex?: boolean;
  /** Skip Granola sync */
  skipGranola?: boolean;
  /** Skip Gmail sync */
  skipGmail?: boolean;
  /** Skip Linear sync */
  skipLinear?: boolean;
  /** Skip Slack sync */
  skipSlack?: boolean;
  /** Skip entity extraction from daily notes */
  skipExtraction?: boolean;
}

export interface StepResult {
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface HeartbeatResult {
  entitiesCreated: number;
  entitiesUpdated: number;
  reindexed: boolean;
  entities: EntityDetail[];
  extractionMethod: 'ollama' | 'pattern';
  granola?: GranolaSyncResult;
  gmail?: GmailSyncResult;
  linear?: LinearSyncResult;
  slack?: SlackSyncResult;
  backup?: BackupResult;
  /** Granular step results for debugging */
  steps: {
    backup?: StepResult;
    extraction?: StepResult;
    granola?: StepResult;
    gmail?: StepResult;
    linear?: StepResult;
    slack?: StepResult;
    qmdUpdate?: StepResult;
    qmdEmbed?: StepResult;
  };
  /** Whether all steps succeeded */
  allStepsSucceeded: boolean;
  /** Warnings from partial failures */
  warnings: string[];
}

/**
 * Run the heartbeat process:
 * 0. Daily backup (once per day, keeps last 7)
 * 1. Scan recent daily notes
 * 2. Extract entities and facts (using Ollama LLM or pattern matching fallback)
 * 3. Create/update entity files
 * 4. Sync Granola meetings
 * 5. Sync Gmail messages
 * 6. Sync Linear notifications
 * 7. Sync Slack messages
 * 8. Reindex QMD
 *
 * Each step is isolated - failures in one step don't prevent others from running.
 */
export async function runHeartbeat(options: HeartbeatOptions = {}): Promise<HeartbeatResult> {
  console.log('[Heartbeat] Starting...');
  const overallStart = Date.now();

  let entitiesCreated = 0;
  let entitiesUpdated = 0;
  const entityDetails: EntityDetail[] = [];
  const warnings: string[] = [];
  const steps: HeartbeatResult['steps'] = {};

  // Step 0: Daily backup (runs once per day, keeps last 7)
  let backupResult: BackupResult | undefined;
  if (!options.skipBackup) {
    const backupStart = Date.now();
    try {
      backupResult = await createBackup();
      if (backupResult.skipped) {
        console.log(`[Heartbeat] Backup skipped (${backupResult.reason})`);
      } else if (backupResult.success) {
        console.log(`[Heartbeat] Backup created: ${backupResult.backupPath}`);
      }
      steps.backup = {
        success: backupResult.success,
        durationMs: Date.now() - backupStart,
        error: backupResult.error,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Backup failed:', errMsg);
      warnings.push(`Backup failed: ${errMsg}`);
      steps.backup = {
        success: false,
        durationMs: Date.now() - backupStart,
        error: errMsg,
      };
    }
  }

  // Determine extraction method
  let useOllama = false;
  if (!options.skipExtraction) {
    useOllama = await isOllamaAvailable();
    console.log(`[Heartbeat] Extraction method: ${useOllama ? 'Ollama LLM' : 'Pattern matching'}`);
  }

  // Step 1: Entity extraction from daily notes
  if (!options.skipExtraction) {
    const extractionStart = Date.now();
    try {
      // Load state to track which notes have been processed
      const state = await loadHeartbeatState();

      // Load existing entities to provide context to extraction LLM
      console.log('[Heartbeat] Loading existing entities for context...');
      const existingEntityHints = useOllama ? await loadExistingEntityHints() : [];
      console.log(`[Heartbeat] Loaded ${existingEntityHints.length} existing entities as context`);

      const notes = await listDailyNotes();
      const recentNotes = notes.slice(0, 3);

      for (const noteFile of recentNotes) {
        const date = noteFile.replace('.md', '');
        const fullContent = await readDailyNote(date);
        if (!fullContent) continue;

        // Get only NEW sections (after last processed timestamp for this note)
        const lastProcessedTimestamp = state.processedNotes[noteFile] || null;
        const { content, latestTimestamp } = getNewSections(fullContent, lastProcessedTimestamp);

        if (!content.trim()) {
          console.log(`[Heartbeat] Skipping ${date} (no new sections)`);
          continue;
        }

        console.log(`[Heartbeat] Processing ${date} sections after ${lastProcessedTimestamp || 'start'}`);

        // Track the latest timestamp we'll save after processing
        const newTimestamp = latestTimestamp;

        // FIRST: Try to use pre-extracted content from daily notes
        // Daily notes from triage already have **Memory Saved:** sections with rich extracted facts
        const preExtracted = parsePreExtractedContent(content);
        let extracted: ExtractedEntity[];

        if (preExtracted.length > 0) {
          // Convert pre-extracted entries to entities
          console.log(`[Heartbeat] Found ${preExtracted.length} pre-extracted entries in ${date}`);
          extracted = [];

          for (const entry of preExtracted) {
            // Create entity for sender if they have facts
            if (entry.memorySaved.length > 0 || entry.actionItems.length > 0) {
              const facts = [
                ...entry.memorySaved,
                ...entry.actionItems.map(a => `Action item: ${a}`),
              ];

              // Filter out vague/useless facts
              const goodFacts = facts.filter(f => {
                const lower = f.toLowerCase();
                // Skip very short or vague facts
                if (f.length < 10) return false;
                // Skip "mentioned on" type facts
                if (lower.includes('mentioned on') || lower.includes('contacted us about')) return false;
                // Skip vague facts without data
                if (/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\w+\s+(performance|report)/i.test(lower)) return false;
                return true;
              });

              if (goodFacts.length > 0) {
                extracted.push({
                  name: entry.sender,
                  type: 'person',
                  facts: goodFacts,
                });
              }
            }
          }

          console.log(`[Heartbeat] Pre-extracted ${extracted.length} entities with facts from ${date}`);
        } else if (useOllama) {
          // FALLBACK: No pre-extracted content, use Ollama extraction
          try {
            // Pass existing entities so LLM can use full names when possible
            extracted = await extractEntitiesWithLLM(content, `memory/${date}.md`, existingEntityHints);
            console.log(`[Heartbeat] Ollama extracted ${extracted.length} entities from ${date}`);
          } catch (error) {
            console.warn('[Heartbeat] Ollama extraction failed, using pattern matching:', error);
            extracted = extractEntitiesFromNote(content, date);
            warnings.push(`Ollama failed for ${date}, used pattern matching`);
          }
        } else {
          extracted = extractEntitiesFromNote(content, date);
        }

        // Resolve extracted entities to existing ones using smart matching
        // Pass the original content for better context in LLM resolution
        console.log(`[Heartbeat] Resolving ${extracted.length} entities...`);
        const resolved = await resolveEntities(extracted, content);

        for (const resolution of resolved) {
          const { extracted: entity, match, isNew, reason, confidence } = resolution;

          if (isNew) {
            // Create new entity
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
            console.log(`[Heartbeat] Created entity: ${entity.name} (${entity.type}) - ${reason}`);
            entitiesCreated++;
            entityDetails.push({
              name: entity.name,
              type: entity.type,
              facts: entity.facts,
              action: 'created',
              source: `memory/${date}.md`
            });
          } else if (match) {
            // Update existing entity (resolved match)
            const targetName = match.name;
            const targetType = match.type;

            console.log(`[Heartbeat] Resolved "${entity.name}" → "${targetName}" (${(confidence * 100).toFixed(0)}% confidence)`);

            // Get existing facts for semantic deduplication
            const existingFacts = await getExistingFacts(targetType, targetName);

            // Try to add each fact, using semantic deduplication if Ollama available
            let factsAdded = 0;
            const addedFacts: string[] = [];
            for (const fact of entity.facts) {
              // First check semantic redundancy with Ollama
              if (useOllama && existingFacts.length > 0) {
                const isRedundant = await isFactRedundant(fact, existingFacts, targetName);
                if (isRedundant) {
                  console.log(`[Heartbeat] Skipping redundant fact for ${targetName}: "${fact.slice(0, 50)}..."`);
                  continue;
                }
              }

              const wasAdded = await addFactToEntity(targetType, targetName, {
                fact,
                category: 'context',
                timestamp: date,
                source: `memory/${date}.md`,
                status: 'active',
                supersededBy: null,
                relatedEntities: []
              });
              if (wasAdded) {
                factsAdded++;
                addedFacts.push(fact);
                existingFacts.push(fact); // Add to existing for subsequent checks
              }
            }
            // Only count as updated if we actually added new facts
            if (factsAdded > 0) {
              console.log(`[Heartbeat] Updated entity: ${targetName} (+${factsAdded} facts)`);
              entitiesUpdated++;
              entityDetails.push({
                name: targetName,
                type: targetType,
                facts: addedFacts,
                action: 'updated',
                source: `memory/${date}.md`
              });
            }
          }
        }

        // Mark this note as processed with the latest timestamp
        if (newTimestamp) {
          state.processedNotes[noteFile] = newTimestamp;
        }
      }

      // Save state after processing all notes
      state.lastRun = new Date().toISOString();
      await saveHeartbeatState(state);

      steps.extraction = {
        success: true,
        durationMs: Date.now() - extractionStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Entity extraction failed:', errMsg);
      warnings.push(`Entity extraction failed: ${errMsg}`);
      steps.extraction = {
        success: false,
        durationMs: Date.now() - extractionStart,
        error: errMsg,
      };
    }
  }

  // Step 2: Sync Granola meetings to triage
  let granolaResult: GranolaSyncResult | undefined;
  if (!options.skipGranola) {
    const granolaStart = Date.now();
    try {
      granolaResult = await syncGranolaMeetings();
      if (granolaResult.synced > 0) {
        console.log(`[Heartbeat] Granola: synced ${granolaResult.synced} meetings`);
      }
      steps.granola = {
        success: true,
        durationMs: Date.now() - granolaStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Granola sync failed:', errMsg);
      warnings.push(`Granola sync failed: ${errMsg}`);
      steps.granola = {
        success: false,
        durationMs: Date.now() - granolaStart,
        error: errMsg,
      };
    }
  }

  // Step 3: Sync Gmail messages to triage
  let gmailResult: GmailSyncResult | undefined;
  if (!options.skipGmail) {
    const gmailStart = Date.now();
    try {
      gmailResult = await syncGmailMessages();
      if (gmailResult.synced > 0) {
        console.log(`[Heartbeat] Gmail: synced ${gmailResult.synced} emails`);
      }
      steps.gmail = {
        success: true,
        durationMs: Date.now() - gmailStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Gmail sync failed:', errMsg);
      warnings.push(`Gmail sync failed: ${errMsg}`);
      steps.gmail = {
        success: false,
        durationMs: Date.now() - gmailStart,
        error: errMsg,
      };
    }
  }

  // Step 4: Sync Linear notifications to triage
  let linearResult: LinearSyncResult | undefined;
  if (!options.skipLinear) {
    const linearStart = Date.now();
    try {
      linearResult = await syncLinearNotifications();
      if (linearResult.synced > 0) {
        console.log(`[Heartbeat] Linear: synced ${linearResult.synced} notifications`);
      }
      steps.linear = {
        success: !linearResult.error,
        durationMs: Date.now() - linearStart,
        error: linearResult.error,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Linear sync failed:', errMsg);
      warnings.push(`Linear sync failed: ${errMsg}`);
      steps.linear = {
        success: false,
        durationMs: Date.now() - linearStart,
        error: errMsg,
      };
    }
  }

  // Step 5: Ensure Slack Socket Mode is connected (real-time listener for DMs and @mentions)
  let slackResult: SlackSyncResult | undefined;
  if (!options.skipSlack) {
    const slackStart = Date.now();
    try {
      if (isSocketConfigured()) {
        // Socket Mode: ensure connection is active (real-time, no sync needed)
        await startSocketMode();
        console.log('[Heartbeat] Slack Socket Mode connected');
        steps.slack = {
          success: true,
          durationMs: Date.now() - slackStart,
        };
      } else {
        // Fallback: old sync approach if Socket Mode not configured
        slackResult = await syncSlackMessages();
        if (slackResult.synced > 0) {
          console.log(`[Heartbeat] Slack: synced ${slackResult.synced} messages`);
        }
        steps.slack = {
          success: !slackResult.error,
          durationMs: Date.now() - slackStart,
          error: slackResult.error,
        };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] Slack setup failed:', errMsg);
      warnings.push(`Slack setup failed: ${errMsg}`);
      steps.slack = {
        success: false,
        durationMs: Date.now() - slackStart,
        error: errMsg,
      };
    }
  }

  // Step 6: Reindex QMD (split into update + embed for better observability)
  let reindexed = false;
  if (!options.skipReindex) {
    // QMD Update (fast - just document index)
    const updateStart = Date.now();
    try {
      execSync('qmd update', {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 60000
      });
      console.log('[Heartbeat] QMD update complete');
      steps.qmdUpdate = {
        success: true,
        durationMs: Date.now() - updateStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] QMD update failed:', errMsg);
      warnings.push(`QMD update failed: ${errMsg}`);
      steps.qmdUpdate = {
        success: false,
        durationMs: Date.now() - updateStart,
        error: errMsg,
      };
    }

    // QMD Embed (slow - vector embeddings)
    const embedStart = Date.now();
    try {
      execSync('qmd embed', {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 180000 // 3 minutes for embed (was 2 min, often timed out)
      });
      console.log('[Heartbeat] QMD embed complete');
      reindexed = true;
      steps.qmdEmbed = {
        success: true,
        durationMs: Date.now() - embedStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Heartbeat] QMD embed failed:', errMsg);
      warnings.push(`QMD embed failed: ${errMsg}`);
      steps.qmdEmbed = {
        success: false,
        durationMs: Date.now() - embedStart,
        error: errMsg,
      };
      // If update succeeded but embed failed, still consider partially reindexed
      if (steps.qmdUpdate?.success) {
        reindexed = true; // Documents are indexed, just not embedded
        warnings.push('QMD update succeeded but embed failed - keyword search works, semantic search may be stale');
      }
    }
  }

  const totalDuration = Date.now() - overallStart;
  const allStepsSucceeded = Object.values(steps).every(s => s?.success ?? true);

  console.log(
    `[Heartbeat] Complete in ${totalDuration}ms - ` +
    `created: ${entitiesCreated}, updated: ${entitiesUpdated}, ` +
    `reindexed: ${reindexed}` +
    (warnings.length > 0 ? ` (${warnings.length} warnings)` : '')
  );

  return {
    entitiesCreated,
    entitiesUpdated,
    reindexed,
    entities: entityDetails,
    extractionMethod: useOllama ? 'ollama' : 'pattern',
    granola: granolaResult,
    gmail: gmailResult,
    linear: linearResult,
    slack: slackResult,
    backup: backupResult,
    steps,
    allStepsSucceeded,
    warnings,
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

