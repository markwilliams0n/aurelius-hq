/**
 * Connector Sync State — DB-backed
 *
 * Stores connector sync state (last sync timestamp, cursors, etc.) in the
 * configs table instead of dotfiles on disk. Falls back to reading legacy
 * dotfiles on first run for a smooth migration.
 */

import { db } from '@/lib/db';
import { configs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getConfig, type ConfigKey } from '@/lib/config';
import { promises as fs } from 'fs';
import path from 'path';

export type SyncStateKey = 'sync:gmail' | 'sync:granola' | 'sync:linear' | 'sync:slack';

/**
 * Legacy dotfile paths — used only for one-time migration fallback.
 */
const LEGACY_PATHS: Record<SyncStateKey, string> = {
  'sync:gmail': path.join(process.cwd(), '.gmail-sync-state.json'),
  'sync:granola': path.join(process.cwd(), '.granola-credentials.json'),
  'sync:linear': path.join(process.cwd(), '.linear-sync-state.json'),
  'sync:slack': path.join(process.cwd(), '.slack-sync-state.json'),
};

/**
 * Read the legacy dotfile for a connector.
 * For Granola, extracts only the sync state field (last_synced_at),
 * leaving credentials in the file.
 */
async function readLegacyFile(key: SyncStateKey): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(LEGACY_PATHS[key], 'utf-8');
    const parsed = JSON.parse(content);

    // Granola's file has credentials mixed in — only extract sync state
    if (key === 'sync:granola') {
      if (parsed.last_synced_at) {
        return { lastSyncedAt: parsed.last_synced_at };
      }
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Get sync state for a connector from the database.
 * Falls back to reading the legacy dotfile on first run and migrates to DB.
 */
export async function getSyncState<T = Record<string, unknown>>(
  key: SyncStateKey
): Promise<T | null> {
  // 1. Try DB first
  const config = await getConfig(key as ConfigKey);
  if (config) {
    try {
      return JSON.parse(config.content) as T;
    } catch {
      return null;
    }
  }

  // 2. Fallback: try reading from legacy dotfile (one-time migration)
  const legacyState = await readLegacyFile(key);
  if (legacyState) {
    // Migrate to DB for future use
    await setSyncState(key, legacyState);
    console.log(`[SyncState] Migrated ${key} from dotfile to database`);
    return legacyState as T;
  }

  return null;
}

/**
 * Save sync state for a connector to the database.
 * Unlike user-facing configs (which version every change), sync state is
 * machine-managed and updates in-place to avoid row accumulation (~384/day).
 */
export async function setSyncState(
  key: SyncStateKey,
  state: Record<string, unknown>
): Promise<void> {
  const current = await getConfig(key as ConfigKey);

  if (current) {
    // Update existing row in-place — no versioning needed for machine state
    await db
      .update(configs)
      .set({
        content: JSON.stringify(state),
        createdAt: new Date(),
      })
      .where(
        and(
          eq(configs.key, key as ConfigKey),
          eq(configs.version, current.version)
        )
      );
  } else {
    // First write — create the row
    await db
      .insert(configs)
      .values({
        key: key as ConfigKey,
        content: JSON.stringify(state),
        version: 1,
        createdBy: 'system',
      });
  }
}
