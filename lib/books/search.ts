import type { NormalizedBook } from "./types";
import { googleBooksProvider } from "./providers/google-books";
import { openLibraryProvider } from "./providers/open-library";

const providers = [googleBooksProvider, openLibraryProvider];

function dedupeKey(book: NormalizedBook): string {
  if (book.isbn13) return `isbn:${book.isbn13}`;
  if (book.isbn10) return `isbn:${book.isbn10}`;
  return `title:${book.title.toLowerCase()}|${(book.authors[0] ?? "").toLowerCase()}`;
}

/**
 * Searches every configured book source in parallel and merges the results.
 * A provider that's unreachable (network policy, rate limit, outage) is
 * skipped rather than failing the whole search.
 */
export async function searchBooks(
  query: string,
  limit = 20
): Promise<NormalizedBook[]> {
  if (!query.trim()) return [];

  const results = await Promise.allSettled(
    providers.map((provider) => provider.search(query, limit))
  );

  const merged = new Map<string, NormalizedBook>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const book of result.value) {
      const key = dedupeKey(book);
      if (!merged.has(key)) merged.set(key, book);
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
