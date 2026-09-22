import type { BookProvider, NormalizedBook } from "../types";
import { parseSeriesFromTitle } from "../series";
import { logger } from "@/lib/logger";

const SCOPE = "provider:google";

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    description?: string;
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    language?: string;
    categories?: string[];
  };
}

function normalize(volume: GoogleVolume): NormalizedBook {
  const info = volume.volumeInfo ?? {};
  const { title, seriesName, seriesPosition } = parseSeriesFromTitle(
    info.title ?? "Untitled"
  );

  const isbn10 = info.industryIdentifiers?.find((i) => i.type === "ISBN_10")
    ?.identifier;
  const isbn13 = info.industryIdentifiers?.find((i) => i.type === "ISBN_13")
    ?.identifier;

  const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;

  return {
    source: "googlebooks",
    sourceId: volume.id,
    title,
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    isbn10,
    isbn13,
    coverUrl: cover?.replace(/^http:/, "https:"),
    description: info.description,
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    pageCount: info.pageCount,
    language: info.language,
    languages: info.language ? [info.language] : [],
    genres: info.categories ?? [],
    seriesName,
    seriesPosition,
  };
}

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";

/** Without an API key, Google Books enforces a low, shared, per-IP quota
 * (not tied to this app specifically) — the cause of "works sometimes,
 * finds nothing other times" under any real traffic. Setting
 * GOOGLE_BOOKS_API_KEY (free, no billing required for normal usage — see
 * DEPLOY.md) moves the quota onto your own project instead. */
function withKey(params: URLSearchParams): URLSearchParams {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (key) params.set("key", key);
  return params;
}

export const googleBooksProvider: BookProvider = {
  name: "googlebooks",

  async search(query, limit = 20) {
    const hasKey = !!process.env.GOOGLE_BOOKS_API_KEY;
    const params = withKey(
      new URLSearchParams({
        q: query,
        maxResults: String(Math.min(limit, 40)),
      })
    );
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}?${params.toString()}`, {
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
          hasKey,
          body: body.slice(0, 300),
        });
        return [];
      }

      const data = (await res.json()) as { items?: GoogleVolume[] };
      const books = (data.items ?? []).map(normalize);
      const withSeries = books.filter((b) => b.seriesName).length;
      logger.info(SCOPE, "search ok", {
        query,
        durationMs,
        hasKey,
        resultCount: books.length,
        seriesDetected: withSeries,
      });
      return books;
    } catch (err) {
      const durationMs = Date.now() - start;
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      logger.warn(SCOPE, isTimeout ? "search timed out" : "search errored", {
        query,
        durationMs,
        hasKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  },

  async lookupByIsbn(isbn) {
    const params = withKey(new URLSearchParams({ q: `isbn:${isbn}` }));
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}?${params.toString()}`);
      const durationMs = Date.now() - start;

      if (!res.ok) {
        logger.warn(SCOPE, "lookupByIsbn failed", {
          isbn,
          status: res.status,
          durationMs,
        });
        return null;
      }

      const data = (await res.json()) as { items?: GoogleVolume[] };
      const first = data.items?.[0];
      const result = first ? normalize(first) : null;
      logger.info(SCOPE, "lookupByIsbn ok", {
        isbn,
        durationMs,
        found: !!result,
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
