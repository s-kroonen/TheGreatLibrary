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
