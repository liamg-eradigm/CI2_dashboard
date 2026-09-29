# Architecture

## Applications and boundaries (4_Backend_Design)

| Concern | Where | Notes |
|---|---|---|
| Pages, reusable UI, filters, tables, charts, role-appropriate navigation | `apps/web` (React SPA + Worker) | Never connects to D1/storage/LLM. Only `@eradigm/shared` may be imported (ESLint rule). |
| Sign-in verification, permissions, submissions, extraction, AI analysis, data checks, storage, audit, admin | `apps/api` (Worker) | Every request re-checks role **and** tenant. |
| Page retrieval & parsing of untrusted HTML | `apps/capture` (Worker) | No D1, storage, queue or application secrets. Reached only through the API's service binding. |
| Draft pre-fill | `apps/api/src/pipeline/prefill.ts` | The one decision point: `LLM_PROVIDER = "none"` (prototype) → empty draft; otherwise the LLM adapter. See [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md). |
| LLM calls (off in the prototype) | `packages/llm` | Only package allowed to import a model SDK (ESLint). Swappable via `LLM_PROVIDER`. |
| Shared, versioned definitions | `packages/shared` | `CONTRACT_VERSION` (sent as `X-Contract-Version`; the dashboard warns on a major mismatch), zod request/response schemas, generated `openapi.json`. |

Each Worker has its own `wrangler.jsonc`, environments and secrets, so a
dashboard change cannot reveal API credentials or bypass permission checks —
the API independently checks the sign-in session (Sign in with Microsoft,
`apps/api/src/auth/`).

## Storage
- **D1** (managed SQLite): tenants, users, role assignments, tenant settings,
  tracker columns/options (taxonomy), submissions, intelligence items (with the
  published projection used for queries), item competitors, source-snapshot
  metadata, processing attempts, item revisions, review decisions, capture log,
  incidents, notifications, saved views, audit events. Schema:
  `apps/api/migrations/` (`0001_initial.sql`, `0002_manual_entry_free_tier.sql`).
- **Saved page copies** (`apps/api/src/pipeline/snapshots.ts`): sanitised
  snapshots, AES-256-GCM encrypted with `SNAPSHOT_ENCRYPTION_KEY`,
  content-addressed and never overwritten. Stored in the D1 table
  `snapshot_blobs` by default (≤ 600k-character chunks, keys `d1:<tenant>/<item>/<sha256>`),
  which needs no extra Cloudflare product on the Free plan; if an R2 bucket is
  bound as `SNAPSHOTS`, new copies go to R2 (`t/<tenant>/items/<item>/<sha256>.html`)
  and older ones stay readable. `source_snapshots` holds the storage key,
  fingerprints (sanitised + raw SHA-256), size, content type, final URL, capture
  method, retention status and access scope.
- **Queues**: `eradigm-ci-jobs-<env>` (3 deliveries, exponential backoff, 24 h
  retention on the Free plan) and a dead-letter queue that turns exhausted jobs
  into visible *Failed* items.

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
`published`; manual-entry drafts have no `llm_draft`). Per-field **provenance**
(`source` / `ai` / `analyst`) keeps source-derived, AI-suggested and
analyst-entered information distinguishable; in the prototype every value is
`analyst`.

## URL processing sequence
1. **Validate & normalise** (`checkAndNormaliseUrl`): HTTP/HTTPS only, no
   credentials, standard ports, tracking parameters and fragments removed,
   private/loopback/link-local/metadata/CGNAT/multicast/reserved/IPv6-special and
   internal hostnames blocked. Rejections are logged and never create an item.
2. **Idempotency and duplicates**: a repeated request (same `Idempotency-Key`,
   e.g. a double-click or network retry) resolves to one item. A genuine
   re-submission always creates a new item: only entries **already in the
   tracker (approved)** count as duplicates, matched on normalised URL key,
   file hash or content fingerprint and evaluated at read time. The item is
   still sent to the Inbox with a warning (`duplicateOf`); approval is refused
   with `DUPLICATE` unless the reviewer explicitly overrides it, and the
   override is audited. Failed, rejected and in-review copies never block.
3. **Create submission** → item **Queued**, processing attempt 1, job enqueued.
4. **Isolated retrieval** (capture worker): DNS-over-HTTPS resolution with every
   address checked, manual redirects (≤ 5) re-checked hop by hop, robots.txt,
   20 s load limit, 5 MB cap, `text/html` only, login-wall/paywall/bot-challenge
   detection (stop, never bypass — the analyst uploads a SingleFile save instead).
5. **Content scan, sanitisation and extraction before storage** — one pass with
   the Workers-native `HTMLRewriter` (fits the Free plan CPU budget): malware
   markers rejected; scripts, trackers, form controls, frames, common inline
   handlers and `javascript:` URLs stripped; a strict CSP `<meta>` added so the
   copy stays inert even when downloaded; headline, dates, outlet and body text
   extracted.
6. **Save copy** (D1 by default) + metadata; capture log records final URL + outcome.
7. **Content fingerprint** (skipped when almost no text was extracted) → used
   for the duplicate warning; it never fails the item.
8. **Data policy check** (`redaction.ts`) → quarantine on secrets, card
   numbers, confidentiality markings, etc.
9. **Draft pre-fill** (`prefill.ts`): **manual entry** in the prototype — the
   draft goes to **Needs review** with every field empty. (With pre-fill enabled:
   minimum text + taxonomy to the LLM, structured output, server-side validation.)
10. Analyst opens the saved page (inline, full-window in a new tab, or as a
    download), enters the fields and **approves** (server-side validation, new
    published revision), **rejects** or **re-captures** (new attempt that keeps
    the values already entered; stale job messages are ignored).

## Primary / Secondary streams and Phantoms
- **Two streams.** Input has a *Primary Source* and a *Secondary Source* (HTML
  upload only). Each item carries `stream`; it goes to that stream's Inbox and,
  once approved, to that stream's Tracker. `Source Tier` is set by the platform
  (`Primary` / `Reviewed-Secondary`) and cannot be edited.
- **Separate column sets.** `tracker_columns` / `column_options` are keyed by
  `(tenant, stream, …)`; each Inbox edits its own. Both start with the same 22
  columns. `in_tracker` marks the nine shown in the Tracker and Phantoms tables
  (the other fields feed the Markdown). Locked ("core") columns are the ones the
  Dashboard charts and the Markdown depend on: they can be renamed, not deleted.
- **Dashboard** reads both streams through one merged, read-only schema
  (`?stream=all`): union of options, Primary order first.
- **ID** is typed by the analyst, projected onto `intelligence_items.record_id`
  and unique among tracker entries of a tenant (checked at approval, backed by a
  partial unique index). **Review Date** defaults to the approval day.
- **Phantoms** is a view, not a copy: every approved Primary entry, plus
  approved Secondary entries whose Impact is at or above the admin setting
  `phantoms.secondaryMinImpact` (Administration → Workspace settings). Changing
  the setting or an entry's Impact updates Phantoms immediately.
- **Markdown** (`GET /api/signals/:id/markdown`, `?download=1` for a file named
  `<ID>.md`) is generated from the published field values only, with the
  approver as `QC.Reviewed_by`. The front matter is valid YAML (two-space
  indentation; values quoted only when YAML would misread them). See
  `packages/shared/src/markdown.ts`.

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
- **Inbox and Input do not exist for the client role** (the prototype showed the
  Inbox read-only). Clients see only Dashboard and Tracker; `/inbox`, `/input`
  and `/admin` redirect them to the Dashboard, and the API refuses the Inbox,
  submission and capture-log endpoints for clients (403).
- **Manual-entry prototype:** drafts arrive empty (no AI), so the Inbox shows
  *Awaiting analyst entry*, **View saved page / Open saved page in new tab /
  Download HTML**, and *Re-capture* instead of *Reprocess*. The AI views
  (evidence & confidence, model output) reappear automatically when pre-fill is
  enabled.
- **Reject / Reprocess / Retry / Delete** actions and Needs-review / Processing /
  Failed / Decided views were added to the Inbox (required by 4_Backend_Design).
- **Evidence & confidence** per field are shown on AI drafts (when pre-fill is
  enabled) so analysts can compare source with extracted fields.
- **Trend Test** panel added to the Dashboard (specified in 3_Frontend_Design,
  not in the prototype), plus **Saved views** and an **Administration** page.
- Amber text `#A55F12` was darkened to `#8A4E0D` to meet WCAG AA contrast on tinted
  backgrounds (found by the automated accessibility tests).
