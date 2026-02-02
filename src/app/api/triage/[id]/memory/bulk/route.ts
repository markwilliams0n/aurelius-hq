import { NextResponse } from "next/server";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";
import { appendToDailyNote } from "@/lib/memory/daily-notes";

interface ExtractedEntity {
  name: string;
  type: "person" | "company" | "project";
  role?: string;
  facts: string[];
}

interface ExtractedFact {
  content: string;
  category: "status" | "preference" | "relationship" | "context" | "milestone";
  entityName?: string;
  confidence: string;
}

interface ExtractedMemory {
  entities?: ExtractedEntity[];
  facts?: ExtractedFact[];
  actionItems?: Array<{ description: string; assignee?: string }>;
  summary?: string;
  topics?: string[];
}

// POST /api/triage/[id]/memory/bulk - Save all extracted memory
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const extractedMemory = body.extractedMemory as ExtractedMemory;

    if (!extractedMemory) {
      return NextResponse.json({ error: "No extracted memory provided" }, { status: 400 });
    }

    let savedCount = 0;
    const errors: string[] = [];

    // Save entities and their facts
    if (extractedMemory.entities) {
      for (const entity of extractedMemory.entities) {
        try {
          // Create/update the entity
          const savedEntity = await upsertEntity(entity.name, entity.type, {
            role: entity.role,
            sourceItemId: id,
          });

          savedCount++;

          // Save facts associated with this entity
          for (const factContent of entity.facts) {
            try {
              await createFact(
                savedEntity.id,
                factContent,
                "context",
                "document", // from Granola document
                id
              );
              savedCount++;
            } catch (factError) {
              console.error(`Failed to save fact for ${entity.name}:`, factError);
              errors.push(`Fact for ${entity.name}: ${factContent.slice(0, 30)}...`);
            }
          }
        } catch (entityError) {
          console.error(`Failed to save entity ${entity.name}:`, entityError);
          errors.push(`Entity: ${entity.name}`);
        }
      }
    }

    // Save standalone facts
    if (extractedMemory.facts) {
      for (const fact of extractedMemory.facts) {
        try {
          // If fact has an associated entity, find or create it
          let entityId: string | null = null;
          if (fact.entityName) {
            const entity = await upsertEntity(fact.entityName, "person", {});
            entityId = entity.id;
          }

          if (entityId) {
            await createFact(
              entityId,
              fact.content,
              fact.category as "status" | "preference" | "relationship" | "context" | "milestone",
              "document",
              id
            );
          } else {
            // Create a general fact without entity association
            // For now, skip facts without entities
            console.log(`Skipping fact without entity: ${fact.content.slice(0, 50)}...`);
          }
          savedCount++;
        } catch (factError) {
          console.error(`Failed to save fact:`, factError);
          errors.push(`Fact: ${fact.content.slice(0, 30)}...`);
        }
      }
    }

    // Append summary to daily notes if present
    if (extractedMemory.summary) {
      try {
        const noteEntry = `### Meeting Memory Saved

**Summary:** ${extractedMemory.summary}

${extractedMemory.topics?.length ? `**Topics:** ${extractedMemory.topics.join(", ")}` : ""}

${extractedMemory.actionItems?.length ? `**Action Items:**\n${extractedMemory.actionItems.map(a => `- ${a.description}${a.assignee ? ` (@${a.assignee})` : ""}`).join("\n")}` : ""}

*${savedCount} items saved to memory*
`;
        await appendToDailyNote(noteEntry);
      } catch (noteError) {
        console.error("Failed to append to daily notes:", noteError);
      }
    }

    return NextResponse.json({
      success: true,
      saved: savedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Bulk memory save failed:", error);
    return NextResponse.json(
      { error: "Failed to save memory", details: String(error) },
      { status: 500 }
    );
  }
}
