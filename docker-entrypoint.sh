#!/bin/sh
set -e

echo "Applying database schema..."
npx drizzle-kit push --force

# In the background: the first run over a large library is rate-limited by
# the series providers (a few minutes), and it's a best-effort enhancement
# — the app shouldn't wait on it to start serving. Output still lands in
# the container logs.
echo "Backfilling series links for existing books (in the background)..."
(npx tsx scripts/backfill-series.ts || echo "Series backfill failed") &

echo "Starting The Great Library..."
exec "$@"
