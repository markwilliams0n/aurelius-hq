import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const VAULT_DIR = path.join(process.cwd(), "data", "vault", "files");

/** Ensure vault directory exists */
async function ensureDir() {
  await fs.mkdir(VAULT_DIR, { recursive: true });
}

/** Save a file to the vault directory, return the path */
export async function saveFile(
  buffer: Buffer,
  originalName: string
): Promise<string> {
  await ensureDir();
  const ext = path.extname(originalName);
  const filename = `${randomUUID()}${ext}`;
  const filePath = path.join(VAULT_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/** Read a file from the vault directory */
export async function readFile(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

/** Delete a file from the vault directory */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}
