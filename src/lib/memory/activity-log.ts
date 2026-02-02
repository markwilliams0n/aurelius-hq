import { promises as fs } from 'fs';
import path from 'path';

const LIFE_DIR = path.join(process.cwd(), 'life');
const ACTIVITY_LOG_PATH = path.join(LIFE_DIR, 'system', 'activity-log.json');

export type EntityDetail = {
  name: string;
  type: 'person' | 'company' | 'project';
  facts: string[];
  action: 'created' | 'updated';
  source: string;
};

export type HeartbeatLogEntry = {
  id: string;
  type: 'heartbeat';
  success: boolean;
  entitiesCreated: number;
  entitiesUpdated: number;
  reindexed: boolean;
  entities: EntityDetail[];
  extractionMethod: 'ollama' | 'pattern';
  duration: number;
  timestamp: string;
  error?: string;
};

export type SynthesisLogEntry = {
  id: string;
  type: 'synthesis';
  success: boolean;
  entitiesProcessed: number;
  factsArchived: number;
  summariesRegenerated: number;
  duration: number;
  timestamp: string;
  error?: string;
};

export type ActivityLogEntry = HeartbeatLogEntry | SynthesisLogEntry;

export interface ActivityLog {
  entries: ActivityLogEntry[];
  lastUpdated: string;
}

async function ensureLogDir(): Promise<void> {
  const systemDir = path.join(LIFE_DIR, 'system');
  await fs.mkdir(systemDir, { recursive: true });
}

export async function readActivityLog(): Promise<ActivityLog> {
  try {
    await ensureLogDir();
    const content = await fs.readFile(ACTIVITY_LOG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { entries: [], lastUpdated: new Date().toISOString() };
  }
}

export async function appendActivityLog(entry: ActivityLogEntry): Promise<void> {
  await ensureLogDir();
  const log = await readActivityLog();

  // Add new entry at the beginning
  log.entries.unshift(entry);

  // Keep only last 100 entries
  if (log.entries.length > 100) {
    log.entries = log.entries.slice(0, 100);
  }

  log.lastUpdated = new Date().toISOString();

  await fs.writeFile(ACTIVITY_LOG_PATH, JSON.stringify(log, null, 2));
}

export async function clearActivityLog(): Promise<void> {
  await ensureLogDir();
  const log: ActivityLog = { entries: [], lastUpdated: new Date().toISOString() };
  await fs.writeFile(ACTIVITY_LOG_PATH, JSON.stringify(log, null, 2));
}
