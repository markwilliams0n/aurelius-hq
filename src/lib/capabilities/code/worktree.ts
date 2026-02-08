/**
 * Git Worktree Management
 *
 * Manages isolated git worktrees for Claude Code sessions.
 * Each session gets its own worktree on a dedicated branch, so edits
 * never touch the main working copy where the dev server runs.
 *
 * Worktrees live at ../aurelius-worktrees/<sessionId> relative to the repo root.
 */

import * as path from 'path';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const WORKTREE_BASE = path.resolve(REPO_ROOT, '..', 'aurelius-worktrees');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  path: string;
  branchName: string;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command with spawnSync (no shell interpolation).
 * Returns stdout on success, throws on failure.
 */
function git(args: string[], cwd: string = REPO_ROOT): string {
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() || 'Unknown git error';
    throw new Error(`git ${args[0]} failed: ${stderr}`);
  }

  return result.stdout?.toString() ?? '';
}

/**
 * Run a git command that may legitimately fail (e.g. diff --quiet).
 * Returns { status, stdout, stderr } without throwing.
 */
function gitMaybe(args: string[], cwd: string = REPO_ROOT) {
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a git worktree on a new branch checked out from main.
 *
 * The worktree is placed at `WORKTREE_BASE/<sessionId>`.
 * The branch is named as provided (caller handles prefixing).
 */
export function createWorktree(branchName: string, sessionId: string): WorktreeInfo {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists at ${worktreePath}`);
  }

  mkdirSync(WORKTREE_BASE, { recursive: true });

  // Fetch latest main so we branch from the freshest commit
  gitMaybe(['fetch', 'origin', 'main'], REPO_ROOT);

  // Use origin/main if available, otherwise fall back to main
  const baseRef = gitMaybe(['rev-parse', '--verify', 'origin/main'], REPO_ROOT).status === 0
    ? 'origin/main'
    : 'main';

  git(['worktree', 'add', '-b', branchName, worktreePath, baseRef], REPO_ROOT);

  return { path: worktreePath, branchName };
}

/**
 * Get the full diff between the worktree branch and main.
 */
export function getWorktreeDiff(worktreePath: string): string {
  // diff against main from inside the worktree
  return git(['diff', 'main...HEAD'], worktreePath);
}

/**
 * Get summary statistics of changes vs main.
 */
export function getWorktreeStats(worktreePath: string): DiffStats {
  const raw = git(['diff', '--stat', 'main...HEAD'], worktreePath);

  // The last line of --stat output looks like:
  //  3 files changed, 42 insertions(+), 7 deletions(-)
  // or it may be empty if there are no changes.
  const lines = raw.trim().split('\n');
  const summaryLine = lines[lines.length - 1] || '';

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  const filesMatch = summaryLine.match(/(\d+) files? changed/);
  if (filesMatch) filesChanged = parseInt(filesMatch[1], 10);

  const insMatch = summaryLine.match(/(\d+) insertions?\(\+\)/);
  if (insMatch) insertions = parseInt(insMatch[1], 10);

  const delMatch = summaryLine.match(/(\d+) deletions?\(-\)/);
  if (delMatch) deletions = parseInt(delMatch[1], 10);

  return {
    filesChanged,
    insertions,
    deletions,
    summary: summaryLine.trim(),
  };
}

/**
 * List files changed in the worktree branch vs main.
 */
export function getChangedFiles(worktreePath: string): string[] {
  const raw = git(['diff', '--name-only', 'main...HEAD'], worktreePath);
  if (!raw.trim()) return [];
  return raw.trim().split('\n');
}

/**
 * Get the commit log since the branch diverged from main.
 */
export function getWorktreeLog(worktreePath: string): string {
  return git(['log', '--oneline', 'main..HEAD'], worktreePath);
}

/**
 * Fast-forward merge the worktree branch into main, then clean up.
 *
 * Uses --ff-only so it will fail if the merge isn't a clean fast-forward.
 * After a successful merge the worktree and branch are removed.
 */
export function mergeWorktree(worktreePath: string, branchName: string): void {
  // Merge into main from the main repo working directory
  try {
    git(['merge', '--ff-only', branchName], REPO_ROOT);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Fast-forward merge of ${branchName} into main failed. ` +
      `This usually means main has advanced since the branch was created. ` +
      `You may need to rebase first.\n\nOriginal error: ${msg}`
    );
  }

  // Clean up worktree and branch after successful merge
  cleanupWorktree(worktreePath, branchName);
}

/**
 * Remove a worktree and delete its branch.
 */
export function cleanupWorktree(worktreePath: string, branchName: string): void {
  // Remove the worktree (--force handles uncommitted changes)
  gitMaybe(['worktree', 'remove', '--force', worktreePath], REPO_ROOT);

  // Delete the branch
  gitMaybe(['branch', '-D', branchName], REPO_ROOT);
}

/**
 * Check whether a worktree exists for the given session ID.
 */
export function worktreeExists(sessionId: string): boolean {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);
  return existsSync(worktreePath);
}
