import { searchBooks } from "./search";
import { fetchOpenLibrarySeriesLineup } from "./providers/open-library";
import { fetchHardcoverSeriesLineup } from "./providers/hardcover";
import { extractAnchoredPosition } from "./series";
import type { NormalizedBook, SeriesProviderSource } from "./types";
import type { SeriesVolume } from "@/db/schema";

/**
 * Discovers the full lineup of a series from external sources — not just
 * what the current user happens to own. This is what lets us show "you
 * have 1 of 5" instead of "you have 1 of 1" (the latter being all we
 * could ever infer purely from the user's own collection).
 *
 * With a resolved provider key this is exact: every member work is listed
 * with its position, from whichever of Open Library / Hardcover turned
 * out to have the bigger lineup for this series (see resolveSeriesSource
 * in series-sync.ts). Without one it falls back to keyword-searching the
 * series name, which is far less reliable — most volumes don't carry the
 * series name in a structured field, so it finds few of them unless the
 * title spells the series name out (handled by extractAnchoredPosition).
 *
 * Returns null when the lookup itself failed, so callers don't cache a
 * transient outage as "this series has no volumes".
 */
export async function discoverSeriesVolumes(series: {
  name: string;
  source: SeriesProviderSource | null;
  sourceId: string | null;
}): Promise<SeriesVolume[] | null> {
  if (series.source === "openlibrary" && series.sourceId) {
    return fetchOpenLibrarySeriesLineup(series.sourceId);
  }
  if (series.source === "hardcover" && series.sourceId) {
    return fetchHardcoverSeriesLineup(series.sourceId);
  }
  return discoverByName(series.name);
}

async function discoverByName(seriesName: string): Promise<SeriesVolume[]> {
  const found = await searchBooks(seriesName, 40, { background: true });

  const withPosition: { book: NormalizedBook; position: number }[] = [];
  for (const b of found) {
    const position =
      // Prefer a provider's own structured series field when it matches
      // the series we asked about...
      (b.seriesName?.toLowerCase() === seriesName.toLowerCase()
        ? b.seriesPosition
        : undefined) ??
      // ...but a lot of self-published titles only number themselves in
      // plain text ("Zodiac Academy 6: Fated Throne") with no structured
      // field at all — still unambiguous since it's anchored to the
      // exact name we searched for.
      extractAnchoredPosition(b.title, seriesName);
    if (position !== undefined) withPosition.push({ book: b, position });
  }

  const byPosition = new Map<number, SeriesVolume>();
  for (const { book: m, position } of withPosition) {
    if (byPosition.has(position)) continue;
    byPosition.set(position, {
      position,
      title: m.title,
      coverUrl: m.coverUrl,
      isbn13: m.isbn13,
      isbn10: m.isbn10,
      source: m.source === "manual" ? undefined : m.source,
      sourceId: m.source === "manual" ? undefined : m.sourceId,
      authors: m.authors,
    });
  }

  return Array.from(byPosition.values()).sort((a, b) => a.position - b.position);
}
