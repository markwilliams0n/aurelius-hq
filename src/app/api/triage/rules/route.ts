import { NextResponse } from "next/server";
import { getAllRules, createRule } from "@/lib/triage/rules";
import { parseNaturalLanguageRule } from "@/lib/triage/rules-ai";

// GET /api/triage/rules — list all rules
export async function GET() {
  try {
    const rules = await getAllRules();
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("[Rules API] Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules" },
      { status: 500 }
    );
  }
}

// POST /api/triage/rules — create a rule
// Body can be either:
//   { input: "natural language instruction" }  → parsed via AI
//   { name, type, trigger, action, ... }       → created directly
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.input && typeof body.input === "string") {
      // Natural language path: parse then create
      const parsed = await parseNaturalLanguageRule(body.input);

      const rule = await createRule({
        name: parsed.name,
        description: parsed.description,
        type: parsed.type,
        source: parsed.source,
        trigger: parsed.trigger ?? null,
        action: parsed.action ?? null,
        guidance: parsed.guidance ?? null,
      });

      return NextResponse.json({ rule, parsed: true }, { status: 201 });
    }

    // Direct creation path: body has the rule fields
    if (!body.name || !body.type || !body.source) {
      return NextResponse.json(
        { error: "Missing required fields: name, type, source" },
        { status: 400 }
      );
    }

    const rule = await createRule({
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      source: body.source,
      trigger: body.trigger ?? null,
      action: body.action ?? null,
      guidance: body.guidance ?? null,
      status: body.status ?? "active",
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error("[Rules API] Failed to create rule:", error);
    return NextResponse.json(
      { error: "Failed to create rule" },
      { status: 500 }
    );
  }
}
