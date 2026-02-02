import { NextResponse } from "next/server";
import { getInboxItems } from "../../route";

// POST /api/triage/[id]/memory - Extract memory from triage item
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const items = getInboxItems();
  const item = items.find((i) => i.externalId === id);

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // For now, return simulated extracted facts
  // In production, this would call the AI to extract facts
  const extractedFacts = simulateFactExtraction(item);

  return NextResponse.json({
    success: true,
    itemId: id,
    facts: extractedFacts,
    message: `Extracted ${extractedFacts.length} facts from this item`,
  });
}

// Simulate fact extraction (replace with actual AI call later)
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

    // If it's an email, extract company
    if (item.connector === "gmail" && item.sender) {
      const domain = item.sender.split("@")[1];
      if (domain && !domain.includes("gmail") && !domain.includes("hotmail")) {
        facts.push({
          id: crypto.randomUUID(),
          content: `${item.senderName} works at ${domain.split(".")[0]}`,
          category: "relationship",
          entityName: item.senderName,
          entityType: "person",
        });
      }
    }
  }

  // Extract based on priority and tags
  if (item.priority === "urgent" || item.priority === "high") {
    facts.push({
      id: crypto.randomUUID(),
      content: `High priority item from ${item.senderName || item.sender}: "${item.subject}"`,
      category: "status",
      entityName: item.senderName || item.sender,
      entityType: "person",
    });
  }

  // Extract project-related facts from Linear
  if (item.connector === "linear") {
    facts.push({
      id: crypto.randomUUID(),
      content: `Issue "${item.subject}" in project ${item.sender}`,
      category: "context",
      entityName: item.sender,
      entityType: "project",
    });
  }

  // Extract mentions of specific topics
  const content = item.content?.toLowerCase() || "";
  const subject = item.subject?.toLowerCase() || "";

  if (content.includes("meeting") || subject.includes("meeting")) {
    facts.push({
      id: crypto.randomUUID(),
      content: `${item.senderName || item.sender} discussed scheduling a meeting`,
      category: "context",
      entityName: item.senderName || item.sender,
      entityType: "person",
    });
  }

  if (content.includes("deadline") || content.includes("due date")) {
    facts.push({
      id: crypto.randomUUID(),
      content: `${item.senderName || item.sender} mentioned an upcoming deadline`,
      category: "milestone",
      entityName: item.senderName || item.sender,
      entityType: "person",
    });
  }

  if (content.includes("budget") || content.includes("cost") || content.includes("price")) {
    facts.push({
      id: crypto.randomUUID(),
      content: `Financial discussion with ${item.senderName || item.sender} about ${item.subject}`,
      category: "context",
      entityName: item.senderName || item.sender,
      entityType: "person",
    });
  }

  return facts;
}
