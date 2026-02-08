import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createVaultItem } from "@/lib/vault";
import { saveFile } from "@/lib/vault/files";
import { extractText } from "@/lib/vault/extract";
import { classifyVaultItem } from "@/lib/vault/classify";

/**
 * POST /api/vault/upload — Upload a file to the vault
 *
 * Accepts multipart form data with a single "file" field.
 * Saves file to disk, extracts text for search, classifies with Ollama.
 *
 * Returns { item: VaultItem }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // File size limit: 10MB
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      );
    }

    // File type allowlist
    const ALLOWED_TYPES = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
      "text/csv",
      "image/png",
      "image/jpeg",
    ];
    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `File type not supported: ${contentType}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name;

    // Save file to disk
    const filePath = await saveFile(buffer, fileName);

    // Extract text for search
    const textContent = await extractText(buffer, contentType, fileName);

    // Classify with Ollama
    const classification = await classifyVaultItem(textContent, {
      type: "document",
    });

    // Save to DB
    const item = await createVaultItem({
      type: "document",
      title: classification.title,
      content: textContent,
      filePath,
      fileName,
      contentType,
      sensitive: classification.sensitive,
      tags: classification.tags,
    });

    return NextResponse.json({ item });
  } catch (error) {
    console.error("[Vault Upload] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
