import { eq, ilike } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { book, series, type SeriesVolume } from "@/db/schema";
import { discoverSeriesVolumes } from "@/lib/books/series-lookup";
import { lookupByIsbn } from "@/lib/books/search";
import { logger } from "@/lib/logger";

const SCOPE = "series-sync";

export async function findOrCreateSeries(name: string): Promise<string> {
  const existing = await db.query.series.findFirst({
    where: ilike(series.name, name),
  });
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
 * Looks up a book's series link by ISBN and writes it if the book is
 * currently orphaned (no seriesId) and the lookup finds one. Shared by
 * the "Refresh from source" action and the startup backfill script so
 * both use exactly the same logic.
 */
export async function backfillBookSeriesByIsbn(
  bookRow: { id: string; isbn13: string | null; isbn10: string | null; seriesId: string | null }
): Promise<boolean> {
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
  if (!fresh?.seriesName) {
    logger.warn(SCOPE, "backfill found no series from any provider", {
      bookId: bookRow.id,
      isbn,
      lookupSucceeded: !!fresh,
    });
    return false;
  }

  const seriesId = await findOrCreateSeries(fresh.seriesName);
  await db
    .update(book)
    .set({
      seriesId,
      seriesPosition: fresh.seriesPosition?.toString(),
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookRow.id));

  logger.info(SCOPE, "backfilled series link", {
    bookId: bookRow.id,
    isbn,
    seriesName: fresh.seriesName,
    seriesPosition: fresh.seriesPosition ?? null,
  });
  return true;
}

/**
 * Makes sure a series row has its full lineup cached (`knownVolumes`),
 * looking it up from external search if it's never been done. Returns
 * the lineup to use immediately, whether freshly fetched or already
 * cached — callers don't need to care which.
 */
export async function ensureSeriesLineup(
  seriesId: string,
  name: string,
  current: { knownVolumes: SeriesVolume[] | null; lookedUpAt: Date | null }
): Promise<SeriesVolume[]> {
  if (current.lookedUpAt) {
    logger.info(SCOPE, "lineup cache hit", {
      seriesId,
      name,
      cachedVolumeCount: current.knownVolumes?.length ?? 0,
    });
    return current.knownVolumes ?? [];
  }

  const volumes = await discoverSeriesVolumes(name);
  const expectedCount = volumes.length
    ? Math.max(...volumes.map((v) => v.position))
    : null;

  await db
    .update(series)
    .set({
      knownVolumes: volumes,
      expectedCount,
      lookedUpAt: new Date(),
    })
    .where(eq(series.id, seriesId));

  logger.info(SCOPE, "lineup discovered and cached", {
    seriesId,
    name,
    volumesFound: volumes.length,
    expectedCount,
    positions: volumes.map((v) => v.position),
  });

  return volumes;
}
