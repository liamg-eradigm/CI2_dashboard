#!/usr/bin/env bash
# Fresh local database for end-to-end tests: migrations + non-confidential seed.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
STATE=../../.wrangler/e2e
rm -rf "$STATE"
npx wrangler d1 migrations apply DB --local --env dev --persist-to "$STATE" > /dev/null
npx wrangler d1 execute DB --local --env dev --persist-to "$STATE" --file seed/seed.sql > /dev/null
exec npx wrangler dev --env dev --port 8797 --persist-to "$STATE" --ip 127.0.0.1
