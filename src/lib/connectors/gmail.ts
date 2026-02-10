/**
 * Gmail Connector Adapter
 *
 * Wraps syncGmailMessages() behind the Connector interface.
 * No logic changes — just normalization.
 */

import { syncGmailMessages } from '@/lib/gmail';
import type { Connector } from './types';

export const gmailConnector: Connector = {
  name: 'gmail',
  step: 'gmail',
  async sync() {
    const r = await syncGmailMessages();
    const detail = [
      r.synced > 0 ? `${r.synced} new` : null,
      r.skipped > 0 ? `${r.skipped} existing` : null,
      r.archived > 0 ? `${r.archived} archived` : null,
    ].filter(Boolean).join(', ');

    return {
      normalized: { synced: r.synced, errors: r.errors, skipped: r.skipped },
      raw: r,
      detail: detail || undefined,
      logCount: r.synced,
      logLabel: 'emails',
    };
  },
};
