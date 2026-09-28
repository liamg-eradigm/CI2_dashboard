# Operations

## Environments
| | dev | staging | production |
|---|---|---|---|
| Where | local (`npm run dev`) | Cloudflare | Cloudflare |
| Sign-in | dev header (refused elsewhere — fails closed) | Cloudflare Access | Cloudflare Access |
| Draft pre-fill | manual entry (`LLM_PROVIDER=none`) | manual entry | manual entry — see [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md) |
| Plan | — | Workers Free | Workers Free |
| Data | synthetic seed | synthetic seed or test tenants | real |
| Deploy | — | every push to `main` | manual, approved |

## Logs, metrics, traces, alerts
- **Structured JSON logs** from all Workers (`apps/api/src/lib/log.ts`,
  `apps/capture/src/index.ts`): request id, route, status, latency, tenant and user
  ids, job events (`job_retry`, `job_failed`, `job_skipped`), capture outcomes.
  Article text, model input/output and analyst edits are never logged.
  View in Workers → Logs (observability is enabled in every `wrangler.jsonc`;
  the Free plan keeps a limited daily volume and short retention — Logpush export
  needs Workers Paid).
- **Traces**: Workers Observability records invocations and subrequests
  (D1, Queues, service bindings). Watch **CPU time** per invocation on the
  capture and API workers (Free plan limit 10 ms; see DEPLOYMENT.md § Workers Free plan). Enable tracing in the
  dashboard for the API worker if not on by default for your account.
- **Metrics** (Workers Analytics Engine dataset `eradigm_ci_metrics_<env>`):
  `request_ms`, `item_routed` (manual-entry drafts), `item_approved`,
  `item_failed` (by code), `item_quarantined` (by category), and
  `item_classified` / `llm_latency_ms` once pre-fill is enabled. Query with the
  Analytics Engine SQL API or Grafana.
- **Alerts**:
  - Application alerts go to `ALERT_WEBHOOK_URL` (Slack/Teams incoming webhook):
    quarantines, items stuck in processing, and (once pre-fill is enabled)
    Claude API auth/permission failures. Admins also see them under Administration.
  - Configure Cloudflare Notifications for: Workers error rate / exceeded CPU,
    Queue backlog and DLQ activity, D1 storage, Access login anomalies.
  - Suggested thresholds: 5xx > 2 % for 5 min; `item_failed` > 10/h (code
    `PROCESSING_LIMIT` = pages too large for the Free plan CPU limit); any
    `item_quarantined`; DLQ messages > 0; dashboard p95 > 1 s.
- **Health**: `GET /api/health` (no auth; checks D1). Configure an Access bypass
  policy for `/api/health` if an external uptime monitor needs it.

## Backups and restore
- **D1 Time Travel** gives point-in-time recovery for the last 7 days on the
  Workers Free plan (30 days on Workers Paid). It covers the saved page copies too,
  because they are stored in D1 (`snapshot_blobs`):
  ```bash
  npx wrangler d1 time-travel info DB --env production -c apps/api/wrangler.jsonc
  npx wrangler d1 time-travel restore DB --env production -c apps/api/wrangler.jsonc --timestamp 2026-09-28T10:00:00Z
  ```
- **Nightly encrypted exports**: `.github/workflows/backup.yml` runs
  `scripts/backup-d1.sh production`, encrypts with `BACKUP_PASSPHRASE` (GPG AES-256)
  and keeps 30 days of artifacts. Copy to long-term storage if longer retention is required.
- **Saved page copies** live in D1 by default, so the nightly export above backs
  them up with everything else (if you enabled R2, back that bucket up with a
  scheduled `rclone sync` to a second bucket). Snapshots are encrypted, so also
  back up `SNAPSHOT_ENCRYPTION_KEY`. Note: the export grows with the saved pages;
  lower the snapshot retention (Administration) if it gets large.
- **Verified restore drill**: `bash scripts/verify-restore.sh` exports a
  database, restores it into an empty one and compares row counts and the audit
  chain head (last run: *RESTORE VERIFIED*). To drill against production data,
  restore an export into a scratch D1 database:
  ```bash
  npx wrangler d1 create eradigm-ci-restore-drill
  npx wrangler d1 execute eradigm-ci-restore-drill --remote --file backups/<export>.sql
  ```
  then call `/api/audit/verify` against a staging API pointed at it, or compare counts.

## Rollback
- **Code**: every deploy is a Worker version.
  ```bash
  npx wrangler deployments list -c apps/api/wrangler.jsonc --env production
  npx wrangler rollback <version-id> -c apps/api/wrangler.jsonc --env production
  ```
  Roll back web, API and capture independently (same commands with their
  configs). The web and API stay compatible within a contract major version.
- **Schema**: migrations are forward-only and additive by policy (add columns /
  tables; never drop or rename in the same release as code that stops using
  them). To undo a bad migration: roll back the Worker, then either apply a new
  corrective migration or use D1 Time Travel to restore to just before it
  (note: this also discards data written since).
- **Taxonomy mistakes** (renamed/deleted options) are ordinary data changes and
  are recorded in the audit log; rename back in the Inbox column editor.

## Retention and deletion (daily cron, `apps/api/src/services/retention.ts`)
| Data | Rule (tenant-configurable under Administration) |
|---|---|
| Source snapshots | deleted from the snapshot store (D1, or R2 if enabled) after `snapshotDays` (default 730); metadata kept, marked *expired* |
| Rejected / failed items | stored copy + extracted text purged after `rejectedDays` (default 90) |
| Deleted items | all stored content purged after `deletedDays` (default 30) |
| Quarantined items | snapshot + extracted text deleted **immediately**; only category + time retained |
| Audit events | append-only, retained indefinitely (export for archival) |
| Items stuck in processing > 30 min | marked *Failed* (retryable) + alert |

In the manual-entry prototype nothing is sent to any AI provider. If pre-fill is
enabled later, deleting data here does not delete anything held by the LLM
provider; see [CLAUDE-API.md](CLAUDE-API.md).

## Performance
`npm run test:load` (see script header) exercises `/api/dashboard` and
`/api/tracker` with random filter combinations. Budget: p95 ≤ 800 ms, errors ≤ 1 %.
Local simulator result: dashboard p95 ≈ 480 ms, tracker p95 ≈ 530 ms at 58 req/s,
0 errors (single-process miniflare; production is expected to be faster).
Re-run against staging after large data growth.

## Incident response (data policy)
1. Quarantine notification arrives (in-app + webhook): category only.
2. Admin checks Administration → incidents; the item is already stopped and its
   copy deleted. Decide whether the source should be re-submitted with redactions
   or not at all; mark the incident resolved (audited).
3. If a secret was involved, rotate it at its source.
