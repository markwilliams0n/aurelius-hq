/**
 * Test script for heartbeat functionality
 * Run with: npx tsx scripts/test-heartbeat.ts
 */

// Load environment FIRST using require (not hoisted like import)
require('dotenv').config({ path: '.env.local' });

async function runTests() {
  // Dynamic import AFTER env is loaded
  const { runHeartbeat } = await import('../src/lib/memory/heartbeat');

  console.log('='.repeat(60));
  console.log('HEARTBEAT TEST SUITE');
  console.log('='.repeat(60));
  console.log('');

  console.log('Test 1: Full heartbeat run with entity resolution');
  console.log('-'.repeat(60));

  try {
    const startTime = Date.now();
    const result = await runHeartbeat({ skipReindex: true, skipGranola: true });
    const duration = Date.now() - startTime;

    console.log('');
    console.log('RESULTS:');
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Entities created: ${result.entitiesCreated}`);
    console.log(`  Entities updated: ${result.entitiesUpdated}`);
    console.log(`  Extraction method: ${result.extractionMethod}`);
    console.log(`  All steps succeeded: ${result.allStepsSucceeded}`);

    if (result.warnings.length > 0) {
      console.log(`  Warnings: ${result.warnings.join(', ')}`);
    }

    console.log('');
    console.log('ENTITY DETAILS:');
    for (const entity of result.entities) {
      console.log(`  [${entity.action.toUpperCase()}] ${entity.name} (${entity.type})`);
      for (const fact of entity.facts) {
        console.log(`    - ${fact}`);
      }
    }

    if (result.entities.length === 0) {
      console.log('  (No new entities created or updated)');
    }

  } catch (error) {
    console.error('Test failed:', error);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
}

runTests();

// Debug: show what was extracted
console.log('\nDEBUG: Entities extracted and resolved:');
