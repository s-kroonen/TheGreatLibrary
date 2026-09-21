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
    fields: "key,title,author_name,series",
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

  for (const doc of docs) {
    console.log(`--- ${doc.title ?? "(no title)"} ---`);
    console.log("key:", doc.key);
    console.log("author_name:", doc.author_name ?? null);
    console.log("series field:", JSON.stringify(doc.series ?? null));

    // Also check the Work-level record, in case series info lives there
    // instead of (or in addition to) the search index doc.
    if (doc.key) {
      try {
        const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
        const work = (await readJsonSafe(workRes)) as Record<string, unknown>;
        const rawSeries = work.series ?? null;
        console.log("work-level record has 'series' key:", "series" in work, JSON.stringify(rawSeries));

        // The Work-level `series` field, when present, has been observed as
        // an array of memberships like [{ series: { key: '/series/OL...L' }, position: '1' }].
        // Resolve each referenced series key to see what a human-readable
        // name actually looks like — nothing downstream of us has ever
        // fetched this entity before, so don't assume its shape.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- diagnostic script, not production data flow
        const memberships = (Array.isArray(rawSeries) ? rawSeries : rawSeries ? [rawSeries] : []) as any[];
        for (const membership of memberships) {
          const seriesKey: string | undefined = membership?.series?.key ?? membership?.key;
          if (!seriesKey) {
            console.log("  membership has no resolvable series key:", JSON.stringify(membership));
            continue;
          }
          try {
            const seriesRes = await fetch(`https://openlibrary.org${seriesKey}.json`);
            const seriesEntity = await readJsonSafe(seriesRes);
            console.log(`  series entity ${seriesKey}:`, JSON.stringify(seriesEntity, null, 2));
          } catch (err) {
            console.log(`  series entity lookup failed for ${seriesKey}:`, err instanceof Error ? err.message : err);
          }
        }
      } catch (err) {
        console.log("work-level lookup failed:", err instanceof Error ? err.message : err);
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
