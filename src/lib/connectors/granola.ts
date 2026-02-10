/**
 * Granola Connector Adapter
 *
 * Wraps syncGranolaMeetings() behind the Connector interface.
 * No logic changes — just normalization.
 */

import { syncGranolaMeetings } from '@/lib/granola';
import type { Connector } from './types';

export const granolaConnector: Connector = {
  name: 'granola',
  step: 'granola',
  async sync() {
    const r = await syncGranolaMeetings();
    return {
      normalized: { synced: r.synced, errors: r.errors, skipped: r.skipped },
      raw: r,
      detail: r.synced > 0 ? `${r.synced} meetings` : undefined,
      logCount: r.synced,
      logLabel: 'meetings',
    };
  },
};
