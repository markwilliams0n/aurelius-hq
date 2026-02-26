/**
 * Slack Connector Adapter
 *
 * Wraps Slack sync behind the Connector interface.
 * Handles the Socket Mode vs polling fallback that previously lived in sync-all.ts.
 */

import { syncSlackMessages, startSocketMode, isSocketConfigured } from '@/lib/slack';
import { syncSlackDirectory } from '@/lib/slack/directory';
import type { Connector, HeartbeatStep } from './types';

export const slackConnector: Connector = {
  name: 'slack',
  step: 'slack' as HeartbeatStep, // Dormant — not registered in connector list
  async sync() {
    // Socket Mode: connect for real-time messages, then refresh directory cache
    if (isSocketConfigured()) {
      await startSocketMode();
      console.log('[Heartbeat] Slack Socket Mode connected');

      // Refresh workspace directory cache (skips if <24h old)
      try {
        await syncSlackDirectory();
      } catch (dirErr) {
        console.warn('[Heartbeat] Slack directory sync failed:', dirErr);
      }

      return {
        normalized: { synced: 0, errors: 0, skipped: 0 },
        raw: undefined,
        detail: 'Socket Mode connected',
      };
    }

    // Polling fallback: search-based sync
    const r = await syncSlackMessages();
    return {
      normalized: {
        synced: r.synced,
        errors: r.errors,
        skipped: r.skipped,
        error: r.error,
      },
      raw: r,
      detail: r.synced > 0 ? `${r.synced} messages` : undefined,
      logCount: r.synced,
      logLabel: 'messages',
    };
  },
};
