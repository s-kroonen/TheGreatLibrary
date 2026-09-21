#!/bin/sh
set -e

echo "Applying database schema..."
npx drizzle-kit push --force

echo "Backfilling series links for existing books..."
npx tsx scripts/backfill-series.ts || echo "Series backfill failed, continuing startup anyway"

echo "Starting The Great Library..."
exec "$@"
