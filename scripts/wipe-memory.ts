#!/usr/bin/env npx tsx
/**
 * ⚠️  DANGEROUS - EXPLICIT USE ONLY ⚠️
 *
 * Wipe Memory - Nuclear reset of all memory data
 *
 * This script deletes ALL memory data (entities, facts, daily notes, conversations).
 * Only run this when you intentionally want a fresh start.
 *
 * DO NOT:
 * - Run this as part of automated workflows
 * - Run this without understanding what it deletes
 * - Let Claude run this without explicit user request
 *
 * Usage:
 *   npx tsx scripts/wipe-memory.ts              # Preview what will be deleted
 *   npx tsx scripts/wipe-memory.ts --confirm    # Backup first, then delete
 *   npx tsx scripts/wipe-memory.ts --confirm --no-backup  # Skip backup (dangerous!)
 */

// Load environment FIRST using require (not hoisted like import)
require('dotenv').config({ path: '.env.local' });

import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

// Paths to clear
const PATHS = {
  people: path.join(ROOT, "life/areas/people"),
  companies: path.join(ROOT, "life/areas/companies"),
  projects: path.join(ROOT, "life/projects"),
  activityLog: path.join(ROOT, "life/system/activity-log.json"),
  heartbeatState: path.join(ROOT, "life/system/heartbeat-state.json"),
  dailyNotes: path.join(ROOT, "memory"),
};

function countDirectoryItems(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(f => !f.startsWith('.'));
}

function deleteDirectoryContents(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  const items = fs.readdirSync(dirPath).filter(f => !f.startsWith('.'));
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
  return items.length;
}

async function main() {
  // Dynamic imports AFTER env is loaded
  const { db } = await import("../src/lib/db");
  const { entities, facts, conversations, documents, documentChunks } = await import("../src/lib/db/schema");
  const { sql } = await import("drizzle-orm");

  const confirm = process.argv.includes("--confirm");

  console.log("🧹 Memory Wipe Tool\n");

  // Count what will be deleted
  console.log("Scanning...\n");

  // Files
  const people = countDirectoryItems(PATHS.people);
  const companies = countDirectoryItems(PATHS.companies);
  const projects = countDirectoryItems(PATHS.projects);
  const dailyNotes = countDirectoryItems(PATHS.dailyNotes).filter(f => f.endsWith('.md'));

  // Database
  const [entitiesCount] = await db.select({ count: sql<number>`count(*)` }).from(entities);
  const [factsCount] = await db.select({ count: sql<number>`count(*)` }).from(facts);
  const [conversationsCount] = await db.select({ count: sql<number>`count(*)` }).from(conversations);
  const [documentsCount] = await db.select({ count: sql<number>`count(*)` }).from(documents);
  const [chunksCount] = await db.select({ count: sql<number>`count(*)` }).from(documentChunks);

  const dbCounts = {
    entities: Number(entitiesCount.count),
    facts: Number(factsCount.count),
    conversations: Number(conversationsCount.count),
    documents: Number(documentsCount.count),
    documentChunks: Number(chunksCount.count),
  };

  console.log("FILE SYSTEM:");
  console.log(`  life/areas/people/     ${people.length} entities (${people.join(', ') || 'empty'})`);
  console.log(`  life/areas/companies/  ${companies.length} entities (${companies.join(', ') || 'empty'})`);
  console.log(`  life/projects/         ${projects.length} entities (${projects.join(', ') || 'empty'})`);
  console.log(`  memory/*.md            ${dailyNotes.length} daily notes`);
  console.log(`  life/system/           activity-log.json, heartbeat-state.json (reset)`);

  console.log("\nDATABASE:");
  console.log(`  entities               ${dbCounts.entities} rows`);
  console.log(`  facts                  ${dbCounts.facts} rows`);
  console.log(`  conversations          ${dbCounts.conversations} rows`);
  console.log(`  documents              ${dbCounts.documents} rows`);
  console.log(`  document_chunks        ${dbCounts.documentChunks} rows`);

  const totalFiles = people.length + companies.length + projects.length + dailyNotes.length;
  const totalDbRows = Object.values(dbCounts).reduce((a, b) => a + b, 0);

  console.log(`\nTOTAL: ${totalFiles} file items + ${totalDbRows} database rows\n`);

  if (!confirm) {
    console.log("⚠️  This is a PREVIEW. To actually delete, run:");
    console.log("   npx tsx scripts/wipe-memory.ts --confirm\n");
    process.exit(0);
  }

  // Create backup first (unless --no-backup)
  const skipBackup = process.argv.includes("--no-backup");
  if (!skipBackup) {
    console.log("📦 Creating backup before wipe...\n");
    const { createBackup } = await import("../src/lib/memory/backup");
    const backupResult = await createBackup(true); // force=true to create even if one exists today

    if (backupResult.success && !backupResult.skipped) {
      console.log(`  ✓ Backup created: ${backupResult.backupPath}`);
      if (backupResult.pushed) {
        console.log(`  ✓ Pushed to GitHub`);
      }
      console.log("");
    } else if (!backupResult.success) {
      console.error(`\n❌ Backup failed: ${backupResult.error}`);
      console.log("Run with --no-backup to skip backup and wipe anyway (dangerous!).\n");
      process.exit(1);
    }
  } else {
    console.log("⚠️  Skipping backup (--no-backup flag)\n");
  }

  // Actually delete
  console.log("🔥 DELETING...\n");

  // Delete file contents
  let deletedPeople = deleteDirectoryContents(PATHS.people);
  console.log(`  ✓ Deleted ${deletedPeople} people entities`);

  let deletedCompanies = deleteDirectoryContents(PATHS.companies);
  console.log(`  ✓ Deleted ${deletedCompanies} company entities`);

  let deletedProjects = deleteDirectoryContents(PATHS.projects);
  console.log(`  ✓ Deleted ${deletedProjects} project entities`);

  // Delete daily notes
  for (const note of dailyNotes) {
    fs.unlinkSync(path.join(PATHS.dailyNotes, note));
  }
  console.log(`  ✓ Deleted ${dailyNotes.length} daily notes`);

  // Reset system files
  fs.writeFileSync(PATHS.activityLog, JSON.stringify({ entries: [] }, null, 2));
  console.log(`  ✓ Reset activity-log.json`);

  fs.writeFileSync(PATHS.heartbeatState, JSON.stringify({ processedNotes: {}, lastRun: null }, null, 2));
  console.log(`  ✓ Reset heartbeat-state.json`);

  // Truncate database tables in a transaction (atomic)
  await db.transaction(async (tx) => {
    await tx.delete(documentChunks);
    await tx.delete(documents);
    await tx.delete(facts);
    await tx.delete(entities);
    await tx.delete(conversations);
  });
  console.log(`  ✓ Truncated database tables`);

  console.log("\n✅ Memory wiped. Fresh start!\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
