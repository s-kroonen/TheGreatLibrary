import { searchBooks } from "./search";
import { fetchOpenLibrarySeriesLineup } from "./providers/open-library";
import type { SeriesVolume } from "@/db/schema";

/**
 * Discovers the full lineup of a series from external sources — not just
 * what the current user happens to own. This is what lets us show "you
 * have 1 of 5" instead of "you have 1 of 1" (the latter being all we
 * could ever infer purely from the user's own collection).
 *
 * With an Open Library series key this is exact: every member work is
 * listed with its position. Without one it falls back to keyword-searching
 * the series name, which is unreliable (most volumes don't have the series
 * name in their title, so it finds few of them) — the key is worth
 * resolving whenever possible, see `resolveSeriesKey` in series-sync.ts.
 *
 * Returns null when the lookup itself failed, so callers don't cache a
 * transient outage as "this series has no volumes".
 */
export async function discoverSeriesVolumes(series: {
  name: string;
  openLibraryKey: string | null;
}): Promise<SeriesVolume[] | null> {
  if (series.openLibraryKey) {
    return fetchOpenLibrarySeriesLineup(series.openLibraryKey);
  }
  return discoverByName(series.name);
}

async function discoverByName(seriesName: string): Promise<SeriesVolume[]> {
  const found = await searchBooks(seriesName, 40);
  const matches = found.filter(
    (b) =>
      b.seriesName?.toLowerCase() === seriesName.toLowerCase() &&
      b.seriesPosition !== undefined
  );

  const byPosition = new Map<number, SeriesVolume>();
  for (const m of matches) {
    const position = m.seriesPosition!;
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
