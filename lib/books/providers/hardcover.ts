/**
 * Hardcover (hardcover.app) as a series-detection source. It's a modern
 * Goodreads alternative built around exactly the indie/romance/romantasy
 * catalog Open Library is weakest on — verified directly against their
 * docs (docs.hardcover.app) before writing this: free GraphQL API
 * (5,000 req/day), `search` for fuzzy title/author lookup (Typesense,
 * typo-tolerant), and a `series` + `book_series` query for a full,
 * de-duplicated lineup with built-in compilation/duplicate filtering —
 * something we had to hand-roll for Open Library.
 *
 * Entirely optional: requires a free account + personal API token the
 * user creates themselves (docs.hardcover.app/api/getting-started —
 * "Getting an API Key"). Every function here no-ops (returns null/[])
 * when HARDCOVER_API_KEY isn't set, the same pattern as Google Books'
 * optional key.
 */
import { isCollectionListing, sharesAuthor, titleStem } from "../match";
import { withCache, TTL, type CacheOptions } from "../provider-cache";
import { logger } from "@/lib/logger";
import type { SeriesVolume } from "@/db/schema";

const SCOPE = "provider:hardcover";
const ENDPOINT = "https://api.hardcover.app/v1/graphql";

function apiKey(): string | null {
  return process.env.HARDCOVER_API_KEY || null;
}

// ---------- Rate limiting ----------
// Free tier (confirmed on the account this was built against): 60
// requests/min with a burst of 10, 5,000/day. A token bucket enforces the
// per-minute shape client-side so we never fire the kind of burst that'd
// otherwise get us 429'd — one token refills every second, up to 10
// banked. The daily count is a best-effort safety margin on top of that:
// it resets on container restart (not persisted), so it undercounts
// across restarts, but the real backstop is honoring 429 + Retry-After
// below, which is authoritative regardless of what we've counted.
const RATE_LIMIT_BURST = 10;
const RATE_LIMIT_PER_MIN = 60;
const DAILY_LIMIT = 5000;
const DAILY_SAFETY_MARGIN = 200; // stop ourselves well short of the real cap

let tokens = RATE_LIMIT_BURST;
let lastRefill = Date.now();
let dailyCount = 0;
let dailyResetAt = nextUtcMidnight();
let cooldownUntil = 0; // set when Hardcover itself returns a 429

function nextUtcMidnight(): number {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/** Resolves once a request is actually allowed to go out, or immediately
 * with false if today's safety-margin budget is already spent. */
async function acquireSlot(): Promise<boolean> {
  const now = Date.now();
  if (now >= dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = nextUtcMidnight();
  }
  if (dailyCount >= DAILY_LIMIT - DAILY_SAFETY_MARGIN) {
    logger.warn(SCOPE, "daily request budget reached, skipping Hardcover for the rest of today", {
      dailyCount,
      limit: DAILY_LIMIT,
    });
    return false;
  }

  if (cooldownUntil > now) {
    await new Promise((r) => setTimeout(r, cooldownUntil - now));
  }

  for (;;) {
    const t = Date.now();
    tokens = Math.min(RATE_LIMIT_BURST, tokens + ((t - lastRefill) * RATE_LIMIT_PER_MIN) / 60000);
    lastRefill = t;
    if (tokens >= 1) {
      tokens -= 1;
      dailyCount++;
      return true;
    }
    const waitMs = Math.min(2000, Math.max(50, ((1 - tokens) * 60000) / RATE_LIMIT_PER_MIN));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  label: string,
  timeoutMs = 4000
): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  if (!(await acquireSlot())) return null;

  const start = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        // Hardcover's own docs recommend this for scripts/tools hitting
        // the API, to help them reach heavy or misbehaving users.
        "User-Agent": "TheGreatLibrary/1.0 (+https://github.com/s-kroonen/TheGreatLibrary)",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const durationMs = Date.now() - start;

    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? 30);
      cooldownUntil = Date.now() + retryAfterSec * 1000;
      logger.warn(SCOPE, `${label} rate limited by Hardcover`, { durationMs, retryAfterSec });
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(SCOPE, `${label} failed`, { status: res.status, durationMs, body: body.slice(0, 300) });
      return null;
    }

    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      logger.warn(SCOPE, `${label} returned errors`, {
        durationMs,
        errors: json.errors.map((e) => e.message),
      });
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    logger.warn(SCOPE, isTimeout ? `${label} timed out` : `${label} errored`, {
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------- Per-book series resolution (search, Typesense-backed) ----------

interface HardcoverBookSearchResult {
  title?: string;
  author_names?: string[];
  isbns?: string[];
  // Confirmed against a real response: `featured_series.id` is the
  // book_series JOIN row's own id (different per book), NOT the series'
  // id — that's nested at featured_series.series.id. Same for the name:
  // it lives on the nested `series` object, not on featured_series
  // itself. Easy to get backwards since the docs don't spell out the
  // nesting; verified with a live query before trusting it.
  featured_series?: { series?: { id?: number; name?: string } | null } | null;
  featured_series_position?: number | null;
}

interface SearchData {
  search?: { results?: { hits?: { document?: HardcoverBookSearchResult }[] } };
}

const SEARCH_QUERY = `
  query SearchBooks($query: String!) {
    search(query: $query, query_type: "Book", per_page: 5, page: 1) {
      results
    }
  }
`;

/** The `search` field returns a raw Typesense payload (typed `jsonb` on
 * Hardcover's side, so GraphQL hands it back as opaque JSON) — its shape
 * is `{ results: { hits: [{ document: {...} }] } }` rather than a plain
 * list, confirmed against their docs' example responses. */
async function searchBooksRaw(query: string): Promise<HardcoverBookSearchResult[]> {
  const data = await graphql<SearchData>(SEARCH_QUERY, { query }, "book search");
  return (data?.search?.results?.hits ?? [])
    .map((h) => h.document)
    .filter((d): d is HardcoverBookSearchResult => !!d);
}

export interface ResolvedHardcoverSeries {
  seriesName: string;
  seriesPosition?: number;
  /** Hardcover's series id — used to fetch the full lineup later. */
  seriesId: string;
  via: "isbn" | "title-author";
}

/** Mirrors findOpenLibrarySeries: tries ISBN first (via the isbns field
 * in search results), then falls back to title + author. Cached (see
 * provider-cache.ts) — pass opts.force to bypass for an explicit
 * user-triggered refresh. */
export async function findHardcoverSeries(
  book: { isbn?: string; title: string; authors: string[] },
  opts: CacheOptions = {}
): Promise<ResolvedHardcoverSeries | null> {
  if (!apiKey()) return null;
  const key = `${book.isbn ?? "-"}|${titleStem(book.title)}|${(book.authors[0] ?? "").toLowerCase()}`;
  return withCache("hardcover", "series-by-book", key, TTL.SERIES, () => findHardcoverSeriesUncached(book), opts);
}

async function findHardcoverSeriesUncached(book: {
  isbn?: string;
  title: string;
  authors: string[];
}): Promise<ResolvedHardcoverSeries | null> {
  const start = Date.now();

  const pick = (
    hits: HardcoverBookSearchResult[],
    via: ResolvedHardcoverSeries["via"]
  ): ResolvedHardcoverSeries | null => {
    for (const hit of hits) {
      if (!hit.title || isCollectionListing(hit.title)) continue;
      const series = hit.featured_series?.series;
      if (!series?.name || series.id === undefined) continue;
      if (via === "title-author") {
        if (titleStem(hit.title) !== titleStem(book.title)) continue;
        if (!sharesAuthor(hit.author_names ?? [], book.authors)) continue;
      }
      return {
        seriesName: series.name,
        seriesPosition: hit.featured_series_position ?? undefined,
        seriesId: String(series.id),
        via,
      };
    }
    return null;
  };

  if (book.isbn) {
    const hits = await searchBooksRaw(book.isbn);
    const hit = pick(
      hits.filter((h) => h.isbns?.includes(book.isbn!)),
      "isbn"
    );
    if (hit) {
      logger.info(SCOPE, "resolved series", { ...hit, isbn: book.isbn, durationMs: Date.now() - start });
      return hit;
    }
  }

  const hits = await searchBooksRaw(book.authors[0] ? `${book.title} ${book.authors[0]}` : book.title);
  const hit = pick(hits, "title-author");
  logger.info(SCOPE, hit ? "resolved series" : "no series found", {
    title: book.title,
    author: book.authors[0] ?? null,
    isbn: book.isbn ?? null,
    ...(hit ?? {}),
    durationMs: Date.now() - start,
  });
  return hit;
}

// ---------- Full series lineup (structured query, not search) ----------

interface BookSeriesEdge {
  position?: number | null;
  details?: string | null;
  book?: {
    title?: string;
    // ISBNs live on `editions`, not on `books` directly (confirmed
    // against the real schema after `isbns` on `books` errored: "field
    // 'isbns' not found in type: 'books'") — one edition is enough,
    // best-effort, not meant to pick a canonical one.
    editions?: { isbn_13?: string | null; isbn_10?: string | null }[];
  } | null;
}

interface SeriesLineupData {
  series?: { book_series?: BookSeriesEdge[] }[];
}

/**
 * The exact query shape and filters here are verified straight from
 * Hardcover's own "Getting All Books in a Series" guide — `_eq` only
 * (their fuzzy-match operators are disabled API-side), duplicate/
 * compilation filtering is their own documented recipe, not guessed.
 */
const LINEUP_QUERY = `
  query SeriesLineup($seriesId: Int!) {
    series(where: { id: { _eq: $seriesId } }) {
      book_series(
        distinct_on: position
        order_by: [{ position: asc }, { book: { users_count: desc } }]
        where: {
          book: { canonical_id: { _is_null: true }, is_partial_book: { _eq: false } }
          compilation: { _eq: false }
        }
      ) {
        position
        details
        book {
          title
          editions(limit: 1) {
            isbn_13
            isbn_10
          }
        }
      }
    }
  }
`;

export async function fetchHardcoverSeriesLineup(
  seriesId: string,
  opts: CacheOptions = {}
): Promise<SeriesVolume[] | null> {
  if (!apiKey()) return null;
  return withCache("hardcover", "lineup", seriesId, TTL.LINEUP, () => fetchHardcoverSeriesLineupUncached(seriesId), opts);
}

async function fetchHardcoverSeriesLineupUncached(seriesId: string): Promise<SeriesVolume[] | null> {
  const start = Date.now();
  const numericId = Number(seriesId);
  if (!Number.isFinite(numericId)) return null;

  const data = await graphql<SeriesLineupData>(
    LINEUP_QUERY,
    { seriesId: numericId },
    "series lineup",
    8000
  );
  if (!data) return null;

  const edges = data.series?.[0]?.book_series ?? [];
  const volumes: SeriesVolume[] = [];
  const skipped: string[] = [];
  for (const edge of edges) {
    const title = edge.book?.title;
    if (!title || edge.position == null) {
      if (title) skipped.push(title);
      continue;
    }
    const edition = edge.book?.editions?.[0];
    volumes.push({
      position: edge.position,
      title,
      isbn13: edition?.isbn_13 ?? undefined,
      isbn10: edition?.isbn_10 ?? undefined,
      // No Google Books/Open Library sourceId for this record — can't be
      // one-click-added to a wishlist (addMissingSeriesBooksToWishlistAction
      // skips volumes without source+sourceId), but it still shows
      // correctly in the "what's missing" list, which is the main value.
    });
  }

  logger.info(SCOPE, "series lineup fetched", {
    seriesId,
    durationMs: Date.now() - start,
    volumes: volumes.length,
    positions: volumes.map((v) => v.position),
    skippedWithoutPosition: skipped,
  });
  return volumes;
}

/** Resolves a series name to Hardcover's series id via its (fuzzy,
 * typo-tolerant) series search, so fetchHardcoverSeriesLineup can be
 * called by id afterward — exact-match `where` filters can't do this
 * themselves since Hardcover disables the fuzzy/case-insensitive
 * operators API-side. */
export async function findHardcoverSeriesId(
  name: string,
  opts: CacheOptions = {}
): Promise<string | null> {
  if (!apiKey()) return null;
  return withCache("hardcover", "series-id-by-name", name.toLowerCase(), TTL.SERIES, () => findHardcoverSeriesIdUncached(name), opts);
}

async function findHardcoverSeriesIdUncached(name: string): Promise<string | null> {
  interface SeriesSearchDoc {
    id?: number;
    name?: string;
  }
  interface SeriesSearchData {
    search?: { results?: { hits?: { document?: SeriesSearchDoc }[] } };
  }
  const data = await graphql<SeriesSearchData>(
    `query SearchSeries($query: String!) {
      search(query: $query, query_type: "Series", per_page: 5, page: 1) {
        results
      }
    }`,
    { query: name },
    "series id search"
  );
  const hits = (data?.search?.results?.hits ?? [])
    .map((h) => h.document)
    .filter((d): d is SeriesSearchDoc => !!d);
  const exact = hits.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  const match = exact ?? hits[0];
  return match?.id !== undefined ? String(match.id) : null;
}
