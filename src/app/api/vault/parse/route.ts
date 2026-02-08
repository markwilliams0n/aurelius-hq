import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { classifyVaultItem } from "@/lib/vault/classify";
import { extractText } from "@/lib/vault/extract";

/**
 * POST /api/vault/parse — Classify content without saving
 *
 * Body (JSON): { content: string, model?: string, instructions?: string }
 * Body (FormData): file + optional model field
 *
 * Returns { suggestions: VaultClassification, extractedText: string }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    let textContent: string;
    let model: string | undefined;
    let fileName: string | undefined;
    let fileContentType: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      model = (formData.get("model") as string) || undefined;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: "File too large (max 10MB)" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
      fileContentType = file.type || "application/octet-stream";
      textContent = await extractText(buffer, fileContentType, fileName);
    } else {
      const body = await request.json();
      textContent = body.content;
      model = body.model;

      if (!textContent) {
        return NextResponse.json(
          { error: "content is required" },
          { status: 400 }
        );
      }

      if (body.instructions) {
        textContent = `[User instructions: ${body.instructions}]\n\n${textContent}`;
      }
    }

    const suggestions = await classifyVaultItem(
      textContent,
      undefined,
      model ? { model } : undefined
    );

    return NextResponse.json({
      suggestions,
      extractedText: textContent,
      fileName,
      fileContentType,
    });
  } catch (error) {
    console.error("[Vault Parse] Error:", error);
    return NextResponse.json(
      { error: "Failed to parse content" },
      { status: 500 }
    );
  }
}
