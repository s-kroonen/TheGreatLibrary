import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { book, series, type SeriesVolume } from "@/db/schema";
import { discoverSeriesVolumes } from "@/lib/books/series-lookup";
import { lookupByIsbn } from "@/lib/books/search";
import { findOpenLibrarySeries } from "@/lib/books/providers/open-library";
import { logger } from "@/lib/logger";

const SCOPE = "series-sync";

/** New volumes get released, so a cached lineup can't live forever. A
 * lineup that came back empty is retried much sooner — it usually means
 * the series just isn't indexed yet, or the lookup was flaky. */
const LINEUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_LINEUP_TTL_MS = 60 * 60 * 1000;
/** After a failed lookup, don't re-hit the provider on every page load. */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const lastFailureAt = new Map<string, number>();

const OPEN_LIBRARY = "openlibrary";

/**
 * Finds the series row for a name — or, better, for an Open Library series
 * key, which identifies a series exactly regardless of how it's spelled.
 * An existing row that was created by name only (before we knew its key)
 * is adopted, so its lineup gets re-discovered by key.
 */
export async function findOrCreateSeries(
  name: string,
  openLibraryKey?: string
): Promise<string> {
  const sameName = sql`lower(${series.name}) = ${name.toLowerCase()}`;

  if (openLibraryKey) {
    const byKey = () =>
      db.query.series.findFirst({
        where: and(eq(series.source, OPEN_LIBRARY), eq(series.sourceId, openLibraryKey)),
      });

    const keyed = await byKey();
    if (keyed) {
      logger.info(SCOPE, "matched existing series by key", { name, seriesId: keyed.id, openLibraryKey });
      return keyed.id;
    }

    const adoptable = await db.query.series.findFirst({
      where: and(sameName, isNull(series.source)),
    });
    if (adoptable) {
      try {
        await db
          .update(series)
          .set({ source: OPEN_LIBRARY, sourceId: openLibraryKey, lookedUpAt: null })
          .where(eq(series.id, adoptable.id));
        logger.info(SCOPE, "adopted name-only series into open library key", {
          name,
          seriesId: adoptable.id,
          openLibraryKey,
        });
        return adoptable.id;
      } catch {
        // Lost a race with another writer claiming this key — use theirs.
        const raced = await byKey();
        if (raced) return raced.id;
        throw new Error(`Could not claim series key ${openLibraryKey}`);
      }
    }

    const id = nanoid();
    await db
      .insert(series)
      .values({ id, name, source: OPEN_LIBRARY, sourceId: openLibraryKey })
      .onConflictDoNothing();
    const created = await byKey();
    logger.info(SCOPE, "created new series with key", { name, seriesId: created?.id, openLibraryKey });
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
export async function resolveSeriesKey(seriesId: string): Promise<string | null> {
  const members = await db.query.book.findMany({
    where: eq(book.seriesId, seriesId),
    limit: 3,
  });

  for (const m of members) {
    const found = await findOpenLibrarySeries({
      isbn: m.isbn13 ?? m.isbn10 ?? undefined,
      title: m.title,
      authors: m.authors,
    });
    if (!found) continue;

    try {
      await db
        .update(series)
        .set({ source: OPEN_LIBRARY, sourceId: found.seriesKey, lookedUpAt: null })
        .where(and(eq(series.id, seriesId), isNull(series.source)));
    } catch {
      logger.warn(SCOPE, "series key already belongs to another series row", {
        seriesId,
        seriesKey: found.seriesKey,
      });
      return null;
    }
    logger.info(SCOPE, "resolved series key from member book", {
      seriesId,
      bookId: m.id,
      seriesKey: found.seriesKey,
      openLibraryName: found.seriesName,
    });
    return found.seriesKey;
  }

  logger.info(SCOPE, "could not resolve series key", { seriesId, membersTried: members.length });
  return null;
}

/**
 * Looks up a book's series link and writes it if the book is currently
 * orphaned (no seriesId) and the lookup finds one. Shared by the "Refresh
 * from source" action, the add-book flow and the startup backfill script
 * so all use exactly the same logic.
 */
export async function backfillBookSeries(bookRow: {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  seriesId: string | null;
}): Promise<boolean> {
  if (bookRow.seriesId) {
    logger.info(SCOPE, "backfill skipped, already linked", { bookId: bookRow.id });
    return false;
  }
  const isbn = bookRow.isbn13 ?? bookRow.isbn10;
  if (!isbn) {
    logger.warn(SCOPE, "backfill skipped, no ISBN to look up", { bookId: bookRow.id });
    return false;
  }

  const fresh = await lookupByIsbn(isbn);
  // No provider knows this ISBN at all — still worth asking Open Library
  // about the title and author we have stored.
  const found = fresh
    ? fresh.seriesName
      ? { seriesName: fresh.seriesName, seriesPosition: fresh.seriesPosition, seriesKey: fresh.seriesKey }
      : null
    : await findOpenLibrarySeries({ title: bookRow.title, authors: bookRow.authors });

  await db.update(book).set({ seriesCheckedAt: new Date() }).where(eq(book.id, bookRow.id));

  if (!found) {
    logger.warn(SCOPE, "backfill found no series from any provider", {
      bookId: bookRow.id,
      title: bookRow.title,
      isbn,
      lookupSucceeded: !!fresh,
    });
    return false;
  }

  const seriesId = await findOrCreateSeries(found.seriesName, found.seriesKey);
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
    seriesKey: found.seriesKey ?? null,
    seriesPosition: found.seriesPosition ?? null,
  });
  return true;
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

  let openLibraryKey = current.source === OPEN_LIBRARY ? current.sourceId : null;
  if (!openLibraryKey) openLibraryKey = await resolveSeriesKey(seriesId);

  const volumes = await discoverSeriesVolumes({ name, openLibraryKey });
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
    method: openLibraryKey ? "open-library-series-key" : "name-search",
    openLibraryKey,
    volumesFound: volumes.length,
    expectedCount,
    positions: volumes.map((v) => v.position),
  });

  return volumes;
}
