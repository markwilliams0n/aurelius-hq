/**
 * Code Session Lifecycle
 *
 * Shared logic for starting and resuming coding sessions.
 * Eliminates duplication between the code:start and code:resume handlers.
 */

import { startSession, startAutonomousSession, type ActiveSession } from './executor';
import { buildCodePrompt, buildPlanningPrompt, buildExecutionPrompt, buildReviewPrompt, buildFixPrompt } from './prompts';
import {
  getWorktreeStats,
  getChangedFiles,
  getWorktreeLog,
  createWorktree,
  cleanupWorktree,
} from './worktree';
import {
  setSession,
  removeSession,
  setAutoApproveTimer,
  clearAutoApproveTimer,
} from './session-manager';
import {
  notifySessionState,
  updateSessionTelegram,
  formatPlanReady,
  formatPrReady,
  formatProgressMilestone,
  formatReviewStarted,
  formatReviewResult,
  getPlanKeyboard,
  getMergeKeyboard,
} from './telegram';
import { getCard, updateCard, createCard, generateCardId } from '@/lib/action-cards/db';
import type { CardHandlerResult } from '@/lib/action-cards/registry';
import { getConfig } from '@/lib/config';
import { nanoid } from 'nanoid';
import { slugifyTask } from './prompts';
import type { CodeAgentConfig, CodeSessionData } from './types';
import { DEFAULT_CODE_AGENT_CONFIG } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnSessionOptions {
  sessionId: string;
  task: string;
  context?: string | null;
  branchName: string;
  worktreePath: string;
  cardId?: string;
  cardData: Record<string, unknown>;
  /** If true, wraps the task/context for a resumed session. */
  isResume?: boolean;
  /** Initial turn count (for resumed sessions). */
  initialTurns?: number;
  /** Initial cost (for resumed sessions). */
  initialCost?: number | null;
  /** If true, skip worktree cleanup on error (resume keeps partial work). */
  keepWorktreeOnError?: boolean;
  /** Worktree cleanup function — only needed for start (not resume). */
  cleanupOnError?: () => void;
}

// ---------------------------------------------------------------------------
// Placeholder for reserving session slot
// ---------------------------------------------------------------------------

function createPlaceholder(): ActiveSession {
  return {
    pid: 0,
    kill: () => {},
    process: null as unknown,
    state: 'running' as const,
    sendMessage: () => {},
    closeInput: () => {},
  } as ActiveSession;
}

// ---------------------------------------------------------------------------
// Finalize session — gather worktree stats and mark completed
// ---------------------------------------------------------------------------

export async function finalizeSession(
  sessionId: string,
  cardId: string | undefined,
  data: Record<string, unknown>,
  worktreePath: string,
  totalTurns: number,
  totalCostUsd: number | null,
): Promise<void> {
  removeSession(sessionId);

  if (!cardId) return;

  try {
    const stats = getWorktreeStats(worktreePath);
    const changedFiles = getChangedFiles(worktreePath);
    const log = getWorktreeLog(worktreePath);

    const currentCard = await getCard(cardId);
    if (currentCard?.status === 'confirmed') {
      await updateCard(cardId, {
        data: {
          ...data,
          state: 'completed',
          worktreePath,
          totalTurns,
          totalCostUsd,
          result: {
            sessionId,
            turns: totalTurns,
            costUsd: totalCostUsd,
            stats,
            changedFiles,
            log,
          },
        },
      });
    }

    const task = (data.task as string) || 'Unknown task';
    notifySessionState(sessionId, 'completed', cardId, task, totalTurns, totalCostUsd, {
      filesChanged: changedFiles?.length ?? 0,
    });
  } catch (err) {
    console.error(`[code-session:${sessionId}] Failed to gather results:`, err);
  }
}

// ---------------------------------------------------------------------------
// Spawn session — shared by start and resume
// ---------------------------------------------------------------------------

export async function spawnSession(opts: SpawnSessionOptions): Promise<CardHandlerResult> {
  const {
    sessionId,
    task,
    context,
    branchName,
    worktreePath,
    cardId,
    cardData,
    isResume = false,
    initialTurns = 0,
    initialCost = null,
    keepWorktreeOnError = false,
    cleanupOnError,
  } = opts;

  // Reserve the session slot atomically
  setSession(sessionId, createPlaceholder());

  let totalTurns = initialTurns;
  let totalCostUsd = initialCost;

  // Build prompt
  const systemPrompt = isResume
    ? buildCodePrompt(task, [
        'RESUME: This session is being resumed from a previous run.',
        'The worktree already has work in progress.',
        'Check `git log --oneline main..HEAD` and `git status` to see what was done.',
        'Continue from where you left off.',
        context || '',
      ].filter(Boolean).join('\n'))
    : buildCodePrompt(task, context ?? undefined);

  const taskMessage = isResume
    ? `Continue working on: ${task}\n\nThis is a resumed session. Check git log and git status to see what was already done, then continue.`
    : task;

  let session: ActiveSession;
  try {
    session = startSession({
      sessionId,
      systemPrompt,
      task: taskMessage,
      worktreePath,

      onProgress(event) {
        console.log(`[code-session:${sessionId}] ${event.type}`, event.text ?? event.tool ?? '');
      },

      async onResult(result) {
        totalTurns = result.turns;
        if (result.costUsd !== null) totalCostUsd = result.costUsd;

        if (cardId) {
          try {
            const currentCard = await getCard(cardId);
            if (currentCard?.status === 'confirmed') {
              await updateCard(cardId, {
                data: {
                  ...cardData,
                  worktreePath,
                  state: 'waiting',
                  lastMessage: result.text,
                  totalTurns,
                  totalCostUsd,
                },
              });
            }
          } catch (err) {
            console.error(`[code-session:${sessionId}] Failed to update card:`, err);
          }
        }

        notifySessionState(sessionId, 'waiting', cardId, task, totalTurns, totalCostUsd, {
          lastMessage: result.text,
        });
      },

      async onError(error) {
        removeSession(sessionId);

        if (!keepWorktreeOnError) {
          cleanupOnError?.();
        }

        if (cardId) {
          try {
            await updateCard(cardId, {
              ...(keepWorktreeOnError
                ? { data: { ...cardData, state: 'error' } }
                : { status: 'error' }),
              result: { error: error.message },
            });
          } catch (err) {
            console.error(`[code-session:${sessionId}] Failed to update card on error:`, err);
          }
        }

        notifySessionState(sessionId, 'error', cardId, task, totalTurns, totalCostUsd, {
          error: error.message,
        });
      },
    });
  } catch (err) {
    removeSession(sessionId);
    if (!keepWorktreeOnError) {
      cleanupOnError?.();
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', error: `Failed to ${isResume ? 'resume' : 'start'} session: ${msg}` };
  }

  // Replace placeholder with real session
  setSession(sessionId, session);

  // Listen for process exit to finalize
  session.process.on('exit', () => {
    if (session.state === 'completed' || session.state === 'waiting_for_input') {
      finalizeSession(sessionId, cardId, cardData, worktreePath, totalTurns, totalCostUsd);
    }
  });

  // Update card to running state
  if (cardId) {
    await updateCard(cardId, {
      data: {
        ...cardData,
        worktreePath,
        state: 'running',
        totalTurns,
        totalCostUsd,
      },
    });
  }

  notifySessionState(sessionId, 'running', cardId, task, totalTurns, totalCostUsd);

  return { status: 'confirmed' };
}

// ---------------------------------------------------------------------------
// Load code agent config from DB
// ---------------------------------------------------------------------------

export async function getCodeAgentConfig(): Promise<CodeAgentConfig> {
  try {
    const config = await getConfig('capability:code-agent');
    if (config?.content) {
      return { ...DEFAULT_CODE_AGENT_CONFIG, ...JSON.parse(config.content) };
    }
  } catch {
    // Fall back to defaults
  }
  return DEFAULT_CODE_AGENT_CONFIG;
}

// ---------------------------------------------------------------------------
// Autonomous Flow — Plan → Approve → Execute → PR
// ---------------------------------------------------------------------------

/**
 * Start the autonomous coding flow.
 *
 * 1. Create worktree + action card
 * 2. Run planning phase (read-only Claude invocation)
 * 3. Send plan to Telegram with auto-approve timer
 * 4. On approval (or timeout): run execution phase
 * 5. On completion: push branch + create PR + notify
 *
 * Returns the card ID for tracking.
 */
export async function startAutonomousFlow(
  task: string,
  context?: string | null,
): Promise<{ cardId: string; sessionId: string } | { error: string }> {
  const config = await getCodeAgentConfig();
  const sessionId = nanoid(12);
  const branchName = 'aurelius/' + slugifyTask(task);

  // Create worktree
  let worktreePath: string;
  try {
    const wt = createWorktree(branchName, sessionId);
    worktreePath = wt.path;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to create worktree: ${msg}` };
  }

  // Create action card for tracking
  const cardData: CodeSessionData = {
    sessionId,
    task,
    context: context ?? null,
    branchName,
    worktreePath,
    autonomous: true,
    state: 'planning',
  };

  const card = await createCard({
    id: generateCardId(),
    pattern: 'code',
    handler: 'code:approve-plan',
    title: `Coding: ${task.length > 57 ? task.slice(0, 57) + '...' : task}`,
    data: cardData as unknown as Record<string, unknown>,
    status: 'confirmed', // Skip pending — autonomous flow starts immediately
  });

  // Phase 1: Planning — notify immediately so Telegram message order is correct
  console.log(`[autonomous:${sessionId}] Starting planning phase`);

  // Send "planning" notification BEFORE starting the run, so it always
  // arrives before the plan-ready notification (avoids Telegram race)
  await updateSessionTelegram(
    sessionId,
    'running',
    formatProgressMilestone(task, 'Planning...', 0, null),
  );

  const planningPrompt = buildPlanningPrompt(task, context ?? undefined);
  let planText = '';
  let planCost: number | null = null;

  try {
    planText = await runPlanningPhase(sessionId, planningPrompt, task, worktreePath, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[autonomous:${sessionId}] Planning failed:`, msg);
    await updateCard(card.id, { data: { ...cardData, state: 'error' }, result: { error: msg } });
    notifySessionState(sessionId, 'error', card.id, task, 0, null, { error: msg });
    try { cleanupWorktree(worktreePath, branchName); } catch { /* best effort */ }
    return { error: `Planning failed: ${msg}` };
  }

  // Update card with plan
  const updatedData: CodeSessionData = {
    ...cardData,
    state: 'plan-ready',
    plan: planText,
    autoApproveAt: new Date(Date.now() + config.planning.autoApproveMinutes * 60 * 1000).toISOString(),
  };
  await updateCard(card.id, { data: updatedData as unknown as Record<string, unknown> });

  // Send plan to Telegram
  if (config.notifications.onPlanReady) {
    await updateSessionTelegram(
      sessionId,
      'waiting', // Use 'waiting' to trigger new message (gets notification)
      formatPlanReady(task, planText, config.planning.autoApproveMinutes, planCost),
      getPlanKeyboard(card.id),
    );
  }

  // Start auto-approve timer
  setAutoApproveTimer(sessionId, config.planning.autoApproveMinutes, () => {
    console.log(`[autonomous:${sessionId}] Auto-approving plan after ${config.planning.autoApproveMinutes} minutes`);
    executePlan(sessionId, card.id).catch((err) => {
      console.error(`[autonomous:${sessionId}] Auto-approve execution failed:`, err);
    });
  });

  return { cardId: card.id, sessionId };
}

/**
 * Run the planning phase: spawn a read-only Claude invocation that produces a plan.
 * Returns the plan text.
 */
async function runPlanningPhase(
  sessionId: string,
  systemPrompt: string,
  task: string,
  worktreePath: string,
  config: CodeAgentConfig,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let planText = '';
    let lastText = '';

    const session = startAutonomousSession({
      sessionId: `${sessionId}-plan`,
      systemPrompt,
      task: `Read the codebase and create a plan for: ${task}`,
      worktreePath,
      maxCostUsd: config.planning.maxPlanningCostUsd,
      maxDurationMinutes: 30, // Planning needs time to read the codebase
      onProgress(event) {
        if (event.type === 'thinking' && event.text) {
          lastText = event.text;
          // Accumulate plan text (the last text block is usually the plan)
          planText = event.text;
        }
      },
      onResult() {
        // Planning session completed a turn — capture the text
        if (lastText) {
          planText = lastText;
        }
      },
      onError(error) {
        reject(error);
      },
    });

    session.process.on('exit', (code) => {
      if (code === 0 || code === null) {
        if (planText) {
          resolve(planText);
        } else {
          reject(new Error('Planning phase produced no output'));
        }
      }
      // Error case handled by onError callback
    });
  });
}

/**
 * Execute the approved plan. Called on manual approval or auto-approve timeout.
 */
export async function executePlan(
  sessionId: string,
  cardId: string,
): Promise<void> {
  const card = await getCard(cardId);
  if (!card) throw new Error('Card not found');

  const data = card.data as unknown as CodeSessionData;
  if (!data.plan || !data.worktreePath) {
    throw new Error('Card missing plan or worktreePath');
  }

  // Clear auto-approve timer if it's still running
  clearAutoApproveTimer(sessionId);

  const config = await getCodeAgentConfig();

  // Update card state
  await updateCard(cardId, {
    data: {
      ...card.data,
      state: 'executing',
      planApprovedAt: new Date().toISOString(),
    },
  });

  // Send executing notification
  if (config.notifications.onProgressMilestones) {
    await updateSessionTelegram(
      sessionId,
      'running',
      formatProgressMilestone(data.task, 'Executing plan...', 0, null),
    );
  }

  console.log(`[autonomous:${sessionId}] Starting execution phase`);

  const executionPrompt = buildExecutionPrompt(data.task, data.plan, {
    commitStrategy: config.execution.commitStrategy,
    maxRetries: config.execution.maxRetries,
  });

  let totalTurns = 0;
  let totalCostUsd: number | null = null;
  let lastMessage = '';

  const autonomousSession = startAutonomousSession({
    sessionId,
    systemPrompt: executionPrompt,
    task: `Execute the approved plan for: ${data.task}\n\nPlan:\n${data.plan}`,
    worktreePath: data.worktreePath,
    maxCostUsd: config.execution.maxCostUsd,
    maxDurationMinutes: config.execution.maxDurationMinutes,
    onProgress(event) {
      if (event.type === 'thinking' && event.text) {
        lastMessage = event.text;
      }
      console.log(`[autonomous:${sessionId}] ${event.type}`, event.text?.slice(0, 100) ?? event.tool ?? '');
    },
    onResult(result) {
      totalTurns = result.turns;
      if (result.costUsd !== null) totalCostUsd = result.costUsd;
      if (result.text) lastMessage = result.text;

      // Update card with progress
      updateCard(cardId, {
        data: {
          ...card.data,
          state: 'executing',
          totalTurns,
          totalCostUsd,
          lastMessage: lastMessage.slice(0, 500),
        },
      }).catch(() => {});
    },
    onError(error) {
      console.error(`[autonomous:${sessionId}] Execution error:`, error.message);
      updateCard(cardId, {
        data: { ...card.data, state: 'error', totalTurns, totalCostUsd },
        result: { error: error.message },
      }).catch(() => {});

      if (config.notifications.onError) {
        notifySessionState(sessionId, 'error', cardId, data.task, totalTurns, totalCostUsd, {
          error: error.message,
        });
      }
    },
    onCostUpdate(cost) {
      // Periodic progress notification at cost milestones
      if (config.notifications.onProgressMilestones && cost > 0 && Math.floor(cost) > Math.floor((totalCostUsd ?? 0))) {
        updateSessionTelegram(
          sessionId,
          'running',
          formatProgressMilestone(data.task, 'Working...', totalTurns, cost),
        ).catch(() => {});
      }
    },
  });

  // Track session
  setSession(sessionId, {
    pid: autonomousSession.pid,
    kill: autonomousSession.kill,
    process: autonomousSession.process,
    get state() { return autonomousSession.state; },
    sendMessage: () => {}, // No stdin in autonomous mode
    closeInput: () => {},
  });

  // On completion, start review phase
  autonomousSession.process.on('exit', async (code) => {
    removeSession(sessionId);

    if (code !== 0 && code !== null) return; // Error handled in onError

    try {
      // Extract PR URL from the last message (Claude outputs it at the end)
      const prUrlMatch = lastMessage.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
      const prUrl = prUrlMatch ? prUrlMatch[0] : null;

      await updateCard(cardId, {
        data: {
          ...card.data,
          state: 'reviewing',
          totalTurns,
          totalCostUsd,
          prUrl,
          reviewRound: 1,
        },
      });

      if (prUrl) {
        // Start self-review
        await reviewPR(sessionId, cardId, data.task, data.plan!, data.worktreePath!, prUrl, totalTurns, totalCostUsd, 1, config);
      } else {
        // No PR URL — skip review, go straight to completed
        console.warn(`[autonomous:${sessionId}] No PR URL found, skipping review`);
        await finalizeAutonomousSession(sessionId, cardId, data, totalTurns, totalCostUsd, null, config);
      }
    } catch (err) {
      console.error(`[autonomous:${sessionId}] Failed to start review:`, err);
    }
  });
}

// ---------------------------------------------------------------------------
// Self-Review Loop — Review PR → Fix Issues → Re-review
// ---------------------------------------------------------------------------

/**
 * Review a PR by spawning a read-only Claude session that evaluates the diff.
 * If issues are found, spawns a fix session and loops back.
 */
async function reviewPR(
  sessionId: string,
  cardId: string,
  task: string,
  plan: string,
  worktreePath: string,
  prUrl: string,
  totalTurns: number,
  totalCostUsd: number | null,
  reviewRound: number,
  config: CodeAgentConfig,
): Promise<void> {
  const maxRounds = config.review.maxRounds;
  const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
  if (!prNumber) {
    console.error(`[autonomous:${sessionId}] Cannot extract PR number from ${prUrl}`);
    await finalizeAutonomousSession(sessionId, cardId, { task, plan, worktreePath, prUrl } as CodeSessionData, totalTurns, totalCostUsd, prUrl, config);
    return;
  }

  console.log(`[autonomous:${sessionId}] Starting review round ${reviewRound}/${maxRounds}`);

  // Notify Telegram
  await updateSessionTelegram(
    sessionId,
    'running',
    formatReviewStarted(task, reviewRound, totalCostUsd),
  );

  // Get PR diff via gh CLI
  const { spawnSync } = await import('child_process');
  const diffResult = spawnSync('gh', ['pr', 'diff', prNumber], {
    cwd: worktreePath,
    encoding: 'utf-8',
    timeout: 30_000,
  });

  if (diffResult.status !== 0) {
    console.error(`[autonomous:${sessionId}] Failed to get PR diff:`, diffResult.stderr);
    await finalizeAutonomousSession(sessionId, cardId, { task, plan, worktreePath, prUrl } as CodeSessionData, totalTurns, totalCostUsd, prUrl, config);
    return;
  }

  const prDiff = diffResult.stdout;
  const reviewPrompt = buildReviewPrompt(task, plan, prDiff);

  // Spawn review session (read-only)
  let reviewText = '';
  let lastText = '';

  const reviewSession = startAutonomousSession({
    sessionId: `${sessionId}-review-${reviewRound}`,
    systemPrompt: reviewPrompt,
    task: `Review this PR diff for correctness, plan adherence, and potential issues.`,
    worktreePath,
    maxCostUsd: config.planning.maxPlanningCostUsd,
    maxDurationMinutes: 15,
    onProgress(event) {
      if (event.type === 'thinking' && event.text) {
        lastText = event.text;
        reviewText = event.text;
      }
    },
    onResult() {
      if (lastText) reviewText = lastText;
    },
    onError(error) {
      console.error(`[autonomous:${sessionId}] Review error:`, error.message);
    },
  });

  reviewSession.process.on('exit', async (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[autonomous:${sessionId}] Review exited with code ${code}, skipping`);
      await finalizeAutonomousSession(sessionId, cardId, { task, plan, worktreePath, prUrl } as CodeSessionData, totalTurns, totalCostUsd, prUrl, config);
      return;
    }

    // Parse review verdict
    const approved = reviewText.includes('APPROVED') && !reviewText.includes('ISSUES FOUND');
    const issuesMatch = reviewText.match(/ISSUES FOUND:([\s\S]*)/);
    const issues = issuesMatch ? issuesMatch[1].trim() : null;

    if (approved) {
      console.log(`[autonomous:${sessionId}] Review passed on round ${reviewRound}`);
      await updateSessionTelegram(
        sessionId,
        'running',
        formatReviewResult(task, true, null, reviewRound),
      );
      await finalizeAutonomousSession(sessionId, cardId, { task, plan, worktreePath, prUrl } as CodeSessionData, totalTurns, totalCostUsd, prUrl, config);
    } else if (issues && reviewRound < maxRounds) {
      console.log(`[autonomous:${sessionId}] Review found issues on round ${reviewRound}, fixing`);
      await updateSessionTelegram(
        sessionId,
        'running',
        formatReviewResult(task, false, issues, reviewRound),
      );

      await updateCard(cardId, {
        data: { state: 'fixing', reviewRound, reviewIssues: issues },
      });

      await fixReviewIssues(sessionId, cardId, task, plan, worktreePath, prUrl, issues, totalTurns, totalCostUsd, reviewRound, config);
    } else {
      console.warn(`[autonomous:${sessionId}] Review round ${reviewRound} — surfacing merge card (max rounds or unstructured issues)`);
      const warning = reviewRound >= maxRounds
        ? `Review had unresolved issues after ${maxRounds} rounds`
        : undefined;
      await finalizeAutonomousSession(sessionId, cardId, { task, plan, worktreePath, prUrl } as CodeSessionData, totalTurns, totalCostUsd, prUrl, config, warning);
    }
  });
}

/**
 * Fix issues found during review, then re-review.
 */
async function fixReviewIssues(
  sessionId: string,
  cardId: string,
  task: string,
  plan: string,
  worktreePath: string,
  prUrl: string,
  issues: string,
  totalTurns: number,
  totalCostUsd: number | null,
  reviewRound: number,
  config: CodeAgentConfig,
): Promise<void> {
  console.log(`[autonomous:${sessionId}] Fixing issues from review round ${reviewRound}`);

  const fixPrompt = buildFixPrompt(task, issues, { maxRetries: config.execution.maxRetries });

  let fixTurns = 0;
  let fixCost: number | null = null;

  const fixSession = startAutonomousSession({
    sessionId: `${sessionId}-fix-${reviewRound}`,
    systemPrompt: fixPrompt,
    task: `Fix these review issues:\n\n${issues}`,
    worktreePath,
    maxCostUsd: config.execution.maxCostUsd,
    maxDurationMinutes: config.execution.maxDurationMinutes,
    onProgress(event) {
      console.log(`[autonomous:${sessionId}:fix] ${event.type}`, event.text?.slice(0, 100) ?? event.tool ?? '');
    },
    onResult(result) {
      fixTurns = result.turns;
      if (result.costUsd !== null) fixCost = result.costUsd;
    },
    onError(error) {
      console.error(`[autonomous:${sessionId}] Fix error:`, error.message);
    },
  });

  fixSession.process.on('exit', async (code) => {
    const newTotalTurns = totalTurns + fixTurns;
    const newTotalCost = (totalCostUsd ?? 0) + (fixCost ?? 0);

    if (code !== 0 && code !== null) {
      console.error(`[autonomous:${sessionId}] Fix exited with code ${code}`);
      await finalizeAutonomousSession(sessionId, cardId, { task, plan, worktreePath, prUrl } as CodeSessionData, newTotalTurns, newTotalCost, prUrl, config, 'Fix session failed');
      return;
    }

    // Re-review
    await updateCard(cardId, {
      data: { state: 'reviewing', reviewRound: reviewRound + 1 },
    });
    await reviewPR(sessionId, cardId, task, plan, worktreePath, prUrl, newTotalTurns, newTotalCost, reviewRound + 1, config);
  });
}

/**
 * Finalize an autonomous session — gather stats and surface the merge card.
 */
async function finalizeAutonomousSession(
  sessionId: string,
  cardId: string,
  data: CodeSessionData,
  totalTurns: number,
  totalCostUsd: number | null,
  prUrl: string | null,
  config: CodeAgentConfig,
  warning?: string,
): Promise<void> {
  try {
    const stats = getWorktreeStats(data.worktreePath!);
    const changedFiles = getChangedFiles(data.worktreePath!);
    const log = getWorktreeLog(data.worktreePath!);

    await updateCard(cardId, {
      data: {
        sessionId,
        task: data.task,
        context: data.context,
        branchName: data.branchName ?? '',
        worktreePath: data.worktreePath,
        autonomous: true,
        plan: data.plan,
        state: 'completed',
        totalTurns,
        totalCostUsd,
        prUrl,
        result: {
          sessionId,
          turns: totalTurns,
          costUsd: totalCostUsd,
          stats,
          changedFiles,
          log,
        },
      },
    });

    if (config.notifications.onComplete) {
      if (prUrl) {
        let msg = formatPrReady(data.task, prUrl, totalTurns, totalCostUsd, stats);
        if (warning) {
          msg += `\n\n\u{26A0}\u{FE0F} ${warning}`;
        }
        await updateSessionTelegram(sessionId, 'waiting', msg, getMergeKeyboard(cardId));
      } else {
        notifySessionState(sessionId, 'completed', cardId, data.task, totalTurns, totalCostUsd, {
          filesChanged: changedFiles?.length ?? 0,
        });
      }
    }
  } catch (err) {
    console.error(`[autonomous:${sessionId}] Failed to finalize:`, err);
  }
}
