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
// Planning Prompt (read-only, produces a structured plan)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the planning phase of an autonomous session.
 * The agent reads the codebase and produces a structured plan — no edits.
 */
export function buildPlanningPrompt(task: string, context?: string): string {
  return `
You are planning a code change for the Aurelius HQ codebase — a personal AI assistant
built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL (Neon), and Tailwind CSS v4.
The app runs locally on macOS (not Vercel).

## Your Task
${task}

${context ? `## Additional Context\n${context}` : ''}

## Instructions

You are in PLANNING MODE. Do NOT make any edits. Your job is to:

1. Read and understand the relevant code
2. Identify which files need to change and why
3. Consider edge cases and risks
4. Produce a structured plan

## Output Format

Output your plan in this exact format:

## Plan

### Summary
One paragraph describing the approach.

### Steps
1. [File path] — What to change and why
2. [File path] — What to change and why
...

### Testing
- How to verify the changes work

### Risks
- Any potential issues or things to watch out for

## Key Paths
- Capabilities: src/lib/capabilities/<name>/index.ts
- DB Schema: src/lib/db/schema/
- API Routes: src/app/api/
- Components: src/components/aurelius/
- Config: src/lib/config.ts (typed configKeyEnum)
`.trim();
}

// ---------------------------------------------------------------------------
// Execution Prompt (autonomous, follows the approved plan)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the execution phase of an autonomous session.
 * The agent follows the approved plan, edits, tests, commits, pushes, and creates a PR.
 */
export function buildExecutionPrompt(
  task: string,
  plan: string,
  config: { commitStrategy: 'incremental' | 'single'; maxRetries: number },
): string {
  const commitInstruction = config.commitStrategy === 'incremental'
    ? 'Commit after each logical chunk of work with clear commit messages.'
    : 'Make all changes, then create a single commit at the end.';

  return `
You are working on the Aurelius HQ codebase — a personal AI assistant
built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL (Neon), and Tailwind CSS v4.
The app runs locally on macOS (not Vercel).

## Your Task
${task}

## Approved Plan
Follow this plan. Do not deviate unless you discover something that makes a step impossible.

${plan}

## Execution Rules
- Follow the plan step by step
- ${commitInstruction}
- Run \`npx tsc --noEmit\` after changes to verify no type errors
- Run \`npx vitest run\` if you changed code near existing tests
- If tests fail, debug and fix (up to ${config.maxRetries} attempts per issue, then note the failure)
- If adding a config key, the enum requires a DB migration (ALTER TYPE ... ADD VALUE)
- Tailwind v4 — @tailwindcss/typography is incompatible, use custom CSS
- Use bun (not npm) for package operations

## When Done
1. Ensure all changes are committed
2. Run \`git push -u origin HEAD\` to push the branch
3. Create a PR: \`gh pr create --title "<concise title>" --body "<summary of changes>"\`
4. Output the PR URL as your final message

## Key Paths
- Capabilities: src/lib/capabilities/<name>/index.ts
- DB Schema: src/lib/db/schema/
- API Routes: src/app/api/
- Components: src/components/aurelius/
- Config: src/lib/config.ts (typed configKeyEnum)
`.trim();
}

// ---------------------------------------------------------------------------
// Review Prompt (reads PR diff, outputs structured verdict)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the self-review phase.
 * The agent reads the PR diff and evaluates quality, correctness, and plan adherence.
 */
export function buildReviewPrompt(
  task: string,
  plan: string,
  prDiff: string,
): string {
  return `
You are reviewing a pull request for the Aurelius HQ codebase — a personal AI assistant
built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL (Neon), and Tailwind CSS v4.

## Original Task
${task}

## Approved Plan
${plan}

## PR Diff
\`\`\`diff
${prDiff}
\`\`\`

## Review Instructions

Evaluate the PR against these criteria:

1. **Plan adherence** — Does the code implement what the plan described? Anything missing or extra?
2. **Correctness** — Any bugs, logic errors, off-by-one errors, race conditions?
3. **Type safety** — Any type mismatches, missing null checks, unsafe casts?
4. **Security** — Any injection vulnerabilities, exposed secrets, unsafe user input handling?
5. **Edge cases** — Any unhandled error paths, missing fallbacks?

## Output Format

If the PR looks good:
\`\`\`
APPROVED
\`\`\`

If there are issues to fix:
\`\`\`
ISSUES FOUND:
1. [file path] — Description of the issue
2. [file path] — Description of the issue
...
\`\`\`

Be concise. Only flag real issues — not style preferences or minor nits.
Do NOT flag missing tests unless the plan specifically called for them.
`.trim();
}

// ---------------------------------------------------------------------------
// Fix Prompt (applies fixes from review feedback)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for fixing issues found during review.
 */
export function buildFixPrompt(
  task: string,
  issues: string,
  config: { maxRetries: number },
): string {
  return `
You are fixing issues found during code review on the Aurelius HQ codebase — a personal AI assistant
built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL (Neon), and Tailwind CSS v4.

## Original Task
${task}

## Review Issues to Fix
${issues}

## Instructions
- Fix each issue listed above
- Run \`npx tsc --noEmit\` after changes to verify no type errors
- Run \`npx vitest run\` if you changed code near existing tests
- If a fix fails after ${config.maxRetries} attempts, note it and move on
- Commit your fixes with a clear message
- Push: \`git push\`
- Output "FIXES PUSHED" as your final message

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
