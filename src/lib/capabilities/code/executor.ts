/**
 * Claude Code Session Executor
 *
 * Spawns `claude` CLI processes in isolated git worktrees and parses
 * their NDJSON streaming output into typed progress events.
 *
 * The CLI is invoked with --output-format stream-json, which emits
 * one JSON object per line on stdout. We parse these to surface
 * thinking, tool calls, tool results, and milestones back to the
 * orchestrator.
 *
 * Security: The subprocess env is stripped to only safe variables.
 * ANTHROPIC_API_KEY is explicitly excluded so the CLI uses the
 * user's Max subscription rather than a leaked server key.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'milestone';
  text?: string;
  tool?: string;
  input?: string;
}

export interface SessionResult {
  sessionId?: string;
  turns: number;
  durationMs: number;
  costUsd: number | null;
}

export interface CodeSessionOptions {
  sessionId: string;
  prompt: string;
  worktreePath: string;
  maxTurns: number;
  timeoutMs: number;
  onProgress: (event: ProgressEvent) => void;
  onComplete: (result: SessionResult) => void;
  onError: (error: Error) => void;
}

export interface ActiveSession {
  pid: number;
  kill: () => void;
  process: ChildProcess;
}

// ---------------------------------------------------------------------------
// Allowed tools
// ---------------------------------------------------------------------------

const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git:*)',
  'Bash(npx tsc:*)',
  'Bash(npx vitest:*)',
  'Bash(bun add:*)',
  'Bash(bun run:*)',
  'Bash(bun install:*)',
  'Bash(bunx drizzle-kit:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
] as const;

// ---------------------------------------------------------------------------
// Safe environment
// ---------------------------------------------------------------------------

const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'SHELL',
  'LANG',
  'NODE_ENV',
  'TERM',
] as const;

/**
 * Build a minimal, safe environment for the child process.
 *
 * Only passes through known-safe vars from the parent process env.
 * Explicitly omits ANTHROPIC_API_KEY and all other secrets so the
 * CLI authenticates via the user's Max subscription.
 */
function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Disable telemetry / non-essential network calls
  env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';

  return env;
}

// ---------------------------------------------------------------------------
// Tool input summarization
// ---------------------------------------------------------------------------

/**
 * Produce a short human-readable summary of a tool's input for
 * progress display. Keeps it to ~120 chars max.
 */
function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';

  const obj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Read':
      return typeof obj.file_path === 'string' ? obj.file_path : '';

    case 'Edit':
      return typeof obj.file_path === 'string' ? obj.file_path : '';

    case 'Write':
      return typeof obj.file_path === 'string' ? obj.file_path : '';

    case 'Glob':
      return typeof obj.pattern === 'string' ? obj.pattern : '';

    case 'Grep':
      return typeof obj.pattern === 'string' ? obj.pattern : '';

    case 'Bash': {
      const cmd = typeof obj.command === 'string' ? obj.command : '';
      // Truncate long commands for display
      return cmd.length > 120 ? cmd.slice(0, 117) + '...' : cmd;
    }

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// NDJSON stream parser
// ---------------------------------------------------------------------------

/**
 * Parse the NDJSON stream from `claude --output-format stream-json`.
 *
 * Each line is a JSON object with a `type` field. We care about:
 * - `assistant`: contains content blocks (text or tool_use)
 * - `result`: final summary with session_id, num_turns, etc.
 *
 * Content blocks live in `event.message.content[]` for assistant
 * messages. Each block has a `type` of `text` or `tool_use`.
 */
function parseStream(
  stdout: NodeJS.ReadableStream,
  onProgress: (event: ProgressEvent) => void,
  onComplete: (result: SessionResult) => void,
): void {
  const rl = createInterface({ input: stdout, crlfDelay: Infinity });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON line — skip silently (claude CLI sometimes emits
      // status text before the stream starts)
      return;
    }

    const eventType = event.type as string | undefined;

    if (eventType === 'assistant') {
      // Extract content blocks from the message
      const message = event.message as Record<string, unknown> | undefined;
      const contentBlocks = (message?.content ?? event.content) as
        | Array<Record<string, unknown>>
        | undefined;

      if (!Array.isArray(contentBlocks)) return;

      for (const block of contentBlocks) {
        if (block.type === 'text' && typeof block.text === 'string') {
          onProgress({
            type: 'thinking',
            text: block.text,
          });
        } else if (block.type === 'tool_use') {
          const toolName = (block.name as string) ?? 'unknown';
          const toolInput = block.input;
          onProgress({
            type: 'tool_call',
            tool: toolName,
            input: summarizeToolInput(toolName, toolInput),
          });
        }
      }
    } else if (eventType === 'result') {
      onComplete({
        sessionId: (event.session_id as string) ?? undefined,
        turns: (event.num_turns as number) ?? 0,
        durationMs: (event.duration_ms as number) ?? 0,
        costUsd: (event.total_cost_usd as number) ?? null,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Spawn a Claude Code CLI session in an isolated worktree.
 *
 * Returns an ActiveSession handle that the caller can use to
 * monitor or kill the process. Progress, completion, and errors
 * are delivered via the callbacks in `options`.
 */
export function startSession(options: CodeSessionOptions): ActiveSession {
  const {
    prompt,
    worktreePath,
    maxTurns,
    timeoutMs,
    onProgress,
    onComplete,
    onError,
  } = options;

  // Build the CLI arguments
  const args: string[] = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--max-turns', String(maxTurns),
    '--permission-mode', 'acceptEdits',
    '--no-session-persistence',
  ];

  // Append each allowed tool
  for (const tool of ALLOWED_TOOLS) {
    args.push('--allowedTools', tool);
  }

  // Spawn the CLI
  // Cast env to ProcessEnv — our stripped env is intentionally sparse
  // but spawn() expects the full ProcessEnv type.
  const child = spawn('claude', args, {
    cwd: worktreePath,
    env: buildSafeEnv() as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcess;

  // Track whether we've already fired a terminal callback
  let settled = false;

  const settle = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    return true;
  };

  // Timeout guard — kill the process if it runs too long
  const timer = setTimeout(() => {
    if (!settled) {
      child.kill('SIGTERM');
      // Give it 5s to clean up, then force-kill
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5_000);

      if (settle()) {
        onError(new Error(`Session timed out after ${timeoutMs}ms`));
      }
    }
  }, timeoutMs);

  // Parse stdout NDJSON stream
  if (child.stdout) {
    parseStream(child.stdout, onProgress, (result) => {
      if (settle()) {
        onComplete(result);
      }
    });
  }

  // Log stderr (diagnostic output from the CLI)
  if (child.stderr) {
    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrRl.on('line', (line: string) => {
      console.error(`[code-executor:stderr] ${line}`);
    });
  }

  // Handle process exit
  child.on('error', (err) => {
    if (settle()) {
      onError(new Error(`Failed to spawn claude CLI: ${err.message}`));
    }
  });

  child.on('exit', (code, signal) => {
    if (settle()) {
      // If we get here without having fired onComplete from the
      // stream, it means the process exited before emitting a
      // result event. Treat non-zero as an error.
      if (code !== 0) {
        const reason = signal
          ? `killed by signal ${signal}`
          : `exited with code ${code}`;
        onError(new Error(`Claude CLI ${reason}`));
      } else {
        // Exited cleanly but no result event — unusual but not fatal.
        // Fire onComplete with zero values so the caller isn't left
        // hanging.
        onComplete({
          sessionId: undefined,
          turns: 0,
          durationMs: 0,
          costUsd: null,
        });
      }
    }
  });

  const pid = child.pid ?? 0;

  return {
    pid,
    kill: () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
    process: child,
  };
}
