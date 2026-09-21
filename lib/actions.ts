"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  book,
  series,
  userBook,
  wishlistShare,
  type UserBookStatus,
} from "@/db/schema";
import { requireUser } from "@/lib/session";
import { searchBooks, lookupByIsbn } from "@/lib/books/search";
import { getGoogleBooksPrice } from "@/lib/books/price";
import { findOrCreateSeries, backfillBookSeries, ensureSeriesLineup } from "@/lib/series-sync";
import { logger } from "@/lib/logger";
import type { NormalizedBook } from "@/lib/books/types";

const SCOPE = "actions";

async function mustGetUser() {
  const user = await requireUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

export type SearchResult = NormalizedBook & {
  existingStatus: UserBookStatus | null;
};

export async function searchBooksAction(query: string): Promise<SearchResult[]> {
  const user = await requireUser();
  logger.info(SCOPE, "searchBooksAction called", {
    query,
    userId: user?.id ?? null,
  });
  const results = await searchBooks(query, 20);

  if (!user) return results.map((r) => ({ ...r, existingStatus: null }));

  const library = await db.query.userBook.findMany({
    where: eq(userBook.userId, user.id),
    with: { book: true },
  });
  const statusByIsbn = new Map<string, UserBookStatus>();
  for (const ub of library) {
    if (ub.book.isbn13) statusByIsbn.set(ub.book.isbn13, ub.status);
    if (ub.book.isbn10) statusByIsbn.set(ub.book.isbn10, ub.status);
  }

  return results.map((r) => ({
    ...r,
    existingStatus:
      (r.isbn13 && statusByIsbn.get(r.isbn13)) ||
      (r.isbn10 && statusByIsbn.get(r.isbn10)) ||
      null,
  }));
}

/** Upserts a normalized external book into the shared `book` table. */
async function upsertBook(normalized: NormalizedBook): Promise<string> {
  const existing = await db.query.book.findFirst({
    where: and(
      eq(book.source, normalized.source),
      eq(book.sourceId, normalized.sourceId)
    ),
  });
  if (existing) {
    // Series detection has improved over time (and depends on whichever
    // provider happens to have the data), so a book added before that
    // never got linked to its series. Backfill it here rather than only
    // on first insert, so re-adding/re-searching an existing book can
    // fix it retroactively instead of leaving it orphaned forever.
    if (!existing.seriesId && normalized.seriesName) {
      const seriesId = await findOrCreateSeries(normalized.seriesName, normalized.seriesKey);
      await db
        .update(book)
        .set({
          seriesId,
          seriesPosition: normalized.seriesPosition?.toString(),
          updatedAt: new Date(),
        })
        .where(eq(book.id, existing.id));
      logger.info(SCOPE, "upsertBook backfilled series on existing book", {
        bookId: existing.id,
        title: normalized.title,
        seriesName: normalized.seriesName,
      });
    } else if (!existing.seriesId) {
      // The search result itself had no series signal, but a deeper
      // ISBN-based lookup (Open Library Work-level record, etc.) might
      // still find one — the same fallback "Refresh from source" uses.
      const isbn = existing.isbn13 ?? existing.isbn10;
      const backfilled = isbn
        ? await backfillBookSeries({
            id: existing.id,
            title: existing.title,
            authors: existing.authors,
            isbn13: existing.isbn13,
            isbn10: existing.isbn10,
            seriesId: existing.seriesId,
          })
        : false;
      logger.info(SCOPE, "upsertBook found existing book, still no series detected", {
        bookId: existing.id,
        title: normalized.title,
        source: normalized.source,
        backfilledViaIsbnLookup: backfilled,
      });
    }
    return existing.id;
  }

  let seriesId: string | null = null;
  if (normalized.seriesName) {
    seriesId = await findOrCreateSeries(normalized.seriesName, normalized.seriesKey);
  } else {
    logger.info(SCOPE, "upsertBook: no series detected on new book", {
      title: normalized.title,
      source: normalized.source,
      sourceId: normalized.sourceId,
    });
  }

  const id = nanoid();
  await db.insert(book).values({
    id,
    title: normalized.title,
    subtitle: normalized.subtitle,
    authors: normalized.authors,
    isbn10: normalized.isbn10,
    isbn13: normalized.isbn13,
    coverUrl: normalized.coverUrl,
    description: normalized.description,
    publisher: normalized.publisher,
    publishedDate: normalized.publishedDate,
    pageCount: normalized.pageCount,
    language: normalized.language,
    genres: normalized.genres,
    seriesId,
    seriesPosition: normalized.seriesPosition?.toString(),
    source: normalized.source,
    sourceId: normalized.sourceId,
  });

  // Same fallback as above, for the freshly-inserted-book case: the
  // search result had no series signal, but a deeper ISBN lookup might.
  // One extra lookup for the book just added, not for every search result.
  if (!seriesId && (normalized.isbn13 ?? normalized.isbn10)) {
    const backfilled = await backfillBookSeries({
      id,
      title: normalized.title,
      authors: normalized.authors,
      isbn13: normalized.isbn13 ?? null,
      isbn10: normalized.isbn10 ?? null,
      seriesId: null,
    });
    logger.info(SCOPE, "upsertBook: post-insert series backfill attempt", {
      bookId: id,
      title: normalized.title,
      backfilledViaIsbnLookup: backfilled,
    });
  }

  return id;
}

export async function addBookAction(
  normalized: NormalizedBook,
  status: UserBookStatus = "owned"
) {
  const user = await mustGetUser();
  const bookId = await upsertBook(normalized);

  const existing = await db.query.userBook.findFirst({
    where: and(eq(userBook.userId, user.id), eq(userBook.bookId, bookId)),
  });

  if (existing) {
    if (existing.status !== status) {
      await db
        .update(userBook)
        .set({ status, updatedAt: new Date() })
        .where(eq(userBook.id, existing.id));
    }
    revalidatePath("/shelf");
    revalidatePath("/wishlist");
    return existing.id;
  }

  const id = nanoid();
  await db.insert(userBook).values({
    id,
    userId: user.id,
    bookId,
    status,
  });

  revalidatePath("/shelf");
  revalidatePath("/wishlist");
  revalidatePath("/series");
  return id;
}

/** Adds a manually-entered book with no external source match. */
export async function addManualBookAction(input: {
  title: string;
  authors: string[];
  status: UserBookStatus;
}) {
  const user = await mustGetUser();
  const id = nanoid();
  const bookId = nanoid();

  await db.insert(book).values({
    id: bookId,
    title: input.title,
    authors: input.authors,
    genres: [],
    source: "manual",
    sourceId: bookId,
  });

  await db.insert(userBook).values({
    id,
    userId: user.id,
    bookId,
    status: input.status,
  });

  revalidatePath("/shelf");
  return id;
}

export async function updateUserBookAction(
  userBookId: string,
  fields: Partial<{
    status: UserBookStatus;
    rating: number | null;
    notes: string | null;
    tags: string[];
    moodTags: string[];
    format: string | null;
    condition: string | null;
    shelf: string | null;
    pricePaid: string | null;
  }>
) {
  const user = await mustGetUser();
  await db
    .update(userBook)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(userBook.id, userBookId), eq(userBook.userId, user.id)));

  revalidatePath("/shelf");
  revalidatePath("/wishlist");
  revalidatePath(`/book/${userBookId}`);
}

export async function updateBookDetailsAction(
  bookId: string,
  fields: Partial<{
    title: string;
    subtitle: string | null;
    authors: string[];
    description: string | null;
    publisher: string | null;
    publishedDate: string | null;
    pageCount: number | null;
    genres: string[];
    coverUrl: string | null;
  }>
) {
  await mustGetUser();
  await db
    .update(book)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(book.id, bookId));

  revalidatePath("/shelf");
}

export async function deleteUserBookAction(userBookId: string) {
  const user = await mustGetUser();
  await db
    .delete(userBook)
    .where(and(eq(userBook.id, userBookId), eq(userBook.userId, user.id)));

  revalidatePath("/shelf");
  revalidatePath("/wishlist");
}

/** Re-fetches a book's canonical data from its original external source. */
export async function refreshBookFromSourceAction(bookId: string) {
  await mustGetUser();
  const existing = await db.query.book.findFirst({ where: eq(book.id, bookId) });
  if (!existing?.isbn13 && !existing?.isbn10) {
    logger.warn(SCOPE, "refreshBookFromSourceAction: no ISBN, cannot refresh", {
      bookId,
      title: existing?.title ?? null,
    });
    return;
  }

  logger.info(SCOPE, "refreshBookFromSourceAction started", {
    bookId,
    title: existing.title,
    isbn: existing.isbn13 ?? existing.isbn10,
    hadSeriesAlready: !!existing.seriesId,
  });

  const fresh = await lookupByIsbn(existing.isbn13 ?? existing.isbn10!);
  if (!fresh) {
    logger.warn(SCOPE, "refreshBookFromSourceAction: lookup found nothing", { bookId });
    return;
  }

  const seriesId =
    !existing.seriesId && fresh.seriesName
      ? await findOrCreateSeries(fresh.seriesName, fresh.seriesKey)
      : existing.seriesId;

  await db
    .update(book)
    .set({
      title: fresh.title,
      subtitle: fresh.subtitle,
      authors: fresh.authors,
      coverUrl: fresh.coverUrl ?? existing.coverUrl,
      description: fresh.description ?? existing.description,
      publisher: fresh.publisher ?? existing.publisher,
      publishedDate: fresh.publishedDate ?? existing.publishedDate,
      pageCount: fresh.pageCount ?? existing.pageCount,
      genres: fresh.genres.length ? fresh.genres : existing.genres,
      seriesId,
      seriesPosition: seriesId
        ? (fresh.seriesPosition?.toString() ?? existing.seriesPosition)
        : existing.seriesPosition,
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId));

  logger.info(SCOPE, "refreshBookFromSourceAction completed", {
    bookId,
    fetchedSeriesName: fresh.seriesName ?? null,
    seriesLinkedAfter: !!seriesId,
  });

  revalidatePath("/shelf");
  revalidatePath("/series");
}

export async function checkCurrentPriceAction(userBookId: string) {
  const user = await mustGetUser();
  const ub = await db.query.userBook.findFirst({
    where: and(eq(userBook.id, userBookId), eq(userBook.userId, user.id)),
    with: { book: true },
  });
  if (!ub) return null;

  const isbn = ub.book.isbn13 ?? ub.book.isbn10;
  const price = isbn ? await getGoogleBooksPrice(isbn) : null;

  await db
    .update(userBook)
    .set({
      currentPrice: price ? String(price.amount) : null,
      priceCheckedAt: new Date(),
      priceSource: price ? "googlebooks" : null,
      priceUrl: price?.url ?? null,
    })
    .where(eq(userBook.id, userBookId));

  revalidatePath("/wishlist");
  return price;
}

/** Adds every volume of a series (from its discovered lineup) that the
 * user doesn't already have to their wishlist. Volumes are matched to the
 * user's books by series position, the same way the series page counts
 * what's missing. */
export async function addMissingSeriesBooksToWishlistAction(seriesId: string) {
  const user = await mustGetUser();
  const seriesRow = await db.query.series.findFirst({ where: eq(series.id, seriesId) });
  if (!seriesRow) return 0;

  const lineup = await ensureSeriesLineup(seriesRow.id, seriesRow.name, {
    source: seriesRow.source,
    sourceId: seriesRow.sourceId,
    knownVolumes: seriesRow.knownVolumes,
    lookedUpAt: seriesRow.lookedUpAt,
  });

  const library = await db.query.userBook.findMany({
    where: eq(userBook.userId, user.id),
    with: { book: true },
  });
  const heldPositions = new Set(
    library
      .filter((ub) => ub.book.seriesId === seriesId && ub.book.seriesPosition !== null)
      .map((ub) => Number(ub.book.seriesPosition))
  );
  const ownedIsbns = new Set(
    library.flatMap((ub) => [ub.book.isbn13, ub.book.isbn10]).filter(Boolean)
  );

  let added = 0;
  for (const volume of lineup) {
    if (heldPositions.has(volume.position)) continue;
    if (
      (volume.isbn13 && ownedIsbns.has(volume.isbn13)) ||
      (volume.isbn10 && ownedIsbns.has(volume.isbn10))
    )
      continue;
    if (!volume.source || !volume.sourceId) continue;

    await addBookAction(
      {
        source: volume.source,
        sourceId: volume.sourceId,
        title: volume.title,
        authors: volume.authors ?? [],
        isbn13: volume.isbn13,
        isbn10: volume.isbn10,
        coverUrl: volume.coverUrl,
        genres: [],
        seriesName: seriesRow.name,
        seriesPosition: volume.position,
        seriesKey: seriesRow.source === "openlibrary" ? (seriesRow.sourceId ?? undefined) : undefined,
      },
      "wishlist"
    );
    added++;
  }

  logger.info(SCOPE, "addMissingSeriesBooksToWishlistAction completed", {
    seriesId,
    seriesName: seriesRow.name,
    lineupSize: lineup.length,
    added,
  });

  revalidatePath("/series");
  revalidatePath("/wishlist");
  return added;
}

/** Turns on (or reuses) a public, no-login-required share link for the
 * current user's wishlist. */
export async function enableWishlistShareAction() {
  const user = await mustGetUser();
  const existing = await db.query.wishlistShare.findFirst({
    where: eq(wishlistShare.userId, user.id),
  });
  if (existing) return existing.token;

  const token = nanoid(24);
  await db.insert(wishlistShare).values({ id: nanoid(), userId: user.id, token });

  revalidatePath("/wishlist");
  return token;
}

/** Revokes the current share link — the old URL stops working immediately.
 * Sharing again afterwards issues a brand new token. */
export async function revokeWishlistShareAction() {
  const user = await mustGetUser();
  await db.delete(wishlistShare).where(eq(wishlistShare.userId, user.id));
  revalidatePath("/wishlist");
}
