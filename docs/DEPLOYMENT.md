# Deploying to Cloudflare

Three Workers per environment, deployed in this order:

| Worker | Config | Needs |
|---|---|---|
| `eradigm-ci-capture-<env>` | `apps/capture/wrangler.jsonc` | nothing (deliberately no bindings) |
| `eradigm-ci-api-<env>` | `apps/api/wrangler.jsonc` | D1, Queues, CAPTURE service binding, secrets (R2 optional) |
| `eradigm-ci-web-<env>` | `apps/web/wrangler.jsonc` | static assets + API service binding |

Environments: **dev** (local only), **staging**, **production** — each with its own
database, queues and secrets. (On the Free plan you may run
only **production** to keep within the daily allowances; everything below
works per environment.)

## Prerequisites

- A Cloudflare account on the **Workers Free plan**. No billing account or payment
  method is needed for anything in the default configuration; there is no
  Cloudflare Access / Zero Trust. See [Workers Free plan](#workers-free-plan).
- **Microsoft Entra ID** (included with Eradigm's Microsoft 365) for "Sign in with
  Microsoft". Registering the app is free. See [SIGN-IN-ENTRA.md](SIGN-IN-ENTRA.md).
- A web address for the dashboard: the free `*.workers.dev` address (default) or
  optionally your own domain, e.g. `ci.eradigm.com`.
- **No AI/LLM account or API key** — the prototype uses manual entry. To add
  automatic pre-fill later see [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md).
- Node 22, npm 11, and `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## Workers Free plan

Everything this build uses is available on the Workers Free plan:

| Product | Used for | Free allowance (Cloudflare's published limits at the time of writing — re-check) |
|---|---|---|
| Workers (3) | web, API, capture | 100,000 requests/day, **10 ms CPU per invocation**, 3 MB compressed script size (ours: web < 1 KB + static assets, API ≈ 300 KB, capture ≈ 140 KB gzipped) |
| Static assets | the React dashboard | free, unlimited requests |
| D1 | all records **and** the saved page copies (`snapshot_blobs`) | 500 MB per database, 5 GB per account, 5 M rows read / 100 k rows written per day, Time Travel 7 days |
| Queues | background capture/processing, retries, dead-letter queue | 10,000 operations/day, 24 h message retention (set by `provision.sh`) |
| Cron Triggers | daily retention job | 5 per account (we use 1 per environment) |
| Rate limiting binding, Workers Analytics Engine, Workers Logs | abuse limits, metrics, logs | included |
| Rate limiting binding | per-IP sign-in limits, per-user request limits | included |
| Microsoft Entra ID (not Cloudflare) | sign-in, MFA, password resets | included with Microsoft 365; app registration is free |

**Not used, because they need a paid plan or a payment method:** Containers
(the optional headless-Chromium capture service was removed — JavaScript-heavy or
login-protected pages are saved with SingleFile and uploaded), `limits.cpu_ms`,
Logpush, Tail Workers. **R2** has a free tier but Cloudflare asks for a payment
method before enabling it, so snapshots are stored in D1 by default; R2 is
optional (`scripts/provision.sh <env> --with-r2`, then uncomment the
`r2_buckets` line) and new snapshots then go to R2 automatically while existing
ones stay readable.

**Capacity on the Free plan (rough):** a sanitised article is typically
100–500 KB, so a 500 MB D1 database holds roughly 1,000–4,000 saved pages next to
the records. Each submission uses ~4 queue operations, so ~2,500 submissions a
day fit the queue allowance. The retention job deletes saved pages after the
tenant's retention period (Administration).

**CPU (10 ms per invocation).** HTML is sanitised and parsed with the Workers
runtime's native streaming parser (`HTMLRewriter`) with handlers attached only
to the few elements that matter; the earlier JavaScript DOM approach took
100–400 ms per page and would not fit. Measured in the local Workers runtime
(an upper bound; confirm in production under Workers → Metrics → CPU time):

| Page | Size | Parse + sanitise + extract |
|---|---|---|
| Short article | 150 KB | ≈ 3 ms |
| Large news page (heavy navigation, inline scripts) | 560 KB | ≈ 12 ms |
| SingleFile save with a 3 MB embedded image | 3.4 MB | ≈ 44 ms |

Cloudflare does not always stop a Worker exactly at 10 ms, but very large pages
can exceed the limit. When the capture worker fails for that reason the item
ends **Failed · PROCESSING_LIMIT** with the message *"save it with SingleFile,
ideally without embedded images, and upload the HTML file"* (the upload limit is
5 MB). If this becomes common, **Workers Paid ($5/month)** raises the CPU limit
to 30 s with no code or configuration change.

## 1. Provision resources (once per environment)

```bash
bash scripts/provision.sh staging
```
Creates the D1 database (id written into `apps/api/wrangler.jsonc`), the job
queue + dead-letter queue (24 h retention, the Free plan maximum) and, with
`--with-r2`, an optional R2 bucket; and generates
`SNAPSHOT_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY` and `SESSION_SECRET` as Worker
secrets. **Store the first two in your password manager** — losing the first makes
stored snapshots unreadable, losing the second makes the audit chain
unverifiable. (`SESSION_SECRET` can be replaced at any time; sign-ins in progress
simply restart.)

## 2. Sign-in: Sign in with Microsoft (Entra ID)

Passwords are never stored by this system (6_QC_&_Compliance). People sign in
with their organisation's Microsoft work or school account — **any organisation**
— and their organisation handles passwords, MFA, lockouts and account recovery.
A person gets in only after an Eradigm admin or analyst created their account
and they opened its one-time **invite link**.

Follow **[SIGN-IN-ENTRA.md](SIGN-IN-ENTRA.md)**, which walks through every click
and command. In short:
1. Register the app in Microsoft Entra ID (multitenant, redirect URI
   `<web address>/api/auth/callback`) and create a client secret.
2. Put the dashboard's web address in `APP_ORIGIN` in `apps/api/wrangler.jsonc`
   (the only file edit).
3. Enter the Microsoft values yourself as secrets — **never in files or chat**:
   `npx wrangler secret put ENTRA_CLIENT_ID --env <env> -c apps/api/wrangler.jsonc`
   and `... ENTRA_CLIENT_SECRET ...`.

The API checks the session on every request and maps it to a user, tenant and
role in D1. Microsoft proves *who* someone is; the API decides *what* they can see.

## 3. Secrets

```bash
npx wrangler secret put ALERT_WEBHOOK_URL  --env staging -c apps/api/wrangler.jsonc   # optional (Slack/Teams incoming webhook)
```
No AI API key is needed (manual entry). The web and capture workers hold no
application secrets.

## 4. Deploy

### Option A — GitHub Actions (included)
Add repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts/Routes, D1,
Queues edit; R2 only if you enabled it) — the Microsoft values are **not** GitHub
secrets; they live in Cloudflare (step 2) and the workflow only checks that they
exist — and `CLOUDFLARE_ACCOUNT_ID`, and create GitHub environments
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
npx tsx scripts/create-tenant.ts --name "Acme Pharma" --slug acme --admin jane@eradigm.com --admin-name "Jane Doe" \
  --origin <web address> > /tmp/tenant.sql
npx wrangler d1 execute DB --remote --env production -c apps/api/wrangler.jsonc --file /tmp/tenant.sql
```
The terminal prints the first admin's **invite link**; send it to them privately.
They open it and sign in with Microsoft to activate the account.

For **staging** you may also load the non-confidential demo seed (generate it
with the staging audit key so the audit chain verifies), then let yourself into
the demo workspace with a break-glass invite:
```bash
AUDIT_HMAC_KEY=<staging key> npm run seed:generate -w apps/api
npx wrangler d1 execute DB --remote --env staging -c apps/api/wrangler.jsonc --file apps/api/seed/seed.sql
npx tsx scripts/create-invite.ts --tenant t_demo --email you@eradigm.com --name "You" --role admin --origin <staging web address> > /tmp/invite.sql
npx wrangler d1 execute DB --remote --env staging -c apps/api/wrangler.jsonc --file /tmp/invite.sql
```
`scripts/create-invite.ts` is also the recovery path if every admin of a
workspace loses access.
**Never load the demo seed into production.**

## 6. Smoke test
- Open the invite link, **Accept and sign in with Microsoft**; the sidebar shows
  your name, role and workspace. **Sign out** returns you to the sign-in page.
- Administration → **Deployment status** should be all ✓ ("Sign in with Microsoft
  configured (any organisation)", "Manual entry:
  … no external AI service", capture worker bound, queue bound, snapshots in D1,
  encryption key, audit key, alerts).
- Input → submit a public article URL → watch the 7-step pipeline → Inbox: the
  item says *Awaiting analyst entry* → **View saved page** / **Open saved page in
  new tab** → enter the fields → approve → see it on the Dashboard.
- Sign in as a client user: the sidebar shows only Dashboard and Tracker, and
  `/inbox`, `/input` and `/admin` redirect to the Dashboard.

## Adding automatic pre-fill later
See [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md): set the API key secret and
`LLM_PROVIDER` for the environment and redeploy the API worker.
