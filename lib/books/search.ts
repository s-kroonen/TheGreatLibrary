import type { NormalizedBook } from "./types";
import { googleBooksProvider } from "./providers/google-books";
import { findOpenLibrarySeries, openLibraryProvider } from "./providers/open-library";
import { mergeResults } from "./merge";
import { withCache, swallowTransient, TransientProviderError, TTL, type CacheOptions } from "./provider-cache";
import { logger } from "@/lib/logger";

const SCOPE = "search";

const providers = [googleBooksProvider, openLibraryProvider];

// Open Library is well known to be slow (and occasionally to hang) — give
// it a head start alongside Google Books, but don't let it hold up an
// *interactive* search past this grace period. This only applies when
// someone's actually waiting on a response; see `background` below.
const SLOW_PROVIDER_GRACE_MS = 1500;
const INTERACTIVE_TIMEOUT_MS = 4000;
// Series lineup discovery and the startup backfill have no one watching a
// spinner — a slow-but-complete answer beats a fast-but-wrong one there,
// so background searches wait out both providers in full with a longer
// per-request timeout instead of racing/dropping anything.
const BACKGROUND_TIMEOUT_MS = 10000;

interface SearchOnceOptions {
  background?: boolean;
}

interface SearchOnceResult {
  results: NormalizedBook[];
  /** Set only for an interactive (non-background) search where Open
   * Library's response didn't make it back in time and got dropped from
   * the results returned to the caller. The promise is still running —
   * callers that don't need an immediate answer (e.g. the search action,
   * after it's already responded to the request) can await it anyway and
   * use whatever it finds to backfill data retroactively, getting the
   * slow-but-complete answer's value without making the user wait for it. */
  lateOpenLibrary: Promise<NormalizedBook[]> | null;
}

/** Races a provider promise against a grace-period timeout, but — unlike
 * a plain Promise.race — keeps the original promise accessible as `late`
 * even after the race is decided, so a caller can still use whatever it
 * eventually resolves to instead of just discarding it. */
async function raceWithGrace(
  promise: Promise<NormalizedBook[]>,
  graceMs: number
): Promise<{ books: NormalizedBook[]; droppedByGrace: boolean; late: Promise<NormalizedBook[]> | null }> {
  const TIMED_OUT = Symbol("timed-out");
  const timeout = new Promise<typeof TIMED_OUT>((resolve) =>
    setTimeout(() => resolve(TIMED_OUT), graceMs)
  );
  const winner = await Promise.race([promise, timeout]).catch(() => []);
  if (winner === TIMED_OUT) {
    return { books: [], droppedByGrace: true, late: promise };
  }
  return { books: winner as NormalizedBook[], droppedByGrace: false, late: null };
}

async function searchOnce(
  query: string,
  limit: number,
  opts: SearchOnceOptions = {}
): Promise<SearchOnceResult> {
  if (opts.background) {
    const [googleResults, openLibraryResults] = await Promise.all([
      googleBooksProvider.search(query, limit, { timeoutMs: BACKGROUND_TIMEOUT_MS }).catch(() => []),
      openLibraryProvider.search(query, limit, { timeoutMs: BACKGROUND_TIMEOUT_MS }).catch(() => []),
    ]);
    return {
      results: mergeResults(openLibraryResults, googleResults, limit),
      lateOpenLibrary: null,
    };
  }

  // Google Books is the fast, primary source — always wait for it (its
  // own internal timeout is the real ceiling). Open Library gets a
  // shorter grace period so a slow response there can't drag the whole
  // search down to it.
  const [googleResults, openLibraryOutcome] = await Promise.all([
    googleBooksProvider.search(query, limit, { timeoutMs: INTERACTIVE_TIMEOUT_MS }).catch(() => []),
    raceWithGrace(
      openLibraryProvider.search(query, limit, { timeoutMs: INTERACTIVE_TIMEOUT_MS }).catch(() => []),
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
  return {
    results: mergeResults(openLibraryOutcome.books, googleResults, limit),
    lateOpenLibrary: openLibraryOutcome.late,
  };
}

/** Collapses runs of a repeated letter down to one, e.g. "harrry potter"
 * -> "harry potter", "fourthh wing" -> "fourth wing". Only used as a
 * fallback when the literal query finds nothing, since it would also
 * mangle legitimate double letters ("book" -> "bok") in words that were
 * actually spelled correctly. */
function collapseRepeatedLetters(query: string): string {
  return query.replace(/([a-z])\1+/gi, "$1");
}

interface SearchBooksOptions {
  /** See SearchOnceOptions.background. Defaults to false (interactive). */
  background?: boolean;
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
  limit = 20,
  opts: SearchBooksOptions = {}
): Promise<NormalizedBook[]> {
  return (await searchBooksFull(query, limit, opts)).results;
}

/**
 * Same as searchBooks, but also hands back a promise for Open Library's
 * response when it was dropped from the (already-returned) results for
 * running past the interactive grace period — see SearchOnceResult.
 * lateOpenLibrary. Only the interactive search action needs this; every
 * other caller just wants the plain result list from searchBooks.
 */
export async function searchBooksFull(
  query: string,
  limit = 20,
  opts: SearchBooksOptions = {}
): Promise<SearchOnceResult> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], lateOpenLibrary: null };

  const start = Date.now();
  let outcome = await searchOnce(trimmed, limit, opts);

  let usedFuzzyRetry = false;
  if (outcome.results.length === 0) {
    const relaxed = collapseRepeatedLetters(trimmed);
    if (relaxed !== trimmed) {
      usedFuzzyRetry = true;
      logger.info(SCOPE, "no results, retrying with repeated letters collapsed", {
        original: trimmed,
        relaxed,
      });
      outcome = await searchOnce(relaxed, limit, opts);
    }
  }

  logger.info(SCOPE, "search complete", {
    query: trimmed,
    durationMs: Date.now() - start,
    resultCount: outcome.results.length,
    usedFuzzyRetry,
    background: opts.background ?? false,
    seriesDetected: outcome.results.filter((b) => b.seriesName).length,
  });

  return outcome;
}

/**
 * Resolves a book by ISBN. The first provider that knows the ISBN supplies
 * the record, but that provider often can't say what series it's in —
 * Google Books never does, and Open Library doesn't index every edition's
 * ISBN. So when the record has no series, ask Open Library separately
 * (by ISBN, then title + author) rather than stopping at the first hit.
 */
export async function lookupByIsbn(
  isbn: string,
  opts: CacheOptions = {}
): Promise<NormalizedBook | null> {
  return swallowTransient(withCache("search", "lookup-by-isbn", isbn, TTL.ISBN, () => lookupByIsbnUncached(isbn), opts), opts.onTransient);
}

async function lookupByIsbnUncached(isbn: string): Promise<NormalizedBook | null> {
  let found: NormalizedBook | null = null;
  let anyProviderFailed = false;
  for (const provider of providers) {
    try {
      const book = await provider.lookupByIsbn(isbn);
      if (book) {
        found = book;
        break;
      }
    } catch {
      // try next provider
      anyProviderFailed = true;
    }
  }

  if (!found) {
    logger.warn(SCOPE, "lookupByIsbn found nothing from any provider", { isbn, anyProviderFailed });
    // If a provider errored out, "nothing found" is really "couldn't
    // tell" — don't let withCache store it as a confirmed miss.
    if (anyProviderFailed) throw new TransientProviderError(`lookupByIsbn ${isbn}: a provider failed`);
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
