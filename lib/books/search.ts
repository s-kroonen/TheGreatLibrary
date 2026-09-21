import type { NormalizedBook } from "./types";
import { googleBooksProvider } from "./providers/google-books";
import { openLibraryProvider } from "./providers/open-library";
import { logger } from "@/lib/logger";

const SCOPE = "search";

const providers = [googleBooksProvider, openLibraryProvider];

// Open Library is well known to be slow (and occasionally to hang) — give
// it a head start alongside Google Books, but don't let it hold up the
// whole search past this grace period. Its results are still merged in
// if they land within it; whatever's still in flight after is dropped.
const SLOW_PROVIDER_GRACE_MS = 1500;

function dedupeKey(book: NormalizedBook): string {
  if (book.isbn13) return `isbn:${book.isbn13}`;
  if (book.isbn10) return `isbn:${book.isbn10}`;
  return `title:${book.title.toLowerCase()}|${(book.authors[0] ?? "").toLowerCase()}`;
}

function mergeInto(
  merged: Map<string, NormalizedBook>,
  books: NormalizedBook[]
) {
  for (const book of books) {
    const key = dedupeKey(book);
    if (!merged.has(key)) merged.set(key, book);
  }
}

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

async function searchOnce(query: string, limit: number) {
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

  const merged = new Map<string, NormalizedBook>();
  mergeInto(merged, googleResults);
  mergeInto(merged, openLibraryOutcome.books);
  return merged;
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
  const merged = await searchOnce(trimmed, limit);

  let usedFuzzyRetry = false;
  if (merged.size === 0) {
    const relaxed = collapseRepeatedLetters(trimmed);
    if (relaxed !== trimmed) {
      usedFuzzyRetry = true;
      logger.info(SCOPE, "no results, retrying with repeated letters collapsed", {
        original: trimmed,
        relaxed,
      });
      const retried = await searchOnce(relaxed, limit);
      mergeInto(merged, Array.from(retried.values()));
    }
  }

  const results = Array.from(merged.values()).slice(0, limit);
  logger.info(SCOPE, "search complete", {
    query: trimmed,
    durationMs: Date.now() - start,
    resultCount: results.length,
    usedFuzzyRetry,
    seriesDetected: results.filter((b) => b.seriesName).length,
  });

  return results;
}

export async function lookupByIsbn(isbn: string): Promise<NormalizedBook | null> {
  for (const provider of providers) {
    try {
      const book = await provider.lookupByIsbn(isbn);
      if (book) {
        logger.info(SCOPE, "lookupByIsbn resolved", {
          isbn,
          provider: provider.name,
          seriesName: book.seriesName ?? null,
        });
        return book;
      }
    } catch {
      // try next provider
    }
  }
  logger.warn(SCOPE, "lookupByIsbn found nothing from any provider", { isbn });
  return null;
}
