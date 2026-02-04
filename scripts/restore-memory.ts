#!/usr/bin/env npx tsx
/**
 * Restore Memory - Restore from a backup archive
 *
 * Usage:
 *   npx tsx scripts/restore-memory.ts                    # List available backups
 *   npx tsx scripts/restore-memory.ts 2026-02-03         # Restore from specific date
 *   npx tsx scripts/restore-memory.ts backups/2026-02-03.tar.gz  # Restore from path
 */

require('dotenv').config({ path: '.env.local' });

import * as path from 'path';
import { promises as fs } from 'fs';

async function main() {
  const { restoreBackup, getBackupInfo } = await import('../src/lib/memory/backup');

  const arg = process.argv[2];

  // No arg - list available backups
  if (!arg) {
    console.log('📦 Available backups:\n');
    const info = await getBackupInfo();

    if (info.backups.length === 0) {
      console.log('  No backups found.\n');
      console.log('Backups are created automatically by heartbeat (once per day).');
      process.exit(0);
    }

    for (const backup of info.backups) {
      const sizeKB = (backup.size / 1024).toFixed(1);
      console.log(`  ${backup.date}  (${sizeKB} KB)`);
    }

    console.log(`\nTo restore, run:`);
    console.log(`  npx tsx scripts/restore-memory.ts ${info.backups[0].date}\n`);
    process.exit(0);
  }

  // Get backup repo info
  const info = await getBackupInfo();

  // Determine backup path
  let backupPath: string;
  if (arg.endsWith('.tar.gz')) {
    // Resolve relative paths
    backupPath = path.resolve(arg);
  } else {
    // Assume it's a date - use the configured backup repo path
    backupPath = path.join(info.repoPath, `${arg}.tar.gz`);
  }

  // Check if backup exists BEFORE the countdown
  try {
    await fs.access(backupPath);
  } catch {
    console.error(`❌ Backup not found: ${backupPath}\n`);
    console.log('Available backups:');
    for (const backup of info.backups) {
      console.log(`  ${backup.date}`);
    }
    process.exit(1);
  }

  console.log(`⚠️  This will OVERWRITE all current memory data with backup from:`);
  console.log(`   ${backupPath}\n`);
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  // 5 second countdown
  for (let i = 5; i > 0; i--) {
    process.stdout.write(`${i}... `);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n');

  console.log('🔄 Restoring...\n');
  const result = await restoreBackup(backupPath);

  if (result.success) {
    console.log('✅ Restore complete!\n');
    console.log('Restored:');
    console.log(`  Entities:       ${result.stats?.entities}`);
    console.log(`  Facts:          ${result.stats?.facts}`);
    console.log(`  Conversations:  ${result.stats?.conversations}`);
    console.log(`  Documents:      ${result.stats?.documents}`);
    console.log(`  Doc Chunks:     ${result.stats?.documentChunks}`);
  } else {
    console.error('❌ Restore failed:', result.error);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
