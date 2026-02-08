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

/** Validate that a path is within the vault directory */
function assertWithinVault(filePath: string): void {
  const resolved = path.resolve(filePath);
  const vaultDir = path.resolve(VAULT_DIR);
  if (!resolved.startsWith(vaultDir + path.sep) && resolved !== vaultDir) {
    throw new Error("Invalid file path: outside vault directory");
  }
}

/** Read a file from the vault directory */
export async function readFile(filePath: string): Promise<Buffer> {
  assertWithinVault(filePath);
  return fs.readFile(filePath);
}

/** Delete a file from the vault directory */
export async function deleteFile(filePath: string): Promise<void> {
  assertWithinVault(filePath);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}
