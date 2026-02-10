export interface SyncResult {
  synced: number;
  errors: number;
  skipped: number;
  error?: string;
}

export interface ConnectorSyncResult {
  connector: string;
  result?: SyncResult;
  success: boolean;
  durationMs: number;
  error?: string;
}
