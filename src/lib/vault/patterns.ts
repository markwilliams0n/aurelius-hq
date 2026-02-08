/** Patterns that indicate sensitive data — shared across classify + supermemory */
export const SENSITIVE_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN (with dashes)
  /\b[A-Z]\d{8}\b/, // US passport (letter + 8 digits)
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit card
];

/** Redact sensitive patterns from content (for sending to LLMs or SuperMemory) */
export function redactSensitiveContent(content: string): string {
  return content
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]")
    .replace(/\b[A-Z]\d{8}\b/g, "[REDACTED]")
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[REDACTED]");
}
