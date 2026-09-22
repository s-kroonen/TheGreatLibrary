export type LanguageFilter = "en" | "nl";

/** Normalizes the various language code formats our providers return
 * (ISO 639-1 from Google Books, ISO 639-2/3 from Open Library) down to
 * the codes we actually filter by. Returns null for anything else
 * (French, German, ...) and undefined when we don't know at all —
 * unknown-language results are never hidden by a language filter since
 * we can't tell if they'd match. */
export function normalizeLanguage(
  raw: string | undefined
): LanguageFilter | "other" | undefined {
  if (!raw) return undefined;
  const c = raw.toLowerCase();
  if (["en", "eng", "en-us", "en-gb"].includes(c)) return "en";
  if (["nl", "nld", "dut", "nl-nl", "nl-be"].includes(c)) return "nl";
  return "other";
}

/**
 * Whether a book should be visible under the current language filter.
 * Checks every code in `languages`, not just one — Open Library's
 * per-record language field is a work-level aggregate (every edition's
 * language, unordered), so treating a single code as authoritative
 * misclassifies real books: "Dune"'s list starts with "rum", which would
 * otherwise hide the English original from an English-only filter.
 *
 * A book with no language info at all is never hidden (we can't tell if
 * it'd match); a book whose only known languages are unrecognized ones
 * ("other") is shown only when that bucket is enabled.
 */
export function matchesLanguageFilter(
  languages: string[] | undefined,
  selected: ReadonlySet<LanguageFilter>,
  showOther: boolean
): boolean {
  if (!languages || languages.length === 0) return true;

  const buckets = languages.map(normalizeLanguage);
  if (buckets.some((b) => b && b !== "other" && selected.has(b))) return true;
  if (showOther && buckets.some((b) => b === "other")) return true;
  return false;
}
