/**
 * macOS Native Notifications
 *
 * Sends native macOS notifications via osascript.
 * Only works on macOS (silently no-ops on other platforms).
 */

import { exec } from "child_process";

const IS_MACOS = process.platform === "darwin";

/** Escape a string for use inside AppleScript double-quoted strings */
function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Strip Markdown/HTML formatting for clean notification text */
function stripFormatting(text: string): string {
  return text
    .replace(/[*_`~]/g, "")           // Markdown bold/italic/code/strikethrough
    .replace(/<[^>]+>/g, "")           // HTML tags
    .replace(/\n{2,}/g, "\n")          // Collapse multiple newlines
    .trim();
}

interface NotifyOptions {
  /** Subtitle line (shown below title) */
  subtitle?: string;
  /** Sound name — set to false for silent. Default: "default" */
  sound?: string | false;
}

/**
 * Send a macOS native notification.
 *
 * @param title - Bold title line (e.g. "Aurelius")
 * @param body  - Body text (Markdown/HTML stripped automatically)
 * @param options - Optional subtitle and sound
 */
export async function notifyMacOS(
  title: string,
  body: string,
  options?: NotifyOptions,
): Promise<void> {
  if (!IS_MACOS) return;

  const cleanBody = stripFormatting(body).slice(0, 200);
  const cleanTitle = stripFormatting(title).slice(0, 100);

  let script = `display notification "${escapeAppleScript(cleanBody)}" with title "${escapeAppleScript(cleanTitle)}"`;

  if (options?.subtitle) {
    script += ` subtitle "${escapeAppleScript(stripFormatting(options.subtitle).slice(0, 100))}"`;
  }

  if (options?.sound !== false) {
    script += ` sound name "${options?.sound || "default"}"`;
  }

  return new Promise((resolve) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
      if (err) {
        console.error("[notifications] osascript failed:", err.message);
      }
      resolve(); // Always resolve — notifications are best-effort
    });
  });
}
