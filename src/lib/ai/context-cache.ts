export interface TTLCache<T> {
  get(): Promise<T>;
  invalidate(): void;
}

/**
 * Simple TTL cache that wraps an async loader function.
 * Calls the loader at most once per `ttlMs` period.
 */
export function createTTLCache<T>(
  loader: () => Promise<T>,
  ttlMs: number,
): TTLCache<T> {
  let cachedValue: T | undefined;
  let cachedAt = 0;

  return {
    async get(): Promise<T> {
      const now = Date.now();
      if (cachedValue !== undefined && now - cachedAt < ttlMs) {
        return cachedValue;
      }
      cachedValue = await loader();
      cachedAt = Date.now();
      return cachedValue;
    },
    invalidate() {
      cachedAt = 0;
    },
  };
}
