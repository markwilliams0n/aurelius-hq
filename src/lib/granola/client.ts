/**
 * Granola API Client
 *
 * Handles authentication (WorkOS OAuth with token rotation) and API calls.
 * Based on: https://github.com/getprobo/reverse-engineering-granola-api
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  getSyncState as getConnectorSyncState,
  setSyncState as setConnectorSyncState,
} from '@/lib/connectors/sync-state';

const WORKOS_AUTH_URL = 'https://api.workos.com/user_management/authenticate';
const GRANOLA_API_URL = 'https://api.granola.ai';
const CREDENTIALS_PATH = path.join(process.cwd(), '.granola-credentials.json');

// Path to Granola app's token file (macOS)
const GRANOLA_APP_TOKEN_PATH = path.join(
  os.homedir(),
  'Library/Application Support/Granola/supabase.json'
);

// Granola document types
export interface GranolaDocument {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcript_state: string;
  google_calendar_data?: {
    summary?: string;
    organizer?: { email: string; displayName?: string };
    attendees?: Array<{ email: string; displayName?: string }>;
    start?: { dateTime: string };
    end?: { dateTime: string };
  };
}

export interface GranolaDocumentFull extends GranolaDocument {
  markdown?: string;
  transcript?: Array<{
    speaker: string;
    text: string;
    start_time: number;
  }>;
}

export interface GranolaCredentials {
  refresh_token: string;
  access_token?: string;
  access_token_expires_at?: number;
  client_id: string;
  last_synced_at?: string;
}

/**
 * Try to read fresh tokens from the Granola desktop app.
 * This helps when the app has refreshed tokens and burned ours.
 */
async function syncFromGranolaApp(): Promise<GranolaCredentials | null> {
  try {
    const content = await fs.readFile(GRANOLA_APP_TOKEN_PATH, 'utf-8');
    const appData = JSON.parse(content);

    // Check if the app has valid tokens
    if (!appData.workos_tokens) return null;

    const tokens = typeof appData.workos_tokens === 'string'
      ? JSON.parse(appData.workos_tokens)
      : appData.workos_tokens;

    if (!tokens.refresh_token) return null;

    // Extract client_id from the app data or use default
    const userInfo = appData.user_info
      ? (typeof appData.user_info === 'string' ? JSON.parse(appData.user_info) : appData.user_info)
      : null;

    // Get our existing credentials for the client_id
    const existing = await getCredentialsInternal();

    const creds: GranolaCredentials = {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: tokens.obtained_at
        ? tokens.obtained_at + (tokens.expires_in * 1000)
        : undefined,
      client_id: existing?.client_id || 'client_01JZJ0XBDAT8PHJWQY09Y0VD61',
      // Note: last_synced_at is now stored in the database (sync:granola config key)
    };

    // Save the updated credentials
    await saveCredentials(creds);
    console.log('[Granola] Synced fresh tokens from Granola app');

    return creds;
  } catch {
    return null;
  }
}

/**
 * Internal: Get stored Granola credentials without syncing
 */
async function getCredentialsInternal(): Promise<GranolaCredentials | null> {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get stored Granola credentials, attempting to sync from app if needed
 */
export async function getCredentials(): Promise<GranolaCredentials | null> {
  // First try our stored credentials
  const creds = await getCredentialsInternal();

  // If we have credentials with a valid access token, use them
  if (creds?.access_token && creds.access_token_expires_at) {
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    if (Date.now() < creds.access_token_expires_at - bufferMs) {
      return creds;
    }
  }

  // Try to sync from the Granola app (might have fresher tokens)
  const appCreds = await syncFromGranolaApp();
  if (appCreds) return appCreds;

  return creds;
}

/**
 * Save Granola credentials
 */
export async function saveCredentials(creds: GranolaCredentials): Promise<void> {
  await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

/**
 * Check if Granola is configured
 */
export async function isConfigured(): Promise<boolean> {
  const creds = await getCredentials();
  return !!(creds?.refresh_token && creds?.client_id);
}

/**
 * Get a valid access token.
 *
 * IMPORTANT: We NEVER refresh tokens ourselves to avoid burning the
 * Granola app's session. Instead, we read the access token from the
 * Granola app's storage and use it directly.
 *
 * The Granola desktop app handles all token refreshing.
 */
export async function getAccessToken(): Promise<string> {
  // Always try to get fresh tokens from the Granola app first
  const appCreds = await syncFromGranolaApp();

  if (appCreds?.access_token) {
    // Check if the app's access token is still valid
    if (appCreds.access_token_expires_at) {
      const bufferMs = 2 * 60 * 1000; // 2 minutes buffer
      if (Date.now() < appCreds.access_token_expires_at - bufferMs) {
        return appCreds.access_token;
      }
    } else {
      // No expiry info, try using it anyway
      return appCreds.access_token;
    }
  }

  // Fall back to our stored credentials
  const creds = await getCredentialsInternal();

  if (creds?.access_token) {
    // Check if still valid
    if (creds.access_token_expires_at) {
      const bufferMs = 2 * 60 * 1000;
      if (Date.now() < creds.access_token_expires_at - bufferMs) {
        return creds.access_token;
      }
    } else {
      return creds.access_token;
    }
  }

  // No valid access token available
  throw new Error(
    'No valid Granola access token. Please ensure the Granola app is running ' +
    'and you are logged in. The app needs to refresh the token.'
  );
}

/**
 * Fetch paginated list of documents
 */
export async function getDocuments(options?: {
  limit?: number;
  cursor?: string;
}): Promise<{ documents: GranolaDocument[]; next_cursor?: string }> {
  const token = await getAccessToken();

  const response = await fetch(`${GRANOLA_API_URL}/v2/get-documents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Granola/5.354.0',
      'X-Client-Version': '5.354.0',
    },
    body: JSON.stringify({
      limit: options?.limit || 50,
      offset: options?.cursor ? parseInt(options.cursor) : 0,
      include_last_viewed_panel: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch documents: ${response.status}`);
  }

  // API returns { docs: [...], deleted: [...] }
  const data = await response.json();
  return {
    documents: data.docs || [],
    next_cursor: data.next_cursor,
  };
}

/**
 * Fetch documents by IDs (batch endpoint)
 */
export async function getDocumentsBatch(documentIds: string[]): Promise<GranolaDocumentFull[]> {
  const token = await getAccessToken();

  const response = await fetch(`${GRANOLA_API_URL}/v1/get-documents-batch`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Granola/5.354.0',
      'X-Client-Version': '5.354.0',
    },
    body: JSON.stringify({
      document_ids: documentIds,
      include_last_viewed_panel: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch documents batch: ${response.status}`);
  }

  const data = await response.json();
  return data.docs || [];
}

/**
 * Fetch a single document with full content
 */
export async function getDocument(documentId: string): Promise<GranolaDocumentFull> {
  const docs = await getDocumentsBatch([documentId]);
  if (docs.length === 0) {
    throw new Error(`Document not found: ${documentId}`);
  }
  return docs[0];
}

/**
 * Transcript utterance from Granola
 */
export interface GranolaTranscriptUtterance {
  id: string;
  document_id: string;
  text: string;
  start_timestamp: string;
  source: 'microphone' | 'system_audio';
}

/**
 * Fetch transcript for a document
 */
export async function getDocumentTranscript(documentId: string): Promise<GranolaTranscriptUtterance[]> {
  const token = await getAccessToken();

  const response = await fetch(`${GRANOLA_API_URL}/v1/get-document-transcript`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Granola/5.354.0',
      'X-Client-Version': '5.354.0',
    },
    body: JSON.stringify({
      document_id: documentId,
    }),
  });

  if (response.status === 404) {
    // No transcript available
    return [];
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: ${response.status}`);
  }

  const data = await response.json();
  return data.utterances || data || [];
}

/**
 * Get documents updated since a given date
 */
export async function getDocumentsSince(since: Date): Promise<GranolaDocument[]> {
  const allDocs: GranolaDocument[] = [];
  let cursor: string | undefined;

  while (true) {
    const { documents, next_cursor } = await getDocuments({ cursor, limit: 50 });

    for (const doc of documents) {
      const docDate = new Date(doc.updated_at);
      if (docDate >= since) {
        allDocs.push(doc);
      } else {
        // Documents are sorted by date desc, so we can stop
        return allDocs;
      }
    }

    if (!next_cursor) break;
    cursor = next_cursor;
  }

  return allDocs;
}
