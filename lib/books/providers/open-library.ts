import type { BookProvider, NormalizedBook } from "../types";
import { parseSeriesFromTitle } from "../series";

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  publisher?: string[];
  first_publish_year?: number;
  language?: string[];
  subject?: string[];
}

function normalize(doc: OpenLibraryDoc): NormalizedBook {
  const { title, seriesName, seriesPosition } = parseSeriesFromTitle(
    doc.title
  );
  const isbns = doc.isbn ?? [];

  return {
    source: "openlibrary",
    sourceId: doc.key,
    title,
    authors: doc.author_name ?? [],
    isbn10: isbns.find((i) => i.length === 10),
    isbn13: isbns.find((i) => i.length === 13),
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : undefined,
    publisher: doc.publisher?.[0],
    publishedDate: doc.first_publish_year
      ? String(doc.first_publish_year)
      : undefined,
    language: doc.language?.[0],
    genres: doc.subject?.slice(0, 5) ?? [],
    seriesName,
    seriesPosition,
  };
}

const BASE_URL = "https://openlibrary.org";

export const openLibraryProvider: BookProvider = {
  name: "openlibrary",

  async search(query, limit = 20) {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      // Restrict to the fields we actually use — the default response
      // includes a lot more per-edition data and is noticeably slower.
      fields: "key,title,author_name,isbn,cover_i,publisher,first_publish_year,language,subject",
    });
    const res = await fetch(`${BASE_URL}/search.json?${params.toString()}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
    return (data.docs ?? []).map(normalize);
  },

  async lookupByIsbn(isbn) {
    const res = await fetch(`${BASE_URL}/search.json?isbn=${isbn}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
    const first = data.docs?.[0];
    return first ? normalize(first) : null;
  },
};
