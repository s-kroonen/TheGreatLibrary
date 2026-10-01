/**
 * Runs at container startup (see docker-entrypoint.sh) before the server
 * starts. Scans the shared `book` table — not per-user, since a book row
 * is shared across everyone who owns it — for books that were added
 * before series detection existed/improved and never got linked to a
 * series, and backfills them via an ISBN lookup.
 *
 * Also gives series rows that only have a name (created before we stored
 * a provider's series key) their key, which is what lets the series page
 * list the full lineup accurately instead of guessing it by name.
 *
 * Safe to run on every boot: it only touches rows still missing a
 * seriesId (and books already checked in the last week are skipped), so
 * an already-fixed library is a fast no-op.
 *
 * Set FORCE_SERIES_RECHECK=true for one boot to ignore the "already
 * checked recently" cooldown and the provider-response cache, and
 * re-attempt every still-unlinked book regardless of when it was last
 * tried — the thing to reach for right after adding a new provider (like
 * Hardcover), since books checked before that existed are otherwise
 * stuck in their cooldown for up to 7 days even though a fresh check
 * would now find them. Safe to leave off after a boot or two — once
 * everything's been retried, the cooldown is doing its normal job again.
 */
import { and, isNull, lt, or, isNotNull } from "drizzle-orm";

import { db } from "../db";
import { book, series } from "../db/schema";
import { backfillBookSeries, resolveSeriesSource } from "../lib/series-sync";
import { logger } from "../lib/logger";

const SCOPE = "backfill-series";
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const FORCE = process.env.FORCE_SERIES_RECHECK === "true";

async function resolveKeylessSeries() {
  const keyless = await db.query.series.findMany({ where: isNull(series.source) });
  let resolved = 0;
  for (const s of keyless) {
    try {
      if (await resolveSeriesSource(s.id, { force: FORCE })) resolved++;
    } catch (err) {
      logger.error(SCOPE, "series key resolution failed", {
        seriesId: s.id,
        name: s.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (keyless.length) {
    logger.info(SCOPE, "series key pass complete", { checked: keyless.length, resolved, forced: FORCE });
  }
}

async function main() {
  if (FORCE) {
    logger.warn(SCOPE, "FORCE_SERIES_RECHECK is set — ignoring the recheck cooldown and provider cache for this boot");
  }

  const orphaned = await db.query.book.findMany({
    where: and(
      isNull(book.seriesId),
      or(isNotNull(book.isbn13), isNotNull(book.isbn10)),
      FORCE
        ? undefined
        : or(
            isNull(book.seriesCheckedAt),
            lt(book.seriesCheckedAt, new Date(Date.now() - RECHECK_AFTER_MS))
          )
    ),
  });

  if (orphaned.length === 0) {
    logger.info(SCOPE, "no books to link");
  } else {
    await linkOrphans(orphaned);
  }

  // After linking, so freshly-created series get their key too.
  await resolveKeylessSeries();
}

async function linkOrphans(orphaned: (typeof book.$inferSelect)[]) {
  logger.info(SCOPE, "checking books for a missing series link", {
    candidateCount: orphaned.length,
    forced: FORCE,
  });

  let fixed = 0;
  for (const b of orphaned) {
    try {
      if (await backfillBookSeries(b, { force: FORCE })) fixed++;
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
