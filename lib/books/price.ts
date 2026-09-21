import { logger } from "@/lib/logger";

const SCOPE = "price";

interface GoogleVolumeSale {
  saleInfo?: {
    listPrice?: { amount: number; currencyCode: string };
    retailPrice?: { amount: number; currencyCode: string };
    buyLink?: string;
  };
}

/**
 * Best-effort current price via Google Books' sale info (when the book is
 * sold through Google Play Books). There's no free, keyless Amazon or
 * bol.com pricing API, so those are exposed as retailer search links
 * instead (see retailerSearchLinks below) rather than scraped/fabricated
 * numbers.
 */
export async function getGoogleBooksPrice(
  isbn: string
): Promise<{ amount: number; currency: string; url?: string } | null> {
  const params = new URLSearchParams({ q: `isbn:${isbn}` });
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (key) params.set("key", key);

  const start = Date.now();
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?${params.toString()}`
    );
    const durationMs = Date.now() - start;

    if (!res.ok) {
      logger.warn(SCOPE, "price check failed", {
        isbn,
        status: res.status,
        durationMs,
      });
      return null;
    }

    const data = (await res.json()) as { items?: GoogleVolumeSale[] };
    const sale = data.items?.[0]?.saleInfo;
    const price = sale?.retailPrice ?? sale?.listPrice;

    logger.info(SCOPE, "price check ok", {
      isbn,
      durationMs,
      found: !!price,
    });

    if (!price) return null;

    return {
      amount: price.amount,
      currency: price.currencyCode,
      url: sale?.buyLink,
    };
  } catch (err) {
    logger.warn(SCOPE, "price check errored", {
      isbn,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function retailerSearchLinks(query: string) {
  const q = encodeURIComponent(query);
  return [
    { name: "Amazon.nl", url: `https://www.amazon.nl/s?k=${q}&i=stripbooks` },
    { name: "bol.com", url: `https://www.bol.com/nl/nl/s/?searchtext=${q}` },
  ];
}
