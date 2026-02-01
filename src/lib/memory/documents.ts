import { db } from "@/lib/db";
import {
  documents,
  documentChunks,
  type Document,
  type DocumentChunk,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { embed, embedBatch } from "@/lib/ai/embeddings";
import { upsertEntity } from "./entities";
import { createFact } from "./facts";
import { chat } from "@/lib/ai/client";

// Create a document
export async function createDocument(
  filename: string,
  contentType: string,
  rawContent: string,
  entityId?: string
): Promise<Document> {
  const [doc] = await db
    .insert(documents)
    .values({
      filename,
      contentType,
      rawContent,
      entityId,
      processingStatus: "pending",
    })
    .returning();

  return doc;
}

// Chunk text into smaller pieces
function chunkText(text: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Process a document: chunk it and create embeddings
export async function processDocument(documentId: string): Promise<void> {
  // Get document
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  // Update status to processing
  await db
    .update(documents)
    .set({ processingStatus: "processing" })
    .where(eq(documents.id, documentId));

  try {
    // Chunk the content
    const chunks = chunkText(doc.rawContent);

    // Generate embeddings for all chunks
    const embeddings = await embedBatch(chunks);

    // Insert chunks with embeddings
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(documentChunks).values({
        documentId,
        chunkIndex: String(i),
        content: chunks[i],
        embedding: embeddings[i],
      });
    }

    // Update status to completed
    await db
      .update(documents)
      .set({
        processingStatus: "completed",
        processedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  } catch (error) {
    // Update status to failed
    await db
      .update(documents)
      .set({ processingStatus: "failed" })
      .where(eq(documents.id, documentId));
    throw error;
  }
}

// Search document chunks by semantic similarity
export async function searchDocuments(
  query: string,
  limit: number = 5
): Promise<Array<DocumentChunk & { similarity: number; document: Document }>> {
  const queryEmbedding = await embed(query);

  const results = await db.execute(sql`
    SELECT
      dc.*,
      1 - (dc.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity,
      d.filename,
      d.content_type
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.embedding IS NOT NULL
      AND d.processing_status = 'completed'
    ORDER BY dc.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${limit}
  `);

  return results as unknown as Array<
    DocumentChunk & { similarity: number; document: Document }
  >;
}

// Ingest a JSON document and extract facts
export async function ingestJsonDocument(
  filename: string,
  jsonContent: Record<string, unknown>
): Promise<{
  document: Document;
  factsCreated: number;
}> {
  const rawContent = JSON.stringify(jsonContent, null, 2);

  // Create document entity
  const docEntity = await upsertEntity(filename, "document", {
    filename,
    contentType: "application/json",
  });

  // Create document
  const doc = await createDocument(
    filename,
    "application/json",
    rawContent,
    docEntity.id
  );

  // Process document (create chunks with embeddings)
  await processDocument(doc.id);

  // Extract facts from JSON using AI
  const extractionPrompt = `Analyze this JSON document and extract important facts.
For each fact, identify:
- The entity it relates to (person, project, company, etc.)
- The type of entity
- The atomic fact
- The category (preference, relationship, status, context, milestone)

JSON content:
${rawContent}

Output as a list, one fact per line:
- entity: [Name] | type: [person|project|topic|company|team] | fact: [atomic fact] | category: [preference|relationship|status|context|milestone]`;

  const response = await chat(extractionPrompt);

  // Parse extracted facts
  const lines = response.split("\n").filter((l) => l.trim().startsWith("-"));
  let factsCreated = 0;

  for (const line of lines) {
    const parts = line
      .replace(/^-\s*/, "")
      .split("|")
      .map((p) => p.trim());

    const parsed: Record<string, string> = {};
    for (const part of parts) {
      const [key, ...valueParts] = part.split(":");
      if (key && valueParts.length > 0) {
        parsed[key.trim().toLowerCase()] = valueParts.join(":").trim();
      }
    }

    if (parsed.entity && parsed.type && parsed.fact) {
      try {
        const entity = await upsertEntity(parsed.entity, parsed.type as any);
        await createFact(
          entity.id,
          parsed.fact,
          (parsed.category as any) || "context",
          "document",
          doc.id
        );
        factsCreated++;
      } catch (error) {
        console.error("Failed to create fact:", error);
      }
    }
  }

  return { document: doc, factsCreated };
}

// Get document by ID
export async function getDocument(id: string): Promise<Document | null> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  return doc || null;
}

// List all documents
export async function listDocuments(): Promise<Document[]> {
  return db.select().from(documents).orderBy(sql`created_at DESC`);
}

// Get chunks for a document
export async function getDocumentChunks(
  documentId: string
): Promise<DocumentChunk[]> {
  return db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId))
    .orderBy(documentChunks.chunkIndex);
}
