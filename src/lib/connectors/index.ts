/**
 * Connector Registry
 *
 * Central registry of all connectors. sync-all.ts iterates this list
 * instead of maintaining its own hardcoded ConnectorDef[] array.
 */

import { gmailConnector } from './gmail';
import { granolaConnector } from './granola';
import { linearConnector } from './linear';
import { slackConnector } from './slack';
import type { Connector } from './types';

export const connectors: Connector[] = [
  granolaConnector,
  gmailConnector,
  linearConnector,
  slackConnector,
];

export function getConnector(name: string): Connector | undefined {
  return connectors.find(c => c.name === name);
}

// Re-export types for convenience
export type { Connector, SyncResult, ConnectorSyncResult } from './types';
