import { NextResponse } from 'next/server';
import { runWeeklySynthesis } from '@/lib/memory/synthesis';

export const runtime = 'nodejs';
export const maxDuration = 300; // Allow up to 5 minutes for synthesis

/**
 * POST /api/synthesis - Run weekly synthesis
 * Calculates decay tiers, archives cold facts, regenerates summaries
 */
export async function POST() {
  try {
    const result = await runWeeklySynthesis();
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Synthesis error:', error);
    return NextResponse.json(
      { error: 'Synthesis failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Also allow GET for easy testing
export async function GET() {
  return POST();
}
