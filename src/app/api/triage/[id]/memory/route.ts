import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";
import { appendToDailyNote } from "@/lib/memory/daily-notes";

// POST /api/triage/[id]/memory - Extract memory from triage item
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Query database for the item
  const items = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.externalId, id))
    .limit(1);

  const item = items[0];

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  try {
    // Extract and save facts to the real memory system
    const savedFacts = await extractAndSaveTriageMemory(item);

    return NextResponse.json({
      success: true,
      itemId: id,
      facts: savedFacts,
      message: `Extracted ${savedFacts.length} facts from this item`,
    });
  } catch (error) {
    console.error("Failed to extract memory:", error);

    // Fall back to simulated extraction if database isn't available
    const simulatedFacts = simulateFactExtraction(item);
    return NextResponse.json({
      success: true,
      itemId: id,
      facts: simulatedFacts,
      message: `Extracted ${simulatedFacts.length} facts (simulated)`,
      simulated: true,
    });
  }
}

// Extract facts from triage item and save to memory system
async function extractAndSaveTriageMemory(item: any): Promise<
  Array<{
    id: string;
    content: string;
    category: string;
    entityName: string;
    entityType: string;
  }>
> {
  const savedFacts: Array<{
    id: string;
    content: string;
    category: string;
    entityName: string;
    entityType: string;
  }> = [];

  // 1. Create/update sender entity
  if (item.senderName || item.sender) {
    const senderName = item.senderName || item.sender;
    const entityType = determineEntityType(item);

    try {
      const entity = await upsertEntity(senderName, entityType, {
        email: item.sender,
        connector: item.connector,
        lastContactedAt: new Date().toISOString(),
      });

      // Save fact about the contact
      const factContent = `${senderName} contacted us about: "${item.subject}"`;
      const fact = await createFact(
        entity.id,
        factContent,
        "context",
        "chat", // source type - using "chat" for triage
        item.externalId
      );

      savedFacts.push({
        id: fact.id,
        content: factContent,
        category: "context",
        entityName: senderName,
        entityType,
      });

      // If high priority, save that as a status fact
      if (item.priority === "urgent" || item.priority === "high") {
        const priorityFact = await createFact(
          entity.id,
          `High priority item from ${senderName}: "${item.subject}" requires attention`,
          "status",
          "chat",
          item.externalId
        );

        savedFacts.push({
          id: priorityFact.id,
          content: priorityFact.content,
          category: "status",
          entityName: senderName,
          entityType,
        });
      }
    } catch (error) {
      console.error("Failed to save sender entity:", error);
    }
  }

  // 2. Extract company from email domain
  if (item.connector === "gmail" && item.sender?.includes("@")) {
    const domain = item.sender.split("@")[1];
    if (domain && !isPersonalDomain(domain)) {
      const companyName = domainToCompanyName(domain);
      const senderName = item.senderName || item.sender;

      try {
        const companyEntity = await upsertEntity(companyName, "company", {
          domain,
        });

        // Create relationship fact
        const relationshipFact = await createFact(
          companyEntity.id,
          `${senderName} works at ${companyName}`,
          "relationship",
          "chat",
          item.externalId
        );

        savedFacts.push({
          id: relationshipFact.id,
          content: relationshipFact.content,
          category: "relationship",
          entityName: companyName,
          entityType: "company",
        });
      } catch (error) {
        console.error("Failed to save company entity:", error);
      }
    }
  }

  // 3. For Linear items, extract project context
  if (item.connector === "linear" && item.sender) {
    try {
      const projectEntity = await upsertEntity(item.sender, "project", {
        source: "linear",
      });

      const projectFact = await createFact(
        projectEntity.id,
        `Issue "${item.subject}" in project ${item.sender}`,
        "context",
        "chat",
        item.externalId
      );

      savedFacts.push({
        id: projectFact.id,
        content: projectFact.content,
        category: "context",
        entityName: item.sender,
        entityType: "project",
      });
    } catch (error) {
      console.error("Failed to save project entity:", error);
    }
  }

  // 4. Save to daily notes for context
  try {
    const noteEntry = formatTriageNoteEntry(item, savedFacts.length);
    await appendToDailyNote(noteEntry);
  } catch (error) {
    console.error("Failed to save to daily notes:", error);
  }

  return savedFacts;
}

// Determine entity type based on connector
function determineEntityType(item: any): "person" | "project" | "team" {
  if (item.connector === "linear") {
    return "project";
  }
  if (item.connector === "slack" && item.sender?.startsWith("#")) {
    return "team";
  }
  return "person";
}

// Check if domain is personal
function isPersonalDomain(domain: string): boolean {
  const personalDomains = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "protonmail.com",
    "aol.com",
    "live.com",
    "msn.com",
  ];
  return personalDomains.includes(domain.toLowerCase());
}

// Convert domain to company name
function domainToCompanyName(domain: string): string {
  return domain
    .replace(/\.(com|io|co|net|org|dev|app|ai)$/i, "")
    .split(".")[0]
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Format entry for daily notes
function formatTriageNoteEntry(item: any, factCount: number): string {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `### Triage: ${item.subject} (${timestamp})

**From:** ${item.senderName || item.sender}
**Source:** ${item.connector}
**Priority:** ${item.priority}

${factCount} facts extracted and saved to memory.
`;
}

// Fallback simulation when database isn't available
function simulateFactExtraction(item: any): Array<{
  id: string;
  content: string;
  category: string;
  entityName: string;
  entityType: string;
}> {
  const facts: Array<{
    id: string;
    content: string;
    category: string;
    entityName: string;
    entityType: string;
  }> = [];

  // Extract sender-related facts
  if (item.senderName) {
    facts.push({
      id: crypto.randomUUID(),
      content: `${item.senderName} contacted us about: ${item.subject}`,
      category: "context",
      entityName: item.senderName,
      entityType: "person",
    });

    if (item.connector === "gmail" && item.sender) {
      const domain = item.sender.split("@")[1];
      if (domain && !isPersonalDomain(domain)) {
        facts.push({
          id: crypto.randomUUID(),
          content: `${item.senderName} works at ${domainToCompanyName(domain)}`,
          category: "relationship",
          entityName: item.senderName,
          entityType: "person",
        });
      }
    }
  }

  if (item.priority === "urgent" || item.priority === "high") {
    facts.push({
      id: crypto.randomUUID(),
      content: `High priority item from ${item.senderName || item.sender}: "${item.subject}"`,
      category: "status",
      entityName: item.senderName || item.sender,
      entityType: "person",
    });
  }

  if (item.connector === "linear") {
    facts.push({
      id: crypto.randomUUID(),
      content: `Issue "${item.subject}" in project ${item.sender}`,
      category: "context",
      entityName: item.sender,
      entityType: "project",
    });
  }

  return facts;
}
