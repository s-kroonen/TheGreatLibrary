#!/bin/sh
set -e

echo "Applying database schema..."
npx drizzle-kit push --force

echo "Starting The Great Library..."
exec "$@"
