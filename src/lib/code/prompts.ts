/**
 * Prompt Builder for Claude Code Sessions
 *
 * Builds system prompts and generates branch-friendly slugs
 * for coding tasks dispatched to Claude Code CLI.
 */

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the system prompt sent to a Claude Code CLI session.
 *
 * Includes codebase context, the specific task, optional extra context,
 * and standing rules that every session should follow.
 */
export function buildCodePrompt(task: string, context?: string): string {
  return `
You are working on the Aurelius HQ codebase — a personal AI assistant
built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL (Neon), and Tailwind CSS v4.
The app runs locally on macOS (not Vercel).

## Your Task
${task}

${context ? `## Additional Context\n${context}` : ''}

## Rules
- Make focused changes — don't refactor unrelated code
- Run \`npx tsc --noEmit\` before finishing to verify no type errors
- Run \`npx vitest run\` if you changed code near existing tests
- Write clear git commit messages referencing what you changed and why
- If adding a config key, the enum requires a DB migration (ALTER TYPE ... ADD VALUE)
- Tailwind v4 — @tailwindcss/typography is incompatible, use custom CSS
- Use bun (not npm) for package operations

## Key Paths
- Capabilities: src/lib/capabilities/<name>/index.ts
- DB Schema: src/lib/db/schema/
- API Routes: src/app/api/
- Components: src/components/aurelius/
- Config: src/lib/config.ts (typed configKeyEnum)
`.trim();
}

// ---------------------------------------------------------------------------
// Task Slugifier
// ---------------------------------------------------------------------------

/**
 * Convert a task description into a branch-friendly slug.
 *
 * - Lowercase
 * - Strip non-alphanumeric chars (except spaces and hyphens)
 * - Spaces become hyphens
 * - Collapse consecutive hyphens
 * - Truncate to 50 characters
 * - Remove trailing hyphen
 */
export function slugifyTask(task: string): string {
  return task
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}
