import { promises as fs } from 'fs';
import path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'memory');

/**
 * User's timezone for all date operations.
 * Defaults to America/Los_Angeles (PST/PDT).
 * Set USER_TIMEZONE env var to override.
 */
const USER_TIMEZONE = process.env.USER_TIMEZONE || 'America/Los_Angeles';

/**
 * Get date string in YYYY-MM-DD format using USER's timezone.
 * Important: Always use explicit timezone to avoid server timezone mismatches.
 */
function getLocalDateString(date: Date = new Date()): string {
  // Use Intl.DateTimeFormat to get date parts in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale gives us YYYY-MM-DD format directly
  return formatter.format(date);
}

/**
 * Get current hour in user's timezone (0-23)
 */
function getCurrentHour(): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

function getTodayFilename(): string {
  return `${getLocalDateString()}.md`;
}

function getTodayPath(): string {
  return path.join(MEMORY_DIR, getTodayFilename());
}

export async function ensureMemoryDir(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

export async function appendToDailyNote(content: string): Promise<void> {
  await ensureMemoryDir();
  const filepath = getTodayPath();

  const timestamp = new Date().toLocaleTimeString('en-US', {
    timeZone: USER_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const entry = `\n## ${timestamp}\n\n${content}\n`;

  // Check if file exists
  try {
    await fs.access(filepath);
    // Append to existing file
    await fs.appendFile(filepath, entry);
  } catch {
    // Create new file with header
    const header = `# ${new Date().toLocaleDateString('en-US', {
      timeZone: USER_TIMEZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}\n`;
    await fs.writeFile(filepath, header + entry);
  }
}

export async function readDailyNote(date?: string): Promise<string | null> {
  const filename = date ? `${date}.md` : getTodayFilename();
  const filepath = path.join(MEMORY_DIR, filename);

  try {
    return await fs.readFile(filepath, 'utf-8');
  } catch {
    return null;
  }
}

export async function listDailyNotes(): Promise<string[]> {
  await ensureMemoryDir();
  const files = await fs.readdir(MEMORY_DIR);
  return files
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse();
}

export interface RecentNotesOptions {
  /** Maximum approximate tokens (chars / 4). Default 2000 tokens (~8000 chars) */
  maxTokens?: number;
}

/**
 * Get recent daily notes for direct inclusion in chat context.
 *
 * Returns today's notes, plus yesterday's if it's before noon.
 * This provides a "rolling 24 hours" of context without waiting for QMD reindex.
 *
 * @returns Formatted string with date headers, or null if no notes exist
 */
export async function getRecentNotes(options: RecentNotesOptions = {}): Promise<string | null> {
  const maxTokens = options.maxTokens ?? 2000;
  const maxChars = maxTokens * 4; // Rough approximation

  const now = new Date();
  const currentHour = getCurrentHour();
  const today = getLocalDateString(now);

  // Get yesterday's date (in local timezone)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const sections: string[] = [];

  // Read today's notes
  const todayContent = await readDailyNote(today);
  if (todayContent) {
    sections.push(todayContent);
  }

  // Include yesterday if before noon (rolling 24h window)
  if (currentHour < 12) {
    const yesterdayContent = await readDailyNote(yesterdayStr);
    if (yesterdayContent) {
      // Prepend yesterday's content (chronological order)
      sections.unshift(yesterdayContent);
    }
  }

  if (sections.length === 0) {
    return null;
  }

  let combined = sections.join('\n\n---\n\n');

  // Truncate from the beginning (oldest) if too long
  if (combined.length > maxChars) {
    // Find a good truncation point (after a ## heading)
    const truncated = combined.slice(-maxChars);
    const headingMatch = truncated.match(/\n## /);
    if (headingMatch && headingMatch.index !== undefined) {
      combined = '...(earlier entries truncated)...\n' + truncated.slice(headingMatch.index + 1);
    } else {
      combined = '...(earlier entries truncated)...\n' + truncated;
    }
  }

  return combined;
}
