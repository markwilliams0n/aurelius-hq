import { NextResponse } from 'next/server';
import { runWeeklySynthesis } from '@/lib/memory/synthesis';
import { appendActivityLog, SynthesisLogEntry } from '@/lib/memory/activity-log';

export const runtime = 'nodejs';
export const maxDuration = 300; // Allow up to 5 minutes for synthesis

/**
 * POST /api/synthesis - Run weekly synthesis
 * Calculates decay tiers, archives cold facts, regenerates summaries
 */
export async function POST() {
  const startTime = Date.now();

  try {
    const result = await runWeeklySynthesis();
    const duration = Date.now() - startTime;

    // Log to activity log
    const logEntry: SynthesisLogEntry = {
      id: `syn-${Date.now()}`,
      type: 'synthesis',
      success: true,
      entitiesProcessed: result.entitiesProcessed ?? 0,
      factsArchived: result.factsArchived ?? 0,
      summariesRegenerated: result.summariesRegenerated ?? 0,
      duration,
      timestamp: new Date().toISOString(),
    };
    await appendActivityLog(logEntry);

    return NextResponse.json({
      success: true,
      ...result,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Synthesis error:', error);

    // Log failure to activity log
    const logEntry: SynthesisLogEntry = {
      id: `syn-${Date.now()}`,
      type: 'synthesis',
      success: false,
      entitiesProcessed: 0,
      factsArchived: 0,
      summariesRegenerated: 0,
      duration,
      timestamp: new Date().toISOString(),
      error: String(error),
    };
    await appendActivityLog(logEntry);

    return NextResponse.json(
      { success: false, error: 'Synthesis failed', details: String(error), duration },
      { status: 500 }
    );
  }
}

// Also allow GET for easy testing
export async function GET() {
  return POST();
}
