import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { user, userBook, wishlistShare } from "@/db/schema";

export async function getUserBookById(userId: string, userBookId: string) {
  return db.query.userBook.findFirst({
    where: and(eq(userBook.id, userBookId), eq(userBook.userId, userId)),
    with: { book: { with: { series: true } } },
  });
}

export async function getUserBooks(userId: string) {
  return db.query.userBook.findMany({
    where: eq(userBook.userId, userId),
    with: { book: { with: { series: true } } },
    orderBy: [desc(userBook.addedAt)],
  });
}

export type UserBookWithBook = Awaited<ReturnType<typeof getUserBooks>>[number];

export async function getSeriesOverview(userId: string) {
  const books = await getUserBooks(userId);
  const bySeries = new Map<
    string,
    { name: string; expectedCount: number | null; books: UserBookWithBook[] }
  >();

  for (const ub of books) {
    const s = ub.book.series;
    if (!s) continue;
    if (!bySeries.has(s.id)) {
      bySeries.set(s.id, {
        name: s.name,
        expectedCount: s.expectedCount,
        books: [],
      });
    }
    bySeries.get(s.id)!.books.push(ub);
  }

  return Array.from(bySeries.entries()).map(([id, data]) => {
    const positionOf = (b: UserBookWithBook) =>
      b.book.seriesPosition === null ? null : Number(b.book.seriesPosition);

    // "Have" = physically own it or have read/are reading/DNF'd it.
    // Wishlisted volumes don't count toward completion — they're tracked
    // separately so they can be badged instead of counted as missing.
    const havePositions = data.books
      .filter((b) => b.status !== "wishlist")
      .map(positionOf)
      .filter((p): p is number => p !== null);

    const wishlistPositions = new Set(
      data.books
        .filter((b) => b.status === "wishlist")
        .map(positionOf)
        .filter((p): p is number => p !== null)
    );

    const allPositions = data.books
      .map(positionOf)
      .filter((p): p is number => p !== null);
    const maxPosition = allPositions.length ? Math.max(...allPositions) : null;
    const total = data.expectedCount ?? maxPosition;

    const missing: number[] = [];
    if (total) {
      const have = new Set(havePositions);
      for (let i = 1; i <= total; i++) {
        if (!have.has(i) && !wishlistPositions.has(i)) missing.push(i);
      }
    }

    return {
      id,
      name: data.name,
      books: data.books.sort(
        (a, b) => (positionOf(a) ?? 0) - (positionOf(b) ?? 0)
      ),
      total,
      haveCount: new Set(havePositions).size,
      missing,
    };
  });
}

export async function getWishlistShare(userId: string) {
  const share = await db.query.wishlistShare.findFirst({
    where: eq(wishlistShare.userId, userId),
  });
  return share?.token ?? null;
}

export async function getPublicWishlist(token: string) {
  const share = await db.query.wishlistShare.findFirst({
    where: eq(wishlistShare.token, token),
  });
  if (!share) return null;

  const owner = await db.query.user.findFirst({
    where: eq(user.id, share.userId),
  });
  if (!owner) return null;

  const books = await db.query.userBook.findMany({
    where: and(
      eq(userBook.userId, share.userId),
      eq(userBook.status, "wishlist")
    ),
    with: { book: true },
    orderBy: [desc(userBook.addedAt)],
  });

  return { ownerName: owner.name, books };
}

export async function getStats(userId: string) {
  const books = await getUserBooks(userId);
  const owned = books.filter((b) => b.status === "owned" || b.status === "read" || b.status === "reading");
  const genreCounts = new Map<string, number>();
  for (const ub of owned) {
    for (const g of ub.book.genres) {
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
  }

  return {
    totalOwned: owned.length,
    totalWishlist: books.filter((b) => b.status === "wishlist").length,
    totalRead: books.filter((b) => b.status === "read").length,
    currentlyReading: books.filter((b) => b.status === "reading").length,
    topGenres: Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6),
  };
}
