#!/usr/bin/env bash
# One-time Cloudflare resource provisioning for an environment (staging|production).
#
#   npx wrangler login            # or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#   bash scripts/provision.sh staging            # Workers Free plan (default)
#   bash scripts/provision.sh production --with-r2   # also create an R2 bucket for snapshots
#
# Creates the D1 database and queues (24 h retention, the Free plan maximum),
# writes the D1 id into apps/api/wrangler.jsonc, and generates the
# encryption/audit secrets. Everything created here is on the Workers Free plan;
# R2 is optional (it has a free tier but Cloudflare asks for a payment method
# before enabling it), so by default snapshots are stored in D1.
set -euo pipefail
ENV="${1:?usage: provision.sh staging|production [--with-r2]}"
WITH_R2="${2:-}"
[[ "$ENV" == "staging" || "$ENV" == "production" ]] || { echo "env must be staging or production"; exit 1; }
cd "$(dirname "$0")/.."
UPPER=$(echo "$ENV" | tr '[:lower:]' '[:upper:]')

echo "▸ D1 database eradigm-ci-$ENV"
OUT=$(npx wrangler d1 create "eradigm-ci-$ENV" --location weur 2>&1 || true)
echo "$OUT" | tail -5
ID=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)
if [[ -z "$ID" ]]; then
  ID=$(npx wrangler d1 list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s).find(d=>d.name==='eradigm-ci-$ENV');console.log(x?x.uuid:'')})")
fi
[[ -n "$ID" ]] || { echo "Could not determine D1 id"; exit 1; }
sed -i.bak "s/REPLACE_WITH_${UPPER}_D1_ID/$ID/" apps/api/wrangler.jsonc && rm -f apps/api/wrangler.jsonc.bak
echo "  database_id = $ID (written to apps/api/wrangler.jsonc)"

if [[ "$WITH_R2" == "--with-r2" ]]; then
  echo "▸ R2 bucket eradigm-ci-snapshots-$ENV (optional)"
  npx wrangler r2 bucket create "eradigm-ci-snapshots-$ENV" || true
  echo "  Uncomment the r2_buckets line for $ENV in apps/api/wrangler.jsonc to store new snapshots in R2."
fi
echo "▸ Queues (24 h message retention: the Workers Free plan maximum)"
npx wrangler queues create "eradigm-ci-jobs-$ENV" --message-retention-period-secs 86400 || true
npx wrangler queues create "eradigm-ci-jobs-dlq-$ENV" --message-retention-period-secs 86400 || true

echo "▸ Secrets"
# Safe to re-run: a secret that already exists is never replaced (replacing the
# encryption or audit key would make saved pages unreadable / the audit chain unverifiable).
EXISTING=$(npx wrangler secret list --env "$ENV" -c apps/api/wrangler.jsonc --format json 2>/dev/null || echo "[]")
has() { echo "$EXISTING" | grep -q "\"$1\""; }
SHOWN=""
for NAME in SNAPSHOT_ENCRYPTION_KEY AUDIT_HMAC_KEY SESSION_SECRET; do
  if has "$NAME"; then
    echo "  $NAME already set · kept"
    continue
  fi
  # Node (always installed for this project) rather than openssl, which Windows lacks.
  if [[ "$NAME" == "SESSION_SECRET" ]]; then BYTES=48; else BYTES=32; fi
  VALUE=$(node -e "process.stdout.write(require('crypto').randomBytes($BYTES).toString('base64'))")
  printf '%s' "$VALUE" | npx wrangler secret put "$NAME" --env "$ENV" -c apps/api/wrangler.jsonc >/dev/null
  echo "  $NAME set"
  if [[ "$NAME" != "SESSION_SECRET" ]]; then SHOWN="$SHOWN\n    $NAME = $VALUE"; fi
done
if [[ -n "$SHOWN" ]]; then
  echo
  echo "  ┌─ SAVE THESE NOW in your password manager (shown only once) ──────────────"
  printf "$SHOWN\n"
  echo "  └─ Needed only to restore a backup into a new Worker. Do not share them. ─"
fi
echo
echo "Next steps (docs/SIGN-IN-ENTRA.md has every click and command):"
echo "  1. Set APP_ORIGIN for $ENV in apps/api/wrangler.jsonc (the dashboard's web address)."
echo "  2. Register the app in Microsoft Entra ID, then enter its values yourself (they are never stored in files):"
echo "       npx wrangler secret put ENTRA_CLIENT_ID     --env $ENV -c apps/api/wrangler.jsonc"
echo "       npx wrangler secret put ENTRA_CLIENT_SECRET --env $ENV -c apps/api/wrangler.jsonc"
echo "  3. Deploy: capture worker → API (runs migrations) → web. See docs/DEPLOYMENT.md."
echo "  No AI/LLM key is needed: drafts reach the Inbox with every field empty (manual entry)."
echo "  To add automatic pre-fill later, follow docs/ENABLING-AUTOFILL.md."
echo "  Keep SNAPSHOT_ENCRYPTION_KEY and AUDIT_HMAC_KEY in your password manager: losing them makes snapshots unreadable / the audit chain unverifiable."
