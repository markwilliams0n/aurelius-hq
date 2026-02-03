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
import { spawnSync } from 'child_process';
import { db } from '@/lib/db';
import { entities, facts, conversations, documents, documentChunks } from '@/lib/db/schema';

const ROOT = process.cwd();
const LIFE_DIR = path.join(ROOT, 'life');
const MEMORY_DIR = path.join(ROOT, 'memory');

// How many daily backups to keep
const RETENTION_DAYS = 7;

/**
 * Validate a path to prevent command injection.
 * Since we use spawnSync with array args, this is mostly redundant,
 * but we still reject obvious shell metacharacters as defense in depth.
 */
function isValidPath(p: string): boolean {
  // Reject null bytes and obvious shell metacharacters
  // Allow everything else (including non-ASCII, parentheses, etc.)
  return !/[\0`$|;&]/.test(p);
}

/**
 * Run a command safely with spawnSync (no shell interpolation)
 */
function runCommand(cmd: string, args: string[], cwd?: string): { success: boolean; error?: string } {
  const result = spawnSync(cmd, args, { cwd, stdio: 'pipe' });
  if (result.status !== 0) {
    return { success: false, error: result.stderr?.toString() || 'Command failed' };
  }
  return { success: true };
}

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
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
function getTodayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
    runCommand('git', ['init'], backupsDir);

    // Create .gitignore for staging directories
    await fs.writeFile(path.join(backupsDir, '.gitignore'), '.staging-*\n.restore-staging\n');

    // Initial commit
    runCommand('git', ['add', '.gitignore'], backupsDir);
    runCommand('git', ['commit', '-m', 'Initial commit'], backupsDir);
  }
}

/**
 * Set up the remote if not already set (without token in URL)
 */
async function ensureRemote(): Promise<void> {
  if (!isGitPushConfigured()) return;

  const backupsDir = getBackupsDir();
  const repo = process.env.BACKUP_GITHUB_REPO;

  // Check if remote exists
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: backupsDir, stdio: 'pipe' });
  if (result.status !== 0) {
    // Add remote WITHOUT token (token used only during push)
    const remoteUrl = `https://github.com/${repo}.git`;
    runCommand('git', ['remote', 'add', 'origin', remoteUrl], backupsDir);
    console.log('[Backup] Added GitHub remote');
  }
}

/**
 * Commit and push the backup to GitHub
 * Token is used inline during push only, not stored in git config
 */
async function commitAndPush(backupFile: string): Promise<boolean> {
  if (!isGitPushConfigured()) return false;

  const backupsDir = getBackupsDir();
  const today = getTodayDate();
  const token = process.env.BACKUP_GITHUB_TOKEN;
  const repo = process.env.BACKUP_GITHUB_REPO;

  try {
    await ensureRemote();

    // Stage the backup file
    runCommand('git', ['add', backupFile], backupsDir);

    // Also stage any deletions (pruned backups)
    runCommand('git', ['add', '-A'], backupsDir);

    // Check if there's anything to commit
    const diffResult = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: backupsDir, stdio: 'pipe' });
    if (diffResult.status === 0) {
      // No changes to commit
      return true;
    }

    // Commit
    runCommand('git', ['commit', '-m', `Backup ${today}`], backupsDir);

    // Push with token inline (not stored in remote URL)
    console.log('[Backup] Pushing to GitHub...');
    const pushUrl = `https://${token}@github.com/${repo}.git`;

    // Try main first, then master
    let pushResult = spawnSync('git', ['push', '-u', pushUrl, 'main'], { cwd: backupsDir, stdio: 'pipe' });
    if (pushResult.status !== 0) {
      pushResult = spawnSync('git', ['push', '-u', pushUrl, 'master'], { cwd: backupsDir, stdio: 'pipe' });
    }

    if (pushResult.status !== 0) {
      console.error('[Backup] Git push failed:', pushResult.stderr?.toString());
      return false;
    }

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

  // Export each table (no pretty-printing to save memory on large DBs)
  const entitiesData = await db.select().from(entities);
  await fs.writeFile(path.join(dbDir, 'entities.json'), JSON.stringify(entitiesData));

  const factsData = await db.select().from(facts);
  await fs.writeFile(path.join(dbDir, 'facts.json'), JSON.stringify(factsData));

  const conversationsData = await db.select().from(conversations);
  await fs.writeFile(path.join(dbDir, 'conversations.json'), JSON.stringify(conversationsData));

  const documentsData = await db.select().from(documents);
  await fs.writeFile(path.join(dbDir, 'documents.json'), JSON.stringify(documentsData));

  const chunksData = await db.select().from(documentChunks);
  await fs.writeFile(path.join(dbDir, 'documentChunks.json'), JSON.stringify(chunksData));

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
 * Verify a tarball is valid by listing its contents
 */
async function verifyTarball(tarballPath: string): Promise<boolean> {
  const result = spawnSync('tar', ['-tzf', tarballPath], { stdio: 'pipe' });
  return result.status === 0;
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

  // Validate paths
  if (!isValidPath(backupsDir)) {
    return { success: false, error: 'Invalid backup directory path' };
  }

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

    // Create tarball using spawnSync (no shell interpolation)
    const tarballName = `${today}.tar.gz`;
    const tarballPath = path.join(backupsDir, tarballName);
    console.log('[Backup] Creating archive...');

    const tarResult = spawnSync('tar', ['-czf', tarballPath, '-C', stagingDir, '.'], { stdio: 'pipe' });
    if (tarResult.status !== 0) {
      throw new Error(`tar failed: ${tarResult.stderr?.toString()}`);
    }

    // Verify the tarball is valid
    console.log('[Backup] Verifying archive...');
    if (!await verifyTarball(tarballPath)) {
      await fs.unlink(tarballPath).catch(() => {});
      throw new Error('Backup verification failed - archive corrupted');
    }

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

  // Validate and resolve path
  const resolvedPath = path.resolve(backupPath);
  if (!isValidPath(resolvedPath)) {
    return { success: false, error: 'Invalid backup path' };
  }

  // Verify backup exists
  try {
    await fs.access(resolvedPath);
  } catch {
    return { success: false, error: `Backup not found: ${resolvedPath}` };
  }

  const stagingDir = path.join(backupsDir, '.restore-staging');

  try {
    // Extract to staging using spawnSync (no shell interpolation)
    await fs.mkdir(stagingDir, { recursive: true });
    const tarResult = spawnSync('tar', ['-xzf', resolvedPath, '-C', stagingDir], { stdio: 'pipe' });
    if (tarResult.status !== 0) {
      throw new Error(`tar extraction failed: ${tarResult.stderr?.toString()}`);
    }

    // Load backup data first (before deleting anything)
    const dbDir = path.join(stagingDir, 'db');
    const entitiesData = JSON.parse(await fs.readFile(path.join(dbDir, 'entities.json'), 'utf-8'));
    const factsData = JSON.parse(await fs.readFile(path.join(dbDir, 'facts.json'), 'utf-8'));
    const conversationsData = JSON.parse(await fs.readFile(path.join(dbDir, 'conversations.json'), 'utf-8'));
    const documentsData = JSON.parse(await fs.readFile(path.join(dbDir, 'documents.json'), 'utf-8'));
    const chunksData = JSON.parse(await fs.readFile(path.join(dbDir, 'documentChunks.json'), 'utf-8'));

    // Restore database in a transaction (atomic - all or nothing)
    console.log('[Restore] Restoring database...');
    await db.transaction(async (tx) => {
      // Clear existing data (order matters for foreign keys)
      await tx.delete(documentChunks);
      await tx.delete(documents);
      await tx.delete(facts);
      await tx.delete(entities);
      await tx.delete(conversations);

      // Insert backup data
      if (entitiesData.length > 0) {
        await tx.insert(entities).values(entitiesData);
      }
      if (factsData.length > 0) {
        await tx.insert(facts).values(factsData);
      }
      if (conversationsData.length > 0) {
        await tx.insert(conversations).values(conversationsData);
      }
      if (documentsData.length > 0) {
        await tx.insert(documents).values(documentsData);
      }
      if (chunksData.length > 0) {
        await tx.insert(documentChunks).values(chunksData);
      }
    });

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
    } catch (error) {
      console.warn('[Restore] Warning: Could not fully restore life/ directory:', error);
    }

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
    } catch (error) {
      console.warn('[Restore] Warning: Could not fully restore memory/ directory:', error);
    }

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
