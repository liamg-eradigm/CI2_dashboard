# Architecture

## Applications and boundaries (4_Backend_Design)

| Concern | Where | Notes |
|---|---|---|
| Pages, reusable UI, filters, tables, charts, role-appropriate navigation | `apps/web` (React SPA + Worker) | Never connects to D1/R2/LLM. Only `@eradigm/shared` may be imported (ESLint rule). |
| Sign-in verification, permissions, submissions, extraction, AI analysis, data checks, storage, audit, admin | `apps/api` (Worker) | Every request re-checks role **and** tenant. |
| Page retrieval & parsing of untrusted HTML | `apps/capture` (Worker) | No D1, R2, queue or application secrets. Reached only through the API's service binding. |
| LLM calls | `packages/llm` | Only package allowed to import a model SDK (ESLint). Swappable via `LLM_PROVIDER`. |
| Shared, versioned definitions | `packages/shared` | `CONTRACT_VERSION` (sent as `X-Contract-Version`; the dashboard warns on a major mismatch), zod request/response schemas, generated `openapi.json`. |

Each Worker has its own `wrangler.jsonc`, environments and secrets, so a
dashboard change cannot reveal API credentials or bypass permission checks —
the API independently verifies the Cloudflare Access JWT.

## Storage
- **D1** (managed SQLite): tenants, users, role assignments, tenant settings,
  tracker columns/options (taxonomy), submissions, intelligence items (with the
  published projection used for queries), item competitors, source-snapshot
  metadata, processing attempts, item revisions, review decisions, capture log,
  incidents, notifications, saved views, audit events. Schema:
  `apps/api/migrations/0001_initial.sql`.
- **R2**: sanitised page snapshots, AES-256-GCM encrypted with
  `SNAPSHOT_ENCRYPTION_KEY`, content-addressed (`t/<tenant>/items/<item>/<sha256>.html`),
  never overwritten. D1 holds the reference, fingerprints (sanitised + raw
  SHA-256), size, content type, final URL, capture method, retention status and
  access scope.
- **Queues**: `eradigm-ci-jobs-<env>` (3 deliveries, exponential backoff) and a
  dead-letter queue that turns exhausted jobs into visible *Failed* items.

## Records and lifecycle
Separate records exist for tenant, user, assigned role (append-only history),
submission, saved source copy, processing attempt, intelligence item, review
decision, audit event and saved view.

Item statuses: **Queued → Fetching → Extracting → Needs review → Approved /
Rejected**, plus **Failed** and **Deleted** (`packages/shared/src/status.ts` —
transitions outside the table are rejected).

Per intelligence item the platform retains: submitted and normalised/final URLs,
publication date, received time, snapshot reference, extraction version, prompt
version, schema version, redaction-policy version, model, supporting excerpts,
confidence and validation warnings, reviewer, review times, publication status
and full revision history (`item_revisions`: `llm_draft`, `analyst_edit`,
`published`). Per-field **provenance** (`source` / `ai` / `analyst`) keeps
source-derived, AI-suggested and analyst-changed information distinguishable.

## URL processing sequence
1. **Validate & normalise** (`checkAndNormaliseUrl`): HTTP/HTTPS only, no
   credentials, standard ports, tracking parameters and fragments removed,
   private/loopback/link-local/metadata/CGNAT/multicast/reserved/IPv6-special and
   internal hostnames blocked. Rejections are logged and never create an item.
2. **Duplicate check**: normalised URL key (and `Idempotency-Key`, file hash)
   per tenant, enforced by partial unique indexes — concurrent identical
   submissions resolve to one item.
3. **Create submission** → item **Queued**, processing attempt 1, job enqueued.
4. **Isolated retrieval** (capture worker): DNS-over-HTTPS resolution with every
   address checked, manual redirects (≤ 5) re-checked hop by hop, robots.txt,
   20 s load limit, 10 MB cap, `text/html` only, login-wall/paywall/bot-challenge
   detection (stop, never bypass — the analyst uploads a SingleFile save instead).
5. **Content scan & sanitisation before storage**: malware markers rejected;
   scripts, trackers, forms, frames, handlers and `javascript:` URLs stripped.
6. **Save copy** in R2 + metadata in D1; capture log records final URL + outcome.
7. **Extract** article text and metadata (Readability on linkedom — the Worker
   alternative to trafilatura), content fingerprint → duplicate-content check.
8. **Redaction / classification policy** → quarantine or redact.
9. **LLM** with the version-controlled output schema; **validate** against the
   taxonomy and data rules; save a **Needs review** draft.
10. Analyst compares snapshot vs fields/evidence/confidence/warnings and
    **approves** (server-side validation, new published revision), **rejects** or
    requests **reprocessing** (new attempt; stale job messages are ignored).

## Queries
`apps/api/src/services/query.ts` builds one tenant-scoped `WHERE` clause from the
shared filter state and reuses it for the tracker page, KPI counts, timeline,
every bar chart (each ignoring only its own dimension) and exports, so dashboard
totals reconcile with filtered tracker records by construction (asserted by
integration tests).

## Frontend
React 19 + React Router + TanStack Query, hand-built accessible charts matching
the Claude Design prototype (tokens in `apps/web/src/styles/app.css`). Filter state
lives in the URL (shareable, survives opening a record, shared by Dashboard and
Tracker). Date defaults are computed daily in the tenant's time zone.

### Deliberate deviations from the prototype
- **Inbox is hidden from the client role** (the prototype showed it read-only).
  The brief says unreviewed LLM drafts are for analysts and only approved data
  reaches clients; the API also refuses Inbox endpoints for clients.
- **Reject / Reprocess / Retry / Delete** actions and Needs-review / Processing /
  Failed / Decided views were added to the Inbox (required by 4_Backend_Design).
- **Evidence & confidence** per field are shown on the Inbox draft (required so
  analysts can compare source with extracted fields).
- **Trend Test** panel added to the Dashboard (specified in 3_Frontend_Design,
  not in the prototype), plus **Saved views** and an **Administration** page.
- Amber text `#A55F12` was darkened to `#8A4E0D` to meet WCAG AA contrast on tinted
  backgrounds (found by the automated accessibility tests).
