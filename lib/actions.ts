"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { and, eq, ilike } from "drizzle-orm";

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
import type { NormalizedBook } from "@/lib/books/types";

async function mustGetUser() {
  const user = await requireUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

export type SearchResult = NormalizedBook & {
  existingStatus: UserBookStatus | null;
};

export async function searchBooksAction(query: string): Promise<SearchResult[]> {
  const results = await searchBooks(query, 20);

  const user = await requireUser();
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

async function findOrCreateSeries(name: string): Promise<string> {
  const existing = await db.query.series.findFirst({
    where: ilike(series.name, name),
  });
  if (existing) return existing.id;

  const id = nanoid();
  await db.insert(series).values({ id, name });
  return id;
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
      const seriesId = await findOrCreateSeries(normalized.seriesName);
      await db
        .update(book)
        .set({
          seriesId,
          seriesPosition: normalized.seriesPosition?.toString(),
          updatedAt: new Date(),
        })
        .where(eq(book.id, existing.id));
    }
    return existing.id;
  }

  let seriesId: string | null = null;
  if (normalized.seriesName) {
    seriesId = await findOrCreateSeries(normalized.seriesName);
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
  if (!existing?.isbn13 && !existing?.isbn10) return;

  const fresh = await lookupByIsbn(existing.isbn13 ?? existing.isbn10!);
  if (!fresh) return;

  const seriesId =
    !existing.seriesId && fresh.seriesName
      ? await findOrCreateSeries(fresh.seriesName)
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

/** Adds every book found for a series (via search) that the user doesn't
 * already have, straight to their wishlist. */
export async function addMissingSeriesBooksToWishlistAction(
  seriesName: string
) {
  const user = await mustGetUser();
  const found = await searchBooks(seriesName, 40);
  const inSeries = found.filter(
    (b) => b.seriesName?.toLowerCase() === seriesName.toLowerCase()
  );

  const ownedIsbns = new Set(
    (
      await db.query.userBook.findMany({
        where: eq(userBook.userId, user.id),
        with: { book: true },
      })
    )
      .map((ub) => ub.book.isbn13 ?? ub.book.isbn10)
      .filter(Boolean)
  );

  let added = 0;
  for (const candidate of inSeries) {
    const isbn = candidate.isbn13 ?? candidate.isbn10;
    if (isbn && ownedIsbns.has(isbn)) continue;
    await addBookAction(candidate, "wishlist");
    added++;
  }

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
