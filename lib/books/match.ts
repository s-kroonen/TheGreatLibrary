/**
 * Helpers for deciding whether two records from different providers are
 * the same book. Provider ISBN sets rarely intersect (Open Library lists
 * every edition's ISBN under one work, Google Books lists one edition),
 * so ISBN alone can't be relied on for that.
 */

function words(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** "Icebreaker: Deluxe Edition Hardcover" and "Icebreaker (Maple Hills, #1)"
 * both reduce to "icebreaker". */
export function titleStem(title: string): string {
  return words(title.split(/[:(]/)[0]);
}

/** Full normalized title — keeps subtitles, so distinct editions stay distinct. */
export function normalizedTitle(title: string): string {
  return words(title);
}

/** True if the two author lists share a name — or if either is empty,
 * since there's nothing to contradict. */
export function sharesAuthor(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return true;
  const set = new Set(a.map(words));
  return b.some((x) => set.has(words(x)));
}
