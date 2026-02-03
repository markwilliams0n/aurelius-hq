/**
 * Comprehensive Heartbeat Test Suite
 * Tests entity resolution with complex scenarios
 *
 * Run with: npx tsx scripts/test-heartbeat-scenarios.ts
 */

require('dotenv').config({ path: '.env.local' });

import { promises as fs } from 'fs';
import path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const LIFE_DIR = path.join(process.cwd(), 'life');
const STATE_FILE = path.join(LIFE_DIR, 'system', 'heartbeat-state.json');
const TEST_DATE = '2026-02-03';  // Use a separate test date to avoid polluting real notes

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

const results: TestResult[] = [];

async function resetHeartbeatState() {
  await fs.writeFile(STATE_FILE, JSON.stringify({
    processedNotes: {},
    lastRun: new Date().toISOString()
  }, null, 2));
}

async function setHeartbeatState(processedNotes: Record<string, string>) {
  await fs.writeFile(STATE_FILE, JSON.stringify({
    processedNotes,
    lastRun: new Date().toISOString()
  }, null, 2));
}

async function cleanupTestNote() {
  const testNotePath = path.join(MEMORY_DIR, `${TEST_DATE}.md`);
  try {
    await fs.unlink(testNotePath);
  } catch {
    // File doesn't exist, that's fine
  }
}

async function appendToTestNote(time: string, content: string) {
  const notePath = path.join(MEMORY_DIR, `${TEST_DATE}.md`);
  let existing = '';
  try {
    existing = await fs.readFile(notePath, 'utf-8');
  } catch {
    // File doesn't exist, start fresh
    existing = `# ${TEST_DATE}\n`;
  }

  const newContent = `${existing}\n## ${time}\n\n${content}\n`;
  await fs.writeFile(notePath, newContent);
}


async function entityExists(type: 'person' | 'company' | 'project', slug: string): Promise<boolean> {
  const typeDir = type === 'person' ? 'areas/people' : type === 'company' ? 'areas/companies' : 'projects';
  try {
    await fs.access(path.join(LIFE_DIR, typeDir, slug));
    return true;
  } catch {
    return false;
  }
}

async function getEntityFacts(type: 'person' | 'company' | 'project', slug: string): Promise<string[]> {
  const typeDir = type === 'person' ? 'areas/people' : type === 'company' ? 'areas/companies' : 'projects';
  try {
    const content = await fs.readFile(path.join(LIFE_DIR, typeDir, slug, 'items.json'), 'utf-8');
    const facts = JSON.parse(content);
    return facts.filter((f: any) => f.status === 'active').map((f: any) => f.fact);
  } catch {
    return [];
  }
}

async function runHeartbeat(): Promise<any> {
  const { runHeartbeat } = await import('../src/lib/memory/heartbeat');
  return runHeartbeat({ skipReindex: true, skipGranola: true });
}

function logTest(name: string, passed: boolean, expected: string, actual: string, details?: string) {
  results.push({ name, passed, expected, actual, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (!passed) {
    console.log(`   Expected: ${expected}`);
    console.log(`   Actual: ${actual}`);
  }
  if (details) {
    console.log(`   Details: ${details}`);
  }
}

// ============================================================
// TEST SCENARIOS
// ============================================================

async function testSimilarNames() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Similar Names');
  console.log('='.repeat(60));

  // Setup: Clean test note and reset state
  await cleanupTestNote();
  await resetHeartbeatState();

  // Setup: We already have Adam Watson
  const hasAdamWatson = await entityExists('person', 'adam-watson');

  // Test 1: "Adam" should resolve to "Adam Watson"
  await appendToTestNote('10:00',
    'Adam sent over the architecture docs for the new API. He mentioned working late on it.');

  let result1 = await runHeartbeat();
  const adamWatsonFacts = await getEntityFacts('person', 'adam-watson');
  const adamCreated1 = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'adam' && e.action === 'created'
  );

  logTest(
    'Partial name "Adam" resolves to "Adam Watson"',
    !adamCreated1,
    'No standalone "Adam" entity created',
    `Adam created: ${adamCreated1}`,
    result1.entities.filter((e: any) => e.name.toLowerCase().includes('adam')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );

  // Test 2: "Adam W." should resolve to "Adam Watson"
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '10:00' });
  await appendToTestNote('10:05',
    'Got a message from Adam W. about the deployment schedule.');

  const result2 = await runHeartbeat();
  const adamNewEntity = await entityExists('person', 'adam-w');
  const adamCreatedInResult = result2.entities.some((e: any) =>
    e.name.toLowerCase() === 'adam w' && e.action === 'created'
  );

  logTest(
    '"Adam W." resolves to "Adam Watson" (not new entity)',
    !adamNewEntity && !adamCreatedInResult,
    'No "adam-w" or "Adam W" entity created',
    `adam-w exists: ${adamNewEntity}, Adam W created: ${adamCreatedInResult}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('adam')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );

  // Test 3: Completely different "Adam Johnson" should create new or be kept separate
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '10:05' });
  await appendToTestNote('10:10',
    'Adam Johnson from the legal team reviewed our contracts. He is based in Chicago and handles IP law.');

  const result3 = await runHeartbeat();
  const hasAdamJohnson = await entityExists('person', 'adam-johnson');
  const adamJohnsonCreated = result3.entities.some((e: any) =>
    e.name.toLowerCase().includes('adam johnson') && e.action === 'created'
  );

  logTest(
    '"Adam Johnson" (different person) handled separately from Adam Watson',
    hasAdamJohnson || adamJohnsonCreated,
    'adam-johnson entity created',
    `adam-johnson exists: ${hasAdamJohnson}, created in run: ${adamJohnsonCreated}`,
    result3.entities.filter((e: any) => e.name.toLowerCase().includes('adam')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );
}

async function testCompanyVariations() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Company Name Variations');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: "ROSTR" vs "Rostr" vs "ROSTR Pro"
  await appendToTestNote('11:00',
    'The ROSTR team shipped the new feature. ROSTR Pro subscribers get early access.');

  const result1 = await runHeartbeat();
  const rostrFacts = await getEntityFacts('project', 'rostr');
  const rostrProFacts = await getEntityFacts('project', 'rostr-pro');

  logTest(
    '"ROSTR" resolves to existing "rostr" (case insensitive)',
    result1.entities.filter((e: any) => e.name.toLowerCase() === 'rostr' && e.action === 'created').length === 0,
    'No new ROSTR entity created',
    `Created entities: ${result1.entities.filter((e: any) => e.action === 'created').map((e: any) => e.name).join(', ') || 'none'}`,
  );

  // Test: Similar company names
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '11:00' });
  await appendToTestNote('11:05',
    'Meeting with Live Nation executives next week. LiveNation wants to expand the partnership.');

  const result2 = await runHeartbeat();
  const liveNationExists = await entityExists('company', 'live-nation');
  const liveNationNoSpaceExists = await entityExists('company', 'livenation');

  logTest(
    '"LiveNation" resolves to "Live Nation" (spacing variation)',
    !liveNationNoSpaceExists,
    'No separate "livenation" entity',
    `live-nation: ${liveNationExists}, livenation: ${liveNationNoSpaceExists}`,
  );
}

async function testContextualResolution() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Contextual Resolution');
  console.log('='.repeat(60));

  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: "Sarah" with engineering context should resolve to Sarah Chen (lead engineer)
  await appendToTestNote('12:00',
    'Sarah reviewed the PR and approved the changes. The code looks solid for the API refactor.');

  const result1 = await runHeartbeat();
  const sarahChenFacts = await getEntityFacts('person', 'sarah-chen');
  const hasPRFact = sarahChenFacts.some(f => f.toLowerCase().includes('pr') || f.toLowerCase().includes('code'));
  const sarahCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'sarah' && e.action === 'created'
  );

  logTest(
    '"Sarah" with code context resolves to "Sarah Chen" (engineer)',
    !sarahCreated || hasPRFact,
    'No standalone "Sarah" created, OR fact added to Sarah Chen',
    `Sarah created: ${sarahCreated}, Sarah Chen PR fact: ${hasPRFact}`,
    result1.entities.filter((e: any) => e.name.toLowerCase().includes('sarah')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );

  // Test: "Corey" should resolve to Corey Crossfield (sales context)
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '12:00' });
  await appendToTestNote('12:05',
    'Corey closed another deal today - $50K annual contract with Universal Music.');

  const result2 = await runHeartbeat();
  const coreyCrossfieldFacts = await getEntityFacts('person', 'corey-crossfield');
  const hasUniversalFact = coreyCrossfieldFacts.some(f => f.toLowerCase().includes('universal'));
  const coreyCreated = result2.entities.some((e: any) =>
    e.name.toLowerCase() === 'corey' && e.action === 'created'
  );

  logTest(
    '"Corey" with sales context resolves to "Corey Crossfield"',
    !coreyCreated || hasUniversalFact,
    'No standalone "Corey" created, OR fact added to Corey Crossfield',
    `Corey created: ${coreyCreated}, Universal fact: ${hasUniversalFact}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('corey')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );
}

async function testAmbiguousEntities() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Ambiguous Entities');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: "Mercury" could be a project, company, or even person
  await appendToTestNote('13:00',
    'The Mercury project hit a major milestone - v2.0 is ready for QA testing.');

  const result1 = await runHeartbeat();
  const mercuryProject = await entityExists('project', 'mercury');
  const mercuryCompany = await entityExists('company', 'mercury');
  const mercuryCreatedAsProject = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('mercury') && e.type === 'project'
  );

  logTest(
    '"Mercury project" creates project (not company)',
    mercuryCreatedAsProject || mercuryProject,
    'mercury entity as project',
    `project exists: ${mercuryProject}, created as project: ${mercuryCreatedAsProject}`,
    result1.entities.filter((e: any) => e.name.toLowerCase().includes('mercury')).map((e: any) => `${e.action}: ${e.name} (${e.type})`).join(', ') || 'none'
  );

  // Test: "Apple" with tech context
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '13:00' });
  await appendToTestNote('13:05',
    'Received an inquiry from Apple about API integration for Apple Music.');

  const result2 = await runHeartbeat();
  const appleCompany = await entityExists('company', 'apple');
  const appleCreated = result2.entities.some((e: any) =>
    e.name.toLowerCase().includes('apple') && e.type === 'company'
  );

  logTest(
    '"Apple" with tech context creates company',
    appleCompany || appleCreated,
    'apple exists as company',
    `company exists: ${appleCompany}, created: ${appleCreated}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('apple')).map((e: any) => `${e.action}: ${e.name} (${e.type})`).join(', ') || 'none'
  );
}

async function testDuplicatePrevention() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Duplicate Prevention');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Same entity mentioned multiple times in one note
  await appendToTestNote('14:00',
    `Quick sync with the team:
    - Marcus Webb finished the API work
    - Marcus is now moving to the auth system
    - Need to check in with Marcus Webb tomorrow about timeline
    - Webb confirmed he can demo on Friday`);

  const result1 = await runHeartbeat();
  const marcusWebbCreated = result1.entities.filter(
    (e: any) => e.name.toLowerCase().includes('marcus') && e.action === 'created'
  ).length;

  logTest(
    'Multiple mentions of "Marcus Webb" / "Marcus" / "Webb" creates only one entity',
    marcusWebbCreated <= 1,
    'At most 1 Marcus entity created',
    `Marcus entities created: ${marcusWebbCreated}`,
    result1.entities.map((e: any) => `${e.action}: ${e.name}`).join(', ')
  );

  // Test: Entity mentioned in both person and company context
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '14:00' });
  await appendToTestNote('14:05',
    `Watson AI is disrupting the market. Adam Watson thinks we should watch them closely.`);

  const result2 = await runHeartbeat();
  const watsonCompany = await entityExists('company', 'watson-ai');
  const adamWatsonPerson = await entityExists('person', 'adam-watson');
  const adamWatsonNotCreatedAsCompany = !result2.entities.some((e: any) =>
    e.name.toLowerCase().includes('adam watson') && e.type === 'company' && e.action === 'created'
  );

  logTest(
    '"Watson AI" (company) and "Adam Watson" (person) handled separately',
    adamWatsonPerson && adamWatsonNotCreatedAsCompany,
    'Adam Watson remains person, not created as company',
    `Adam Watson person: ${adamWatsonPerson}, not created as company: ${adamWatsonNotCreatedAsCompany}`,
    result2.entities.map((e: any) => `${e.action}: ${e.name} (${e.type})`).join(', ')
  );
}

async function testLongTermMemory() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Long-term Memory & Recency');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Reference to someone mentioned long ago
  // We need to check if entities accessed recently rank higher
  await appendToTestNote('15:00',
    'Follow up with Danny about the WME deal. He was optimistic last time we spoke.');

  const result1 = await runHeartbeat();
  const dannyFeldmanFacts = await getEntityFacts('person', 'danny-feldman');
  const dannyFacts = await getEntityFacts('person', 'danny');
  const dannyCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'danny' && e.action === 'created'
  );
  const dannyFeldmanUpdated = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('danny') && e.action === 'updated'
  );

  logTest(
    '"Danny" resolves to frequently-accessed "Danny Feldman"',
    !dannyCreated || dannyFeldmanUpdated,
    'No new "Danny" created OR Danny Feldman updated',
    `Danny created: ${dannyCreated}, Danny Feldman updated: ${dannyFeldmanUpdated}`,
    result1.entities.filter((e: any) => e.name.toLowerCase().includes('danny')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );
}

async function testEdgeCases() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Edge Cases');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Very short names
  await appendToTestNote('16:00',
    'Call with AI startup CEO - their product uses ML for music recommendations.');

  const result1 = await runHeartbeat();
  const aiEntity = await entityExists('company', 'ai');
  const mlEntity = await entityExists('project', 'ml');
  const aiCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'ai' && e.action === 'created'
  );
  const mlCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'ml' && e.action === 'created'
  );

  logTest(
    'Short terms like "AI" and "ML" are filtered out',
    !aiEntity && !mlEntity && !aiCreated && !mlCreated,
    'No AI or ML entities created',
    `AI exists: ${aiEntity}, ML exists: ${mlEntity}, AI created: ${aiCreated}, ML created: ${mlCreated}`,
  );

  // Test: Names with special characters/accents
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '16:00' });
  await appendToTestNote('16:05',
    'Matías Fessia pushed the latest build. Great work from the Córdoba team!');

  const result2 = await runHeartbeat();
  const matiasFacts = await getEntityFacts('person', 'matias-fessia');
  const matiasCreated = result2.entities.some((e: any) =>
    (e.name.toLowerCase().includes('matías') || e.name.toLowerCase().includes('matias')) &&
    e.action === 'created'
  );

  logTest(
    'Accented names "Matías" resolves to "Matias Fessia"',
    !matiasCreated,
    'No new Matías/Matias entity created',
    `Matias created: ${matiasCreated}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('matia')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );

  // Test: All-caps vs mixed case
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '16:05' });
  await appendToTestNote('16:10',
    'STUBHUB sent over the contract. StubHub wants exclusive features.');

  const result3 = await runHeartbeat();
  const stubhubFacts = await getEntityFacts('company', 'stubhub');
  const stubhubCreated = result3.entities.some((e: any) =>
    e.name.toLowerCase().includes('stubhub') && e.action === 'created'
  );

  logTest(
    'All-caps "STUBHUB" resolves to "Stubhub"',
    !stubhubCreated,
    'No new STUBHUB entity created',
    `Stubhub created: ${stubhubCreated}`,
    result3.entities.filter((e: any) => e.name.toLowerCase().includes('stubhub')).map((e: any) => `${e.action}: ${e.name}`).join(', ') || 'none'
  );
}

async function testFactDeduplication() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Semantic Fact Deduplication');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Similar facts shouldn't be duplicated
  const beforeFacts = await getEntityFacts('person', 'adam-watson');

  await appendToTestNote('17:00',
    'Adam Watson is our CTO based in San Diego. He leads the architecture team.');

  const result1 = await runHeartbeat();
  const afterFacts = await getEntityFacts('person', 'adam-watson');
  const newFactCount = afterFacts.length - beforeFacts.length;

  logTest(
    'Redundant facts "CTO" and "San Diego" not duplicated for Adam Watson',
    newFactCount <= 1,
    'At most 1 new fact (architecture lead might be new)',
    `Facts before: ${beforeFacts.length}, after: ${afterFacts.length}, new: ${newFactCount}`,
    `New facts: ${afterFacts.filter(f => !beforeFacts.includes(f)).join('; ')}`
  );
}

async function testComplexMultiWordContext() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Complex Multi-Word Context');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Multiple entities in a complex business scenario
  await appendToTestNote('18:00',
    `Big day - WME pilot discussion continued. Danny says Priya Mehta from data strategy team
    is impressed with the label services analytics. Corey is prepping the custom deck with
    Adam's architectural input. The 150-seat pilot worth $22K annually is looking promising.
    Marcus Lane from UTA called about their decision - they're building internally instead.`);

  const result1 = await runHeartbeat();

  // Check that we correctly identified existing people vs new
  const dannyFeldmanUpdated = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('danny') && e.action === 'updated'
  );
  const coreyUpdated = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('corey') && e.action === 'updated'
  );
  const adamUpdated = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('adam') && e.action === 'updated'
  );
  const priyaCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('priya') && e.action === 'created'
  );
  const marcusLaneCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('marcus lane') && e.action === 'created'
  );

  // Count new entities that shouldn't be created (existing people)
  const standaloneCreations = result1.entities.filter((e: any) =>
    ['danny', 'corey', 'adam'].includes(e.name.toLowerCase()) && e.action === 'created'
  ).length;

  logTest(
    'Complex multi-entity note: existing people updated, new people created appropriately',
    standaloneCreations === 0,
    'No standalone Danny/Corey/Adam created',
    `Standalone creations: ${standaloneCreations}`,
    result1.entities.map((e: any) => `${e.action}: ${e.name}`).join(', ')
  );

  // Test: Technical project context with multiple related terms
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '18:00' });
  await appendToTestNote('18:10',
    `ROSTR Pro feature update: The API redesign is complete. Sarah Chen merged the
    final PR for the artist profile components. Lucas Homer verified the dashboard
    integration works with the new endpoints. Matias handled the deployment.`);

  const result2 = await runHeartbeat();

  const rostrProNotDuplicated = result2.entities.filter((e: any) =>
    e.name.toLowerCase().includes('rostr') && e.action === 'created'
  ).length === 0;

  const sarahNotDuplicated = result2.entities.filter((e: any) =>
    e.name.toLowerCase() === 'sarah' && e.action === 'created'
  ).length === 0;

  logTest(
    'Technical project context: ROSTR Pro not duplicated, Sarah resolves to Sarah Chen',
    rostrProNotDuplicated && sarahNotDuplicated,
    'No ROSTR or Sarah standalone entities',
    `ROSTR Pro clean: ${rostrProNotDuplicated}, Sarah clean: ${sarahNotDuplicated}`,
    result2.entities.map((e: any) => `${e.action}: ${e.name}`).join(', ')
  );
}

async function testSimilarDuplicateNames() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Similar Duplicate Names');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Very similar names that should be differentiated
  await appendToTestNote('19:00',
    `Two meetings today:
    1. Jennifer Park from Netflix music licensing - she mentioned SoundSync AI curation
    2. Jennifer Lee from our Finance team escalated a customer issue
    Both Jennifers need follow-ups but very different contexts.`);

  const result1 = await runHeartbeat();

  // Should not create standalone "Jennifer" entities
  const standaloneJennifer = result1.entities.filter((e: any) =>
    e.name.toLowerCase() === 'jennifer' && e.action === 'created'
  ).length;

  // Should create or update Jennifer Park and Jennifer Lee separately
  const jenniferParkHandled = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('jennifer park')
  );
  const jenniferLeeHandled = result1.entities.some((e: any) =>
    e.name.toLowerCase().includes('jennifer lee')
  );

  logTest(
    'Two different "Jennifer" people handled separately, no standalone Jennifer',
    standaloneJennifer === 0,
    'No standalone "Jennifer" created',
    `Standalone: ${standaloneJennifer}, Park: ${jenniferParkHandled}, Lee: ${jenniferLeeHandled}`,
    result1.entities.filter((e: any) => e.name.toLowerCase().includes('jennifer')).map((e: any) => `${e.action}: ${e.name}`).join(', ')
  );

  // Test: Company names that could be confused
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '19:00' });
  await appendToTestNote('19:10',
    `Partnership discussions:
    - Universal Music wants ROSTR integration for their A&R team
    - Universal Studios is also interested but for film music supervision
    Two completely different Universal entities.`);

  const result2 = await runHeartbeat();

  const universalMusicExists = await entityExists('company', 'universal-music');
  const universalStudiosCreated = result2.entities.some((e: any) =>
    e.name.toLowerCase().includes('universal studios') && e.action === 'created'
  );

  logTest(
    'Universal Music and Universal Studios handled as separate companies',
    universalMusicExists || universalStudiosCreated,
    'Both Universal companies recognized',
    `Universal Music: ${universalMusicExists}, Universal Studios created: ${universalStudiosCreated}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('universal')).map((e: any) => `${e.action}: ${e.name} (${e.type})`).join(', ')
  );
}

async function testLongerTermDataReferences() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Longer-Term Data References');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Reference to entities established in much earlier notes
  // (The existing entities in life/ directory represent "older" data)
  await appendToTestNote('20:00',
    `Reviewing old contacts:
    - Remember Michelle from StubHub? She rejoined from Noise Pop. Schedule a catch-up.
    - Rachel Thornton at Wasserman - we connected via NIF form last week
    - The Netflix team Jennifer mentioned - need to follow up on SoundSync integration`);

  const result1 = await runHeartbeat();

  // Michelle Swing should be resolved, not recreated
  const michelleSwingExists = await entityExists('person', 'michelle-swing');
  const michelleCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'michelle' && e.action === 'created'
  );

  // Rachel Thornton should be resolved if exists
  const rachelCreated = result1.entities.some((e: any) =>
    e.name.toLowerCase() === 'rachel' && e.action === 'created'
  );

  logTest(
    'References to older contacts resolve to existing entities',
    !michelleCreated,
    'Michelle resolves to Michelle Swing (not standalone)',
    `Michelle Swing exists: ${michelleSwingExists}, Michelle standalone created: ${michelleCreated}`,
    result1.entities.filter((e: any) =>
      e.name.toLowerCase().includes('michelle') || e.name.toLowerCase().includes('rachel')
    ).map((e: any) => `${e.action}: ${e.name}`).join(', ')
  );

  // Test: Updating old entity facts without duplication
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '20:00' });
  await appendToTestNote('20:10',
    `Vivian Donahue update: She's settling into the CRO role well. Her AI support
    integration priorities are being documented. Good collaboration with the growth team.`);

  const result2 = await runHeartbeat();
  const vivianExists = await entityExists('person', 'vivian-donahue');
  const vivianCreated = result2.entities.some((e: any) =>
    e.name.toLowerCase().includes('vivian') && e.action === 'created'
  );

  logTest(
    'Update to Vivian Donahue (CRO) enriches existing record',
    !vivianCreated && vivianExists,
    'Vivian updated, not recreated',
    `Vivian exists: ${vivianExists}, created: ${vivianCreated}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('vivian')).map((e: any) => `${e.action}: ${e.name}`).join(', ')
  );
}

async function testCrossTypeResolution() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GROUP: Cross-Type Resolution');
  console.log('='.repeat(60));

  // Reset for this test group
  await cleanupTestNote();
  await resetHeartbeatState();

  // Test: Person name shouldn't become a company/project
  await appendToTestNote('21:00',
    `The Watson project is gaining traction. Not to be confused with Adam Watson
    who leads our architecture. IBM Watson integration is also on the roadmap.`);

  const result1 = await runHeartbeat();

  // Adam Watson should NOT become a project or company
  const adamWatsonAsProject = await entityExists('project', 'adam-watson');
  const adamWatsonAsCompany = await entityExists('company', 'adam-watson');
  const adamWatsonAsPerson = await entityExists('person', 'adam-watson');

  logTest(
    'Adam Watson remains person-type, not confused with Watson project/company',
    adamWatsonAsPerson && !adamWatsonAsProject && !adamWatsonAsCompany,
    'Adam Watson stays as person only',
    `Person: ${adamWatsonAsPerson}, Project: ${adamWatsonAsProject}, Company: ${adamWatsonAsCompany}`,
    result1.entities.filter((e: any) => e.name.toLowerCase().includes('watson')).map((e: any) => `${e.action}: ${e.name} (${e.type})`).join(', ')
  );

  // Test: Company shouldn't become a person
  await setHeartbeatState({ [`${TEST_DATE}.md`]: '21:00' });
  await appendToTestNote('21:10',
    `Meeting notes: LiveNation is expanding their festival portfolio.
    Spoke with their team about potential API access.`);

  const result2 = await runHeartbeat();

  const liveNationAsPerson = await entityExists('person', 'livenation') ||
                              await entityExists('person', 'live-nation');
  const liveNationAsCompany = await entityExists('company', 'live-nation');

  logTest(
    'LiveNation stays as company, not misclassified as person',
    !liveNationAsPerson,
    'LiveNation is company only',
    `Person: ${liveNationAsPerson}, Company: ${liveNationAsCompany}`,
    result2.entities.filter((e: any) => e.name.toLowerCase().includes('livenation') || e.name.toLowerCase().includes('live nation')).map((e: any) => `${e.action}: ${e.name} (${e.type})`).join(', ')
  );
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        HEARTBEAT COMPREHENSIVE TEST SUITE                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nStarted: ${new Date().toISOString()}\n`);

  const startTime = Date.now();

  try {
    // Core entity resolution tests
    await testSimilarNames();
    await testCompanyVariations();
    await testContextualResolution();
    await testAmbiguousEntities();
    await testDuplicatePrevention();
    await testLongTermMemory();
    await testEdgeCases();
    await testFactDeduplication();

    // Advanced tests (multi-word context, similar duplicates, longer-term data)
    await testComplexMultiWordContext();
    await testSimilarDuplicateNames();
    await testLongerTermDataReferences();
    await testCrossTypeResolution();
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
  }

  // Cleanup test note
  console.log('\n🧹 Cleaning up test note...');
  await cleanupTestNote();
  await resetHeartbeatState();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('TEST SUMMARY');
  console.log('═'.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Duration: ${duration}s`);

  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}`);
      console.log(`    Expected: ${result.expected}`);
      console.log(`    Actual: ${result.actual}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Completed: ${new Date().toISOString()}`);

  // Return exit code
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
