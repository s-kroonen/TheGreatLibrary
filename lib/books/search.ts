import type { NormalizedBook } from "./types";
import { googleBooksProvider } from "./providers/google-books";
import { findOpenLibrarySeries, openLibraryProvider } from "./providers/open-library";
import { mergeResults } from "./merge";
import { logger } from "@/lib/logger";

const SCOPE = "search";

const providers = [googleBooksProvider, openLibraryProvider];

// Open Library is well known to be slow (and occasionally to hang) — give
// it a head start alongside Google Books, but don't let it hold up the
// whole search past this grace period. Its results are still merged in
// if they land within it; whatever's still in flight after is dropped.
const SLOW_PROVIDER_GRACE_MS = 1500;

/** Races a provider promise against a grace-period timeout. Reports
 * which one actually won, so callers can log whether the slow provider's
 * results were dropped for taking too long. */
async function raceWithGrace(
  promise: Promise<NormalizedBook[]>,
  graceMs: number
): Promise<{ books: NormalizedBook[]; droppedByGrace: boolean }> {
  const timeout = new Promise<{ books: NormalizedBook[]; droppedByGrace: boolean }>(
    (resolve) =>
      setTimeout(() => resolve({ books: [], droppedByGrace: true }), graceMs)
  );
  try {
    return await Promise.race([
      promise.then((books) => ({ books, droppedByGrace: false })),
      timeout,
    ]);
  } catch {
    return { books: [], droppedByGrace: false };
  }
}

async function searchOnce(query: string, limit: number): Promise<NormalizedBook[]> {
  // Google Books is the fast, primary source — always wait for it (its
  // own internal timeout is the real ceiling). Open Library gets a
  // shorter grace period so a slow response there can't drag the whole
  // search down to it.
  const [googleResults, openLibraryOutcome] = await Promise.all([
    googleBooksProvider.search(query, limit).catch(() => []),
    raceWithGrace(
      openLibraryProvider.search(query, limit).catch(() => []),
      SLOW_PROVIDER_GRACE_MS
    ),
  ]);

  if (openLibraryOutcome.droppedByGrace) {
    logger.warn(SCOPE, "open library dropped by grace period", {
      query,
      graceMs: SLOW_PROVIDER_GRACE_MS,
    });
  }

  // Open Library goes first in the interleave: measured against real
  // queries it ranks the intended book first far more often for short or
  // exact titles ("Dune"), and it's the one carrying series data.
  return mergeResults(openLibraryOutcome.books, googleResults, limit);
}

/** Collapses runs of a repeated letter down to one, e.g. "harrry potter"
 * -> "harry potter", "fourthh wing" -> "fourth wing". Only used as a
 * fallback when the literal query finds nothing, since it would also
 * mangle legitimate double letters ("book" -> "bok") in words that were
 * actually spelled correctly. */
function collapseRepeatedLetters(query: string): string {
  return query.replace(/([a-z])\1+/gi, "$1");
}

/**
 * Searches every configured book source and merges the results. A
 * provider that's unreachable (network policy, rate limit, outage) is
 * skipped rather than failing the whole search. If the literal query
 * comes up empty, retries once against a version with repeated letters
 * collapsed, to tolerate the "did I spell that with one L or two"
 * class of typo.
 */
export async function searchBooks(
  query: string,
  limit = 20
): Promise<NormalizedBook[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const start = Date.now();
  let results = await searchOnce(trimmed, limit);

  let usedFuzzyRetry = false;
  if (results.length === 0) {
    const relaxed = collapseRepeatedLetters(trimmed);
    if (relaxed !== trimmed) {
      usedFuzzyRetry = true;
      logger.info(SCOPE, "no results, retrying with repeated letters collapsed", {
        original: trimmed,
        relaxed,
      });
      results = await searchOnce(relaxed, limit);
    }
  }

  logger.info(SCOPE, "search complete", {
    query: trimmed,
    durationMs: Date.now() - start,
    resultCount: results.length,
    usedFuzzyRetry,
    seriesDetected: results.filter((b) => b.seriesName).length,
  });

  return results;
}

/**
 * Resolves a book by ISBN. The first provider that knows the ISBN supplies
 * the record, but that provider often can't say what series it's in —
 * Google Books never does, and Open Library doesn't index every edition's
 * ISBN. So when the record has no series, ask Open Library separately
 * (by ISBN, then title + author) rather than stopping at the first hit.
 */
export async function lookupByIsbn(isbn: string): Promise<NormalizedBook | null> {
  let found: NormalizedBook | null = null;
  for (const provider of providers) {
    try {
      const book = await provider.lookupByIsbn(isbn);
      if (book) {
        found = book;
        break;
      }
    } catch {
      // try next provider
    }
  }

  if (!found) {
    logger.warn(SCOPE, "lookupByIsbn found nothing from any provider", { isbn });
    return null;
  }

  if (!found.seriesName) {
    const series = await findOpenLibrarySeries({
      // Open Library was already asked for this ISBN if it was the source.
      isbn: found.source === "openlibrary" ? undefined : isbn,
      title: found.title,
      authors: found.authors,
    });
    if (series) {
      found = {
        ...found,
        seriesName: series.seriesName,
        seriesPosition: series.seriesPosition,
        seriesKey: series.seriesKey,
      };
    }
  }

  logger.info(SCOPE, "lookupByIsbn resolved", {
    isbn,
    provider: found.source,
    seriesName: found.seriesName ?? null,
    seriesKey: found.seriesKey ?? null,
  });
  return found;
}
