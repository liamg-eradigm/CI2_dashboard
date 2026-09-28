#!/usr/bin/env bash
# One-time Cloudflare resource provisioning for an environment (staging|production).
#
#   npx wrangler login            # or export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#   bash scripts/provision.sh staging
#
# Creates the D1 database, R2 bucket and queues, writes the D1 id into
# apps/api/wrangler.jsonc, and generates the encryption/audit secrets.
set -euo pipefail
ENV="${1:?usage: provision.sh staging|production}"
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

echo "▸ R2 bucket eradigm-ci-snapshots-$ENV"
npx wrangler r2 bucket create "eradigm-ci-snapshots-$ENV" || true
echo "▸ Queues"
npx wrangler queues create "eradigm-ci-jobs-$ENV" || true
npx wrangler queues create "eradigm-ci-jobs-dlq-$ENV" || true

echo "▸ Secrets (generated locally, never printed)"
openssl rand -base64 32 | npx wrangler secret put SNAPSHOT_ENCRYPTION_KEY --env "$ENV" -c apps/api/wrangler.jsonc
openssl rand -base64 32 | npx wrangler secret put AUDIT_HMAC_KEY --env "$ENV" -c apps/api/wrangler.jsonc
echo
echo "Next steps:"
echo "  1. npx wrangler secret put ANTHROPIC_API_KEY --env $ENV -c apps/api/wrangler.jsonc"
echo "  2. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD for $ENV in apps/api/wrangler.jsonc (see docs/DEPLOYMENT.md)"
echo "  3. Deploy: capture worker → API (runs migrations) → web. See docs/DEPLOYMENT.md."
echo "  Keep SNAPSHOT_ENCRYPTION_KEY and AUDIT_HMAC_KEY in your password manager: losing them makes snapshots unreadable / the audit chain unverifiable."
