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

/** Edit distance counting adjacent-letter transposition as one edit, not
 * two (plain Levenshtein needs a delete + an insert for "fourht" ->
 * "fourth", scoring it as harshly as two unrelated substitutions, even
 * though swapped-adjacent-letters is the single most common real typo).
 * O(n*m), fine at the string lengths a query or a book title ever reaches. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] : 1 + Math.min(rows[i - 1][j - 1], rows[i - 1][j], row[j - 1]);
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        cost = Math.min(cost, rows[i - 2][j - 2] + 1);
      }
      row[j] = cost;
    }
    rows.push(row);
  }
  return rows[a.length][b.length];
}

/** 1 for identical strings, down to 0 for completely different ones. */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - editDistance(a, b) / maxLen;
}

/** Matches token-by-token rather than comparing whole strings, so a query
 * of a different length than "title + author" (the normal case — a title
 * is rarely the same length as itself plus its author) doesn't get
 * penalized as if that length gap were itself a typo. Each query word
 * scores against its best-matching word on the candidate side; the
 * average is the candidate's overall score. Words under 3 letters ("a",
 * "of", "the") are dropped from the query side so a coincidental match on
 * a stopword can't inflate an otherwise-unrelated candidate. */
function tokenSimilarity(query: string, candidate: string): number {
  const queryTokens = query.split(" ").filter((t) => t.length >= 3);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  let total = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const ct of candidateTokens) best = Math.max(best, similarity(qt, ct));
    total += best;
  }
  return total / queryTokens.length;
}

/**
 * Neither provider offers real spelling correction: Open Library's
 * author search is prefix/substring matching (typo-tolerant only in the
 * loose sense that "Tolkein" finds people literally named that, not
 * "Tolkien"), and Google Books has no dedicated endpoint for it at all —
 * confirmed against live responses, not assumed from docs. What both
 * providers DO have is their own internal query-relevance fuzzing, which
 * in practice already recovers the intended book for most single-word
 * typos (verified: "harrry potter", "the nme of the wind", "Fourht Wing"
 * all rank the correct book #1 through our existing merge). The gap is
 * purely UI: nothing tells the user a correction happened.
 *
 * This turns that into a visible "did you mean" by comparing the raw
 * query against the book we already fetched, so it costs no extra
 * requests. Returns null when the query already looks like a clean match
 * (so exact/near-exact searches never show a pointless suggestion), or
 * when nothing in the candidate list is a plausible typo of the query.
 */
export function findSpellingSuggestion<T extends { title: string; authors: string[] }>(
  query: string,
  candidates: T[],
  isAllowed?: (candidate: T) => boolean
): T | null {
  const q = words(query);
  if (q.length < 6) return null; // too short for edit-distance to mean anything

  // Filtered before picking the top few, not after: a suggestion has to
  // be something the user would actually see (e.g. under their current
  // language filter), and an excluded candidate that happens to be an
  // exact match shouldn't count as "query already satisfied" either —
  // it isn't, from what's visible to them.
  const allowed = isAllowed ? candidates.filter(isAllowed) : candidates;
  const top = allowed.slice(0, 5);
  const scored = top.map((candidate) => ({
    candidate,
    score: tokenSimilarity(q, words(`${candidate.title} ${candidate.authors[0] ?? ""}`)),
  }));

  // If anything in the top few is an exact word-for-word match, the query
  // is already satisfied as typed — even when it's not the very top
  // result (a spam listing that happens to literally echo the
  // misspelling, e.g. "How to Draw Harrry Potter", can outrank the real
  // book without the query itself needing correcting). This has to be
  // exact (1.0), not just close: a one-letter-short typo of a 7-letter
  // word plus two other exact words already averages to ~0.95, which is
  // exactly the case a suggestion should fire for, not get swallowed by.
  if (scored.some((s) => s.score >= 0.999)) return null;

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);

  // High bar: this is for "you typed roughly this" — not a lenient "does
  // this seem related".
  return best && best.score >= 0.75 ? best.candidate : null;
}
