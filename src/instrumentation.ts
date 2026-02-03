/**
 * Next.js Instrumentation
 *
 * This file runs once when the server starts.
 * Used to set up background tasks like heartbeat and synthesis schedulers.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server, not during build or in edge runtime
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAllSchedulers } = await import('./lib/scheduler');
    startAllSchedulers();
  }
}
