# Security, tenancy and compliance

| Requirement (6_QC_&_Compliance / 2_Input_Architecture) | Implementation |
|---|---|
| Trusted sign-in, no passwords stored | **Sign in with Microsoft** (Entra ID, any organisation's work account; personal accounts refused): OpenID Connect authorization-code flow with PKCE, `state` and `nonce`; the ID token's RS256 signature (Microsoft JWKS), audience, issuer (per-tenant), expiry and nonce are verified — `apps/api/src/auth/entra.ts`. Optional organisation allow-list (`ENTRA_ALLOWED_TENANTS`). `users` has no credential columns. Setup: [SIGN-IN-ENTRA.md](SIGN-IN-ENTRA.md). |
| Account linking cannot be spoofed across organisations | Accounts are linked only by accepting a one-time invite link (SHA-256-hashed, 7 days, single use, revocable) and afterwards matched on the immutable Microsoft (tenant id, object id) pair — never on the email claim, which each organisation's admins control (tested: same email from another organisation is refused). |
| Role **and** tenant checked on every request and lookup | `resolvePrincipal` + `requirePermission` on every route; every query binds `tenant_id` from the verified principal; cross-tenant ids return 404. Tests: `apps/api/test/security.test.ts`. |
| UI is not a security control | Hidden controls are backed by 403s server-side (tests cover clients calling every staff endpoint). Clients have no Inbox or Input pages at all: the navigation omits them and the routes redirect to the Dashboard (E2E-tested, including direct API calls returning 403). |
| Secure sessions / end active sessions | Server-side sessions: random 256-bit token in an HttpOnly, Secure, SameSite=Lax `__Host-` cookie, only its SHA-256 hash in D1; 8 h idle / 24 h absolute limits; sign-out also signs out at Microsoft. *End sessions* and deactivation delete the user's sessions immediately. State-changing requests require the `X-ECI-Request` header (CSRF protection). |
| Limits on repeated requests and login attempts | Workers rate limiting: 20 sign-in attempts/min per IP, 300 req/min per user, 30 submissions/min per user; password guessing, lockouts and MFA are enforced by each user's Microsoft organisation. |
| Account recovery | Password/MFA recovery by the user's Microsoft organisation; if the Microsoft account itself changes, an admin issues a **New sign-in link** (re-links the account and ends the old identity's sessions). Break-glass: `scripts/create-invite.ts`. |
| Admin-controlled deactivation | Admin-only; deactivation also ends sessions. At least one active admin is always kept. |
| Analysts create analyst/client accounts only in their tenant; only admins create admins or change roles | `canCreateUserWithRole`, `canChangeRole` (`packages/shared/src/permissions.ts`), enforced in `apps/api/src/services/users.ts`. Role changes keep history. |
| Tamper-resistant audit record | Per-tenant HMAC hash chain, unique `(chain, prev_hash)` keeps it linear, triggers block UPDATE/DELETE, `/api/audit/verify` detects edits even if triggers are dropped (tested). Covers sign-ins, account/role changes, submissions, classifications, edits, approvals, rejections, exports, deletions, schema/settings changes, retention purges. |
| Encryption in transit and at rest | TLS everywhere (Cloudflare); D1 (and R2 if enabled) encrypted at rest by Cloudflare; saved pages additionally AES-256-GCM encrypted with an application key; HSTS on the dashboard. |
| No tenant can view or change another tenant's data | Tenant id from the principal only; unique indexes and queries scoped per tenant; exports and aggregates scoped. |
| HTTP/HTTPS only; normalise & validate | `packages/shared/src/url.ts` (unit-tested). |
| Block private/loopback/link-local/metadata/restricted destinations | Hostname + IP-literal checks, DoH resolution of every hostname and redirect hop (`packages/capture`). Residual risk: the Worker's own fetch re-resolves DNS (TOCTOU); Cloudflare Workers cannot reach private networks. |
| Limit redirects, size, time, content types | 5 redirects, 5 MB, 20 s load / 30 s job, `text/html` only. |
| Scan content before storage | Malware markers rejected; active content (scripts, frames, form controls, common inline handlers, `javascript:` URLs) stripped before the copy is stored; a strict CSP `<meta>` (`default-src 'none'`) is embedded so a downloaded copy is inert too; the in-app viewer is a sandboxed, script-less iframe and the snapshot endpoint sends a sandbox CSP. Downloads are audited (`snapshot.downloaded`). |
| Isolate capture; record final URL + outcome | Separate capture Worker with no bindings; capture log for every submission (including rejections). |
| Respect access restrictions | robots.txt (RFC 9309), 401/402/403/451, login walls, paywalls and bot challenges stop the capture; never bypassed. |
| Minimum content to the LLM; schema-constrained output; no new taxonomy values; nothing auto-published | **Prototype: no LLM or other external service is called** (`LLM_PROVIDER = none`, tested: no outbound request during processing). When enabled: see [CLAUDE-API.md](CLAUDE-API.md). |
| Treat all inputs/outputs as confidential; classification & redaction before external transmission | `packages/shared/src/redaction.ts`; tenant-configurable markers. The data-policy check runs on every capture; redaction applies to anything sent to an AI service once pre-fill is enabled. |
| Quarantine on policy violation; non-sensitive incident record; notify admin; retention procedure | `apps/api/src/pipeline/process.ts` (`quarantine`), `incidents` table (category + time only), notifications + webhook, immediate deletion of stored copies. |
| Do not claim third-party deletion | Documented; UI and API never claim provider-side deletion. |
| Failed jobs retried safely without duplicates | Attempt-numbered jobs, conditional state updates, operation tokens, unique indexes (tests: `ingestion.test.ts`). |
| Clear failure messages and recovery options | Failed items show the reason, Retry/Delete actions, Input page pipeline shows the failing step. |
| Dashboard/API security headers | CSP (no inline scripts, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, Permissions-Policy (`apps/web/public/_headers`); API `Cache-Control: no-store`. |
| Spreadsheet formula injection in exports | Cells starting with `= + - @` are neutralised in CSV/TSV. |
| Prompt injection from article text | Not applicable in the prototype (no LLM). When enabled: article is delimited and treated as data in the system prompt; section tags in untrusted text are stripped; output is enum-constrained and re-validated server-side; a human approves everything. |
| Dependency & secret scanning | `npm audit` (0 known vulnerabilities at build time), Dependabot, CodeQL, `scripts/scan-secrets.mjs`, gitleaks in CI. |

## Accessibility (5_UX_&_Data_Visualisation)
Colour is never the only signal (impact = colour + shape + label; status = glyph +
text; action ✓/○ + text; pass/fail = icon + text). Keyboard access for navigation,
tables (row/title buttons, sortable headers with `aria-sort`), filters, dialogs
(focus trap, Esc, focus return), chart points (focusable buttons with full
descriptions) and schema editing. Visible focus ring, skip link, landmarks, logical
headings, labelled controls, `aria-live` status/toasts, errors announced with
`role="alert"`, responsive layouts down to phone width. Automated axe checks
(WCAG 2.1 A/AA, serious/critical) run in the E2E suite for every page and role.
Manual screen-reader testing (NVDA/VoiceOver) is recommended before release.
