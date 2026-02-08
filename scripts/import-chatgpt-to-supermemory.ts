/**
 * Import ChatGPT history memories into Supermemory.
 * Logs all IDs to a manifest file for easy rollback.
 *
 * Run: npx tsx scripts/import-chatgpt-to-supermemory.ts
 * Dry run: npx tsx scripts/import-chatgpt-to-supermemory.ts --dry-run
 * Rollback: npx tsx scripts/import-chatgpt-to-supermemory.ts --rollback
 */

require('dotenv').config({ path: '.env.local' });

import Supermemory from 'supermemory';
import { promises as fs } from 'fs';
import path from 'path';

const INPUT_FILE = path.join(
  process.env.HOME || '',
  'Desktop/ChatGPT File Jan 31 2026/supermemory_import_fixed.json'
);
const MANIFEST_FILE = path.join(
  process.cwd(),
  'docs/research/supermemory-import-manifest.json'
);

const CONTAINER_TAG = process.env.SUPERMEMORY_CONTAINER_TAG || 'default';
const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');
const DELAY_MS = 200; // rate limit safety

interface ImportItem {
  content: string;
  containerTag: string;
  metadata: Record<string, unknown>;
}

interface ManifestEntry {
  supermemoryId: string;
  customId: string;
  content: string;
  category: string;
  originalDateTag: string;
}

async function doImport() {
  const raw = await fs.readFile(INPUT_FILE, 'utf-8');
  const items: ImportItem[] = JSON.parse(raw);

  console.log(`=== IMPORT ${items.length} MEMORIES TO SUPERMEMORY ===\n`);

  if (DRY_RUN) {
    console.log('(DRY RUN — nothing will be sent)\n');
    console.log(`Input: ${INPUT_FILE}`);
    console.log(`Manifest will be saved to: ${MANIFEST_FILE}\n`);

    const categories = new Map<string, number>();
    for (const item of items) {
      const cat = String(item.metadata.category || 'unknown');
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }
    for (const [cat, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log(`\nTotal: ${items.length} items`);
    console.log('Run without --dry-run to execute.');
    return;
  }

  const client = new Supermemory();
  const manifest: ManifestEntry[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const customId = `chatgpt-import-${i}`;
    const category = String(item.metadata.category || 'unknown');
    const dateTag = String(item.metadata.original_date_tag || 'unknown');

    // Flatten metadata to allowed types
    const metadata: Record<string, string | number | boolean> = {
      source: 'chatgpt_history_import',
      category,
      temporal_type: String(item.metadata.temporal_type || ''),
      original_date: String(item.metadata.timestamp || ''),
    };

    try {
      const result = await client.add({
        content: item.content,
        containerTag: CONTAINER_TAG,
        customId,
        metadata,
      });

      manifest.push({
        supermemoryId: result.id,
        customId,
        content: item.content.slice(0, 80),
        category,
        originalDateTag: dateTag,
      });

      succeeded++;
      if (i % 25 === 0 || i === items.length - 1) {
        console.log(`  [${i + 1}/${items.length}] ${succeeded} ok, ${failed} failed`);
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      console.error(`  FAILED [${i}]: ${item.content.slice(0, 60)}... — ${err}`);
      failed++;
    }
  }

  // Write manifest
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  console.log(`\n=== DONE ===`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Manifest: ${MANIFEST_FILE} (${manifest.length} entries)`);
}

async function doRollback() {
  let raw: string;
  try {
    raw = await fs.readFile(MANIFEST_FILE, 'utf-8');
  } catch {
    console.error(`No manifest found at ${MANIFEST_FILE}`);
    process.exit(1);
  }

  const manifest: ManifestEntry[] = JSON.parse(raw);
  console.log(`=== ROLLBACK: DELETE ${manifest.length} MEMORIES ===\n`);

  const client = new Supermemory();
  let deleted = 0;
  let failed = 0;

  for (const entry of manifest) {
    try {
      await client.memories.delete(entry.supermemoryId);
      deleted++;
      if (deleted % 25 === 0) {
        console.log(`  Deleted ${deleted}/${manifest.length}...`);
      }
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`  FAILED to delete ${entry.supermemoryId}: ${err}`);
      failed++;
    }
  }

  console.log(`\n=== ROLLBACK DONE ===`);
  console.log(`Deleted: ${deleted}, Failed: ${failed}`);
}

(ROLLBACK ? doRollback() : doImport()).catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
