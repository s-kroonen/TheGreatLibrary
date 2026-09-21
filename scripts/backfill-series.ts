/**
 * Runs at container startup (see docker-entrypoint.sh) before the server
 * starts. Scans the shared `book` table — not per-user, since a book row
 * is shared across everyone who owns it — for books that were added
 * before series detection existed/improved and never got linked to a
 * series, and backfills them via an ISBN lookup.
 *
 * Safe to run on every boot: it only touches rows still missing a
 * seriesId, so an already-fixed library is a fast no-op.
 */
import { and, isNull, or, isNotNull } from "drizzle-orm";

import { db } from "../db";
import { book } from "../db/schema";
import { backfillBookSeriesByIsbn } from "../lib/series-sync";

async function main() {
  const orphaned = await db.query.book.findMany({
    where: and(
      isNull(book.seriesId),
      or(isNotNull(book.isbn13), isNotNull(book.isbn10))
    ),
  });

  if (orphaned.length === 0) {
    console.log("[backfill-series] nothing to do");
    return;
  }

  console.log(`[backfill-series] checking ${orphaned.length} book(s) for a missing series link...`);

  let fixed = 0;
  for (const b of orphaned) {
    try {
      if (await backfillBookSeriesByIsbn(b)) fixed++;
    } catch (err) {
      console.error(`[backfill-series] failed for book ${b.id}:`, err);
    }
  }

  console.log(`[backfill-series] linked ${fixed} book(s) to a series`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-series] fatal error:", err);
    // Don't block app startup over this — it's a best-effort enhancement.
    process.exit(0);
  });
