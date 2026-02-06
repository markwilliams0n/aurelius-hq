/**
 * One-time migration: Seed Supermemory with existing entity knowledge from life/ directory.
 *
 * Run with: npx tsx scripts/seed-supermemory.ts
 * Optional: --dry-run to preview without sending
 */

require('dotenv').config({ path: '.env.local' });

import { promises as fs } from 'fs';
import path from 'path';

const LIFE_DIR = path.join(process.cwd(), 'life');
const DRY_RUN = process.argv.includes('--dry-run');

interface EntityInfo {
  name: string;
  type: string;
  dirPath: string;
  summary: string | null;
  facts: string[];
}

const ENTITY_DIRS = [
  { path: 'areas/people', type: 'person' },
  { path: 'areas/companies', type: 'company' },
  { path: 'projects', type: 'project' },
  { path: 'resources', type: 'resource' },
];

async function discoverEntities(): Promise<EntityInfo[]> {
  const entities: EntityInfo[] = [];

  for (const { path: entityPath, type } of ENTITY_DIRS) {
    const dirPath = path.join(LIFE_DIR, entityPath);

    let items;
    try {
      items = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue; // Directory doesn't exist
    }

    for (const item of items) {
      if (!item.isDirectory() || item.name.startsWith('_')) continue;

      const entityDir = path.join(dirPath, item.name);
      const name = item.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      // Read summary
      let summary: string | null = null;
      try {
        const content = await fs.readFile(path.join(entityDir, 'summary.md'), 'utf-8');
        const match = content.match(/## Summary\n\n([\s\S]*?)(?=\n##|$)/);
        summary = match ? match[1].trim() : null;
      } catch { /* no summary */ }

      // Read facts
      const facts: string[] = [];
      try {
        const content = await fs.readFile(path.join(entityDir, 'items.json'), 'utf-8');
        const items = JSON.parse(content);
        for (const f of items) {
          if (f.status === 'active' && f.fact) {
            facts.push(f.fact);
          }
        }
      } catch { /* no items */ }

      entities.push({ name, type, dirPath: entityDir, summary, facts });
    }
  }

  return entities;
}

function formatEntityContent(entity: EntityInfo): string {
  const lines: string[] = [];
  lines.push(`Entity: ${entity.name}`);
  lines.push(`Type: ${entity.type}`);

  if (entity.summary) {
    lines.push(`Summary: ${entity.summary}`);
  }

  if (entity.facts.length > 0) {
    lines.push('Facts:');
    for (const fact of entity.facts) {
      lines.push(`- ${fact}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  console.log('='.repeat(60));
  console.log('SEED SUPERMEMORY WITH EXISTING KNOWLEDGE');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('(DRY RUN - no data will be sent)\n');
  }

  if (!process.env.SUPERMEMORY_API_KEY) {
    console.error('SUPERMEMORY_API_KEY not set in .env.local');
    process.exit(1);
  }

  const entities = await discoverEntities();
  console.log(`Found ${entities.length} entities to seed\n`);

  if (entities.length === 0) {
    console.log('No entities found in life/ directory.');
    return;
  }

  // Dynamic import after env is loaded
  const { addMemory } = await import('../src/lib/memory/supermemory');

  let succeeded = 0;
  let failed = 0;

  for (const entity of entities) {
    const content = formatEntityContent(entity);

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would seed: ${entity.name} (${entity.type}) - ${entity.facts.length} facts`);
      console.log(`  Content preview: ${content.slice(0, 120)}...`);
      succeeded++;
      continue;
    }

    try {
      await addMemory(content, { source: 'migration', entityType: entity.type });
      console.log(`  Seeded: ${entity.name} (${entity.type}) - ${entity.facts.length} facts`);
      succeeded++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`  FAILED: ${entity.name} - ${error}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Done. Succeeded: ${succeeded}, Failed: ${failed}`);
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
