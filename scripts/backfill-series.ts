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
import { logger } from "../lib/logger";

const SCOPE = "backfill-series";

async function main() {
  const orphaned = await db.query.book.findMany({
    where: and(
      isNull(book.seriesId),
      or(isNotNull(book.isbn13), isNotNull(book.isbn10))
    ),
  });

  if (orphaned.length === 0) {
    logger.info(SCOPE, "nothing to do");
    return;
  }

  logger.info(SCOPE, "checking books for a missing series link", {
    candidateCount: orphaned.length,
  });

  let fixed = 0;
  for (const b of orphaned) {
    try {
      if (await backfillBookSeriesByIsbn(b)) fixed++;
    } catch (err) {
      logger.error(SCOPE, "failed for book", {
        bookId: b.id,
        title: b.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(SCOPE, "run complete", {
    checked: orphaned.length,
    linked: fixed,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(SCOPE, "fatal error", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't block app startup over this — it's a best-effort enhancement.
    process.exit(0);
  });
