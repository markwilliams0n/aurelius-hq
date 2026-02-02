/**
 * Granola API Client
 *
 * Handles authentication (WorkOS OAuth with token rotation) and API calls.
 * Based on: https://github.com/getprobo/reverse-engineering-granola-api
 */

import { promises as fs } from 'fs';
import path from 'path';

const WORKOS_AUTH_URL = 'https://api.workos.com/user_management/authenticate';
const GRANOLA_API_URL = 'https://api.granola.ai';
const CREDENTIALS_PATH = path.join(process.cwd(), '.granola-credentials.json');

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
 * Get stored Granola credentials
 */
export async function getCredentials(): Promise<GranolaCredentials | null> {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
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
 * Get a valid access token, refreshing if necessary.
 * CRITICAL: Saves new refresh token immediately after rotation.
 */
export async function getAccessToken(): Promise<string> {
  const creds = await getCredentials();
  if (!creds) {
    throw new Error('Granola not configured. Call setup first.');
  }

  // Check if current access token is still valid (with 5min buffer)
  if (creds.access_token && creds.access_token_expires_at) {
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    if (Date.now() < creds.access_token_expires_at - bufferMs) {
      return creds.access_token;
    }
  }

  // Refresh the token
  console.log('[Granola] Refreshing access token...');

  const response = await fetch(WORKOS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.client_id,
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Granola] Token refresh failed:', error);
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  // CRITICAL: Save new tokens immediately before returning
  // The old refresh token is now invalid
  const newCreds: GranolaCredentials = {
    ...creds,
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    access_token_expires_at: Date.now() + (data.expires_in * 1000),
  };

  await saveCredentials(newCreds);
  console.log('[Granola] Token refreshed and saved');

  return data.access_token;
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
