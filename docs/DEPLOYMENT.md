# Deploying to Cloudflare

Three Workers per environment, deployed in this order:

| Worker | Config | Needs |
|---|---|---|
| `eradigm-ci-capture-<env>` | `apps/capture/wrangler.jsonc` | nothing (deliberately no bindings) |
| `eradigm-ci-api-<env>` | `apps/api/wrangler.jsonc` | D1, R2, Queues, CAPTURE service binding, secrets |
| `eradigm-ci-web-<env>` | `apps/web/wrangler.jsonc` | static assets + API service binding |

Environments: **dev** (local only), **staging**, **production** — each with its own
database, bucket, queues, secrets and Access application.

## Prerequisites

- A Cloudflare account on the **Workers Paid** plan (needed for the CPU time used
  by HTML parsing, Queues at this volume, rate limiting and Analytics Engine).
- Cloudflare Zero Trust (free tier is fine) for **Cloudflare Access**.
- A domain on Cloudflare for the dashboard, e.g. `ci.eradigm.com` and
  `ci-staging.eradigm.com`.
- An Anthropic API key per environment — see [CLAUDE-API.md](CLAUDE-API.md).
- Node 22, npm 11, and `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## 1. Provision resources (once per environment)

```bash
bash scripts/provision.sh staging
```
Creates the D1 database (id written into `apps/api/wrangler.jsonc`), the R2
bucket, the job queue + dead-letter queue, and generates
`SNAPSHOT_ENCRYPTION_KEY` and `AUDIT_HMAC_KEY` as Worker secrets. **Store both keys
in your password manager** — losing the first makes stored snapshots unreadable,
losing the second makes the audit chain unverifiable.

## 2. Sign-in: Cloudflare Access

Passwords are never stored by this system (6_QC_&_Compliance). Cloudflare Access,
backed by your identity provider (e.g. Microsoft Entra ID), handles sign-in, MFA,
login-attempt limits, session length and account recovery.

1. Zero Trust → Settings → Authentication → add your identity provider (e.g. Microsoft Entra ID).
2. Zero Trust → Access → Applications → **Add a self-hosted application** for
   `ci-staging.eradigm.com` (all paths). Policy: allow your Eradigm and client
   users (e.g. by email domain or IdP group). Session duration e.g. 8–24 h.
3. Copy the application's **AUD tag** and your team domain
   (`<team>.cloudflareaccess.com`) into `apps/api/wrangler.jsonc`
   (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`) for that environment.
4. Attach the custom domain to the web worker (uncomment `routes` in
   `apps/web/wrangler.jsonc`, or Workers → eradigm-ci-web-staging → Settings → Domains).
5. Optional: to let *End sessions* also revoke Access sessions at the edge, set
   `CF_ACCOUNT_ID` (var) and `CF_ACCESS_API_TOKEN` (secret, *Access: Organizations,
   Identity Providers, and Groups — Revoke* permission) on the API worker.

The API verifies the Access JWT signature, issuer, audience and expiry on every
request, then maps the email to a user, tenant and role in D1. Access proves
*who* someone is; the API decides *what* they can see.

## 3. Secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY  --env staging -c apps/api/wrangler.jsonc
npx wrangler secret put ALERT_WEBHOOK_URL  --env staging -c apps/api/wrangler.jsonc   # optional (Slack/Teams incoming webhook)
```
The web and capture workers hold no application secrets.

## 4. Deploy

### Option A — GitHub Actions (included)
Add repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts/Routes, D1, R2,
Queues edit) and `CLOUDFLARE_ACCOUNT_ID`, and create GitHub environments
`staging` and `production` (add required reviewers to `production`).
`.github/workflows/deploy.yml` deploys **staging on every push to `main`** and
**production on manual dispatch**, in the order capture → migrations → API → web.

### Option B — Cloudflare Workers Builds (connect the repo in the dashboard)
Create three Workers from this GitHub repository (Workers & Pages → Create →
Import a repository), each with **root directory `/`** and:

| Worker | Build command | Deploy command |
|---|---|---|
| capture | `npm i -g npm@11 && npm ci` | `npx wrangler deploy -c apps/capture/wrangler.jsonc --env production` |
| api | `npm i -g npm@11 && npm ci` | `npx wrangler d1 migrations apply DB --remote -c apps/api/wrangler.jsonc --env production && npx wrangler deploy -c apps/api/wrangler.jsonc --env production` |
| web | `npm i -g npm@11 && npm ci && npm run build -w apps/web` | `npx wrangler deploy -c apps/web/wrangler.jsonc --env production` |

Use `--env staging` for the staging set (e.g. on a `staging` branch).

### Option C — by hand
```bash
npx wrangler deploy -c apps/capture/wrangler.jsonc --env staging
npm run deploy:staging -w apps/api          # applies D1 migrations, then deploys
npm run deploy:staging -w apps/web
```

## 5. First tenant and admin

Tenants and their first admin are created once from the command line; everything
after that (more users, roles, deactivation) is done in the app under
Administration.

```bash
npx tsx scripts/create-tenant.ts --name "Acme Pharma" --slug acme --admin jane@eradigm.com --admin-name "Jane Doe" > /tmp/tenant.sql
npx wrangler d1 execute DB --remote --env production -c apps/api/wrangler.jsonc --file /tmp/tenant.sql
```
The admin's email must match the identity Cloudflare Access reports. For
**staging** you may instead load the non-confidential demo seed (generate it
with the staging audit key so the audit chain verifies):
```bash
AUDIT_HMAC_KEY=<staging key> npm run seed:generate -w apps/api
npx wrangler d1 execute DB --remote --env staging -c apps/api/wrangler.jsonc --file apps/api/seed/seed.sql
```
**Never load the demo seed into production.**

## 6. Smoke test
- Sign in through Access; the sidebar shows your name, role and workspace.
- Administration → **Deployment status** should be all ✓ (Access, Claude key,
  capture worker bound, queue bound, encryption key, audit key, alerts).
- Input → submit a public article URL → watch the 8-step pipeline → review in Inbox → approve → see it on the Dashboard.

## Optional: containerised SingleFile capture
If sources need full browser rendering, deploy `services/capture-container`
(see its README) and set `CAPTURE_MODE=container`, `CONTAINER_URL` and the
`CONTAINER_TOKEN` secret on the capture worker.
