# QC report (against 6_QC_&_Compliance)

Build date: 2026-09-28 (revised the same day for the **manual-entry prototype
on the Workers Free plan**: no AI API, empty drafts, client role without Inbox
or Input). Status key: ✅ verified in this build · 🟡 implemented, needs
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
| Unit: taxonomy, validation, permission rules, capture/sanitisation | ✅ 71 + 25 + 9 tests | `packages/shared/test`, `packages/capture/test` (now in the Workers runtime, because parsing uses `HTMLRewriter`), `packages/llm/test` |
| Integration: ingestion, retries, review-state transitions, snapshot store | ✅ 60 tests | `apps/api/test` in the Workers runtime (D1/queues). Covers manual entry (every field empty, **no outbound request**, re-capture keeps entered values, no AI "corrections"), the optional LLM path (mock adapter), D1 chunked/encrypted snapshots, R2 fallback, capture-worker CPU-limit failures |
| E2E: admin, analyst, client | ✅ 16 tests | `e2e/*.spec.ts` (Playwright, Chromium): analyst completes an empty draft from the saved page and approves; SingleFile upload → *Sent to the Inbox*; saved page opens full-window in a new tab; client has no Inbox/Input links, `/inbox`, `/input`, `/admin` redirect to the Dashboard and the API returns 403 |
| Accessibility checks | ✅ | axe WCAG 2.1 A/AA (serious/critical = fail) on Dashboard, Tracker, record drawer, Inbox, Input, saved-source viewer, Administration; phone-width layout checked (no horizontal scroll at 390 px). Manual screen-reader pass recommended. |
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
| Duplicate submissions handled idempotently | ✅ | Idempotency-Key: 5 concurrent identical requests → 1 item. Duplicates count only against the tracker (URL key, file hash, content fingerprint): warned at Input, refused at approval unless overridden, override audited; failed/rejected copies never block (`ingestion.test.ts`, `e2e/analyst.spec.ts`) |
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

## Workers Free plan
| Item | Status | Evidence |
|---|---|---|
| No paid-only configuration | ✅ | `limits.cpu_ms`, R2 (default), Containers, Logpush removed; queues created with 24 h retention; see [DEPLOYMENT.md § Workers Free plan](DEPLOYMENT.md#workers-free-plan) |
| Script size ≤ 3 MB compressed | ✅ | dry-run bundles: API ≈ 303 KB, capture ≈ 138 KB gzipped; web worker < 1 KB + static assets |
| CPU ≤ 10 ms per invocation | 🟡 | HTML parsing moved from a JavaScript DOM (100–400 ms/page) to one native `HTMLRewriter` pass with targeted handlers: ≈ 3 ms (150 KB page), ≈ 12 ms (560 KB), ≈ 44 ms (3.4 MB SingleFile) in the local runtime. Confirm on staging (Workers → Metrics → CPU time). Oversized pages fail with a clear `PROCESSING_LIMIT` message; Workers Paid removes the limit without changes |

## Transition to automatic pre-fill
| Item | Status | Evidence |
|---|---|---|
| Designed for a configuration-only switch | ✅ | Single seam `apps/api/src/pipeline/prefill.ts`; `LLM_PROVIDER` per environment; UI adapts via `/api/me` `features.prefill`; LLM path kept under test with the mock adapter |
| Next-step documentation | ✅ | [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md): approvals, labelled set from approved manual entries (`scripts/export-eval-set.mjs`), evaluation, cost estimate, staging → production, rollback, other providers |

## Not verifiable in this environment (action required)
1. **Live Claude API calls** — not used by the prototype; needed only before enabling pre-fill (no Eradigm API key available; see [CLAUDE-API.md](CLAUDE-API.md)).
2. **Sign in with Microsoft against the real Entra ID** — the full OpenID Connect flow is integration-tested against a fake Microsoft (token + key endpoints, test RSA key); confirm once on staging after [SIGN-IN-ENTRA.md](SIGN-IN-ENTRA.md).
3. **Remote Queues / rate limiting / Analytics Engine / D1 Time Travel** — configured and dry-run bundled; confirm on staging.
4. **Real-internet URL capture** — outbound DNS-over-HTTPS is blocked in the build sandbox; capture logic is tested with a simulated network (redirects, DNS rebinding, robots, login walls, limits).
5. **Production CPU time on the Workers Free plan** — measured locally only (see above).
