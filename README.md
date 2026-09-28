# Eradigm Competitive Intelligence Platform

A Cloudflare-hosted platform for pharma competitive-intelligence news tracking.
Analysts submit a news **URL** or a saved **HTML file**; an isolated capture
worker retrieves and sanitises the page, the **Claude API** pre-fills a tracker
entry (schema-constrained, with evidence and confidence per field), and every
draft waits in the **Inbox** for human review. Only approved items reach the
client-facing **Tracker** and **Dashboard**.

> ⚠️ **Before production:** read [docs/CLAUDE-API.md](docs/CLAUDE-API.md). Using
> the Claude API needs an Anthropic Console organisation, an API key and an
> organisational decision about sending client-confidential article text to a
> third-party AI provider. Until a key is configured the platform runs with an
> offline mock classifier (dev) or marks items *Failed · LLM not configured*
> (staging/production) — nothing is ever auto-published.

The requirement documents and the Claude Design prototype live in
[`docs/requirements/`](docs/requirements).

## Architecture at a glance

```
                      Cloudflare Access (SSO via your identity provider)
                                         │
 Browser ──HTTPS──▶  eradigm-ci-web  (Worker + static React build)
                        │  /api/* over a service binding (same origin, no public API route)
                        ▼
                     eradigm-ci-api  (Worker: auth + tenancy + roles, validation, review, audit)
                        │        │          │             │
                        │        │          │             └──▶ @eradigm/llm  ──▶ Claude API
                        │        │          └── Queue (background jobs, retries, DLQ)
                        │        └── R2 (encrypted, content-addressed page snapshots)
                        └── D1 (relational records, audit hash chain)
                        │
                        └─service binding─▶ eradigm-ci-capture (Worker, NO db/storage/secrets)
                                               └─optional─▶ SingleFile + Chromium container
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
| `packages/llm` | The LLM "container": provider interface + Claude provider (the **only** code allowed to import a model SDK — lint-enforced) + offline mock |
| `packages/capture` | Capture library used by the capture worker |
| `services/capture-container` | Optional Docker service: headless Chromium + SingleFile |
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
npm run test:unit         # shared contract, capture library, LLM adapter
npm run test:integration  # API in the Workers runtime with local D1/R2/queues
npm run test:e2e          # Playwright + axe (starts its own seeded servers)
npm run test:load         # dashboard-query load test (BASE_URL, DEV_USER / ACCESS_JWT)
npm run eval [file.jsonl] # extraction/classification evaluation against labelled examples
npm run audit:deps && npm run scan:secrets
bash scripts/verify-restore.sh   # backup + restore drill
```

## Deploying to Cloudflare

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — in short:
`scripts/provision.sh staging` → configure Cloudflare Access → set secrets →
deploy capture → API (migrations run first) → web, either via the included GitHub
Actions workflow or by connecting each Worker to this repository with Cloudflare
Workers Builds.

## Documentation
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Operations: monitoring, alerts, backup/restore, rollback, retention](docs/OPERATIONS.md)
- [Security, tenancy & compliance](docs/SECURITY-COMPLIANCE.md)
- [Claude API integration & organisational permissions](docs/CLAUDE-API.md)
- [QC report against 6_QC_&_Compliance](docs/QC-REPORT.md)
