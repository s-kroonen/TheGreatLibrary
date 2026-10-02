/**
 * Caches the outcome of external provider lookups (ISBN → book, title+
 * author → series, series id → lineup) in the `provider_cache` table —
 * see db/schema.ts for why. Two layers:
 *
 *  - An in-memory map, cold on every restart, that short-circuits a
 *    repeat lookup within the same process without even a DB round trip,
 *    and collapses concurrent callers asking for the same not-yet-cached
 *    key into a single real fetch (a boot backfill processes books
 *    sequentially today, but this makes it safe even if that changes).
 *  - The DB table, which is what actually survives across boots — the
 *    whole point: a startup backfill re-run (or a container restart
 *    mid-backfill) doesn't re-ask the network, and Hardcover's rate
 *    limit specifically, for a book we already have an answer for.
 *
 * `result: null` is cached too ("confirmed nothing found"), just with a
 * shorter TTL than a real hit — see withCache's foundTtlMs/notFoundTtlMs.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { providerCache } from "@/db/schema";
import { logger } from "@/lib/logger";

const SCOPE = "provider-cache";

const memory = new Map<string, { result: unknown; fetchedAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();

function cacheId(provider: string, kind: string, key: string): string {
  return `${provider}:${kind}:${key}`;
}

/**
 * Thrown by a provider fetcher when the request itself failed (timeout,
 * 429, 5xx, network error) as opposed to succeeding with "no match". The
 * distinction matters: withCache stores a successful "nothing found" for
 * days, and a fetcher that threw is never stored — otherwise one flaky
 * response (Google's 503s, a Hardcover 429) would be cached as a confirmed
 * miss and the book left undetected until the entry expired. Use
 * `swallowTransient` at the public boundary to turn it back into null.
 */
export class TransientProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientProviderError";
  }
}

/** Resolves a lookup that may have thrown TransientProviderError to
 * null (uncached, since withCache never stored it) — callers that just
 * want "no answer right now" don't need to know the difference. */
export async function swallowTransient<T>(
  promise: Promise<T | null>,
  onTransient?: () => void
): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof TransientProviderError) {
      onTransient?.();
      return null;
    }
    throw err;
  }
}

export interface CacheOptions {
  /** Bypasses both cache layers and always makes a fresh request — for
   * explicit user-triggered refreshes ("Refresh from source"), where a
   * stale cached answer would be exactly the wrong thing to show. The
   * fresh result still gets written back, same as any other fetch. */
  force?: boolean;
  /** Called when the lookup failed transiently and resolved to null only
   * because of that — lets a caller tell "no match" from "couldn't ask"
   * (e.g. to avoid marking a book as checked when the check never ran). */
  onTransient?: () => void;
}

export async function withCache<T>(
  provider: string,
  kind: string,
  key: string,
  ttl: { foundMs: number; notFoundMs: number },
  fetcher: () => Promise<T | null>,
  opts: CacheOptions = {}
): Promise<T | null> {
  const id = cacheId(provider, kind, key);
  const now = Date.now();
  const ttlFor = (result: unknown) => (result === null ? ttl.notFoundMs : ttl.foundMs);

  if (!opts.force) {
    const mem = memory.get(id);
    if (mem && now - mem.fetchedAt < ttlFor(mem.result)) {
      return mem.result as T | null;
    }

    const row = await db.query.providerCache.findFirst({ where: eq(providerCache.id, id) });
    if (row) {
      const ageMs = now - row.fetchedAt.getTime();
      if (ageMs < ttlFor(row.result)) {
        memory.set(id, { result: row.result, fetchedAt: row.fetchedAt.getTime() });
        logger.info(SCOPE, "cache hit", { provider, kind, key, ageMs, found: row.result !== null });
        return row.result as T | null;
      }
    }

    const existing = inFlight.get(id);
    if (existing) return existing as Promise<T | null>;
  }

  const promise = (async () => {
    try {
      const result = await fetcher();
      memory.set(id, { result, fetchedAt: Date.now() });
      await db
        .insert(providerCache)
        .values({ id, provider, kind, result: result as never, fetchedAt: new Date() })
        .onConflictDoUpdate({
          target: providerCache.id,
          set: { result: result as never, fetchedAt: new Date() },
        });
      logger.info(SCOPE, "cache miss, fetched and stored", { provider, kind, key, found: result !== null });
      return result;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, promise);
  return promise;
}

/** Common TTL presets — a real answer is trusted for a while (upstream
 * catalogs don't change hour to hour), a "nothing found" is rechecked
 * sooner since it's more likely to just be "not indexed yet". */
export const TTL = {
  SERIES: { foundMs: 30 * 24 * 60 * 60 * 1000, notFoundMs: 7 * 24 * 60 * 60 * 1000 },
  LINEUP: { foundMs: 7 * 24 * 60 * 60 * 1000, notFoundMs: 60 * 60 * 1000 },
  ISBN: { foundMs: 30 * 24 * 60 * 60 * 1000, notFoundMs: 3 * 24 * 60 * 60 * 1000 },
};
