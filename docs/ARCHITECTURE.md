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
- **Two streams.** Input has one *Add a source* card with a Primary / Secondary
  switch (the same control as the spreadsheet import): an HTML upload, or a
  **manual entry** (`POST /api/submissions/manual`, `input_type = 'manual'`), a
  blank item that goes straight to Needs review for an analyst to fill in
  entirely (no capture, nothing to reprocess; the page can be attached later
  from the tracker). Each item carries `stream`; it goes to that stream's Inbox
  and, once approved, to that stream's Tracker. `Source Tier` is set by the
  platform (Secondary only: `Reviewed-Secondary`) and cannot be edited.
- **Separate column sets.** `tracker_columns` / `column_options` are keyed by
  `(tenant, stream, …)`; each stream edits its own. Locked ("core") columns are
  the ones the Dashboard charts and the Markdown depend on: they can be
  renamed, not deleted.
- **Three tables per stream** (Inbox → Edit columns): the **Inbox columns**
  (every field; `position` is the Inbox order), and the **Tracker** and
  **Phantoms** tables, each an ordered choice of Inbox columns
  (`in_tracker` + `tracker_position`, `in_phantoms` + `phantoms_position`,
  migration 0008). Names, types and dropdown options belong to the Inbox
  column, so all three tables share them. The Tracker columns drive the
  Tracker table, its exports and the Tracker/Dashboard filters; the Phantoms
  columns drive the Phantoms table and its exports (Phantoms keeps the Tracker
  filters). The Markdown layout is fixed and does not follow the Phantoms
  columns. A new Inbox column joins neither table until it is added there.
  Defaults: Tracker = Title, Event Date, Macrotrend, Subtrend, Growth
  Intensity, Impact, Source Type, Competitors, Action (both streams);
  Phantoms = the Markdown fields (`DEFAULT_PHANTOMS_KEYS`).
- **Phantoms Markdown** opens from the MD icon (or the title) as a full side
  pane showing the file, with Download at the top right.
- **Dashboard** reads both streams through one merged, read-only schema
  (`?stream=all`): union of options, Primary order first.
- **ID** is typed by the analyst, projected onto `intelligence_items.record_id`
  and unique among tracker entries of a tenant (checked at approval, backed by a
  partial unique index). **Review Date** defaults to the approval day.
- **Phantoms are an evergreen snapshot** (migration 0012, `phantom_snapshots`):
  each entry's values as first pushed to the Tracker (from either inbox, or
  an import). Editing the Tracker entry afterwards changes the Tracker,
  Dashboard and Megatrends only; the Phantoms table, its Markdown, alerts and
  newsletters keep the first version, and Phantoms have no Edit. Phantoms can
  still be deleted (Phantoms only, or globally). Dropdown option renames reach
  the snapshots (a label, not content). The Phantoms queries read the
  snapshot under the Tracker's column names (`itemsFrom` in `query.ts`).
- **Text ⇄ Long text** (contract 1.13): the column editor switches a Text
  column to Long text (a bigger box with bullet indenting) and back, via
  `PATCH /api/schema/columns/:key {type}`. Back to Text is refused while any
  entry has more than 2,000 characters in it. Migration 0013 makes an
  existing "Tell Me More" Text column Long text, like Header, Key Details and
  CI Perspective.
- **Eradigm Inbox and Client Inbox** (contract 1.12, migration 0012):
  - One Eradigm Inbox for Primary and Secondary entries (filter All /
    Secondary / Primary); each entry shows its own tracker's fields and a
    stream tag. Actions: **Reject**, **Send to Client**, **Push to Tracker**
    (the former Approve). Tabs: Needs review, With client, Processing,
    Failed, Pushed & Rejected.
  - **Delete All** (Pushed & Rejected view, staff; contract 1.13, migration
    0013; `POST /api/items/clear-decided {stream?}`) follows the "Show
    entries from" filter: rejected entries are deleted (`status = 'deleted'`);
    pushed entries only leave the Inbox (`inbox_cleared_at`) and stay in the
    Tracker and Phantoms. One audit entry (`inbox.cleared`) with the counts.
  - Send to Client sets `with_client_at` (the entry stays `needs_review`):
    it appears in the client's **Client Inbox** and is read-only for Eradigm
    until it comes back (Eradigm can also Recall it). The client can **Send
    to Eradigm** (back to Needs review, marked "Back from …") or **Push to
    Tracker** (validated like Push to Tracker; an incomplete entry or a
    duplicate is refused with "Send it to Eradigm to complete it").
  - Comments (`item_comments`): the client highlights text in any field (or
    the page text) and a "Comment" button appears (keyboard: each field's
    "＋ Comment"). A comment stores the field, the highlighted words and their
    position, so it is shown marked and numbered in the text and in a margin
    of comment cards, like Word. Back in the Eradigm Inbox the analyst sees
    "Client comments" (click one to jump to the words in the field) and
    resolves them; authors can delete their own.
- **Tabs by role** (`canSeeTab` in `packages/shared/src/megatrends.ts`):
  clients see Dashboard, Tracker, Phantoms, Megatrends and Client Inbox;
  analysts see Dashboard, Tracker, Phantoms, Megatrends and Eradigm Inbox;
  admins see every tab (including Deliverables, Input and Administration).
  Other pages redirect to the Dashboard; the API keeps its own permission
  checks. The Tracker, Phantoms, Input and import default to Secondary.
- **Bullets in long text** (`components/ListTextarea.tsx`): Tab makes a line a
  Markdown bullet and indents it a level each time ("  - "), Shift+Tab
  outdents, Enter continues the list (an empty bullet outdents, then ends it).
  Esc then Tab leaves the field. Used in the Eradigm Inbox and Tracker Edit.
- **Tracker Edit** shows the edit fields first and the text of the saved page
  underneath (no saved-page window while editing).
- **Phantoms** is a view, not a copy: every approved Primary entry, plus
  approved Secondary entries whose Impact is at or above the admin setting
  `phantoms.secondaryMinImpact` (Administration → Workspace settings; default
  Low, i.e. every Secondary entry — migration 0009 moved tenants from the old
  Medium default). Changing the setting or an entry's Impact updates Phantoms
  immediately.
- **Deliverables** (tab; central Alerts / Newsletter switch) are built from
  Phantoms and use the Phantoms table (columns, Markdown, saved page, filters).
  - *Alerts* (`GET /api/deliverables/alerts`): Phantoms of either stream with
    the highest Impact (High). Each gets a stored `.docx` alert
    (`deliverables` table, `kind = 'alert'`, one per entry) the first time it
    is listed, regenerated when the entry is revised (`source_rev`). At most
    25 per page (Workers Free plan query limit).
  - *Newsletter* (`GET /api/deliverables/newsletter`): Phantoms with the two
    highest Impacts (High, Medium). Analysts and admins tick entries (kept
    across pages and both streams), name the newsletter and create it
    (`POST /api/newsletters`); `GET /api/newsletters` lists them (name, the
    Phantoms used) above the entries.
  - The `.docx` (`GET /api/deliverables/:id/docx`, `?download=1` for a file)
    opens in a side pane rendered in the browser (`docx-preview`, loaded on
    first use). Content is a placeholder until the AI writer is connected: the
    entry's Title (alert) or the newsletter's name, bold 32 pt
    (`packages/shared/src/docx.ts`, `titleDocx`). Stored as base64 text in D1
    (no R2 needed).
- **Megatrends** (tab, all roles; `GET /api/megatrends?stream=all|primary|secondary&from&to`)
  is a 3D knowledge graph of the Tracker entries (same rows as the Tracker:
  approved, not deleted from the Tracker) with a timeline below.
  - The graph fills the page from the top down to the timeline, with the
    breadcrumbs over its top-left corner. A column over its right edge
    (`.mg-side`, 480px) holds the summary of the trend in view (a box a shade
    lighter than the page, about three quarters of the height, summary text
    21px) and the minimisable Macrotrend list (the last quarter). The
    camera's view offset centres the graph in the space beside that column.
  - Macrotrend spheres around a central core, sized by their number of
    entries (only those with 1 or more); selecting one reveals its Subtrends
    (also 1 or more), selecting a Subtrend its entries. Zooming in on a node
    shows its summary. Built with three.js / `3d-force-graph`, loaded only
    on this page; without WebGL the list, summaries and timeline still work.
  - Colours: a fixed 8-hue categorical palette validated on the dark surface,
    assigned in taxonomy order (colour follows the entity; "Others" and any
    9th value are neutral grey); names are always shown next to colours.
  - Timeline: one lollipop per entry at its Event Date, same-day entries
    stacked on one skewer; coloured by Macrotrend, or by Subtrend once a
    Macrotrend is selected; filtered by the selection. Clicking an entry
    slides its Tracker row (the entry's Tracker columns, from
    `GET /api/signals/:id`) up from the bottom; the timeline stays in view.
    Scroll (or + / −) zooms in on the dates under the pointer, drag moves
    across them, Reset shows all dates; the bar at the top resizes it (drag,
    or ↑ ↓) and Minimise hides it. Size and minimised state are kept per
    browser.
  - The summary of the trend in view is a band at the top of the page, in
    large type, above the graph. There is no page header or filter bar: the
    page shows both trackers and all dates. The Macrotrend list can be
    minimised. The timeline can be coloured by Macrotrend / Subtrend or by
    Impact (its legend then filters by Impact), and its lollipops grow with
    its height.
  - Summaries (`trend_summaries`, migration 0010) are keyed by name and shared
    by both trackers. Defaults ship in `packages/shared/src/megatrends.ts`; a
    stored row overrides them: written by hand (`PUT /api/megatrends/summaries`,
    analysts and admins; empty text = back to the default) or by the AI writer
    (`POST /api/megatrends/summaries/generate`, 409 until `LLM_PROVIDER` is
    set). The AI writer reads the trend's entries of the last
    `megatrends.summaryDays` days (at most 40), and writes at most
    `megatrends.summarySentences` sentences for `megatrends.perspective`
    with `megatrends.model` (Administration → Workspace settings →
    Megatrends · AI summaries). Renaming a Macrotrend / Subtrend keeps its
    summary.
- **Tab order** (`navOrder` in tenant settings; Administration → Tabs, admins)
  sets the order of the menu for everyone in a workspace; roles still only see
  the tabs they may use.
- **Markdown** (`GET /api/signals/:id/markdown`, `?download=1` for a file named
  `<ID>.md`) is generated from the published field values only. The front
  matter is valid YAML (two-space indentation; values quoted only when YAML
  would misread them). See `packages/shared/src/markdown.ts`.
  - *Secondary*: id, title, event_date, source_type, Source (Publisher, URL,
    Raw_ref), Source_tier, Competitors, Other_entities, Therapeutic_area,
    Assets, Products, QC (Reviewed_by = approver, Review_date,
    Accurate_as_of); sections Header, Key Details, CI Perspective. If the
    Secondary Inbox has a column labelled "Tell Me More" (any case), its text
    is printed under Key Details as part of that section, with no heading of
    its own (`tellMeMoreKey`).
  - *Primary*: id, title, event_date, Source (Role, Company, Location,
    Confidence, Therapeutic_area, Brand_or_asset), Action, Workstream,
    Insight_topic; sections Key Intelligence Question, Key Details, Key
    Metrics. The Tracker/Dashboard classification (Macrotrend, Subtrend,
    Growth Intensity, Impact, Source Type, Competitors) is not included.
- **Column sets differ by stream.** Primary: ID, Title, Event Date, Source
  Role/Company/Location/Confidence, Macrotrend, Subtrend, Growth Intensity,
  Impact, Source Type, Competitors, Action, Workstream, Source Therapeutic
  Area, Source Brand or Asset, Insight Topic, Key Intelligence Question, Key
  Details, Key Metrics. Both streams share the nine Tracker/Dashboard columns
  (same keys and options).
- **Spreadsheet import** (Input → Import spreadsheet): the browser reads the
  first sheet of an .xlsx, or a .csv/.tsv (`packages/shared/src/sheet.ts`),
  matches the header row to the chosen tracker's column labels and sends the
  rows to `POST /api/import?stream=…`: first a dry run over every row (same
  checks as an approval, unique IDs), then batches of 8 rows (the Workers Free
  plan allows 50 database queries per request). Rows are published straight
  to the Tracker, and so to Phantoms under the usual rules, with no saved page.
- **Attaching a saved page later**: the Source column of the Tracker/Phantoms
  table opens the saved page as a side pane (the whole pane is the sandboxed
  page, `?saved=<id>`), or shows a green plus that uploads the HTML
  (`POST /api/items/:id/snapshot`, scanned and sanitised in the capture worker
  like any upload). Rows no longer open on click; the title opens the record
  (Tracker) or the Markdown (Phantoms).
- **Several saved pages per entry** (migration 0011, up to 10): the first page
  stays `intelligence_items.current_snapshot_id`; pages attached after it are
  `source_snapshots` rows with `extra = 1` and their `file_name`. Each row
  carries `pages`; with more than one, the page icon shows the count and opens
  a list (`GET /api/items/:id/snapshots`) to pick from, plus "Attach another
  HTML page" for analysts and admins (also in the saved-page pane, which has a
  page picker). A page opens with `GET /api/items/:id/snapshot?page=<id>`
  (default: the first page). The same file twice is refused.
- **Default dates: everything in view.** Dashboard, Tracker, Phantoms and
  Deliverables default to "Date from" = the oldest entry's Event Date and
  "Date to" = today, or the newest entry if later (`GET /api/tracker/bounds`;
  requests without dates use the same defaults). The "outside these dates"
  hint only appears when someone narrows the dates.
- **Display all** (Tracker, Phantoms, Deliverables tables): `?all=1` asks for up
  to 1,000 rows on one page (`pageSize`), shown as one table that scrolls inside
  its card with the header kept in view. Alerts on a long page are written 25
  per request (free-plan query limit); the page fetches again until all exist.
- **Editing approved entries**: analysts and admins get an Edit (pencil)
  column in the Tracker, Phantoms and Deliverables tables, and ✎ Edit in the
  record drawer and the Markdown pane. The form has every Inbox field and ends
  in **Approve** (`POST /api/signals/:id/revise`, note optional): the values are
  validated like an approval (required fields, options, dates, unique ID),
  published as a new revision (`item_revisions`, projection updated), and
  re-stamped as approved by the editor now (QC Reviewed_by) with Review Date set
  to today unless the editor changed it. Everything downstream follows the new
  revision: Tracker, Dashboard, Phantoms membership (Impact), the Markdown
  (generated from the published values), and the alert `.docx` (regenerated
  when its `source_rev` differs). Newsletters already created keep their file.
- **Deleting entries**: admins and analysts get a tick-box column in the
  Tracker and Phantoms tables (and *Delete* in the record drawer). The
  confirmation offers *Delete Tracker Entry* / *Delete Phantom Entry* (that
  table only) or *Delete Globally*, sent as `DELETE /api/items/:id` with
  `from: "tracker" | "phantoms" | "global"`, one request per entry, audited.
  - From the Tracker: sets `tracker_hidden_at`; the entry leaves the Tracker,
    Dashboard, Trend Test and Tracker exports, and stays in Phantoms.
  - From Phantoms: sets `phantoms_hidden_at`; it leaves Phantoms and Phantoms
    exports, and stays in the Tracker and on the Dashboard.
  - Globally (the default): the soft delete (`status = 'deleted'`).
  An entry that would be left in neither table (already removed from the
  other, or a Secondary entry below the Phantoms Impact threshold) is deleted
  globally. Removed-from-one-table entries still hold their ID.

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
