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

interface OpenLibraryWork {
  series?: Array<{ series?: { key?: string }; key?: string; position?: string }>;
}

interface OpenLibrarySeriesEntity {
  name?: string;
}

/**
 * Open Library's search index doesn't reliably carry the `series` field
 * (confirmed by direct inspection — see scripts/inspect-book.ts), but the
 * Work-level record often has a `series` membership referencing a separate
 * Series entity (`/series/{key}`) that DOES carry a human-readable `name`.
 * Only worth the extra round-trips when we don't already have a series
 * name from a cheaper source (title parsing / search doc's own field).
 */
async function resolveSeriesFromWork(
  workKey: string
): Promise<{ seriesName: string; seriesPosition?: number } | null> {
  const start = Date.now();
  try {
    const workRes = await fetch(`${BASE_URL}${workKey}.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!workRes.ok) {
      logger.warn(SCOPE, "work-level lookup failed", {
        workKey,
        status: workRes.status,
        durationMs: Date.now() - start,
      });
      return null;
    }

    const work = (await workRes.json()) as OpenLibraryWork;
    const membership = work.series?.[0];
    const seriesKey = membership?.series?.key ?? membership?.key;
    if (!seriesKey) {
      logger.info(SCOPE, "work has no series membership", {
        workKey,
        durationMs: Date.now() - start,
      });
      return null;
    }

    const seriesRes = await fetch(`${BASE_URL}${seriesKey}.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!seriesRes.ok) {
      logger.warn(SCOPE, "series entity lookup failed", {
        workKey,
        seriesKey,
        status: seriesRes.status,
        durationMs: Date.now() - start,
      });
      return null;
    }

    const seriesEntity = (await seriesRes.json()) as OpenLibrarySeriesEntity;
    const durationMs = Date.now() - start;
    if (!seriesEntity.name) {
      logger.warn(SCOPE, "series entity has no name", {
        workKey,
        seriesKey,
        durationMs,
      });
      return null;
    }

    const position = membership?.position ? Number(membership.position) : undefined;
    logger.info(SCOPE, "resolved series via work-level lookup", {
      workKey,
      seriesKey,
      seriesName: seriesEntity.name,
      seriesPosition: position,
      durationMs,
    });
    return {
      seriesName: seriesEntity.name,
      seriesPosition: Number.isFinite(position) ? position : undefined,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    logger.warn(SCOPE, isTimeout ? "work-level lookup timed out" : "work-level lookup errored", {
      workKey,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

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
      let result = first ? normalize(first) : null;

      // The search index rarely carries `series` directly — fall back to
      // the Work-level lookup before giving up, so a book like "Icebreaker"
      // (no series signal from either the title or the search doc) still
      // gets linked. Only worth the extra round-trips when we don't
      // already have a name from a cheaper source.
      if (result && !result.seriesName && first?.key) {
        const viaWork = await resolveSeriesFromWork(first.key);
        if (viaWork) {
          result = { ...result, ...viaWork };
        }
      }

      logger.info(SCOPE, "lookupByIsbn ok", {
        isbn,
        durationMs,
        found: !!result,
        rawSeriesField: first?.series?.[0] ?? null,
        seriesName: result?.seriesName ?? null,
        seriesSource: result?.seriesName
          ? first?.series?.[0]
            ? "search-doc-field"
            : "work-level-lookup"
          : null,
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
