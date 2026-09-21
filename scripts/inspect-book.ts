/**
 * Diagnostic tool — dumps the RAW API responses for a title from both
 * providers, so we can see exactly what series-related fields (if any)
 * they actually return, instead of guessing from documentation or
 * training knowledge. Run this wherever the app has real network access
 * (e.g. in Portainer's container, or any machine that can reach both
 * APIs — this sandbox currently can't reach either).
 *
 * Usage: npx tsx scripts/inspect-book.ts "Icebreaker" "Hannah Grace"
 */
export {}; // force module scope — avoids colliding with other scripts' `main`

const [, , title, author] = process.argv;

if (!title) {
  console.error('Usage: npx tsx scripts/inspect-book.ts "<title>" ["<author>"]');
  process.exit(1);
}

const query = author ? `${title} ${author}` : title;

/** Reads the body as text first, then tries to parse JSON — so a
 * non-JSON error page (proxy denial, HTML error, etc.) is reported
 * plainly instead of throwing a confusing "Unexpected token" error. */
async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: text.slice(0, 500) };
  }
}

async function inspectGoogleBooks() {
  console.log("\n=== Google Books ===");
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const params = new URLSearchParams({ q: query, maxResults: "3" });
  if (key) params.set("key", key);

  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?${params.toString()}`
  );
  const data = (await readJsonSafe(res)) as { items?: unknown[] };

  if (!res.ok) {
    console.log(`Request failed (${res.status}):`, JSON.stringify(data, null, 2));
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- diagnostic script, not production data flow
  const items = (data.items ?? []) as any[];
  console.log(`${items.length} result(s) for "${query}"\n`);

  for (const item of items) {
    const info = item.volumeInfo ?? {};
    console.log(`--- ${info.title ?? "(no title)"} ---`);
    console.log("id:", item.id);
    console.log("subtitle:", info.subtitle ?? null);
    console.log("categories:", info.categories ?? null);
    // This is the field our current code never looks at — an
    // undocumented-but-real field some Google Books volumes carry.
    console.log("seriesInfo (undocumented field):", JSON.stringify(info.seriesInfo ?? null));
    console.log();
  }
}

async function inspectOpenLibrary() {
  console.log("\n=== Open Library ===");
  const params = new URLSearchParams({
    q: query,
    limit: "3",
    // `series` is null on real records; the index's actual series fields
    // are series_key / series_name / series_position.
    fields: "key,title,author_name,isbn,series,series_key,series_name,series_position",
  });
  const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
  const data = (await readJsonSafe(res)) as { docs?: unknown[] };

  if (!res.ok) {
    console.log(`Request failed (${res.status}):`, JSON.stringify(data, null, 2));
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- diagnostic script, not production data flow
  const docs = (data.docs ?? []) as any[];
  console.log(`${docs.length} result(s) for "${query}"\n`);

  const seenSeries = new Set<string>();
  for (const doc of docs) {
    console.log(`--- ${doc.title ?? "(no title)"} ---`);
    console.log("key:", doc.key);
    console.log("author_name:", doc.author_name ?? null);
    console.log("isbn count:", doc.isbn?.length ?? 0);
    console.log("legacy `series` field:", JSON.stringify(doc.series ?? null));
    console.log(
      "series_key / series_name / series_position:",
      JSON.stringify([doc.series_key ?? null, doc.series_name ?? null, doc.series_position ?? null])
    );

    // Enumerating the whole series: the Series entity's own `seeds` link
    // does NOT work (seed_count 0; .json 500s, plain URL 404s — verified),
    // but the search index carries series_key on every member work, so
    // this returns the full lineup with positions in one request.
    for (const seriesKey of (doc.series_key ?? []) as string[]) {
      if (seenSeries.has(seriesKey)) continue;
      seenSeries.add(seriesKey);
      const lineupParams = new URLSearchParams({
        q: `series_key:${seriesKey}`,
        limit: "100",
        fields: "key,title,series_key,series_position,edition_count",
      });
      const lineupRes = await fetch(`https://openlibrary.org/search.json?${lineupParams.toString()}`);
      const lineup = (await readJsonSafe(lineupRes)) as { numFound?: number; docs?: unknown[] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- diagnostic script, not production data flow
      const members = (lineup.docs ?? []) as any[];
      console.log(`  series ${seriesKey} lineup (numFound ${lineup.numFound}):`);
      for (const m of members) {
        const i = (m.series_key ?? []).indexOf(seriesKey);
        console.log(`    #${m.series_position?.[i] ?? "?"}  ${m.title}  (${m.key}, ${m.edition_count} editions)`);
      }
    }
    console.log();
  }
}

async function main() {
  console.log(`Inspecting: "${query}"`);
  await inspectGoogleBooks().catch((err) =>
    console.log("Google Books request errored:", err instanceof Error ? err.message : err)
  );
  await inspectOpenLibrary().catch((err) =>
    console.log("Open Library request errored:", err instanceof Error ? err.message : err)
  );
}

main();
