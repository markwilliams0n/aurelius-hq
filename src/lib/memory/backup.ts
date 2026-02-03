/**
 * Memory Backup System
 *
 * Creates daily backups of all memory data (files + database).
 * Keeps last N days of backups, automatically pruning older ones.
 *
 * Supports pushing to a separate git repo for offsite backup:
 * - BACKUP_REPO_PATH: Path to backup git repo (e.g., ~/Claude Code/aurelius-backups)
 * - BACKUP_GITHUB_TOKEN: GitHub PAT for pushing (repo scope)
 * - BACKUP_GITHUB_REPO: GitHub repo (e.g., username/aurelius-backups)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { db } from '@/lib/db';
import { entities, facts, conversations, documents, documentChunks } from '@/lib/db/schema';

const ROOT = process.cwd();
const LIFE_DIR = path.join(ROOT, 'life');
const MEMORY_DIR = path.join(ROOT, 'memory');

// How many daily backups to keep
const RETENTION_DAYS = 7;

/**
 * Get the backup directory path.
 * Uses BACKUP_REPO_PATH env var if set, otherwise falls back to local backups/
 */
function getBackupsDir(): string {
  const envPath = process.env.BACKUP_REPO_PATH;
  if (envPath) {
    // Expand ~ to home directory
    if (envPath.startsWith('~')) {
      return path.join(process.env.HOME || '', envPath.slice(1));
    }
    return envPath;
  }
  return path.join(ROOT, 'backups');
}

/**
 * Check if git push is configured
 */
function isGitPushConfigured(): boolean {
  return !!(process.env.BACKUP_REPO_PATH && process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_GITHUB_REPO);
}

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  skipped?: boolean;
  reason?: string;
  pushed?: boolean;
  stats?: {
    entities: number;
    facts: number;
    conversations: number;
    documents: number;
    documentChunks: number;
    filesCopied: number;
  };
  error?: string;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Check if a backup already exists for today
 */
async function backupExistsForToday(): Promise<boolean> {
  const backupsDir = getBackupsDir();
  const today = getTodayDate();
  const backupPath = path.join(backupsDir, `${today}.tar.gz`);
  try {
    await fs.access(backupPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all existing backups sorted by date (newest first)
 */
async function listBackups(): Promise<string[]> {
  const backupsDir = getBackupsDir();
  try {
    const files = await fs.readdir(backupsDir);
    return files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.tar\.gz$/))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Prune old backups, keeping only the most recent N
 */
async function pruneOldBackups(): Promise<number> {
  const backupsDir = getBackupsDir();
  const backups = await listBackups();
  const toDelete = backups.slice(RETENTION_DAYS);

  for (const backup of toDelete) {
    await fs.unlink(path.join(backupsDir, backup));
  }

  return toDelete.length;
}

/**
 * Initialize the backup repo if it doesn't exist
 */
async function ensureBackupRepo(): Promise<void> {
  const backupsDir = getBackupsDir();
  await fs.mkdir(backupsDir, { recursive: true });

  // Check if it's a git repo
  const gitDir = path.join(backupsDir, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    // Initialize git repo
    console.log('[Backup] Initializing backup repository...');
    execSync('git init', { cwd: backupsDir, stdio: 'pipe' });

    // Create .gitignore for staging directories
    await fs.writeFile(path.join(backupsDir, '.gitignore'), '.staging-*\n.restore-staging\n');

    // Initial commit
    execSync('git add .gitignore && git commit -m "Initial commit"', { cwd: backupsDir, stdio: 'pipe' });
  }
}

/**
 * Set up the remote if configured and not already set
 */
async function ensureRemote(): Promise<void> {
  if (!isGitPushConfigured()) return;

  const backupsDir = getBackupsDir();
  const token = process.env.BACKUP_GITHUB_TOKEN;
  const repo = process.env.BACKUP_GITHUB_REPO;

  // Check if remote exists
  try {
    execSync('git remote get-url origin', { cwd: backupsDir, stdio: 'pipe' });
  } catch {
    // Add remote with token auth
    const remoteUrl = `https://${token}@github.com/${repo}.git`;
    execSync(`git remote add origin "${remoteUrl}"`, { cwd: backupsDir, stdio: 'pipe' });
    console.log('[Backup] Added GitHub remote');
  }
}

/**
 * Commit and push the backup to GitHub
 */
async function commitAndPush(backupFile: string): Promise<boolean> {
  if (!isGitPushConfigured()) return false;

  const backupsDir = getBackupsDir();
  const today = getTodayDate();

  try {
    await ensureRemote();

    // Stage the backup file
    execSync(`git add "${backupFile}"`, { cwd: backupsDir, stdio: 'pipe' });

    // Also stage any deletions (pruned backups)
    execSync('git add -A', { cwd: backupsDir, stdio: 'pipe' });

    // Check if there's anything to commit
    try {
      execSync('git diff --cached --quiet', { cwd: backupsDir, stdio: 'pipe' });
      // No changes to commit
      return true;
    } catch {
      // There are changes, proceed with commit
    }

    // Commit
    execSync(`git commit -m "Backup ${today}"`, { cwd: backupsDir, stdio: 'pipe' });

    // Push
    console.log('[Backup] Pushing to GitHub...');
    execSync('git push -u origin main 2>&1 || git push -u origin master 2>&1', {
      cwd: backupsDir,
      stdio: 'pipe',
    });

    console.log('[Backup] Pushed to GitHub');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Backup] Git push failed:', errMsg);
    return false;
  }
}

/**
 * Export database tables to JSON files in a directory
 */
async function exportDatabase(targetDir: string): Promise<{
  entities: number;
  facts: number;
  conversations: number;
  documents: number;
  documentChunks: number;
}> {
  const dbDir = path.join(targetDir, 'db');
  await fs.mkdir(dbDir, { recursive: true });

  // Export each table
  const entitiesData = await db.select().from(entities);
  await fs.writeFile(path.join(dbDir, 'entities.json'), JSON.stringify(entitiesData, null, 2));

  const factsData = await db.select().from(facts);
  await fs.writeFile(path.join(dbDir, 'facts.json'), JSON.stringify(factsData, null, 2));

  const conversationsData = await db.select().from(conversations);
  await fs.writeFile(path.join(dbDir, 'conversations.json'), JSON.stringify(conversationsData, null, 2));

  const documentsData = await db.select().from(documents);
  await fs.writeFile(path.join(dbDir, 'documents.json'), JSON.stringify(documentsData, null, 2));

  const chunksData = await db.select().from(documentChunks);
  await fs.writeFile(path.join(dbDir, 'documentChunks.json'), JSON.stringify(chunksData, null, 2));

  return {
    entities: entitiesData.length,
    facts: factsData.length,
    conversations: conversationsData.length,
    documents: documentsData.length,
    documentChunks: chunksData.length,
  };
}

/**
 * Copy a directory recursively
 */
async function copyDir(src: string, dest: string): Promise<number> {
  let count = 0;

  try {
    await fs.access(src);
  } catch {
    return 0; // Source doesn't exist
  }

  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // Skip hidden files

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      count++;
    }
  }

  return count;
}

/**
 * Create a backup of all memory data.
 *
 * @param force - If true, create backup even if one exists for today
 * @returns BackupResult with details about what was backed up
 */
export async function createBackup(force = false): Promise<BackupResult> {
  const backupsDir = getBackupsDir();
  const today = getTodayDate();

  // Check if backup already exists for today
  if (!force && await backupExistsForToday()) {
    return {
      success: true,
      skipped: true,
      reason: `Backup already exists for ${today}`,
    };
  }

  // Create temp directory for staging
  const stagingDir = path.join(backupsDir, `.staging-${today}`);

  try {
    await ensureBackupRepo();
    await fs.mkdir(stagingDir, { recursive: true });

    // Export database
    console.log('[Backup] Exporting database...');
    const dbStats = await exportDatabase(stagingDir);

    // Copy file-based storage
    console.log('[Backup] Copying files...');
    let filesCopied = 0;

    // Copy life/ directory
    filesCopied += await copyDir(LIFE_DIR, path.join(stagingDir, 'life'));

    // Copy memory/ directory
    filesCopied += await copyDir(MEMORY_DIR, path.join(stagingDir, 'memory'));

    // Create tarball
    const tarballName = `${today}.tar.gz`;
    const tarballPath = path.join(backupsDir, tarballName);
    console.log('[Backup] Creating archive...');
    execSync(`tar -czf "${tarballPath}" -C "${stagingDir}" .`, { stdio: 'pipe' });

    // Cleanup staging directory
    await fs.rm(stagingDir, { recursive: true, force: true });

    // Prune old backups
    const pruned = await pruneOldBackups();
    if (pruned > 0) {
      console.log(`[Backup] Pruned ${pruned} old backup(s)`);
    }

    console.log(`[Backup] Created ${tarballName}`);

    // Push to GitHub if configured
    let pushed = false;
    if (isGitPushConfigured()) {
      pushed = await commitAndPush(tarballName);
    }

    return {
      success: true,
      backupPath: tarballPath,
      pushed,
      stats: {
        ...dbStats,
        filesCopied,
      },
    };
  } catch (error) {
    // Cleanup staging on error
    try {
      await fs.rm(stagingDir, { recursive: true, force: true });
    } catch {}

    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errMsg,
    };
  }
}

/**
 * Restore memory data from a backup archive.
 *
 * WARNING: This will overwrite all current memory data!
 *
 * @param backupPath - Path to the .tar.gz backup file
 */
export async function restoreBackup(backupPath: string): Promise<{
  success: boolean;
  error?: string;
  stats?: {
    entities: number;
    facts: number;
    conversations: number;
    documents: number;
    documentChunks: number;
  };
}> {
  const backupsDir = getBackupsDir();

  // Verify backup exists
  try {
    await fs.access(backupPath);
  } catch {
    return { success: false, error: `Backup not found: ${backupPath}` };
  }

  const stagingDir = path.join(backupsDir, '.restore-staging');

  try {
    // Extract to staging
    await fs.mkdir(stagingDir, { recursive: true });
    execSync(`tar -xzf "${backupPath}" -C "${stagingDir}"`, { stdio: 'pipe' });

    // Restore database tables (clear existing, insert from backup)
    console.log('[Restore] Restoring database...');

    // Clear existing data (order matters for foreign keys)
    await db.delete(documentChunks);
    await db.delete(documents);
    await db.delete(facts);
    await db.delete(entities);
    await db.delete(conversations);

    // Load and insert backup data
    const dbDir = path.join(stagingDir, 'db');

    const entitiesData = JSON.parse(await fs.readFile(path.join(dbDir, 'entities.json'), 'utf-8'));
    if (entitiesData.length > 0) {
      await db.insert(entities).values(entitiesData);
    }

    const factsData = JSON.parse(await fs.readFile(path.join(dbDir, 'facts.json'), 'utf-8'));
    if (factsData.length > 0) {
      await db.insert(facts).values(factsData);
    }

    const conversationsData = JSON.parse(await fs.readFile(path.join(dbDir, 'conversations.json'), 'utf-8'));
    if (conversationsData.length > 0) {
      await db.insert(conversations).values(conversationsData);
    }

    const documentsData = JSON.parse(await fs.readFile(path.join(dbDir, 'documents.json'), 'utf-8'));
    if (documentsData.length > 0) {
      await db.insert(documents).values(documentsData);
    }

    const chunksData = JSON.parse(await fs.readFile(path.join(dbDir, 'documentChunks.json'), 'utf-8'));
    if (chunksData.length > 0) {
      await db.insert(documentChunks).values(chunksData);
    }

    // Restore files
    console.log('[Restore] Restoring files...');

    // Clear and restore life/ directory contents (keep structure)
    const lifeStagingDir = path.join(stagingDir, 'life');
    try {
      await fs.access(lifeStagingDir);
      // Clear existing entity folders
      for (const subdir of ['areas/people', 'areas/companies', 'projects']) {
        const fullPath = path.join(LIFE_DIR, subdir);
        const entries = await fs.readdir(fullPath).catch(() => []);
        for (const entry of entries) {
          if (!entry.startsWith('_') && !entry.startsWith('.')) {
            await fs.rm(path.join(fullPath, entry), { recursive: true, force: true });
          }
        }
      }
      // Copy from backup
      await copyDir(lifeStagingDir, LIFE_DIR);
    } catch {}

    // Clear and restore memory/ directory
    const memoryStagingDir = path.join(stagingDir, 'memory');
    try {
      await fs.access(memoryStagingDir);
      // Clear existing daily notes
      const memoryEntries = await fs.readdir(MEMORY_DIR).catch(() => []);
      for (const entry of memoryEntries) {
        if (entry.endsWith('.md')) {
          await fs.unlink(path.join(MEMORY_DIR, entry));
        }
      }
      // Copy from backup
      await copyDir(memoryStagingDir, MEMORY_DIR);
    } catch {}

    // Cleanup
    await fs.rm(stagingDir, { recursive: true, force: true });

    console.log('[Restore] Complete');

    return {
      success: true,
      stats: {
        entities: entitiesData.length,
        facts: factsData.length,
        conversations: conversationsData.length,
        documents: documentsData.length,
        documentChunks: chunksData.length,
      },
    };
  } catch (error) {
    // Cleanup on error
    try {
      await fs.rm(stagingDir, { recursive: true, force: true });
    } catch {}

    const errMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMsg };
  }
}

/**
 * Get information about available backups
 */
export async function getBackupInfo(): Promise<{
  backups: Array<{ date: string; path: string; size: number }>;
  retentionDays: number;
  repoPath: string;
  gitPushEnabled: boolean;
}> {
  const backupsDir = getBackupsDir();
  const backupFiles = await listBackups();
  const backups = await Promise.all(
    backupFiles.map(async (file) => {
      const filePath = path.join(backupsDir, file);
      const stats = await fs.stat(filePath);
      return {
        date: file.replace('.tar.gz', ''),
        path: filePath,
        size: stats.size,
      };
    })
  );

  return {
    backups,
    retentionDays: RETENTION_DAYS,
    repoPath: backupsDir,
    gitPushEnabled: isGitPushConfigured(),
  };
}
