import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTTLCache } from "../context-cache";

describe("createTTLCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches the result of the loader function", async () => {
    const loader = vi.fn().mockResolvedValue("result");
    const cache = createTTLCache(loader, 60_000);

    const r1 = await cache.get();
    const r2 = await cache.get();

    expect(r1).toBe("result");
    expect(r2).toBe("result");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refreshes after TTL expires", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const cache = createTTLCache(loader, 60_000);

    const r1 = await cache.get();
    expect(r1).toBe("first");

    vi.advanceTimersByTime(61_000);

    const r2 = await cache.get();
    expect(r2).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a refresh on next get()", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const cache = createTTLCache(loader, 60_000);

    await cache.get();
    cache.invalidate();
    const r2 = await cache.get();

    expect(r2).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
