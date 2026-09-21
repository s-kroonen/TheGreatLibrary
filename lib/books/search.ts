import type { NormalizedBook } from "./types";
import { googleBooksProvider } from "./providers/google-books";
import { openLibraryProvider } from "./providers/open-library";

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

async function raceWithGrace(
  promise: Promise<NormalizedBook[]>,
  graceMs: number
): Promise<NormalizedBook[]> {
  const timeout = new Promise<NormalizedBook[]>((resolve) =>
    setTimeout(() => resolve([]), graceMs)
  );
  try {
    return await Promise.race([promise, timeout]);
  } catch {
    return [];
  }
}

async function searchOnce(query: string, limit: number) {
  // Google Books is the fast, primary source — always wait for it (its
  // own internal timeout is the real ceiling). Open Library gets a
  // shorter grace period so a slow response there can't drag the whole
  // search down to it.
  const [googleResults, openLibraryResults] = await Promise.all([
    googleBooksProvider.search(query, limit).catch(() => []),
    raceWithGrace(
      openLibraryProvider.search(query, limit).catch(() => []),
      SLOW_PROVIDER_GRACE_MS
    ),
  ]);

  const merged = new Map<string, NormalizedBook>();
  mergeInto(merged, googleResults);
  mergeInto(merged, openLibraryResults);
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

  const merged = await searchOnce(trimmed, limit);

  if (merged.size === 0) {
    const relaxed = collapseRepeatedLetters(trimmed);
    if (relaxed !== trimmed) {
      const retried = await searchOnce(relaxed, limit);
      mergeInto(merged, Array.from(retried.values()));
    }
  }

  return Array.from(merged.values()).slice(0, limit);
}

export async function lookupByIsbn(isbn: string): Promise<NormalizedBook | null> {
  for (const provider of providers) {
    try {
      const book = await provider.lookupByIsbn(isbn);
      if (book) return book;
    } catch {
      // try next provider
    }
  }
  return null;
}
