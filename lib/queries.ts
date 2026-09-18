import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { userBook } from "@/db/schema";

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
    const positions = data.books
      .map((b) => b.book.seriesPosition)
      .filter((p): p is string => p !== null)
      .map(Number)
      .sort((a, b) => a - b);

    const maxPosition = positions.length ? Math.max(...positions) : null;
    const total = data.expectedCount ?? maxPosition;
    const missing: number[] = [];
    if (total) {
      const owned = new Set(positions);
      for (let i = 1; i <= total; i++) {
        if (!owned.has(i)) missing.push(i);
      }
    }

    return {
      id,
      name: data.name,
      books: data.books.sort(
        (a, b) =>
          Number(a.book.seriesPosition ?? 0) -
          Number(b.book.seriesPosition ?? 0)
      ),
      total,
      missing,
    };
  });
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
