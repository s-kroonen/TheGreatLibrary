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
