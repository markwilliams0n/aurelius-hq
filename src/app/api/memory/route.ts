import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const LIFE_DIR = path.join(process.cwd(), 'life');
const MEMORY_DIR = path.join(process.cwd(), 'memory');

async function countEntitiesInDir(dirPath: string): Promise<number> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    return items.filter(i => i.isDirectory() && !i.name.startsWith('_')).length;
  } catch {
    return 0;
  }
}

async function listDailyNotes(): Promise<string[]> {
  try {
    const files = await fs.readdir(MEMORY_DIR);
    return files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function GET() {
  const [people, companies, projects, resources, dailyNotes] = await Promise.all([
    countEntitiesInDir(path.join(LIFE_DIR, 'areas/people')),
    countEntitiesInDir(path.join(LIFE_DIR, 'areas/companies')),
    countEntitiesInDir(path.join(LIFE_DIR, 'projects')),
    countEntitiesInDir(path.join(LIFE_DIR, 'resources')),
    listDailyNotes(),
  ]);

  return NextResponse.json({
    counts: {
      people,
      companies,
      projects,
      resources,
      dailyNotes: dailyNotes.length,
      total: people + companies + projects + resources,
    },
    recentNotes: dailyNotes.slice(0, 7),
    structure: [
      { name: 'Projects', path: 'projects', count: projects, icon: 'briefcase' },
      { name: 'People', path: 'areas/people', count: people, icon: 'user' },
      { name: 'Companies', path: 'areas/companies', count: companies, icon: 'building' },
      { name: 'Resources', path: 'resources', count: resources, icon: 'book' },
    ],
  });
}
