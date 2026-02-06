import Supermemory from "supermemory";
import type {
  AddResponse,
  ProfileResponse,
} from "supermemory/resources/top-level";
import type { SearchDocumentsResponse } from "supermemory/resources/search";

const CONTAINER_TAG = process.env.SUPERMEMORY_CONTAINER_TAG || "default";

let client: Supermemory | null = null;

function getClient(): Supermemory {
  if (!client) {
    if (!process.env.SUPERMEMORY_API_KEY) {
      throw new Error("SUPERMEMORY_API_KEY not set");
    }
    client = new Supermemory();
  }
  return client;
}

/**
 * Send content to Supermemory for extraction + indexing.
 * Call after chat messages, triage saves, connector syncs.
 */
export async function addMemory(
  content: string,
  metadata?: Record<string, string | number | boolean>
): Promise<AddResponse> {
  const sm = getClient();
  return sm.add({
    content,
    containerTag: CONTAINER_TAG,
    metadata,
  });
}

/**
 * Get user profile + relevant context for a query.
 * Primary retrieval method for chat context building.
 */
export async function getMemoryContext(
  query: string
): Promise<ProfileResponse> {
  const sm = getClient();
  return sm.profile({
    containerTag: CONTAINER_TAG,
    q: query,
  });
}

/**
 * Search documents directly. For memory browser UI and triage enrichment.
 */
export async function searchMemories(
  query: string,
  limit: number = 10
): Promise<SearchDocumentsResponse["results"]> {
  const sm = getClient();
  const response = await sm.search.documents({
    q: query,
    containerTags: [CONTAINER_TAG],
    limit,
    rerank: true,
  });
  return response.results;
}

/**
 * List memories with pagination. For memory dashboard.
 */
export async function listMemories(options?: {
  page?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}) {
  const sm = getClient();
  return sm.memories.list({
    containerTags: [CONTAINER_TAG],
    page: options?.page ?? 1,
    limit: options?.limit ?? 20,
    order: options?.order ?? 'desc',
    sort: 'createdAt',
  });
}

/**
 * Get user profile facts. For memory dashboard overview.
 */
export async function getProfile() {
  const sm = getClient();
  return sm.profile({
    containerTag: CONTAINER_TAG,
    q: '*',
  });
}
