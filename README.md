# Eradigm Competitive Intelligence Platform

A Cloudflare-hosted platform for pharma competitive-intelligence news tracking.
Analysts submit a news **URL** or a saved **HTML file**; an isolated capture
worker retrieves, sanitises and saves the page, and the item goes to the
**Inbox** with **every tracker field empty**. An analyst opens the saved page,
enters the fields and approves. Only approved items reach the client-facing
**Tracker** and **Dashboard**. Clients never see the Inbox or Input pages.

**Prototype: no AI API.** Nothing is sent to any AI service and no API key is
needed. The build is designed so automatic pre-fill (Claude or another LLM)
can be switched on later by configuration. See
**[docs/ENABLING-AUTOFILL.md](docs/ENABLING-AUTOFILL.md)** for the next steps and
[docs/CLAUDE-API.md](docs/CLAUDE-API.md) for the organisational permissions that
step needs.

**Sign-in: "Sign in with Microsoft"** — any organisation's work account, after an
admin sends the person a one-time invite link. No passwords are stored. Setup,
including exactly where to enter the Microsoft IDs (never in files or chat):
**[docs/SIGN-IN-ENTRA.md](docs/SIGN-IN-ENTRA.md)**.

**Hosting: Cloudflare Workers Free plan.** No paid products, billing account or
payment method are needed in the default configuration (no Cloudflare Access /
Zero Trust); see
[DEPLOYMENT.md § Workers Free plan](docs/DEPLOYMENT.md#workers-free-plan).

The requirement documents and the Claude Design prototype live in
[`docs/requirements/`](docs/requirements).

## Architecture at a glance

```
                      Sign in with Microsoft (Entra ID, any organisation)
                                         │
 Browser ──HTTPS──▶  eradigm-ci-web  (Worker + static React build)
                        │  /api/* over a service binding (same origin, no public API route)
                        ▼
                     eradigm-ci-api  (Worker: auth + tenancy + roles, validation, review, audit)
                        │        │          │             │
                        │        │          │             └╌╌▶ prefill.ts ╌╌▶ @eradigm/llm ╌╌▶ LLM API
                        │        │          │                  (off in the prototype: empty drafts)
                        │        │          └── Queue (background jobs, retries, DLQ)
                        │        └── saved page copies (encrypted; D1 by default, R2 optional)
                        └── D1 (relational records, audit hash chain)
                        │
                        └─service binding─▶ eradigm-ci-capture (Worker, NO db/storage/secrets)
```

Three **independently deployable** Workers, each with its own config and secrets,
sharing only the versioned contract in `packages/shared` (types, validation
rules, taxonomy defaults and a generated OpenAPI description).

| Path | What it is |
|---|---|
| `apps/web` | React + TypeScript dashboard (Dashboard, Tracker, Inbox, Input, Administration) served by a Worker; talks only to `/api` |
| `apps/api` | Processing service: sign-in verification, tenant/role checks, submissions, pipeline, review, schema editing, queries, exports, audit, retention cron |
| `apps/capture` | Isolated capture worker: SSRF-safe retrieval, robots/login/paywall checks, content scan + sanitisation, article extraction |
| `packages/shared` | Versioned contract (`CONTRACT_VERSION`), taxonomy, validation, filters, trend test, URL policy, redaction policy, export writers, `openapi.json` |
| `packages/llm` | The LLM "container" (switched off in the prototype): provider interface + Claude provider (the **only** code allowed to import a model SDK — lint-enforced) + offline mock |
| `packages/capture` | Capture library used by the capture worker (native `HTMLRewriter` pass: scan, sanitise, extract) |
| `e2e/` | Playwright end-to-end + axe accessibility tests (admin, analyst, client) |
| `scripts/` | dev runner, provisioning, backup/restore drill, load test, evaluation harness, secret scan |
| `docs/` | Architecture, deployment, operations, security & compliance, QC report |

## Quick start (local)

Requires Node 22 and npm 11 (`npm i -g npm@11`).

```bash
npm ci
npm run dev          # migrates + seeds a local D1 on first run; API :8787, capture worker, dashboard :5173
```

Open http://localhost:5173 and use **Dev sign-in** in the sidebar to switch between
the seeded demo users (analyst, admin, client, and a user in a second tenant).
Seed data is synthetic and non-confidential.

## Tests and checks

```bash
npm run lint              # includes architectural boundary rules
npm run typecheck
npm run test:unit         # shared contract, capture library (in workerd), LLM adapter
npm run test:integration  # API in the Workers runtime with local D1/queues (manual entry + the optional LLM path)
npm run test:e2e          # Playwright + axe (starts its own seeded servers)
npm run test:load         # dashboard-query load test (BASE_URL, DEV_USER / SESSION)
npm run eval [file.jsonl] # extraction/classification evaluation against labelled examples
node scripts/export-eval-set.mjs --env <env> > eval/labelled.jsonl   # labelled set from approved manual entries
npm run audit:deps && npm run scan:secrets
bash scripts/verify-restore.sh   # backup + restore drill
```

## Deploying to Cloudflare

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — in short:
`scripts/provision.sh staging` → register the app in Microsoft Entra ID and enter its
values as secrets ([docs/SIGN-IN-ENTRA.md](docs/SIGN-IN-ENTRA.md)) → (optional) alert webhook →
deploy capture → API (migrations run first) → web, either via the included GitHub
Actions workflow or by connecting each Worker to this repository with Cloudflare
Workers Builds.

## Documentation
- [Architecture](docs/ARCHITECTURE.md)
- **[Step-by-step deployment guide for beginners](docs/DEPLOY-STEP-BY-STEP.md)** ← start here
- [Deployment (reference)](docs/DEPLOYMENT.md)
- [Sign in with Microsoft — setup (where to enter the Entra values)](docs/SIGN-IN-ENTRA.md)
- [Operations: monitoring, alerts, backup/restore, rollback, retention](docs/OPERATIONS.md)
- [Security, tenancy & compliance](docs/SECURITY-COMPLIANCE.md)
- [Enabling automatic pre-fill with an AI API — next steps](docs/ENABLING-AUTOFILL.md)
- [Claude API integration & organisational permissions](docs/CLAUDE-API.md)
- [QC report against 6_QC_&_Compliance](docs/QC-REPORT.md)
