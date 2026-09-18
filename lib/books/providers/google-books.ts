import type { BookProvider, NormalizedBook } from "../types";
import { parseSeriesFromTitle } from "../series";

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    description?: string;
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    language?: string;
    categories?: string[];
  };
}

function normalize(volume: GoogleVolume): NormalizedBook {
  const info = volume.volumeInfo ?? {};
  const { title, seriesName, seriesPosition } = parseSeriesFromTitle(
    info.title ?? "Untitled"
  );

  const isbn10 = info.industryIdentifiers?.find((i) => i.type === "ISBN_10")
    ?.identifier;
  const isbn13 = info.industryIdentifiers?.find((i) => i.type === "ISBN_13")
    ?.identifier;

  const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;

  return {
    source: "googlebooks",
    sourceId: volume.id,
    title,
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    isbn10,
    isbn13,
    coverUrl: cover?.replace(/^http:/, "https:"),
    description: info.description,
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    pageCount: info.pageCount,
    language: info.language,
    genres: info.categories ?? [],
    seriesName,
    seriesPosition,
  };
}

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";

export const googleBooksProvider: BookProvider = {
  name: "googlebooks",

  async search(query, limit = 20) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(limit, 40)),
    });
    const res = await fetch(`${BASE_URL}?${params.toString()}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: GoogleVolume[] };
    return (data.items ?? []).map(normalize);
  },

  async lookupByIsbn(isbn) {
    const params = new URLSearchParams({ q: `isbn:${isbn}` });
    const res = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: GoogleVolume[] };
    const first = data.items?.[0];
    return first ? normalize(first) : null;
  },
};
