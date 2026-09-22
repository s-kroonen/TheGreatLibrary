export type BookSource = "googlebooks" | "openlibrary" | "manual";

/** A normalized book record, regardless of which external source it came from. */
export interface NormalizedBook {
  source: BookSource;
  sourceId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  isbn10?: string;
  isbn13?: string;
  coverUrl?: string;
  description?: string;
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  /** Single best-guess language, kept for display/storage. */
  language?: string;
  /** Every language code the source associates with this record. For
   * Google Books this is just [language] (one volume, one language). For
   * Open Library it's the *work's* full list of edition languages, e.g.
   * Dune's real list starts with "rum" — the work-level search index
   * doesn't distinguish "the original language" from "a language some
   * translation exists in", so `language` above can be misleading for
   * filtering. Filtering logic should check this array's membership, not
   * treat `language` as authoritative. */
  languages?: string[];
  genres: string[];
  /** Best-effort series info parsed from the source, if any. */
  seriesName?: string;
  seriesPosition?: number;
  /** Open Library's id for the series (e.g. "OL330994L"), when the source
   * gave one. Lets us enumerate the series' full lineup exactly instead of
   * re-guessing it by name. */
  seriesKey?: string;
}

export interface BookProvider {
  name: BookSource;
  search(query: string, limit?: number): Promise<NormalizedBook[]>;
  lookupByIsbn(isbn: string): Promise<NormalizedBook | null>;
}
