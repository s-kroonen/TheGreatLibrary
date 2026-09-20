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
