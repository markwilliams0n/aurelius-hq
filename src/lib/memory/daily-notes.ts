import { promises as fs } from 'fs';
import path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'memory');

function getTodayFilename(): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${today}.md`;
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
