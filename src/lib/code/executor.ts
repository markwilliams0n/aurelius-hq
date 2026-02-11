/**
 * Claude Code Session Executor
 *
 * Spawns `claude` CLI processes in isolated git worktrees using
 * bidirectional stream-json mode. The CLI stays alive across
 * multiple turns — the user can send follow-up messages via stdin
 * and Claude responds via new assistant + result events on stdout.
 *
 * Protocol:
 *   - CLI is started with --input-format stream-json --output-format stream-json
 *   - System prompt is passed via --append-system-prompt
 *   - Task is sent as the first user message on stdin
 *   - Each user message triggers a new assistant response + result event
 *   - Closing stdin ends the session gracefully
 *
 * Security: The subprocess env passes through everything EXCEPT
 * known API keys/secrets, so the CLI can authenticate via the
 * user's Max subscription.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'result';
  text?: string;
  tool?: string;
  input?: string;
}

export interface SessionResult {
  sessionId?: string;
  turns: number;
  durationMs: number;
  costUsd: number | null;
  text: string;
}

export type SessionState = 'running' | 'waiting_for_input' | 'completed' | 'error';

export interface CodeSessionOptions {
  sessionId: string;
  systemPrompt: string;
  task: string;
  worktreePath: string;
  onProgress: (event: ProgressEvent) => void;
  onResult: (result: SessionResult) => void;
  onError: (error: Error) => void;
}

export interface ActiveSession {
  pid: number;
  kill: () => void;
  process: ChildProcess;
  state: SessionState;
  sendMessage: (text: string) => void;
  closeInput: () => void;
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
  'Bash(tsc:*)',
  'Bash(npx tsc:*)',
  'Bash(vitest:*)',
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
  'Bash(npx agent-browser:*)',
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
 * - `result`: turn summary — fires after each assistant response
 *
 * In bidirectional mode, multiple result events can fire (one per
 * user→assistant turn). The process stays alive between them.
 */
function parseStream(
  stdout: NodeJS.ReadableStream,
  log: (level: 'info' | 'error', msg: string) => void,
  onProgress: (event: ProgressEvent) => void,
  onResult: (result: SessionResult) => void,
  onError: (error: Error) => void,
): void {
  const rl = createInterface({ input: stdout, crlfDelay: Infinity });

  // Collect the last text block from each assistant turn so we can
  // include it in the result event for display in the UI
  let lastTextForTurn = '';

  rl.on('line', (line: string) => {
    if (!line.trim()) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    const eventType = event.type as string | undefined;

    if (eventType === 'assistant') {
      const message = event.message as Record<string, unknown> | undefined;
      const contentBlocks = (message?.content ?? event.content) as
        | Array<Record<string, unknown>>
        | undefined;

      if (!Array.isArray(contentBlocks)) return;

      for (const block of contentBlocks) {
        if (block.type === 'text' && typeof block.text === 'string') {
          log('info', `Text: ${block.text.slice(0, 500)}`);
          lastTextForTurn = block.text;
          onProgress({ type: 'thinking', text: block.text });
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
        const result: SessionResult = {
          sessionId: event.session_id as string | undefined,
          turns: (event.num_turns as number | undefined) ?? 0,
          durationMs: (event.duration_ms as number | undefined) ?? 0,
          costUsd: (event.total_cost_usd as number | undefined) ?? null,
          text: lastTextForTurn || resultText,
        };

        // Emit as a progress event too, so the handler can see it
        onProgress({ type: 'result', text: lastTextForTurn });
        onResult(result);
      }

      // Reset for next turn
      lastTextForTurn = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Stdin message formatting
// ---------------------------------------------------------------------------

/**
 * Build an NDJSON user message for the stream-json stdin protocol.
 */
function buildStdinMessage(text: string): string {
  const msg = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  };
  return JSON.stringify(msg) + '\n';
}

// ---------------------------------------------------------------------------
// Autonomous session (headless, no stdin)
// ---------------------------------------------------------------------------

export interface AutonomousSessionOptions {
  sessionId: string;
  systemPrompt: string;
  task: string;
  worktreePath: string;
  maxCostUsd: number;
  maxDurationMinutes: number;
  onProgress: (event: ProgressEvent) => void;
  onResult: (result: SessionResult) => void;
  onError: (error: Error) => void;
  onCostUpdate?: (costUsd: number) => void;
}

export interface AutonomousSession {
  pid: number;
  kill: () => void;
  process: ChildProcess;
  state: SessionState;
}

/**
 * Spawn an autonomous Claude Code CLI session.
 *
 * Uses --dangerously-skip-permissions — the worktree IS the sandbox.
 * No stdin interaction. The task is passed via -p flag.
 * Monitors cost and duration, kills at configured ceilings.
 */
export function startAutonomousSession(options: AutonomousSessionOptions): AutonomousSession {
  const {
    sessionId,
    systemPrompt,
    task,
    worktreePath,
    maxCostUsd,
    maxDurationMinutes,
    onProgress,
    onResult,
    onError,
    onCostUpdate,
  } = options;

  const log = (level: 'info' | 'error', msg: string) => sessionLog(sessionId, level, msg);

  const args: string[] = [
    '-p', task,
    '--append-system-prompt', systemPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  log('info', `Starting autonomous session in ${worktreePath}`);
  log('info', `Task: ${task.slice(0, 200)}${task.length > 200 ? '...' : ''}`);
  log('info', `Limits: cost=$${maxCostUsd}, duration=${maxDurationMinutes}min`);

  const child = spawn('claude', args, {
    cwd: worktreePath,
    env: buildSafeEnv() as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  log('info', `Spawned autonomous claude CLI, PID: ${child.pid ?? 'unknown'}`);

  // Close stdin immediately — no interaction
  if (child.stdin) {
    child.stdin.end();
  }

  let sessionState: SessionState = 'running';
  let lastKnownCost = 0;
  const startTime = Date.now();

  // Duration ceiling timer
  const durationTimer = setTimeout(() => {
    if (sessionState === 'running') {
      log('error', `Duration ceiling hit: ${maxDurationMinutes} minutes`);
      sessionState = 'error';
      child.kill('SIGTERM');
      onError(new Error(`Session killed: exceeded ${maxDurationMinutes} minute time limit`));
    }
  }, maxDurationMinutes * 60 * 1000);

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
        // Track cost and check ceiling
        if (result.costUsd !== null) {
          lastKnownCost = result.costUsd;
          onCostUpdate?.(lastKnownCost);

          if (lastKnownCost >= maxCostUsd) {
            log('error', `Cost ceiling hit: $${lastKnownCost} >= $${maxCostUsd}`);
            sessionState = 'error';
            child.kill('SIGTERM');
            onError(new Error(`Session killed: cost $${lastKnownCost.toFixed(2)} exceeded $${maxCostUsd} limit`));
            return;
          }
        }

        log('info', `Turn complete — turns: ${result.turns}, cost: $${result.costUsd ?? '?'}`);
        // In autonomous mode, result events are informational — session keeps going
        onResult(result);
      },
      (error) => {
        log('error', `Stream error: ${error.message}`);
        sessionState = 'error';
        onError(error);
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
    clearTimeout(durationTimer);
    log('error', `Spawn error: ${err.message}`);
    sessionState = 'error';
    onError(new Error(`Failed to spawn claude CLI: ${err.message}`));
  });

  child.on('exit', (code, signal) => {
    clearTimeout(durationTimer);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log('info', `Process exited — code: ${code}, signal: ${signal}, elapsed: ${elapsed}s, cost: $${lastKnownCost}`);
    if (sessionState !== 'error') {
      if (code !== 0 && code !== null) {
        const reason = signal
          ? `killed by signal ${signal}`
          : `exited with code ${code}`;
        log('error', `Session failed: ${reason}`);
        sessionState = 'error';
        onError(new Error(`Claude CLI ${reason}`));
      } else {
        sessionState = 'completed';
        log('info', 'Autonomous session ended successfully');
      }
    }
  });

  const pid = child.pid ?? 0;

  return {
    pid,
    get state() { return sessionState; },
    kill: () => {
      clearTimeout(durationTimer);
      if (!child.killed) {
        sessionState = 'completed';
        child.kill('SIGTERM');
      }
    },
    process: child,
  };
}

// ---------------------------------------------------------------------------
// Interactive session lifecycle (existing)
// ---------------------------------------------------------------------------

/**
 * Spawn a Claude Code CLI session in bidirectional streaming mode.
 *
 * The CLI stays alive across multiple turns. The caller can:
 * - Send follow-up messages via session.sendMessage(text)
 * - Close the session gracefully via session.closeInput()
 * - Kill the session immediately via session.kill()
 *
 * Callbacks:
 * - onProgress: tool calls, text, milestones during a turn
 * - onResult: fires after each assistant turn completes (can fire multiple times)
 * - onError: fires on errors (error result events, spawn failures, exit codes)
 */
export function startSession(options: CodeSessionOptions): ActiveSession {
  const {
    sessionId,
    systemPrompt,
    task,
    worktreePath,
    onProgress,
    onResult,
    onError,
  } = options;

  const log = (level: 'info' | 'error', msg: string) => sessionLog(sessionId, level, msg);

  const args: string[] = [
    '-p', '',
    '--append-system-prompt', systemPrompt,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
  ];

  for (const tool of ALLOWED_TOOLS) {
    args.push('--allowedTools', tool);
  }

  log('info', `Starting bidirectional session in ${worktreePath}`);
  log('info', `Task: ${task.slice(0, 200)}${task.length > 200 ? '...' : ''}`);

  const child = spawn('claude', args, {
    cwd: worktreePath,
    env: buildSafeEnv() as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  log('info', `Spawned claude CLI (bidirectional), PID: ${child.pid ?? 'unknown'}`);

  let sessionState: SessionState = 'running';

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
        log('info', `Turn complete — turns: ${result.turns}, cost: $${result.costUsd ?? '?'}`);
        sessionState = 'waiting_for_input';
        onResult(result);
      },
      (error) => {
        log('error', `Stream error: ${error.message}`);
        sessionState = 'error';
        onError(error);
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
    sessionState = 'error';
    onError(new Error(`Failed to spawn claude CLI: ${err.message}`));
  });

  child.on('exit', (code, signal) => {
    log('info', `Process exited — code: ${code}, signal: ${signal}`);
    if (sessionState !== 'error') {
      if (code !== 0 && code !== null) {
        const reason = signal
          ? `killed by signal ${signal}`
          : `exited with code ${code}`;
        log('error', `Session failed: ${reason}`);
        sessionState = 'error';
        onError(new Error(`Claude CLI ${reason}`));
      } else {
        sessionState = 'completed';
        log('info', 'Session ended');
      }
    }
  });

  // Send the task as the first user message to kick off the session
  if (child.stdin) {
    const firstMessage = buildStdinMessage(task);
    log('info', `Sending initial task via stdin`);
    child.stdin.write(firstMessage);
  }

  const pid = child.pid ?? 0;

  const session: ActiveSession = {
    pid,
    get state() { return sessionState; },

    kill: () => {
      if (!child.killed) {
        sessionState = 'completed';
        child.kill('SIGTERM');
      }
    },

    sendMessage: (text: string) => {
      if (!child.stdin || child.stdin.destroyed) {
        log('error', 'Cannot send message — stdin is closed');
        return;
      }
      log('info', `User message: ${text.slice(0, 200)}`);
      sessionState = 'running';
      child.stdin.write(buildStdinMessage(text));
    },

    closeInput: () => {
      if (child.stdin && !child.stdin.destroyed) {
        log('info', 'Closing stdin — session will end after current turn');
        child.stdin.end();
      }
    },

    process: child,
  };

  return session;
}
