#!/usr/bin/env bash
# Export an environment's D1 database to a timestamped SQL file with a checksum.
#   bash scripts/backup-d1.sh production     # remote
#   bash scripts/backup-d1.sh local          # local dev database
# Point-in-time restore is also available via D1 Time Travel (see docs/OPERATIONS.md).
set -euo pipefail
ENV="${1:?usage: backup-d1.sh local|staging|production}"
cd "$(dirname "$0")/../apps/api"
mkdir -p ../../backups
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="../../backups/eradigm-ci-$ENV-$TS.sql"
if [[ "$ENV" == "local" ]]; then
  # `wrangler d1 export` is remote-only; dump the local SQLite file in the same SQL form.
  DB_FILE=$(find "${STATE:-../../.wrangler/state}/v3/d1" -name '*.sqlite' ! -name 'metadata.sqlite' | head -1)
  python3 - "$DB_FILE" "$OUT" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
tables, rows, rest = [], [], []
for line in con.iterdump():
    if line in ("BEGIN TRANSACTION;", "COMMIT;") or "_cf_" in line.split("(")[0] or "sqlite_sequence" in line:
        continue
    (tables if line.startswith("CREATE TABLE") else rows if line.startswith("INSERT") else rest).append(line)
with open(sys.argv[2], "w") as f:
    f.write("PRAGMA defer_foreign_keys = on;\n")
    for line in tables + rows + rest:
        f.write(line + "\n")
PY
else
  npx wrangler d1 export DB --remote --env "$ENV" --output "$OUT" > /dev/null
fi
sha256sum "$OUT" > "$OUT.sha256"
echo "$OUT ($(wc -c < "$OUT") bytes)"
