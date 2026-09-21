import type { BookProvider, NormalizedBook } from "../types";
import { parseSeriesField, parseSeriesFromTitle } from "../series";
import { logger } from "@/lib/logger";

const SCOPE = "provider:openlibrary";

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  publisher?: string[];
  first_publish_year?: number;
  language?: string[];
  subject?: string[];
  series?: string[];
}

function normalize(doc: OpenLibraryDoc): NormalizedBook {
  const fromTitle = parseSeriesFromTitle(doc.title);
  // Prefer Open Library's own `series` field when present — it's a real
  // indexed field, not a guess parsed out of the title text.
  const fromField = doc.series?.[0] ? parseSeriesField(doc.series[0]) : null;

  const title = fromTitle.title;
  const seriesName = fromField?.seriesName ?? fromTitle.seriesName;
  const seriesPosition = fromField?.seriesPosition ?? fromTitle.seriesPosition;

  const isbns = doc.isbn ?? [];

  return {
    source: "openlibrary",
    sourceId: doc.key,
    title,
    authors: doc.author_name ?? [],
    isbn10: isbns.find((i) => i.length === 10),
    isbn13: isbns.find((i) => i.length === 13),
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : undefined,
    publisher: doc.publisher?.[0],
    publishedDate: doc.first_publish_year
      ? String(doc.first_publish_year)
      : undefined,
    language: doc.language?.[0],
    genres: doc.subject?.slice(0, 5) ?? [],
    seriesName,
    seriesPosition,
  };
}

const BASE_URL = "https://openlibrary.org";

export const openLibraryProvider: BookProvider = {
  name: "openlibrary",

  async search(query, limit = 20) {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      // Restrict to the fields we actually use — the default response
      // includes a lot more per-edition data and is noticeably slower.
      fields: "key,title,author_name,isbn,cover_i,publisher,first_publish_year,language,subject,series",
    });
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/search.json?${params.toString()}`, {
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(4000),
      });
      const durationMs = Date.now() - start;

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn(SCOPE, "search request failed", {
          query,
          status: res.status,
          durationMs,
          body: body.slice(0, 300),
        });
        return [];
      }

      const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
      const docs = data.docs ?? [];
      const books = docs.map(normalize);
      const withSeriesField = docs.filter((d) => d.series?.[0]).length;
      const withSeriesDetected = books.filter((b) => b.seriesName).length;
      logger.info(SCOPE, "search ok", {
        query,
        durationMs,
        resultCount: books.length,
        withSeriesField,
        seriesDetected: withSeriesDetected,
      });
      return books;
    } catch (err) {
      const durationMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      logger.warn(SCOPE, isTimeout ? "search timed out" : "search errored", {
        query,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },

  async lookupByIsbn(isbn) {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/search.json?isbn=${isbn}`);
      const durationMs = Date.now() - start;

      if (!res.ok) {
        logger.warn(SCOPE, "lookupByIsbn failed", {
          isbn,
          status: res.status,
          durationMs,
        });
        return null;
      }

      const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
      const first = data.docs?.[0];
      const result = first ? normalize(first) : null;
      logger.info(SCOPE, "lookupByIsbn ok", {
        isbn,
        durationMs,
        found: !!result,
        rawSeriesField: first?.series?.[0] ?? null,
        seriesName: result?.seriesName ?? null,
      });
      return result;
    } catch (err) {
      logger.warn(SCOPE, "lookupByIsbn errored", {
        isbn,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },
};
