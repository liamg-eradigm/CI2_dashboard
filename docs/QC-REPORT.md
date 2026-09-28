# QC report (against 6_QC_&_Compliance)

Build date: 2026-09-28. Status key: ✅ verified in this build · 🟡 implemented, needs
verification on the deployed Cloudflare environment / with Eradigm credentials ·
⏭ skipped (as permitted by the brief).

## Environments, migrations, test data, rollback
| Item | Status | Evidence |
|---|---|---|
| Separate dev, staging, production | ✅ config / 🟡 cloud | `env.dev/staging/production` in every `wrangler.jsonc`; staging/prod resources need `scripts/provision.sh` |
| Automated schema migrations | ✅ | `apps/api/migrations/`; applied by `deploy.yml` / Workers Builds before each API deploy; applied in tests via `applyD1Migrations` |
| Seeded non-confidential test data | ✅ | `apps/api/seed/` (synthetic, relative dates); used by dev and E2E |
| Documented rollback procedure | ✅ | [OPERATIONS.md § Rollback](OPERATIONS.md#rollback) |

## Tests
| Item | Status | Evidence |
|---|---|---|
| Unit: taxonomy, validation, permission rules | ✅ 71 + 14 + 9 tests | `packages/shared/test`, `packages/capture/test`, `packages/llm/test` |
| Integration: ingestion, retries, review-state transitions | ✅ 54 tests | `apps/api/test` in the Workers runtime (D1/R2/queues) |
| E2E: admin, analyst, client | ✅ 15 tests | `e2e/*.spec.ts` (Playwright, Chromium) |
| Accessibility checks | ✅ | axe WCAG 2.1 A/AA (serious/critical = fail) on Dashboard, Tracker, record drawer, Inbox, Input, Administration; phone-width layout checked (no horizontal scroll at 390 px). Manual screen-reader pass recommended. |
| Dashboard-query load tests | ✅ local / 🟡 staging | `scripts/load-test.mjs`: 20 concurrent, 0 errors, dashboard p95 ≈ 480 ms, tracker p95 ≈ 530 ms on the local simulator. Re-run against staging. |
| Dependency scanning | ✅ | `npm audit`: 0 vulnerabilities (prod + dev); Dependabot + CodeQL configured. The only high finding encountered (`@cloudflare/puppeteer` → `extract-zip`, no fix) was removed by design. |
| Secret scanning | ✅ | `npm run scan:secrets` passes; gitleaks runs in CI on full history. |

## Observability and resilience
| Item | Status | Evidence |
|---|---|---|
| Structured logs, metrics, traces, alerts | ✅ code / 🟡 cloud | JSON logs, Analytics Engine metrics, Workers Observability, webhook + in-app alerts — [OPERATIONS.md](OPERATIONS.md). Cloudflare Notifications must be configured in the account. |
| Verified backup and restore | ✅ local drill / 🟡 remote | `scripts/verify-restore.sh` → *RESTORE VERIFIED* (row counts + audit head match). Remote: D1 Time Travel + nightly encrypted export workflow; run one remote drill after first deploy. |

## Completion criteria
| Criterion | Status | Evidence |
|---|---|---|
| Unauthorized cross-tenant access blocked | ✅ | `security.test.ts › tenant isolation` (reads, writes, lists, aggregates, exports, tenant switching) + E2E |
| Duplicate submissions handled idempotently | ✅ | URL key, Idempotency-Key, file hash, content fingerprint; 5 concurrent identical submissions → 1 item (`ingestion.test.ts`) |
| Failed jobs retried safely | ✅ | transient failure → retry → Failed → Retry → Needs review; stale message replay is a no-op; one revision, one snapshot |
| Every published item has provenance + audit trail | ✅ | per-field provenance, attempt versions/model, published revision, `item.approved` audit event (tested); seeded items also carry audit events |
| Dashboard totals reconcile with filtered tracker records | ✅ | `dashboard.test.ts` over 8 filter combinations (KPIs, timeline, bars, competitor counts) + E2E |

## Evaluation against labelled examples
⏭ **Skipped — no human-labelled dataset was available.** The harness is ready:
`npm run eval -- eval/<labelled>.jsonl` with `LLM_PROVIDER=anthropic` measures
required-field completion, category accuracy per field, evidence support,
duplicate handling and correction rate, and writes a JSON report. The same
correction-rate / completion / evidence metrics are computed continuously from
real review decisions (Administration → Extraction quality, `/api/metrics/quality`).
Re-run after any change to the prompt (`PROMPT_VERSION`), taxonomy or model.

## Rule: every AI response checked and analyst-approved before publication
✅ Taxonomy enforcement + data-rule validation after every model response;
drafts can only become *Approved* via the approve endpoint (validated again
server-side); no code path publishes automatically (tested: new drafts never
appear in the tracker).

## Not verifiable in this environment (action required)
1. **Live Claude API calls** — no Eradigm API key; see [CLAUDE-API.md](CLAUDE-API.md) (organisational permission flag).
2. **Cloudflare Access JWT verification against a real Access application** — logic unit-covered; confirm on staging.
3. **Remote Queues / rate limiting / Analytics Engine / D1 Time Travel** — configured and dry-run bundled; confirm on staging.
4. **Real-internet URL capture** — outbound DNS-over-HTTPS is blocked in the build sandbox; capture logic is tested with a simulated network (redirects, DNS rebinding, robots, login walls, limits).
5. **Container capture service** — Dockerfile and server written; not built here (no Docker).
