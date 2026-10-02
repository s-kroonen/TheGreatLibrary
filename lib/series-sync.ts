import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { book, series, type SeriesVolume } from "@/db/schema";
import { discoverSeriesVolumes } from "@/lib/books/series-lookup";
import { sharesAuthor } from "@/lib/books/match";
import { lookupByIsbn } from "@/lib/books/search";
import { findOpenLibrarySeries, fetchOpenLibrarySeriesLineup } from "@/lib/books/providers/open-library";
import { findHardcoverSeries, fetchHardcoverSeriesLineup } from "@/lib/books/providers/hardcover";
import type { CacheOptions } from "@/lib/books/provider-cache";
import type { NormalizedBook, SeriesProviderSource } from "@/lib/books/types";
import { logger } from "@/lib/logger";

const SCOPE = "series-sync";

/** Re-exported so callers (e.g. lib/queries.ts) don't need to know this
 * type actually lives in lib/books/types.ts. */
export type ProviderSource = SeriesProviderSource;

interface FoundSeries {
  seriesName: string;
  seriesPosition?: number;
  source: ProviderSource;
  sourceId: string;
}

/** Tries Open Library's title/author match, then Hardcover's — Hardcover
 * is specifically strong on the indie/romance/romantasy titles Open
 * Library tends to have nothing on at all, verified against real
 * responses for a batch of series neither our ISBN lookup nor Open
 * Library's own fallback could place. */
async function findSeriesAnyProvider(
  book: { isbn?: string; title: string; authors: string[] },
  opts: CacheOptions = {}
): Promise<FoundSeries | null> {
  const ol = await findOpenLibrarySeries(book, opts);
  if (ol) {
    return { seriesName: ol.seriesName, seriesPosition: ol.seriesPosition, source: "openlibrary", sourceId: ol.seriesKey };
  }
  const hc = await findHardcoverSeries(book, opts);
  if (hc) {
    return { seriesName: hc.seriesName, seriesPosition: hc.seriesPosition, source: "hardcover", sourceId: hc.seriesId };
  }
  return null;
}

/** New volumes get released, so a cached lineup can't live forever. A
 * lineup that came back empty is retried much sooner — it usually means
 * the series just isn't indexed yet, or the lookup was flaky. */
const LINEUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_LINEUP_TTL_MS = 60 * 60 * 1000;
/** After a failed lookup, don't re-hit the provider on every page load. */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const lastFailureAt = new Map<string, number>();

/**
 * Finds the series row for a name — or, better, for an Open Library series
 * key, which identifies a series exactly regardless of how it's spelled.
 * An existing row that was created by name only (before we knew its key)
 * is adopted, so its lineup gets re-discovered by key.
 */
export async function findOrCreateSeries(
  name: string,
  providerRef?: { source: ProviderSource; id: string },
  authors: string[] = []
): Promise<string> {
  const sameName = sql`lower(${series.name}) = ${name.toLowerCase()}`;

  if (providerRef) {
    const { source, id: sourceId } = providerRef;
    const byKey = () =>
      db.query.series.findFirst({
        where: and(eq(series.source, source), eq(series.sourceId, sourceId)),
      });

    const keyed = await byKey();
    if (keyed) {
      logger.info(SCOPE, "matched existing series by key", { name, seriesId: keyed.id, source, sourceId });
      return keyed.id;
    }

    // The same series often exists under BOTH providers with different ids
    // ("Shatter Me" is an Open Library series and a Hardcover series), and
    // different books of it can resolve through different ones. Keyed only
    // by provider+id that would create two cards for one series, so reuse
    // an existing same-name row from the OTHER provider when one of its
    // books shares an author with this one — name alone isn't enough
    // (unrelated series share names), and with no author we can't tell.
    if (authors.length) {
      const sameNameOtherProvider = await db.query.series.findMany({
        where: and(sameName, sql`${series.source} is not null`, ne(series.source, source)),
        with: { books: true },
      });
      const twin = sameNameOtherProvider.find((s) =>
        s.books.some((b) => b.authors.length > 0 && sharesAuthor(b.authors, authors))
      );
      if (twin) {
        logger.info(SCOPE, "matched same series under the other provider", {
          name,
          seriesId: twin.id,
          existing: `${twin.source}:${twin.sourceId}`,
          incoming: `${source}:${sourceId}`,
        });
        return twin.id;
      }
    }

    const adoptable = await db.query.series.findFirst({
      where: and(sameName, isNull(series.source)),
    });
    if (adoptable) {
      try {
        await db
          .update(series)
          .set({ source, sourceId, lookedUpAt: null })
          .where(eq(series.id, adoptable.id));
        logger.info(SCOPE, "adopted name-only series into provider key", {
          name,
          seriesId: adoptable.id,
          source,
          sourceId,
        });
        return adoptable.id;
      } catch {
        // Lost a race with another writer claiming this key — use theirs.
        const raced = await byKey();
        if (raced) return raced.id;
        throw new Error(`Could not claim series key ${source}:${sourceId}`);
      }
    }

    const id = nanoid();
    await db
      .insert(series)
      .values({ id, name, source, sourceId })
      .onConflictDoNothing();
    const created = await byKey();
    logger.info(SCOPE, "created new series with key", { name, seriesId: created?.id, source, sourceId });
    return created!.id;
  }

  const existing = await db.query.series.findFirst({ where: sameName });
  if (existing) {
    logger.info(SCOPE, "matched existing series", { name, seriesId: existing.id });
    return existing.id;
  }

  const id = nanoid();
  await db.insert(series).values({ id, name });
  logger.info(SCOPE, "created new series", { name, seriesId: id });
  return id;
}

/**
 * Gives a name-only series row its Open Library key, by asking about the
 * books already filed under it. Returns the key, or null if none of them
 * resolves (or another row already owns that key).
 */
export async function resolveSeriesSource(
  seriesId: string,
  opts: CacheOptions = {}
): Promise<{ source: ProviderSource; id: string } | null> {
  const members = await db.query.book.findMany({
    where: eq(book.seriesId, seriesId),
    limit: 3,
  });

  for (const m of members) {
    const book_ = { isbn: m.isbn13 ?? m.isbn10 ?? undefined, title: m.title, authors: m.authors };
    const [ol, hc] = await Promise.all([
      findOpenLibrarySeries(book_, opts),
      findHardcoverSeries(book_, opts),
    ]);
    if (!ol && !hc) continue;

    // Both resolved — rather than always preferring one provider, check
    // which actually has the more complete lineup for this series and
    // use that one. Only costs the extra round trip once, here, not on
    // every subsequent cached-lineup read.
    let chosen: { source: ProviderSource; id: string; name: string };
    if (ol && hc) {
      const [olLineup, hcLineup] = await Promise.all([
        fetchOpenLibrarySeriesLineup(ol.seriesKey, opts),
        fetchHardcoverSeriesLineup(hc.seriesId, opts),
      ]);
      const olCount = olLineup?.length ?? 0;
      const hcCount = hcLineup?.length ?? 0;
      chosen =
        hcCount > olCount
          ? { source: "hardcover", id: hc.seriesId, name: hc.seriesName }
          : { source: "openlibrary", id: ol.seriesKey, name: ol.seriesName };
      logger.info(SCOPE, "both providers resolved a series, picked the bigger lineup", {
        seriesId,
        olCount,
        hcCount,
        picked: chosen.source,
      });
    } else if (ol) {
      chosen = { source: "openlibrary", id: ol.seriesKey, name: ol.seriesName };
    } else {
      chosen = { source: "hardcover", id: hc!.seriesId, name: hc!.seriesName };
    }

    try {
      await db
        .update(series)
        .set({ source: chosen.source, sourceId: chosen.id, lookedUpAt: null })
        .where(and(eq(series.id, seriesId), isNull(series.source)));
    } catch {
      logger.warn(SCOPE, "series key already belongs to another series row", {
        seriesId,
        source: chosen.source,
        sourceId: chosen.id,
      });
      return null;
    }
    logger.info(SCOPE, "resolved series source from member book", {
      seriesId,
      bookId: m.id,
      source: chosen.source,
      sourceId: chosen.id,
      resolvedName: chosen.name,
    });
    return { source: chosen.source, id: chosen.id };
  }

  logger.info(SCOPE, "could not resolve series source", { seriesId, membersTried: members.length });
  return null;
}

/**
 * Looks up a book's series link and writes it if the book is currently
 * orphaned (no seriesId) and the lookup finds one. Shared by the "Refresh
 * from source" action, the add-book flow and the startup backfill script
 * so all use exactly the same logic.
 */
export async function backfillBookSeries(
  bookRow: {
    id: string;
    title: string;
    authors: string[];
    isbn13: string | null;
    isbn10: string | null;
    seriesId: string | null;
  },
  opts: CacheOptions = {}
): Promise<boolean> {
  if (bookRow.seriesId) {
    logger.info(SCOPE, "backfill skipped, already linked", { bookId: bookRow.id });
    return false;
  }
  // A lot of shelf books (imported, or added by title) have no ISBN at
  // all. They used to be skipped outright, which silently left whole
  // series undetected even though a title + author lookup resolves them
  // fine — so go straight to that path instead of giving up.
  const isbn = bookRow.isbn13 ?? bookRow.isbn10 ?? null;

  // Tracks whether any lookup below failed outright (as opposed to
  // answering "no match") — see the seriesCheckedAt stamp further down.
  let lookupFailed = false;
  const checkedOpts: CacheOptions = { ...opts, onTransient: () => { lookupFailed = true; } };

  const fresh = isbn ? await lookupByIsbn(isbn, checkedOpts) : null;
  // Either no provider knows this ISBN at all, or one does but without
  // series info — lookupByIsbn already tries its own Open Library
  // title/author fallback internally, but it has to use whatever title
  // that provider returned, which can differ just enough from what we
  // have stored (e.g. "Twisted Love" vs a foreign edition's own title
  // text) to miss where a fallback keyed off our own stored title would
  // succeed. Worth trying harder — our own title/author against BOTH
  // Open Library and Hardcover — before giving up. Hardcover in
  // particular carries series data for a lot of the indie/romance
  // catalog Open Library simply doesn't index at all.
  const found: FoundSeries | { seriesName: string; seriesPosition?: number } | null =
    fresh?.seriesName
      ? fresh.seriesKey
        ? { seriesName: fresh.seriesName, seriesPosition: fresh.seriesPosition, source: "openlibrary", sourceId: fresh.seriesKey }
        : { seriesName: fresh.seriesName, seriesPosition: fresh.seriesPosition }
      : await findSeriesAnyProvider({ title: bookRow.title, authors: bookRow.authors }, checkedOpts);

  // Only count this as a real check if every lookup actually answered —
  // a 429 or timeout isn't evidence the book has no series, and stamping
  // it would put it in a 7-day cooldown it never earned.
  if (!lookupFailed) {
    await db.update(book).set({ seriesCheckedAt: new Date() }).where(eq(book.id, bookRow.id));
  }

  if (!found) {
    logger.warn(SCOPE, "backfill found no series from any provider", {
      bookId: bookRow.id,
      title: bookRow.title,
      isbn,
      lookupSucceeded: !!fresh,
      lookupFailed,
    });
    return false;
  }

  const seriesId = await findOrCreateSeries(
    found.seriesName,
    "source" in found ? { source: found.source, id: found.sourceId } : undefined,
    bookRow.authors
  );
  await db
    .update(book)
    .set({
      seriesId,
      seriesPosition: found.seriesPosition?.toString(),
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookRow.id));

  logger.info(SCOPE, "backfilled series link", {
    bookId: bookRow.id,
    isbn,
    seriesName: found.seriesName,
    source: "source" in found ? found.source : null,
    sourceId: "source" in found ? found.sourceId : null,
    seriesPosition: found.seriesPosition ?? null,
  });
  return true;
}

/**
 * Opportunistic backfill from a search result that arrived too late to
 * make it into the response a user was actually waiting on (Open Library
 * dropped by the interactive grace period — see searchBooksFull's
 * lateOpenLibrary). Nothing the user did is blocked on this; it just
 * quietly fixes up any of their already-added books that this late data
 * happens to answer, matched by ISBN since that's exact regardless of
 * title/author text differences between providers.
 */
export async function backfillFromLateResults(
  lateBooks: NormalizedBook[]
): Promise<number> {
  let backfilled = 0;
  for (const lb of lateBooks) {
    if (!lb.seriesName) continue;
    const isbn13 = lb.isbn13;
    const isbn10 = lb.isbn10;
    if (!isbn13 && !isbn10) continue;

    const matches = await db.query.book.findMany({
      where: and(
        isNull(book.seriesId),
        or(
          isbn13 ? eq(book.isbn13, isbn13) : undefined,
          isbn10 ? eq(book.isbn10, isbn10) : undefined
        )
      ),
    });
    if (!matches.length) continue;

    const seriesId = await findOrCreateSeries(
      lb.seriesName,
      lb.seriesKey ? { source: "openlibrary", id: lb.seriesKey } : undefined,
      lb.authors
    );
    for (const m of matches) {
      await db
        .update(book)
        .set({
          seriesId,
          seriesPosition: lb.seriesPosition?.toString(),
          updatedAt: new Date(),
        })
        .where(eq(book.id, m.id));
      backfilled++;
      logger.info(SCOPE, "backfilled series from a late-arriving search result", {
        bookId: m.id,
        title: m.title,
        seriesName: lb.seriesName,
        isbn: isbn13 ?? isbn10,
      });
    }
  }
  return backfilled;
}

/**
 * Makes sure a series row has a reasonably fresh full lineup
 * (`knownVolumes`), fetching it if it's missing or stale. Returns the
 * lineup to use immediately, whether freshly fetched or cached — callers
 * don't need to care which.
 */
export async function ensureSeriesLineup(
  seriesId: string,
  name: string,
  current: {
    source: string | null;
    sourceId: string | null;
    knownVolumes: SeriesVolume[] | null;
    lookedUpAt: Date | null;
  }
): Promise<SeriesVolume[]> {
  const cached = current.knownVolumes ?? [];
  const now = Date.now();

  const ttl = cached.length ? LINEUP_TTL_MS : EMPTY_LINEUP_TTL_MS;
  if (current.lookedUpAt && now - current.lookedUpAt.getTime() < ttl) {
    logger.info(SCOPE, "lineup cache hit", { seriesId, name, cachedVolumeCount: cached.length });
    return cached;
  }

  const failedAt = lastFailureAt.get(seriesId);
  if (failedAt && now - failedAt < FAILURE_BACKOFF_MS) {
    return cached;
  }

  let source = current.source as ProviderSource | null;
  let sourceId = current.sourceId;
  if (!source || !sourceId) {
    const resolved = await resolveSeriesSource(seriesId);
    source = resolved?.source ?? null;
    sourceId = resolved?.id ?? null;
  }

  const volumes = await discoverSeriesVolumes({ name, source, sourceId });
  if (!volumes) {
    lastFailureAt.set(seriesId, now);
    logger.warn(SCOPE, "lineup lookup failed, keeping cached lineup", {
      seriesId,
      name,
      cachedVolumeCount: cached.length,
    });
    return cached;
  }
  lastFailureAt.delete(seriesId);

  const wholePositions = volumes.map((v) => Math.floor(v.position));
  const expectedCount = wholePositions.length ? Math.max(...wholePositions) : null;

  await db
    .update(series)
    .set({ knownVolumes: volumes, expectedCount, lookedUpAt: new Date() })
    .where(eq(series.id, seriesId));

  logger.info(SCOPE, "lineup discovered and cached", {
    seriesId,
    name,
    method: source ? `${source}-key` : "name-search",
    source,
    sourceId,
    volumesFound: volumes.length,
    expectedCount,
    positions: volumes.map((v) => v.position),
  });

  return volumes;
}
