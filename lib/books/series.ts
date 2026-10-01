/**
 * Google Books / Open Library titles often encode series info in the title
 * itself, e.g. "Catching Fire (The Hunger Games, #2)" or
 * "Harry Potter and the Goblet of Fire (Harry Potter, Book 4)".
 * Best-effort extraction so we can group books without a dedicated API.
 */
export function parseSeriesFromTitle(
  rawTitle: string
): { title: string; seriesName?: string; seriesPosition?: number } {
  const match = rawTitle.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { title: rawTitle.trim() };

  const [, base, paren] = match;
  const seriesMatch = paren.match(
    /^(.*?),?\s*(?:book\s*)?#?\s*(\d+(?:\.\d+)?)$/i
  );
  if (!seriesMatch) return { title: rawTitle.trim() };

  const [, seriesName, position] = seriesMatch;
  return {
    title: base.trim(),
    seriesName: seriesName.trim(),
    seriesPosition: Number(position),
  };
}

/**
 * Many self-published/indie series (common across the romance/romantasy
 * titles this app sees a lot of — "Zodiac Academy 2", "Zodiac Academy 6:
 * Fated Throne") number volumes directly in the title with no
 * parentheses at all, a format parseSeriesFromTitle doesn't recognize
 * (it requires "Title (Series, #N)"). That pattern is too ambiguous to
 * run generically — "1984", "Catch-22", "2001: A Space Odyssey" are
 * titles, not Series-plus-number — so this only fires anchored to a
 * series name already known from elsewhere (series-lookup's name-based
 * lineup fallback), where "<name> <number>" is unambiguous.
 */
export function extractAnchoredPosition(
  title: string,
  seriesName: string
): number | undefined {
  const escaped = seriesName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = title.match(new RegExp(`^${escaped}\\s+(\\d+(?:\\.\\d+)?)(?:[:.,]|\\s|$)`, "i"));
  return match ? Number(match[1]) : undefined;
}

/**
 * Open Library indexes an explicit `series` field for a meaningful chunk
 * of records (not parsed from the title) — formats seen in the wild
 * include "Harry Potter", "Harry Potter ; 4", "Harry Potter #4", and
 * "Harry Potter, book 4".
 */
export function parseSeriesField(
  raw: string
): { seriesName: string; seriesPosition?: number } {
  const match = raw.match(/^(.*?)\s*(?:[;,#]|\bbook\b)\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return { seriesName: raw.trim() };

  const [, name, position] = match;
  return { seriesName: name.trim(), seriesPosition: Number(position) };
}
