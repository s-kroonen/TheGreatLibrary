import { searchBooks } from "./search";
import type { SeriesVolume } from "@/db/schema";

/**
 * Discovers the full lineup of a series from external search — not just
 * what the current user happens to own. This is what lets us show "you
 * have 1 of 5" instead of "you have 1 of 1" (the latter being all we
 * could ever infer purely from the user's own collection).
 */
export async function discoverSeriesVolumes(
  seriesName: string
): Promise<SeriesVolume[]> {
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
    });
  }

  return Array.from(byPosition.values()).sort((a, b) => a.position - b.position);
}
