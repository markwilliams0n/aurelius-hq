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
import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';

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
// Session log — file-based so we can debug from CLI
// ---------------------------------------------------------------------------

const LOG_DIR = path.resolve(process.cwd(), 'logs', 'code-sessions');

/** Append a timestamped line to a session's log file. */
function sessionLog(sessionId: string, level: 'info' | 'error', message: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}\n`;
    appendFileSync(path.join(LOG_DIR, `${sessionId}.log`), line);
  } catch {
    // Best effort — don't crash if logging fails
  }
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

/**
 * Env vars to strip from the child process. We use a blocklist
 * approach — pass through everything EXCEPT known-dangerous keys.
 * This preserves macOS Keychain access, credential paths, and other
 * system vars the CLI needs for authentication.
 */
const BLOCKED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'NEON_DATABASE_URL',
  'DIRECT_URL',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SUPERMEMORY_API_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
];

/**
 * Build a safe environment for the child process.
 *
 * Passes through all env vars EXCEPT API keys and secrets.
 * This ensures the CLI can authenticate via the user's Max
 * subscription (needs keychain/credential access) while preventing
 * leakage of server-side secrets.
 */
function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !BLOCKED_ENV_KEYS.includes(key)) {
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
    case 'Edit':
    case 'Write':
      return typeof obj.file_path === 'string' ? obj.file_path : '';

    case 'Glob':
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
  log: (level: 'info' | 'error', msg: string) => void,
  onProgress: (event: ProgressEvent) => void,
  onComplete: (result: SessionResult) => void,
  onError: (error: Error) => void,
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
          // Log text responses so we can debug what Claude says
          log('info', `Text: ${block.text.slice(0, 500)}`);
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
      const isError = event.is_error === true || event.subtype === 'error';
      const resultText = typeof event.result === 'string' ? event.result : '';

      log('info', `Result event — is_error: ${isError}, subtype: ${event.subtype}, turns: ${event.num_turns}, cost: $${event.total_cost_usd ?? '?'}`);
      if (resultText) {
        log('info', `Result text: ${resultText.slice(0, 500)}`);
      }

      if (isError) {
        onError(new Error(resultText || 'Claude CLI returned an error result'));
      } else {
        onComplete({
          sessionId: event.session_id as string | undefined,
          turns: (event.num_turns as number | undefined) ?? 0,
          durationMs: (event.duration_ms as number | undefined) ?? 0,
          costUsd: (event.total_cost_usd as number | undefined) ?? null,
        });
      }
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
    sessionId,
    prompt,
    worktreePath,
    maxTurns,
    timeoutMs,
    onProgress,
    onComplete,
    onError,
  } = options;

  const log = (level: 'info' | 'error', msg: string) => sessionLog(sessionId, level, msg);

  const args: string[] = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(maxTurns),
    '--permission-mode', 'acceptEdits',
    '--no-session-persistence',
  ];

  for (const tool of ALLOWED_TOOLS) {
    args.push('--allowedTools', tool);
  }

  log('info', `Starting session in ${worktreePath}`);
  log('info', `Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`);
  log('info', `Max turns: ${maxTurns}, timeout: ${timeoutMs}ms`);

  const child = spawn('claude', args, {
    cwd: worktreePath,
    env: buildSafeEnv() as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  log('info', `Spawned claude CLI, PID: ${child.pid ?? 'unknown'}`);

  // Ensure only one terminal callback fires (complete, error, or timeout)
  let settled = false;
  let sigkillTimer: NodeJS.Timeout | null = null;

  const settle = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
    return true;
  };

  // Timeout guard — kill the process if it runs too long
  const timer = setTimeout(() => {
    if (!settled) {
      child.kill('SIGTERM');
      sigkillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5_000);

      if (settle()) {
        onError(new Error(`Session timed out after ${timeoutMs}ms`));
      }
    }
  }, timeoutMs);

  if (child.stdout) {
    parseStream(
      child.stdout,
      log,
      (event) => {
        if (event.type === 'tool_call') {
          log('info', `Tool: ${event.tool} ${event.input ?? ''}`);
        }
        onProgress(event);
      },
      (result) => {
        log('info', `Complete — turns: ${result.turns}, duration: ${result.durationMs}ms, cost: $${result.costUsd ?? '?'}`);
        if (settle()) {
          onComplete(result);
        }
      },
      (error) => {
        log('error', `Stream error: ${error.message}`);
        if (settle()) {
          onError(error);
        }
      },
    );
  }

  if (child.stderr) {
    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrRl.on('line', (line: string) => {
      log('error', `stderr: ${line}`);
      console.error(`[code-executor:stderr] ${line}`);
    });
  }

  child.on('error', (err) => {
    log('error', `Spawn error: ${err.message}`);
    if (settle()) {
      onError(new Error(`Failed to spawn claude CLI: ${err.message}`));
    }
  });

  child.on('exit', (code, signal) => {
    log('info', `Process exited — code: ${code}, signal: ${signal}`);
    if (settle()) {
      if (code !== 0) {
        const reason = signal
          ? `killed by signal ${signal}`
          : `exited with code ${code}`;
        log('error', `Session failed: ${reason}`);
        onError(new Error(`Claude CLI ${reason}`));
      } else {
        log('info', 'Session exited cleanly (no result event)');
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
