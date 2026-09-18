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
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?${params.toString()}`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: GoogleVolumeSale[] };
  const sale = data.items?.[0]?.saleInfo;
  const price = sale?.retailPrice ?? sale?.listPrice;
  if (!price) return null;

  return {
    amount: price.amount,
    currency: price.currencyCode,
    url: sale?.buyLink,
  };
}

export function retailerSearchLinks(query: string) {
  const q = encodeURIComponent(query);
  return [
    { name: "Amazon", url: `https://www.amazon.com/s?k=${q}&i=stripbooks` },
    { name: "bol.com", url: `https://www.bol.com/nl/nl/s/?searchtext=${q}` },
  ];
}
