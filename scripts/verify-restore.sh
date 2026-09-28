#!/usr/bin/env bash
# Verified backup + restore drill: export a database, restore it into a brand-new
# empty database, and compare row counts and the audit-chain head.
#   bash scripts/verify-restore.sh            # local dev database (default)
#   STATE=.wrangler/e2e bash scripts/verify-restore.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_STATE="${STATE:-$ROOT/.wrangler/state}"
RESTORE_STATE="$ROOT/.wrangler/restore-drill"
cd "$ROOT/apps/api"
OUT=$(STATE="$SRC_STATE" bash "$ROOT/scripts/backup-d1.sh" local | awk '{print $1}')
echo "Backup: $OUT"
sha256sum -c "$OUT.sha256" > /dev/null && echo "Checksum OK"
rm -rf "$RESTORE_STATE"
npx wrangler d1 execute DB --local --env dev --persist-to "$RESTORE_STATE" --file "$OUT" > /dev/null
Q="SELECT (SELECT COUNT(*) FROM tenants) t, (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM intelligence_items) i, (SELECT COUNT(*) FROM item_revisions) r, (SELECT COUNT(*) FROM audit_events) a, (SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1) head"
count() { npx wrangler d1 execute DB --local --env dev --persist-to "$1" --json --command "$Q" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s)[0].results[0])))"; }
A=$(count "$SRC_STATE"); B=$(count "$RESTORE_STATE")
echo "source:   $A"
echo "restored: $B"
rm -rf "$RESTORE_STATE"
[[ "$A" == "$B" ]] && echo "RESTORE VERIFIED" || { echo "RESTORE MISMATCH"; exit 1; }
