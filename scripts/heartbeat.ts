#!/usr/bin/env npx tsx
/**
 * Heartbeat CLI - Run manually or via cron
 *
 * Usage:
 *   npx tsx scripts/heartbeat.ts        # Run once
 *   npx tsx scripts/heartbeat.ts --loop # Run every 2 minutes
 */

import { runHeartbeat } from '../src/lib/memory/heartbeat';

const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

async function main() {
  const isLoop = process.argv.includes('--loop');

  console.log('🫀 Aurelius Heartbeat');
  console.log(isLoop ? 'Running in loop mode (every 2 min)...' : 'Running once...');

  const run = async () => {
    try {
      const result = await runHeartbeat();
      console.log(`✓ Heartbeat complete:`, result);
    } catch (error) {
      console.error('✗ Heartbeat failed:', error);
    }
  };

  await run();

  if (isLoop) {
    setInterval(run, INTERVAL_MS);
    console.log('Press Ctrl+C to stop');
  }
}

main();
