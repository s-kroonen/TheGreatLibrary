import type { NormalizedBook } from "./types";
import { normalizedTitle, sharesAuthor, titleStem } from "./match";

function dedupeKey(book: NormalizedBook): string {
  if (book.isbn13) return `isbn:${book.isbn13}`;
  if (book.isbn10) return `isbn:${book.isbn10}`;
  return `title:${normalizedTitle(book.title)}|${normalizedTitle(book.authors[0] ?? "")}`;
}

function titleAuthorKey(book: NormalizedBook): string {
  return `${normalizedTitle(book.title)}|${normalizedTitle(book.authors[0] ?? "")}`;
}

/**
 * Merges two providers' ranked result lists into one.
 *
 *  - Interleaves them (a1, b1, a2, b2, …) so each provider's best hits are
 *    visible. Concatenating instead lets whichever list is first fill the
 *    whole page — Google Books always returns a full page, so Open
 *    Library's results (often better-ranked for short titles like "Dune",
 *    and the only ones carrying series info) were cut off entirely.
 *  - Drops duplicates (same ISBN, or same title + first author), keeping
 *    the copy from the earlier position.
 *  - Copies series info onto results that lack it when the other list has
 *    the same work (matched by title stem + author, so "Icebreaker:
 *    Deluxe Edition" inherits series from the "Icebreaker" work).
 */
export function mergeResults(
  primary: NormalizedBook[],
  secondary: NormalizedBook[],
  limit: number
): NormalizedBook[] {
  const seriesSource = [...primary, ...secondary].filter((b) => b.seriesName);
  const withSeries = (book: NormalizedBook): NormalizedBook => {
    if (book.seriesName) return book;
    const stem = titleStem(book.title);
    const donor = seriesSource.find(
      (d) => titleStem(d.title) === stem && sharesAuthor(d.authors, book.authors)
    );
    return donor
      ? {
          ...book,
          seriesName: donor.seriesName,
          seriesPosition: donor.seriesPosition,
          seriesKey: donor.seriesKey,
        }
      : book;
  };

  const seen = new Set<string>();
  const seenTitleAuthor = new Set<string>();
  const merged: NormalizedBook[] = [];
  const add = (book: NormalizedBook) => {
    const key = dedupeKey(book);
    const ta = titleAuthorKey(book);
    if (seen.has(key) || seenTitleAuthor.has(ta)) return;
    seen.add(key);
    seenTitleAuthor.add(ta);
    merged.push(withSeries(book));
  };

  for (let i = 0; i < Math.max(primary.length, secondary.length); i++) {
    if (merged.length >= limit) break;
    if (primary[i]) add(primary[i]);
    if (secondary[i] && merged.length < limit) add(secondary[i]);
  }
  return merged;
}
