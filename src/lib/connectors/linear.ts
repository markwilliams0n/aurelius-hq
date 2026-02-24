/**
 * Linear Connector Adapter
 *
 * Wraps syncLinearNotifications() behind the Connector interface.
 * No logic changes — just normalization.
 */

import { syncLinearNotifications } from '@/lib/linear';
import type { Connector, HeartbeatStep } from './types';

export const linearConnector: Connector = {
  name: 'linear',
  step: 'linear' as HeartbeatStep, // Dormant — not registered in connector list
  async sync() {
    const r = await syncLinearNotifications();
    return {
      normalized: {
        synced: r.synced,
        errors: r.errors,
        skipped: r.skipped,
        error: r.error,
      },
      raw: r,
      detail: r.synced > 0 ? `${r.synced} notifications` : undefined,
      logCount: r.synced,
      logLabel: 'notifications',
    };
  },
};
