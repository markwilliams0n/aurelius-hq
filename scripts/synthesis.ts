#!/usr/bin/env npx tsx
/**
 * Weekly Synthesis CLI - Run manually or via cron
 *
 * Usage:
 *   npx tsx scripts/synthesis.ts   # Run once
 *
 * Recommended cron (Sunday midnight):
 *   0 0 * * 0 cd /path/to/aurelius-hq && npx tsx scripts/synthesis.ts
 */

import { runWeeklySynthesis } from '../src/lib/memory/synthesis';

async function main() {
  console.log('📊 Aurelius Weekly Synthesis');
  console.log('Processing memory decay and regenerating summaries...\n');

  try {
    const result = await runWeeklySynthesis();

    console.log('\n✓ Synthesis complete:');
    console.log(`  Entities processed: ${result.entitiesProcessed}`);
    console.log(`  Facts archived: ${result.factsArchived}`);
    console.log(`  Summaries regenerated: ${result.summariesRegenerated}`);

    if (result.errors.length > 0) {
      console.log('\n⚠ Errors:');
      result.errors.forEach(e => console.log(`  - ${e}`));
    }
  } catch (error) {
    console.error('✗ Synthesis failed:', error);
    process.exit(1);
  }
}

main();
