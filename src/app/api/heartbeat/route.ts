import { NextResponse } from 'next/server';
import { runHeartbeat } from '@/lib/memory/heartbeat';

export const runtime = 'nodejs';
export const maxDuration = 120; // Allow up to 2 minutes for heartbeat

export async function POST() {
  try {
    const result = await runHeartbeat();
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return NextResponse.json(
      { error: 'Heartbeat failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Also allow GET for easy testing
export async function GET() {
  return POST();
}
