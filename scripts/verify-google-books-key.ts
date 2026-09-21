/**
 * Sanity-checks GOOGLE_BOOKS_API_KEY (or the lack of one) against the
 * real Google Books API. Run with: npm run verify:google-books
 */
export {}; // force module scope — avoids colliding with other scripts' `main`

async function main() {
  const key = process.env.GOOGLE_BOOKS_API_KEY;

  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", "fourth wing");
  url.searchParams.set("maxResults", "1");
  if (key) url.searchParams.set("key", key);

  console.log(
    key
      ? "Testing with GOOGLE_BOOKS_API_KEY set..."
      : "No GOOGLE_BOOKS_API_KEY set — testing against Google's shared anonymous quota."
  );

  const res = await fetch(url);
  const data = await res.json().catch(() => null);

  if (res.status === 429) {
    console.log("\n❌ Quota exceeded (429).");
    if (key) {
      console.log(
        "You have a key set but still hit a quota error — double check:\n" +
        "  - the key is correct (no extra whitespace/quotes in .env)\n" +
        "  - the Books API is enabled for the project that key belongs to\n" +
        "  - the key isn't restricted to a different API"
      );
    } else {
      console.log(
        "This is the anonymous per-IP quota being exhausted — see README.md\n" +
        "'Google Books API key' section to get a free key."
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    console.log(`\n❌ Unexpected response: ${res.status}`);
    console.log(JSON.stringify(data, null, 2));
    process.exitCode = 1;
    return;
  }

  const title = data?.items?.[0]?.volumeInfo?.title;
  console.log(
    `\n✅ Google Books API responded OK${key ? " using your API key" : " (anonymous)"}.`
  );
  if (title) console.log(`   Sample result: "${title}"`);
}

main();
