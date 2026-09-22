import type { BookProvider, NormalizedBook } from "../types";
import { parseSeriesField, parseSeriesFromTitle } from "../series";
import { sharesAuthor, titleStem } from "../match";
import { logger } from "@/lib/logger";
import type { SeriesVolume } from "@/db/schema";

const SCOPE = "provider:openlibrary";
const BASE_URL = "https://openlibrary.org";

/** Open Library has no API key — but per their own published policy
 * (openlibrary.org/developers/api), an unidentified request is capped at
 * 1 req/s while one with a descriptive User-Agent (app name + a contact
 * email or URL) gets 3 req/s. We were sending no User-Agent at all, so
 * every request ran at the lower anonymous rate for no reason. Set
 * OPEN_LIBRARY_CONTACT in .env to your email for the full policy match;
 * the repo URL fallback still identifies the app either way. */
const USER_AGENT = `TheGreatLibrary/1.0 (+${
  process.env.OPEN_LIBRARY_CONTACT ?? "https://github.com/s-kroonen/TheGreatLibrary"
})`;

/** Every field normalize() reads. Restricting the response to these is
 * noticeably faster than the default, which carries a lot of per-edition
 * data. `series` is kept for old records, but the index's real series
 * fields are series_key / series_name / series_position (confirmed against
 * live responses — `series` came back null even for books that have one). */
const DOC_FIELDS =
  "key,title,author_name,isbn,cover_i,publisher,first_publish_year,language,subject,series,series_key,series_name,series_position";

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
  series_key?: string[];
  series_name?: string[];
  series_position?: string[];
  edition_count?: number;
}

function parsePosition(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function normalize(doc: OpenLibraryDoc): NormalizedBook {
  const fromTitle = parseSeriesFromTitle(doc.title);
  const fromLegacyField = doc.series?.[0] ? parseSeriesField(doc.series[0]) : null;

  // Prefer the index's structured series fields over anything parsed out
  // of text.
  const indexedName = doc.series_name?.[0];
  const seriesName = indexedName ?? fromLegacyField?.seriesName ?? fromTitle.seriesName;
  const seriesPosition =
    (indexedName ? parsePosition(doc.series_position?.[0]) : undefined) ??
    fromLegacyField?.seriesPosition ??
    fromTitle.seriesPosition;

  const isbns = doc.isbn ?? [];

  return {
    source: "openlibrary",
    sourceId: doc.key,
    title: fromTitle.title,
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
    seriesKey: indexedName ? doc.series_key?.[0] : undefined,
  };
}

/** Runs one search.json query. Returns null (not []) when the request
 * failed, so callers can tell "no matches" from "couldn't ask". */
async function querySearch(
  params: Record<string, string>,
  label: string,
  opts: { timeoutMs?: number; cache?: boolean } = {}
): Promise<OpenLibraryDoc[] | null> {
  const start = Date.now();
  try {
    const res = await fetch(
      `${BASE_URL}/search.json?${new URLSearchParams(params).toString()}`,
      {
        headers: { "User-Agent": USER_AGENT },
        ...(opts.cache ? { next: { revalidate: 3600 } } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(SCOPE, `${label} failed`, {
        params,
        status: res.status,
        durationMs: Date.now() - start,
        body: body.slice(0, 300),
      });
      return null;
    }
    const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
    return data.docs ?? [];
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    logger.warn(SCOPE, isTimeout ? `${label} timed out` : `${label} errored`, {
      params,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface ResolvedSeries {
  seriesName: string;
  seriesPosition?: number;
  seriesKey: string;
  via: "isbn" | "title-author";
}

/**
 * Finds the series a book belongs to according to Open Library. Tries the
 * ISBN first, then falls back to title + author — needed because Open
 * Library's ISBN index is per-edition and frequently lacks the exact
 * edition Google Books hands us (e.g. Icebreaker's standard edition
 * 9781398525696 is unknown to it, though the work itself is present and
 * carries the series).
 */
export async function findOpenLibrarySeries(book: {
  isbn?: string;
  title: string;
  authors: string[];
}): Promise<ResolvedSeries | null> {
  const start = Date.now();

  const pick = (docs: OpenLibraryDoc[], via: ResolvedSeries["via"]) => {
    for (const doc of docs) {
      const n = normalize(doc);
      if (!n.seriesKey || !n.seriesName) continue;
      if (via === "title-author") {
        if (titleStem(n.title) !== titleStem(book.title)) continue;
        if (!sharesAuthor(n.authors, book.authors)) continue;
      }
      return {
        seriesName: n.seriesName,
        seriesPosition: n.seriesPosition,
        seriesKey: n.seriesKey,
        via,
      } satisfies ResolvedSeries;
    }
    return null;
  };

  if (book.isbn) {
    const docs = await querySearch({ isbn: book.isbn, fields: DOC_FIELDS }, "series-by-isbn");
    const hit = docs && pick(docs, "isbn");
    if (hit) {
      logger.info(SCOPE, "resolved series", { ...hit, isbn: book.isbn, durationMs: Date.now() - start });
      return hit;
    }
  }

  const params: Record<string, string> = {
    title: book.title,
    limit: "10",
    fields: DOC_FIELDS,
  };
  if (book.authors[0]) params.author = book.authors[0];
  const docs = await querySearch(params, "series-by-title-author");
  const hit = docs && pick(docs, "title-author");
  logger.info(SCOPE, hit ? "resolved series" : "no series found", {
    title: book.title,
    author: book.authors[0] ?? null,
    isbn: book.isbn ?? null,
    ...(hit ?? {}),
    durationMs: Date.now() - start,
  });
  return hit;
}

/**
 * Enumerates every work Open Library has filed under a series. The
 * Series entity's own `seeds` link looks like it should do this but
 * doesn't: it reports seed_count 0 and 404/500s. The search index, on the
 * other hand, carries series_key on every member work, so querying by it
 * returns the whole lineup (with positions) in one request.
 *
 * Returns null when the request failed, [] when the series has no members.
 */
export async function fetchOpenLibrarySeriesLineup(
  seriesKey: string
): Promise<SeriesVolume[] | null> {
  const start = Date.now();
  const docs = await querySearch(
    {
      q: `series_key:${seriesKey}`,
      limit: "100",
      fields: `${DOC_FIELDS},edition_count`,
    },
    "series lineup",
    { timeoutMs: 8000 }
  );
  if (!docs) return null;

  // If two works claim the same position (duplicate works for different
  // editions), keep the one with the most editions — the canonical one.
  const byPosition = new Map<number, { volume: SeriesVolume; editions: number }>();
  const skipped: string[] = [];
  for (const doc of docs) {
    const idx = doc.series_key?.indexOf(seriesKey) ?? -1;
    const position = idx >= 0 ? parsePosition(doc.series_position?.[idx]) : undefined;
    if (position === undefined || position <= 0) {
      skipped.push(doc.title);
      continue;
    }
    const n = normalize(doc);
    const editions = doc.edition_count ?? 0;
    const existing = byPosition.get(position);
    if (existing && existing.editions >= editions) continue;
    byPosition.set(position, {
      editions,
      volume: {
        position,
        title: n.title,
        coverUrl: n.coverUrl,
        isbn13: n.isbn13,
        isbn10: n.isbn10,
        source: "openlibrary",
        sourceId: doc.key,
        authors: n.authors,
      },
    });
  }

  const volumes = Array.from(byPosition.values())
    .map((v) => v.volume)
    .sort((a, b) => a.position - b.position);
  logger.info(SCOPE, "series lineup fetched", {
    seriesKey,
    durationMs: Date.now() - start,
    worksReturned: docs.length,
    volumes: volumes.length,
    positions: volumes.map((v) => v.position),
    skippedWithoutPosition: skipped,
  });
  return volumes;
}

export const openLibraryProvider: BookProvider = {
  name: "openlibrary",

  async search(query, limit = 20) {
    const start = Date.now();
    const docs = await querySearch(
      { q: query, limit: String(limit), fields: DOC_FIELDS },
      "search request",
      { timeoutMs: 4000, cache: true }
    );
    if (!docs) return [];

    const books = docs.map(normalize);
    logger.info(SCOPE, "search ok", {
      query,
      durationMs: Date.now() - start,
      resultCount: books.length,
      seriesDetected: books.filter((b) => b.seriesName).length,
    });
    return books;
  },

  async lookupByIsbn(isbn) {
    const start = Date.now();
    const docs = await querySearch({ isbn, fields: DOC_FIELDS }, "lookupByIsbn");
    if (!docs) return null;
    const result = docs[0] ? normalize(docs[0]) : null;
    logger.info(SCOPE, "lookupByIsbn ok", {
      isbn,
      durationMs: Date.now() - start,
      found: !!result,
      seriesName: result?.seriesName ?? null,
    });
    return result;
  },
};
