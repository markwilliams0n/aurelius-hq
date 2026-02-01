#!/usr/bin/env npx tsx

/**
 * CLI for ingesting JSON documents into Aurelius memory
 *
 * Usage:
 *   pnpm ingest <path-to-json-file>
 *   pnpm ingest ./data/contacts.json
 */

import { readFileSync } from "fs";
import { basename } from "path";
import { ingestJsonDocument } from "@/lib/memory/documents";
import { logActivity } from "@/lib/activity";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: pnpm ingest <path-to-json-file>");
    process.exit(1);
  }

  const filePath = args[0];
  const filename = basename(filePath);

  console.log(`\nIngesting: ${filename}`);
  console.log("─".repeat(40));

  try {
    // Read and parse JSON
    const content = readFileSync(filePath, "utf-8");
    const json = JSON.parse(content);

    console.log("Parsing JSON...");

    // Ingest document
    const { document, factsCreated } = await ingestJsonDocument(filename, json);

    console.log(`Document ID: ${document.id}`);
    console.log(`Facts created: ${factsCreated}`);

    await logActivity({
      eventType: "memory_created",
      actor: "system",
      description: `Ingested document: ${filename} (${factsCreated} facts)`,
      metadata: {
        documentId: document.id,
        filename,
        factsCreated,
      },
    });

    console.log("\n✓ Done!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
