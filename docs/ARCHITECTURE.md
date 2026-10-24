# Architecture

## Applications and boundaries (4_Backend_Design)

| Concern | Where | Notes |
|---|---|---|
| Pages, reusable UI, filters, tables, charts, role-appropriate navigation | `apps/web` (React SPA + Worker) | Never connects to D1/storage/LLM. Only `@eradigm/shared` may be imported (ESLint rule). |
| Sign-in verification, permissions, submissions, extraction, AI analysis, data checks, storage, audit, admin | `apps/api` (Worker) | Every request re-checks role **and** tenant. |
| Page retrieval & parsing of untrusted HTML | `apps/capture` (Worker) | No D1, storage, queue or application secrets. Reached only through the API's service binding. |
| Draft pre-fill | `apps/api/src/pipeline/prefill.ts` | The one decision point: `LLM_PROVIDER = "none"` (prototype) → empty draft; otherwise the LLM adapter. See [ENABLING-AUTOFILL.md](ENABLING-AUTOFILL.md). |
| LLM calls (off in the prototype) | `packages/llm` | Only package allowed to import a model SDK (ESLint). Swappable via `LLM_PROVIDER`. |
| Shared, versioned definitions | `packages/shared` | `CONTRACT_VERSION` (sent as `X-Contract-Version`; the dashboard warns on a major mismatch, and when the API is older than the dashboard), zod request/response schemas, generated `openapi.json`. |

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
   **Secondary entries only** (request 27): a Primary entry from the same
   source is an update, not a duplicate (see *Primary sources* below).
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
- **Three tables per stream** (Inbox → Edit columns; the Primary / Secondary
  switch is shown before the editor opens and follows the Inbox's Primary /
  Secondary view, request 31): the **Inbox columns**
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
  - The graph fills the page from the top down to the timeline. A column over
    its left edge (`.mg-side`, 460px) holds the breadcrumbs, the summary of
    the trend in view (a box a shade lighter than the page, summary text
    20px) and the minimisable Macrotrend list; the bar between them drags (or
    takes ↑/↓) to share the height, remembered per browser and tab
    (`eradigm.<tab>.split`, default 72% summary). The camera's view offset
    centres the graph in the space beside that column and, while the drawer
    is open, left of the drawer (the view glides there as it opens). A hub
    opened from a link is held in place once it has a position, so the
    layout settles around it rather than carrying it off camera.
  - Hubs (Macrotrends, Subtrends, competitors) are translucent spheres holding
    one dot per entry, coloured by Impact, for a sense of the impact mix. The
    selected hub's entries orbit it, spread out (link distance 26 + 1.9 r),
    also coloured by Impact; those are the clickable ones.
  - The drawer from the right (`EntrySheet`, 400px wide, full height):
    - Sources (request 26): selecting a Subtrend or a competitor (not a
      Macrotrend) lists its entries, High → Medium → Low → others/none,
      newest first within each (`bySourceOrder`). Each row is the Impact dot
      (its name read out to screen readers) then as much of the title as
      fits, wrapping; the list scrolls inside the drawer. ✕ or Esc hides it
      for that selection; "☰ Sources" at the window's right edge brings it
      back.
    - Entry: opening one (from the list, the orbit or the timeline) shows its
      Tracker row in the same drawer, with its saved page (or each of its
      pages) in a popup window (`/source/:id`). ← (or Esc) goes back to the
      list at the same scroll position, focusing the row just read; ‹ › step
      through the list when the entry is in it, else along the timeline; ✕
      closes the drawer.
- **Competitors** (tab, all roles, after Megatrends; contract 1.14;
  `GET /api/competitors?stream=all|primary|secondary`) is the Megatrends view
  for competitors: the same frame (`GraphShell`), graph (`Graph3D`, layout
  "competitors"), summary panel, timeline and drawer.
  - One sphere per competitor named by a Tracker entry; radius grows
    exponentially with its entries relative to the most-named competitor
    (`competitorRadius`), so those named once or twice stay very small (and
    unlabelled; the name shows on hover). "N/A" and similar placeholders
    (None, Not applicable, Not specified, -, #N/A, TBC, Unknown, also with a
    bracketed note such as "N/A (none named)": `isPlaceholderCompetitor`) are
    not competitors: no node or tie, and an entry naming only those is left
    out of the tab. The page filters them again on its side, so an older API
    deploy cannot bring an N/A sphere back. Competitors are spread evenly
    around the orbit (`spreadSlots`: places on a Fibonacci sphere; the
    biggest takes the first, each next-biggest the free place farthest from
    those taken), so the large ones never bunch together. Pairs named by the
    same entries are tied, but the tie is only drawn (for the open
    competitor); it does not move them.
  - Summaries: 73 defaults ship in `packages/shared/src/competitors.ts`,
    matched to names in entries by a normalised key, aliases (BMS, J&J,
    Lilly, Novo, GSK, MSD…) and corporate suffixes. Stored summaries use the
    `competitor` level of `trend_summaries` (migration 0014 rebuilds the
    table to allow it); analysts edit them in place. The AI writer (once the
    Claude API is connected) reads the competitor's highest-scoring entries:
    Impact (High 3, Medium 2, Low 1) × a recency factor that halves every
    `summaryDays` days but never drops below 0.35, so an older High-impact
    entry still outranks a recent Low one; it gets each entry's impact, key
    details and CI perspective.
  - The timeline shows the selected competitor's entries (or all entries
    naming one), coloured by Impact or by Macrotrend; the list has a search
    box (there can be over 100 competitors).
- **Automatic IDs** (contract 1.15): the ID is no longer a field in the Inbox.
  It is filled in on every draft save and Push to Tracker as
  `Date_Competitor_Title` (Secondary) or `Date_Competitor_Key Intelligence
  Question` (Primary; the Title until a question is entered), competitors
  joined with " & ", the last part cut to 120 characters. An ID already used
  by a Tracker entry gets `_2`, `_3`… (`freeRecordIds`, a substr prefix match:
  D1 limits LIKE patterns to 50 characters). Imports fill a blank ID the same
  way; IDs typed in a spreadsheet are kept. Tracker edits keep the stored ID.
- **Primary entries: one Tracker entry per Key Intelligence Question**
  (contract 1.15, migration 0015). In the Inbox, a Primary entry's Insight
  Topic, Key Intelligence Question, Key Details and Key Metrics are entered
  as a list (`KiqEditor`): topics, each with questions, each with details and
  metrics; add or remove either. It is saved as `kiq_json` with the draft (the
  first question also fills the entry's own four fields). Push to Tracker
  with several questions calls `POST /api/items/:id/split`: the entry keeps
  the first question and new Inbox entries (`split_from`, consecutive codes)
  take the others, sharing every other field, the text and the saved page;
  URL/file/text fingerprints stay with the original, so the new ones are not
  duplicates of it. The page then pushes each (a request each, within the
  free-tier query limit). The Client Inbox shows the list (comments anchor to
  `_kiq.<topic>.<question>.<part>`) and pushes the same way.
- **Competitor tiers** (contract 1.15): an admin setting (Administration →
  Competitor tiers; `competitorTiers` with Tier 1–3 lists, one name per line;
  anyone else is Tier 4). Names match by `companyKey` (aliases, "&"/"and",
  corporate suffixes). On the Competitors tab, Tier 1 is red, Tier 2
  orange-yellow, Tier 3 green, Tier 4 grey. The list is grouped by tier;
  the summary shows the tier. The whole sphere (shell, rim and glow) takes
  the tier colour, with the same translucency as the Megatrends spheres; the
  dots inside stay coloured by Impact. Tiers do not change position: every
  competitor is linked to the centre on the same orbit as the Macrotrends
  (so dragging the centre brings them along), each at its own even place. The page works out each competitor's tier
  itself from the setting (falling back to the defaults), so tiers and
  colours still show if the API returns no tier.
- **Error boundaries**: each page, and each Administration card, is wrapped
  in an `ErrorBoundary`, so a failure shows "… could not be shown" with a
  Try again button instead of a blank site. The dashboard also warns when
  the API's contract version is older than its own (same major), which means
  the API (or its migrations) was not deployed with the web app. The
  Administration page no longer shows the audit log (the audit API and
  integrity check remain).
- **Summary column width**: the column over the graph's left edge (Megatrends
  and Competitors) has a grip on its right edge that drags (or takes ←/→) its
  width, 300px to 70% of the graph, remembered per browser and tab
  (`eradigm.<tab>.width`).
- **Input**: a chosen HTML file (Add a source) or spreadsheet (Import) has a
  ✕ Remove button, to take it off before it is sent. The capture log is a
  scrollable table about eight rows high, its header kept in view. What
  happened to a source just added (its capture steps, "Sent to the Eradigm
  Inbox" with the link, a possible duplicate) shows right under the Add a
  source card (request 31); Import spreadsheet and Input Trend Analysis show
  theirs inside their own cards.
- **Primary sources** (request 27, contract 1.16, migration 0016): two Primary
  entries come from the same source when their Source Role and Source Company
  match, ignoring case and spacing (`primarySourceKey`,
  `packages/shared/src/sourceLink.ts`; stored as `intelligence_items.source_key`
  when an entry is pushed, edited or imported, and backfilled).
  - While a Primary entry is entered (Eradigm Inbox, Client Inbox), a source
    already in the Primary Tracker flags it: **“This Source Has Prior Primary
    Information”**, with how many entries and the latest one
    (`GET /api/primary-sources`, `PriorFlag`).
  - In the Tracker, each Primary entry is linked to the entry from its source
    just before it and just after it, by Event Date, then approval time
    (`linkedEarlier` / `linkedLater` on rows and entry detail, worked out at
    read time from the index on `source_key`, so edits and deletions re-link
    by themselves).
  - The Primary Tracker and Primary Phantoms tables have a 🔗 column on linked
    entries. Opening a linked entry (record or Markdown) shows the earlier
    entry on the left and the later on the right (`LinkedPanes`), each
    scrolling on its own, labelled Earlier / Later entry with its Event Date
    and which one was opened; ‹ Earlier / Later › walk along the source's
    entries.
- **Analytics** (request 31; first built as the Megatrends / Competitors
  "Trend analysis" subtabs in request 27). Analytics → Dashboard
  (`/dashboard`, `DashboardPage`) is the Analytics Dashboard, in the
  knowledge graph's night sky, with no figures band and no filter bar (the
  Tracker and Phantoms keep theirs): the Signal Timeline of every Tracker
  entry over all dates (oldest entry to today) at the top, then the impact
  mixes by Macrotrend and by Competitor side by side, then Trends Analysis
  with Megatrends and Competitors. The timeline zooms like the knowledge
  graph's: scroll (or + / −) zooms in on the dates under the pointer, drag
  moves across them, Reset shows all dates; it keeps its look (date across,
  Growth Intensity up, impact shapes and colours). Built from `GET
  /api/dashboard` (no new endpoint; `components/analytics/Analytics.tsx`).
  Request 32: the charts sit on lighter panels; the Megatrends and
  Competitors buttons span the same width as the two impact mixes, in larger
  type; each impact mix has its own time frame slider (first and last month,
  oldest entry to today) that reloads that chart alone once the slider rests
  (350 ms; its own `GET /api/dashboard` with those dates); and Impact Mix by
  Competitor never shows "N/A" (or other placeholder) bars.
  Request 33: the dashboard fits the window without scrolling (the timeline
  takes the height left over; on windows under ~820px tall the rows and
  slider are slimmer and the two buttons drop their descriptions). Each
  impact mix is nine one-line rows high whatever it shows, so the two side
  by side are the same size with their rows and bars level: Competitors
  shows its top nine, and Show all lists the rest in the same box (it
  scrolls). A label too long for its line is cut off with … and opens in
  full over its bar when selected. The timeline's plot is very light again,
  as on the original dashboard; Megatrends / Competitors are 35px. Request 34 / 36: the
  plot has no fill of its own (the box's colour, as the impact mix boxes),
  its dashed lines and axes in the axis labels' colour, and the timeline is sized from the window height
  (shorter), leaving room below the Trends Analysis buttons.
  - Trends Analysis (`/analytics/megatrends`, `/analytics/competitors`,
    `TrendAnalysisPage`; the old `/megatrends/analysis` and
    `/competitors/analysis` addresses redirect): the Macrotrends or the
    competitors in wide cells, each with a light bar behind its signal count
    (request 29); competitors by tier, then signal count (request 30), with
    their High / Medium / Low counts. Selecting one opens its own dashboard:
    its Signal Timeline, its impact mix by Competitor (a Macrotrend) or by
    Macrotrend (a competitor), and its trend analysis (the summary written on
    Input → Input Trend Analysis, or the default) in a large box. A
    Macrotrend opens on the whole Macrotrend; a dropdown narrows it to one of
    its Subtrends. The figures are `GET /api/dashboard` filtered to the
    Macrotrend (and Subtrend) or competitor. State is in the URL (`m`, `s` /
    `c`).
  - Analytics → Knowledge Graph: one tab for both graphs (`/megatrends`,
    `/competitors`, as before), with a Megatrends / Competitors toggle at the
    top left where "All macrotrends" / "All competitors" was; the current
    graph's button goes back to its top level.
  - The Trend Test panel and the other old Dashboard charts (Signals by
    Macrotrend / Subtrend, Competitor Composition) are gone; `POST
    /api/trend-test` is kept for API users.
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
- **Trend Analyses** (request 29, contract 1.18; `trend_analyses`, migration
  0018; `packages/shared/src/trendAnalyses.ts`, `services/trendAnalyses.ts`):
  Input → Input Trend Analysis (analysts and admins) writes the analysis of a
  competitor, a Macrotrend or one of its Subtrends (`POST
  /api/trend-analyses`), or imports several from a spreadsheet with the
  columns "Macrotrend or Competitor", "Competitor, Macrotrend, or Subtrend",
  "Name" and "Trend analysis" (`POST /api/trend-analyses/import`: a dry run of
  up to 200 rows checks every row first, then 8 rows per request, all or none
  per request; a later row for the same trend wins). Names match the
  taxonomy and Competitors options in any case (or, exactly, a value Tracker
  entries still carry); a Subtrend's Macrotrend is worked out. Each
  submission is stored as the trend's summary (`trend_summaries`, source
  "manual", so the Trend analysis subtab and the knowledge graph show it at
  once) and kept as a row of `trend_analyses`. Trackers → Trend Analyses
  (`/trend-analyses`, every role) lists them newest first; each is a Markdown
  file (`GET /api/trend-analyses/:id/markdown`, `?download=1` for
  `Trend_analysis_<Level>_<Name>_<date>.md`) whose front matter has one row
  per spreadsheet column, the Subtrend's Macrotrend, the date of submission
  and who submitted it, then the analysis under `## Trend analysis`. Removing
  a row (`DELETE /api/trend-analyses/:id`, analysts and admins) leaves the
  trend's current analysis as it is. Summaries and analyses can be up to
  10,000 characters.
- **Request 34** (contract 1.20, migration 0020):
  - Renames: Trackers → Databases; Tracker → Signals Database; Phantoms →
    Phantoms Database; Trend Analyses → CI analyses; Analytics → Dashboard →
    Megatrends Dashboard (page headings follow). A new tab, Analytics →
    Primary Tracker, follows Databases → Signals Database.
  - A Macrotrend's dashboard (`/analytics/megatrends?m=…`,
    `components/analytics/MacroDashboard.tsx`) is five rows. Rows 1–4 are two
    equal cells each, two rows on screen at a time (cells sized from the
    window, 12px apart): 1 What is <Macrotrend>? | Why does it matter?; 2
    Current Landscape | Impact Mix by Subtrend (a toggle left of the key
    switches to Impact Mix by Competitor; both show only the rows that fit);
    3 Long-Term Landscape | its Signal Timeline (zoom, drag, scroll); 4
    What's Next? | Impact on AbbVie; 5 the whole frame: the knowledge graph
    of this Macrotrend only (`MegatrendsPage focusMacro`, loaded when first
    reached). The arrow at the bottom (with the name of the row it brings
    into view above it) moves 1&2 → 2&3 → 3&4 → 5; from 2&3 on an arrow at
    the top (its name below it) moves back. The mouse wheel (outside the
    graph and timeline on row 5, and outside cells that scroll), Page Up /
    Page Down and the dots at the top right do the same; the view slides
    (the URL keeps it in `v`; `s` is the Subtrend selected in the graph,
    so the Subtrend dropdown is gone). The competitor dashboards are
    unchanged.
  - The six text cells are `macrotrend_sections` (keyed by tenant,
    Macrotrend, section: overview, why, current, longterm, next, abbvie;
    `GET /api/macrotrends/sections`). Input → Input Trend Analysis with
    Macrotrend selected has a Macrotrend dropdown and a box per section
    (Macrotrend overview, Why does it matter?, Current Landscape, Long-Term
    Landscape, What's Next?, Impact on AbbVie), all optional: a submission
    (`POST /api/trend-analyses/macrotrend`) changes only the sections with
    text and is kept in CI analyses (`trend_analyses.sections_json`, a
    Markdown section per filled box). Import spreadsheet takes the columns
    "Macrotrend" and one per section (`POST
    /api/trend-analyses/macrotrend/import`, dry run then 8 rows per request;
    empty cells leave a section as it is). Admins edit a cell in place on the
    dashboard (`PUT /api/macrotrends/sections`; empty text clears it). The
    Macrotrend's older summary (`trend_summaries`) is not changed by these.
    The Competitor toggle of Input Trend Analysis is as before; Subtrend
    analyses are no longer entered there.
  - Both knowledge graphs have no left-hand list or summary panel (only the
    breadcrumb / toggle at the top left), and the graph is centred in the
    space left. Selecting a Subtrend (or competitor) opens its signals in a
    drawer half the page wide, the graph re-centred in the other half. A
    signal whose Phantom (else its Tracker row) has a CI Perspective is
    tagged "CI Perspective" (glowing like the core orb) at the end of its
    row (`ci` on `GET /api/megatrends` / `/api/competitors` entries), and
    its CI Perspective ends the signal's page (`ciPerspective` on `GET
    /api/signals/:id`).
  - Analytics → Primary Tracker (`/analytics/primary`): the Primary Tracker
    (no stream switch) whose link column is "Archived Responses": a dash, or
    a boxed link button for an entry with earlier answers from the same
    source. The button opens a popup of the answer (Source Role, Company and
    Date small at the top; Key Details and Key Metrics below) and splits the
    screen: the Archived Responses table on the right, past a clear divider,
    lists the earlier entries from that source newest first (`GET
    /api/signals/:id/archived`, at most 200); selecting one opens the same
    popup. State is in the URL (`arch`, `ap`).
- **Request 35** (no API change): on a Macrotrend's dashboard the row 5
  knowledge graph has no timeline and no "All Tracker entries" core (the
  Macrotrend is held at the centre, its Subtrends around it; `noCore` in the
  graph spec); the arrows' row names are large (19px, 16px on short windows)
  and bright. The Signal Timeline there (`compact`) has no subtitle, no + / −
  or date range (scroll still zooms; Reset shows once zoomed in) and, instead
  of its levels, "Change Magnitude" running up the axis, so the plot is wider
  and taller; the impact mix has no line under its title.
- **Request 36** (no API change): on row 5 of a Macrotrend's dashboard the
  page title reads "Explore Signals" (the Macrotrend above it), the up arrow
  and its name move into the header, and the graph fills the page below the
  header (the arrow bars lie over the window and only rows 1–4 are clipped to
  the space between them). The signal drawer (both knowledge graphs): its
  list is "Signals"; an open signal shows its title beside the Impact dot
  (15px, no ID), the stream, date and place below; the saved pages, fields
  and CI Perspective scroll together, so the CI Perspective never covers the
  fields, and a long CI Perspective scrolls in its own box (at most 30% of
  the window). On the dashboard the drawer reaches the top of the graph.
- **Request 37** (contract 1.21, no migration):
  - Every database table (Signals Database, Phantoms Database, the Primary
    Tracker and its Archived Responses, Deliverables, Newsletters, CI
    analyses) scrolls inside its own box, down and across, with its header
    row kept in view. The box is sized (`lib/fitToScreen.ts`) so that its card
    (top bar, table, pager) fits the window below the sticky filter bar: once
    the card is scrolled into view, the horizontal scrollbar is on screen.
    "Display all" uses the same box.
  - Deliverables: analysts and admins delete alerts (tick, Delete selected)
    and newsletters (the bin on each row), after a confirmation (`DELETE
    /api/deliverables/:id`, soft delete, audited `deliverable.deleted`). A
    deleted alert's entry leaves the Alerts table and gets no new alert
    (`withoutDeletedAlerts` in the Alerts scope); its Phantom stays, and so
    does its place in the Newsletter table.
- **Request 38** (no API change): Analytics → Primary Tracker shows, after
  its tick box, Source, Archived Responses and Edit columns, exactly Source
  Company, Source Role, Event Date, Insight Topic, Key Intelligence Question,
  Key Details and Key Metrics, in that order (`PRIMARY_TRACKER_KEYS` in
  `TrackerPage.tsx`; the labels are the schema's). Source Company opens the
  entry. The Archived Responses table shows the same seven columns and
  nothing else, and the answer popup the same fields in the same order
  (Source Company, Source Role and Event Date small at the top; the other
  four below). The Signals Database's Primary Tracker keeps its own columns.
- **Request 39** (no API change): Analytics → Primary Tracker. The main
  table takes the Archived Responses table's look (a tinted top bar with the
  teal title "Primary Signals", a teal edge, rows that open on click).
  Pressing a row (or its Source Company) opens the answer's pop-up
  (`AnswerCard`: the seven fields, and "Open the full record"), centred. The
  Archived Responses icon opens the same pop-up as a pane over the left-hand
  table, with the Archived Responses table on the right still in use;
  pressing one of its rows opens that answer's pop-up over the right-hand
  table, level with the first, to compare (‹ › step through the archived
  answers; Esc closes the right one, then the left). State in the URL: `pp`
  (the signal's pop-up), `arch` (the Archived Responses source), `ap` (the
  archived answer's pop-up).
- **Request 40** (contract 1.22, no migration): new signals in the
  knowledge graphs (the Knowledge Graph tab and a Macrotrend dashboard's
  graph). A signal is new while its Event Date is less than
  `newSignals.days` days before today (tenant setting, 14 by default;
  Administration → Workspace settings → Knowledge graphs · New signals;
  `components/megatrends/newSignals.ts`). In orbit around a selected
  Subtrend or competitor a new signal pulses about every 1.8 s: a red halo
  swells and brightens, a ring ripples out from the dot and fades, and the
  dot breathes (made more noticeable after request 40; still with reduced
  motion). In the signals list it is tagged NEW, glowing red, left of the CI
  Perspective tag.
- **Request 41** (contract 1.23, no migration): Analytics → Primary Tracker
  has its own filters instead of the shared filter bar, one per column in
  the table's order (`components/PrimaryTrackerFilters.tsx`): Source Company,
  Source Role and Insight Topic (a searchable list of the values in the
  Primary Tracker, `GET /api/tracker/values?stream=primary&key=…`), Event
  Date (from / to), and Key Intelligence Question, Key Details and Key
  Metrics (the text they contain, in any case). They live in the address
  under `pt.` (e.g. `pt.source_company`, `pt.from`), which the menu never
  carries to the other pages, and the shared `q` / `f.` / `from` / `to`
  filters are ignored there. In API requests a text filter is `t.<column>`
  (any text or long-text column of the stream; `FilterState.text`), which
  exports honour too.
- **Request 42** (contract 1.24, no migration): Analytics → Primary Tracker
  has no Source or Edit columns. The Archived Responses column is now
  **Full Discussion**, with a chat icon and the same behaviour (every earlier
  answer from the same Source Role and Source Company). Right of it, **KIQ
  Archive** (link icon) works the same way but lists only earlier answers
  from that source with the same Insight Topic and Key Intelligence Question
  (compared trimmed and in any case; both must be filled in). The API gives
  each tracker row `kiqEarlier` (the latest such answer, through the
  `ix_item_source_key` index) and `GET /api/signals/:id/archived?match=kiq`
  lists them; the page keeps the choice in the address as `am=kiq`. The
  Signals Database's Primary Tracker is unchanged.
- **Request 43** (contract 1.25, migration 0021):
  - **Database** (`/database`, `pages/DatabasePage.tsx`): a tab of its own
    in the menu (a group with one page and no subtabs, `STANDALONE_GROUPS`;
    admins can still move and rename it). It brings the databases and
    Deliverables onto one page; the separate tabs stay for now. Its toggle
    is Primary Tracker, Secondary Tracker (as on the other tables) and CI
    Analysis (the CI analyses database, unchanged, with no filter menu).
  - The Primary and Secondary tables (`TrackerPage` view `database`,
    `GET /api/database`) show every field of the stream, shown in a table or
    not, after the Source (saved page), Markdown (the Phantom's, for entries
    in Phantoms), Alert (the .docx alert, written as on Deliverables → Alerts
    for High Impact Phantoms whose alert was never deleted, so both pages
    share it) and Newsletter columns. Editing, deleting and exports work as
    on the Signals Database; exports include every field.
  - Its filters (`components/DatabaseFilters.tsx`) cover every field: a
    search, then dropdowns (`f.<column>`, any dropdown field), date ranges
    (Event Date `from`/`to`; other date fields `df.<column>`/`dt.<column>`,
    new in `FilterState.dates`) and "contains" text (`t.<column>`). They
    live in the address under `db.` (never carried to other pages). One row
    shows until "All filters".
  - **Generate Newsletter**: with two or more rows ticked (kept across pages
    and both streams), a button level with the toggle
    (`POST /api/newsletters/generate`). For now the newsletter is a .docx
    of the ticked entries' titles (`listDocx`), named "Newsletter · <date,
    time>"; the AI-written newsletter replaces it later. It is attached to
    every row it was built from (`Signal.newsletters`); the Newsletter cell
    (newspaper icon) opens it, or a menu when the entry is in several.
  - **Primary Tracker → AI Summary** (`components/DiscussionSummaryBox.tsx`):
    a box between the filters and the table, in large type, summarising the
    open Full Discussion or KIQ Archive (the entry and its earlier answers).
    Stored per entry and mode in `discussion_summaries` with a fingerprint
    of the answers it was written from. With the AI writer connected
    (`LLM_PROVIDER`), `GET /api/signals/:id/summary[?match=kiq]` writes a
    missing summary, or rewrites its own once the discussion changes,
    following **Administration → Workspace settings → Primary Tracker · AI
    Summary** (`discussionSummary.instructions`; the Claude model and
    company are those of the Megatrends summaries). Admins write or edit it
    by hand (`PUT`, never replaced automatically, flagged when out of date)
    or ask the AI writer again (`POST …/summary/generate`).
  - Settings: a partial `PATCH /api/settings` no longer resets the sections
    it leaves out (Phantoms minimum Impact, competitor tiers, new-signal
    days) to their defaults.
- **Request 44** (no contract change, no migration):
  - Database: the Source, Markdown, Alert and Newsletter columns share one
    width (`.doc-col`, 112 px) with their icons centred, so the icons are
    evenly spaced whatever the length of the column names.
  - The Database and Analytics → Primary Tracker tables (and the Full
    Discussion / KIQ Archive table beside it) take 80% of the room below
    the sticky filters (`useFitToScreen(min, ratio)`), so the page fits the
    screen.
  - Primary Tracker → AI Summary: a full-width strip attached to the bottom
    of the sticky filter bar and stuck there while the page scrolls (its
    `top` follows the bar's height; `[data-sticky-under]` makes the tables
    fit below it too), in larger type (21 px). It is edited with the same
    bullet editor as long-text fields (`ListTextarea`: Enter for a new line
    or the next bullet, Tab / Shift+Tab to nest bullets "- " by two spaces)
    and shown as typed (`components/BulletText.tsx`: line breaks,
    paragraphs, nested lists). The AI writer may use the same bullets; its
    line breaks and indentation are kept (`keepLines`).
- **Request 45** (no contract change, no migration):
  - Database: Edit joins Source, Markdown, Alert and Newsletter as one of
    five equal columns (`.doc-col`, 86 px, just wider than the longest
    name), so the five icons are evenly spaced and close together.
  - Analytics → Primary Tracker fills the window with no gaps: no note
    above the table; the table (and the Full Discussion / KIQ Archive table
    beside it) is attached, edge to edge, to the bottom of the AI Summary
    and runs to the bottom of the window (`useFitToScreen(min, 1, true)`:
    sized from where the box sits on the page).
  - The AI Summary's bottom edge is a resize handle (`role="separator"`):
    drag it, or focus it and use ↑ / ↓ (Shift for bigger steps, Home / End),
    to make the summary shorter or taller; the table takes the rest of the
    window (at least 180 px stays for it). Double-click returns it to its
    natural height. The height is remembered per browser (local storage,
    a convenience only).
  - The bullet editor (`ListTextarea`) puts the caret back as soon as the
    new text renders, so fast typing after Tab / Enter lands in place.
- **Request 46** (contract 1.26, no migration):
  - **Formatted text** in every content editing box: long-text fields (Inbox,
    record editor, KIQ details and metrics), the AI Summary, the Macrotrend
    dashboard sections, Megatrends / competitor summaries and the Trend
    Analysis input. `components/RichTextField.tsx` is a TipTap editor
    (free, MIT): selecting text shows a bar (BubbleMenu) with Bold,
    Underline, smaller / larger text (85%–200%) and Title (a title line,
    whose size can be changed too); Ctrl+B, Ctrl+U and Ctrl+Shift+< / > work
    too. Bullets as before: Tab makes / nests one, Shift+Tab un-nests, Esc
    then Tab leaves the field. The value is still plain text with light,
    Markdown-compatible markup (`packages/shared/src/richText.ts`):
    `**bold**`, `<u>…</u>`, `<span style="font-size:1.3em">…</span>`, `### `
    title lines and "- " bullets, so existing values need no migration and
    the Phantoms Markdown shows it formatted. `lib/richDoc.ts` converts it
    to and from the editor; `components/BulletText.tsx` (`RichText`) shows it
    formatted (never as raw HTML). Tables, the Client Inbox, spreadsheet
    exports and the AI writer's input use `plainText` (`displayValue` does
    so for long text). The KIQ question and short inputs stay plain (the KIQ
    Archive matches on the question's text).
  - **Full Discussion** is one conversation: the other answers from the same
    Source Role and Source Company on the same Event Date
    (`Signal.discussionWith`; `GET /api/signals/:id/archived` without
    `match`). The AI Summary of a Full Discussion covers that conversation.
    KIQ Archive still spans dates.
  - Resizing the AI Summary: the table is sized in the same frame
    (`useFitToScreen` fill mode measures at once, not on the next frame), and
    the page does not scroll while dragging, so no scrollbar flickers.
- **Request 47** (contract 1.27, no migration):
  - **Hide filters / Show filters** on the Primary Tracker and the Database
    page, at the end of the Active filters bar. Closed, the filter grid is
    hidden (still in the page, so `useFitToScreen` and the sticky AI Summary
    keep measuring it), the band is shorter and the table gets the room.
    Each page remembers its choice in the browser (`state/filtersOpen.ts`,
    `eradigm.filters.ptr|db.closed`).
  - **Editing keeps the box's size**: a formatted-text field is a fixed
    number of lines high (`--rt-rows`) and scrolls; it can still be resized
    by its corner. The AI Summary keeps the height it had when Edit was
    pressed (at least 240px); the Macrotrend dashboard sections and the
    Megatrends summaries edit inside their own boxes.
  - **Title sizes**: staff (admins and analysts) change the size of titles
    outside the text boxes with A− / A+ (75%–200%), shown when the title is
    hovered or its box focused. The size applies for everyone and is kept
    in the tenant settings (`textSizes`, set one at a time with
    `PUT /api/settings/text-size`; 1 removes it). Keys: `entry-title` (each
    entry's Title: the record's heading, the Inbox item's title and the
    Title box in the Inbox and record editor), `heading:ai-summary`,
    `heading:primary-signals`, `heading:archive`, `heading:md-<section>`
    (Macrotrend dashboard sections) and `label:<field>` (a field's heading
    in records and pop-ups, e.g. KEY DETAILS). The stored titles are
    unchanged, so duplicate checks, alerts, graphs and exports are not
    affected. `components/TextSize.tsx` (`SizedHeading`, `TextSizeButtons`,
    `EntryTitleInput`) puts the buttons beside the heading, not in it, so
    its name stays its text.
- **Request 48** (no contract change, no migration):
  - The **Database** page opens with its filters hidden (Show filters opens
    them; each browser remembers the choice, `eradigm.filters.db`).
  - The **Databases** menu group and its tabs (Signals Database, Phantoms
    Database, CI analyses) are gone: the Database tab has them all.
    `MENU_GROUPS` / `MENU_ITEMS` no longer list them, so a saved menu drops
    them when read. `/tracker`, `/phantoms` and `/trend-analyses` open the
    Database page (`ToDatabase` in `App.tsx`), with their filters moved under
    `db.` and any open record or Markdown kept; `/trend-analyses` opens CI
    Analysis. Links in the app (the Inbox's "in the Tracker" and duplicate
    links, the prior-information flag, the import and trend-analysis
    confirmations) now point at the Database. The Phantoms API and the
    Phantoms columns stay (the Database's Markdown column uses them). The
    Primary 🔗 Linked column is not carried over: the Primary Tracker's Full
    Discussion and KIQ Archive cover it. Deleting from the Database offers
    Delete Tracker Entry or Delete Globally (a Phantom alone is no longer
    deleted from the page).
  - **A competitor's page** (Megatrends Dashboard → Competitors → a company,
    `components/analytics/CompetitorDashboard.tsx`): the **Company Profile**
    (the competitor's analysis, formerly "Trend analysis"; Input → Input Trend
    Analysis → Competitor now says Company Profile) at the top, then the
    Signal Timeline and the impact mix by Macrotrend, unchanged. At the
    bottom, as on a Macrotrend's dashboard, the **Explore Signals** arrow:
    pressing it, scrolling on past the end of the page or Page Down glides up
    to the full-page knowledge graph of the company's signals (`v=signals`);
    its up arrow, scrolling up over its header or Page Up glides back. The
    graph (request 49) is the company's globe alone with its signals in orbit
    and its signals list (`CompetitorsPage focus`): no other competitors, ties,
    Macrotrend / Subtrend breakdown or timeline.
- **Request 50** (no contract change, no migration): on a competitor's page
  (Megatrends Dashboard → Competitors → a company) staff change the size of
  the headings with A− / A+ like the Macrotrend dashboard's
  (`heading:company-profile`, `heading:cd-timeline`, `heading:cd-mix`;
  `SignalTimeline` and `ImpactMix` take an optional `sizeKey`), and edit the
  Company Profile in place (✎ Edit, a formatted-text field: select text for
  bold, underline, size or title). Saved through `PUT
  /api/megatrends/summaries` (level competitor); clients read it.
- **Request 51** (contract 1.28, no migration): alerts and newsletters are
  written into the Word templates at the root of the repo, "Alert
  Template.docx" and "Newsletter Template.docx".
  - `scripts/build-docx-templates.mjs` unpacks them into
    `apps/api/src/templates/docxTemplates.generated.ts` (Word's revision IDs
    dropped). The API's wrangler config runs it before every deploy
    (`npm run templates`), and CI fails if the packed copy is out of date. To
    change a template, replace the .docx and deploy (or run
    `npm run templates`).
  - `services/docxTemplate.ts` fills the placeholders in the document XML,
    keeping the template's look: a value takes the formatting of the text where
    its placeholder starts (Word splits placeholders over runs). Long fields
    keep their lines, "- " bullets (as Word bullets at their level) and the
    text boxes' bold, underline, size and titles. Missing values read "N/A".
    Links are added as relationships; the template's review comments are
    removed. The result is packed uncompressed (`zipStore`).
  - **Alerts**: every Tracker entry has one (not only High Impact). Its row
    is created when the entry is first listed; the .docx is written each time
    it is opened, from the entry's Phantom (as first pushed) or, without one,
    its fields, so nothing large is stored per entry. Placeholders: Title,
    Competitor, Assets (Drug), Review Date ("September 3, 2026"), Publisher
    (linked to the URL), Key Details, Impact, CI Perspective, Tell Me More.
  - **Generate Newsletter** (Database): a dialog lists the ticked signals;
    each is put in Technology, People or Process before Confirm
    (`sections` in the request, one per entry). The template's month and year
    are the current ones; the Executive Summary lists each section's titles;
    each section repeats its alert block per entry (Title, Publisher linked,
    Event Date "September 1st, 2026", Macrotrend (Subtrend), CI Perspective,
    Key Details). An empty section reads "N/A". The .docx is stored with the
    newsletter. (Deliverables → Newsletter's title-only file went in request 52.)
  - The document view (`DocxPane`) has B / A− / A+ for selected text (and
    Reset). These change the view only; Download gives the generated file.
- **Request 52** (contract 2.0.0, no migration): Admin → Deliverables is
  gone, and Admin is a tab of its own (like Database) that opens the Admin
  page (formerly "Administration"; `STANDALONE_GROUPS` = database, admin).
  - The Database page has a fourth toggle, Newsletter (`/database?db=newsletters`,
    after CI Analysis). It lists every newsletter made with Generate
    Newsletter, newest first, with the entries each uses; each opens as a side
    pane (download there) and staff delete them. `/deliverables` redirects there.
  - Removed: the Deliverables Alerts and Newsletter tables
    (`GET /api/deliverables/alerts`, `GET /api/deliverables/newsletter`), the
    named title-only newsletter (`POST /api/newsletters`, `CreateNewsletterRequest`),
    the `alerts` / `newsletter` export views and the "deleted alerts" table
    scope. Hence the major contract version. Alerts still open from the
    Database's Alert column (`GET /api/deliverables/{id}/docx`); newsletters
    are listed by `GET /api/newsletters`, made by `POST
    /api/newsletters/generate` and deleted by `DELETE /api/deliverables/{id}`.
- **Request 53** (no contract change, no migration): the Database page looks
  like the Primary Tracker. Under the filters, where the Primary Tracker has
  its AI Summary, a strip (`DatabaseTabs`, `.db-tabs`, stuck under the sticky
  filters with `useStickUnderFilters`) holds the table toggle (Primary Tracker,
  Secondary Tracker, CI Analysis, Newsletter) and a note on the table shown.
  Below it the table's card runs the full width to the bottom of the window
  (`useFitToScreen(160, 1, true)`, `.ptr-content` / `.ptr-card`), headed with
  the table's name (resizable, `heading:database-table`); Generate Newsletter
  sits beside Export. Hidden helpers in a scrolling table (`.sr-only`, such as
  a row's file picker) are pinned to the window so they never make the page
  scroll. Analytics → Knowledge Graph is gone from the menu (a saved menu drops
  it); `/megatrends` and `/competitors` still open the full-page graphs and
  count as the Megatrends Dashboard tab.
- **Request 54** (no contract change, no migration):
  - Generate Newsletter: the section chosen for each signal glows in the
    platform's cyan (`.nl-sec-seg [aria-checked="true"]`), and a placed row is
    tinted.
  - A Macrotrend's knowledge graph (its dashboard's Explore Signals) says
    "Select a Subtrend to explore signals in this space" in the box with its
    name, just below it (`.mg-crumbs.with-hint`). The Competitors' graphs have
    no such line.
  - Database: rows turn blue on hover like the Primary Tracker's; clicking a
    row (not one of its buttons or its tick box) opens `EntryFields` from the
    right (`?row=<id>`): every field of the entry in the table's order, one per
    row, long text through `RichText` so lines and bullets (nested too) are
    kept. "Open record" goes on to the full record.
- **Request 55** (contract 2.1.0, migration 0022): the Test tab (admins
  only), whose pages show a test space fed by the SharePoint workbook
  "Power_Automate_Test.xlsx". Guide: [TEST-TAB-SHAREPOINT.md](TEST-TAB-SHAREPOINT.md).
  - **Microsoft Graph** (`services/sharepoint.ts`): the app signs in as itself
    (client credentials: `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`,
    `SHAREPOINT_CLIENT_SECRET`; the app registration has Sites.Selected with
    read on the CI2 Monitoring site), reads the file's version (`cTag`) by
    `SHAREPOINT_DRIVE_ID` / `SHAREPOINT_ITEM_ID`, and downloads and reads the
    .xlsx itself (`parseXlsxBook`, every sheet). `GET /api/excel/check` is the
    test endpoint: each step (secrets, sign-in, workbook, worksheets with their
    columns) and, on failure, Microsoft's error with what to fix; failures are
    logged (`sharepoint_graph_error`, never the secret or token).
  - **Test space** (`services/excelSync.ts`): a workspace of its own
    (`<tenant>-test` in tenants, linked in `excel_sync`), nobody's member.
    Admins' requests with `x-eradigm-space: test` are answered from it (the
    principal's tenant is swapped in app.ts), so every page and endpoint works
    unchanged. The web app serves the Test pages under `/test` (router
    basename) and sends the header there; moving between `/test` and the rest
    is a page load, so nothing cached in one space shows in the other.
  - **Sync** (the every-minute cron, `* * * * *`, and Sync now): when the
    workbook's version changed, the live workspace's columns, options and
    settings are copied in again, then the workbook is the master: Primary /
    Secondary rows are matched to entries by ID (new rows published as the
    spreadsheet import does, changed rows edited with the workbook's Review
    Date kept and their Phantom taken again so the Markdown and alert follow,
    missing rows deleted); Competitor Trend Analysis sets Company Profiles;
    Macrotrend Analysis sets each Macrotrend's sections. Rows with problems are
    left out and listed (sheet, row, column, why). A run spends at most about
    20 statements on changes (the Free plan's 50 queries per invocation), so a
    large change takes several runs (`more`).
  - `POST /api/excel/upload` (dev and test only) syncs from an uploaded
    workbook instead of SharePoint (the e2e tests).
- **Request 56** (no contract change, no migration):
  - **Database → Primary Tracker is the Primary Tracker.** `TrackerPage` with
    `primaryOnly` and view "database": the Primary Tracker's filters
    (`pt.` parameters, open by default), its AI Summary, columns, Full
    Discussion and KIQ Archive and row pop-ups, plus the Markdown, Alert and
    Newsletter columns (and Generate Newsletter from ticked rows); no Source or
    Edit column. The Markdown is built from the whole entry, not from the
    columns shown. The tables strip sits above the AI Summary; stuck strips
    stack under the filters (`useStickUnderFilters`). `/analytics/primary`
    redirects to `/database?stream=primary` (its parameters kept).
  - **Menu**: Analytics → Primary Tracker and Test → Primary Tracker are gone
    (their keys stay readable); the Megatrends Dashboard is a tab of its own
    (the analytics group is standalone, named "Megatrends Dashboard").
  - **Test tab sync**: while a Test page is open and in view it calls `POST
    /api/excel/sync` every 10 seconds (`TestSpaceSync`); the every-minute cron
    stays the fallback (Cloudflare schedules run at most once a minute). A
    check that finds the same workbook version makes one Graph call and no
    database write (the last-checked time is written at most once a minute,
    and the lock is only taken when there is work). When a change lands, the
    page reads again and shows a small green "Data synced". The status,
    Sync now, Check connection, the sheets read and the rows left out moved to
    Admin → Test tab · SharePoint workbook (`ExcelSyncCard`, `#excel-sync`);
    a Test page shows a red ! leading there when the sync needs attention.
- **Request 57** (no contract change, no migration, web only): **Sync now on
  every Test page** (`TestSyncButton`), at the top right: the last item of the
  page's header row, level with the bottom of the title (Database bands,
  Megatrends Dashboard, Trends Analysis lists and dashboards); on the
  full-page graphs, in the stage's top right corner across from the graph
  toggle (same inset and height). On a Trends Analysis list the intro moves
  under the title and Sync now when the page is narrower than 1080 px.
  `TestSpaceSync` is now a provider around the Test pages: Sync now asks the
  same loop for a forced run (`force: true`, carrying on while `more`), after
  the check under way if there is one. Beside the button, "Checked … ago"
  (this page's own last check; the workbook's last save in its tooltip), and
  "✓ Data synced" there for a moment when a sync changes the test space. A
  forced run that changes nothing says "Already up to date with the workbook"
  with the workbook's last save time.
- **Request 71** (CI SQUARED, no migration): the Dashboard, calmer.
  - **Activity chart**: each point is a month's Activity (the 30 days up to
    it; points a week apart over three months, further apart over longer
    spans), drawn as a smooth monotone curve (`smoothSegments`, no overshoot).
  - **Matrix**: every dot in its full Impact colour; its size grows with
    Growth Intensity (`dotSize`: 5, 6.5, 8 px; the same in the large plot).
  - **Rows**: a handle between the charts and the Profiles shares the height
    (30–75%; drag, arrow keys, Home/End, Enter or double click for the
    default), kept per browser (`eradigm.dashboard.split`).
  - **Look**: hairline cards without shadows, chart notes behind an "i",
    Profiles as name, one text (Analysis / Company profile, scrolling in the
    room left), two slim focus bars and a footer (the full analysis link, or
    the competitor's tier and signals).
- **Request 70** (CI SQUARED; contract 2.9.0; migrations 0032, 0033):
  - **Menu**: every tab is its own (New Entry, Eradigm Inbox, Client Inbox,
    Dashboard, Database, Admin); `normaliseMenu` turns a saved grouped menu
    into single tabs, keeping names and order. Analysts open **New Entry**
    (`TAB_ROLES.input`).
  - **New Macrotrend Manufacturing** (no Subtrends; migration 0032 adds it to
    each CI Squared workspace; the Subtrend is not required for it).
  - **CI Squared text**: no all-capitals and one typeface (`styles/ci2.css`,
    scoped by `html[data-project="ci2"]`, so Epilepsy is unchanged).
  - **New Entry**: a concise source card (Process file and Manual entry
    stacked beside the drop box), **Recent captures** (`GET /api/items?limit=`),
    and the other sections as bars that open and close (kept per browser).
  - **Trend dashboards**: section steps take 0.22 s, and a second step within
    that time skips the animation (`useStepper`); the Macrotrend page has no
    knowledge graph row.
  - **Dashboard** (`pages/DashboardPage.tsx`, `components/dashboard/`), one
    page in two columns. *Activity* = Σ impact (Low 1, Medium 2, High 3) ×
    growth intensity (Stable 1, Slight 2, Strong 3) per signal
    (`dashboard/model.ts`; entries carry `growth` since contract 2.9),
    summed by week (by month past ~7 months); three months by default.
    Left: stacked areas per Macrotrend (a layer opens its Subtrends and its top
    six competitors + Others). Right: a scatter plot per competitor ×
    Macrotrend (Event Date across, growth up, Impact colour, brighter with
    more signals; 9 × 9, Show all scrolls), each opening larger with wheel
    zoom, drag and titles. Below each, its **Profile**: the top five by
    signals as icons and a search; by default, of the top three, the one
    whose Activity grew most over the last 30 days (against the 30 before);
    its analysis; two focus bars (shares under 5% put together as Other when
    there are several); and the Macrotrend Analysis link or the Company
    Profile. A ninth Macrotrend takes the first hue with a hatch (colour and
    texture), so the eight validated hues stay as they are.
  - **Competitor logos** (migration 0033, `competitor_logos`): Admin →
    Competitor logos uploads a PNG, JPEG, WebP or GIF (≤ 256 KB, recognised
    by its first bytes, never SVG); served with its own type and nosniff
    (`/api/competitor-logos`). Without one, a competitor shows its initials in
    its tier's colour.
- **Request 69** (EPILEPSY; contract 2.8.0; migration 0031): the NSO
  Comparator gains **Evidence** (a row just before the chart) and **x-axis
  name** (the chart's x-axis title, under the bars' own names). Staff can
  **format the text** of each row (bold, underline, size, title, bullet
  points; "✎ Format text" on a card) but not reword it: the editor's
  `lockText` lets only formatting and line breaks change, and the API
  (`PUT /api/epilepsy/formats`) refuses markup whose words (`sameWords`) are
  not the workbook's. A formatting is kept per company, row (its assets) and
  field (`epilepsy_formats`), and is shown only while the workbook's words
  are unchanged; otherwise the workbook's text shows as it is.
- **Request 68** (EPILEPSY, no migration): **NSO Comparator** (non-seizure
  outcomes), a tab after Competitor Profiles (`/nso`), from new columns of
  “3. Platform Competitor Profiles” (`EPI_NSO_FIELDS`). One button per
  company; each picked opens its card: NSO Focus, NSO Activity, Core
  Messaging, Channels Used, Imagery and Marketing, and a bar chart of x1–x6
  (name and value) against Data Metric (Unit) as its y-axis. Each row has an
  icon in its own colour and a light shade of it behind the row. A company
  whose block of rows gives several profiles (one per Epilepsy Assets row)
  switches between them by asset. Several companies sit side by side, each
  chart on its own axis (`MetricBars`).
- **Request 67** (EPILEPSY; contract 2.7.0; migration 0030): **Study Name**
  (sheet 4) is a column of the RCA table and panel and of the Trial Tracker
  table (and in the RCA panel's and data viewer's titles). **Admin → Table
  columns** sets the order of each table's columns (News Primary and
  Secondary, RCA, Trial Tracker): drag a column or use its arrows, then save
  (`columnOrder`; `orderColumns` keeps a saved order and puts columns added
  since in their default place). The tables are **built into the page** as
  CI SQUARED's Database: the switch and filters on a full-width strip under
  the band (`.epi-strip`), then the table's card edge to edge
  (`.content.ptr-content`, `.ptr-card`) down to the bottom of the window, so
  only the table scrolls.
- **Request 66** (EPILEPSY, no migration): Competitor Profiles no longer
  reads the profile sheet's **Asset Name** column. A company's assets come
  from **Epilepsy Assets** alone (several in a cell, or one per row of the
  company's block), with MoA, RoA and phase from Trials & Assets (whose own
  Asset Name stays). Admin → Column names no longer lists it.
- **Request 65** (EPILEPSY; contract 2.6.0; migration 0029): **money in USD, column names
  and dropdown options**. The revenue figures and market cap
  (`EPI_USD_FIELDS`) show “(USD)” after their names and are abbreviated
  (`abbreviate`: 1,000,000,000 → “1 bn”, “30.5 bn”, “540 m”); amounts are
  read however they are written (“~$30bn (Oct 2025)”, “(1,234)”, “3e+10”),
  and a column named “… (USD m)” counts its plain numbers in millions.
  Columns are found by name with case, spacing, punctuation and a currency
  note ignored (“Market Cap (USD)” is Market Cap). Admin → Column names lists,
  sheet by sheet, every column the pages read (`EPI_COLUMNS`), where it is
  used, the workbook's column it is read from and its first value; an admin
  can pick another workbook column for it (`columnNames`, applied in the
  browser by `withColumnNames`). Each sheet's dropdowns (Excel data
  validation lists: typed options, or a range on any sheet, directly or by a
  defined name) are read with the sheet (`parseXlsxBook(…, { lists: true })`)
  and listed there; options added in Admin (`addedOptions`) are accepted by
  the platform too (the page filters offer them; the workbook is not
  changed), and values the sheet uses outside the options are flagged with
  a one-click Add.
- **Request 64b** (CI SQUARED; contract 2.5.0; migration 0028): an earnings
  call names its **Competitor** instead of a Company. On the Input card it is
  picked from the same searchable dropdown as the Secondary Tracker, with that
  tracker's Competitors options (`/api/schema?stream=secondary`); the API
  refuses any other value (422 on `competitor`) and stores the option's own
  spelling. Migration 0028 renames `earnings_calls.company` to `competitor` and
  the "Company" heading in the Markdown already written to "Competitor".
- **Request 64** (CI SQUARED; contract 2.4.0; migration 0027): **Earnings
  Calls**. Input → *Input Earnings Call*: drag and drop (or choose) the call's
  report, a `.docx` up to 10 MB, which *View report* opens in the same side
  pane as the newsletters and alerts before anything is sent (`DocxPane` now
  takes a stored `src` or a local `file`); then a text box per field —
  Quarter and Company (needed; Competitor since request 64b), Main Tagline, Patent Expiry / LOE Response,
  AI & Automation Tools, Direct-to-Patient Strategy, IRA Pricing / Tariffs,
  Strategic Investment & Redeployment, Observed Trends. Submit posts
  multipart (`file` + `values` JSON) to `POST /api/earnings-calls` (analysts
  and admins); the API checks the file is a Word document (ZIP), stores it in
  D1 in 1 MB chunks (`earnings_call_files`, as the saved pages are) and
  writes the Markdown with `earningsCallMarkdown` (each field's name on one
  line, its text below, an empty line between fields). Database → *Earnings
  Calls* (`?db=earnings`) lists them newest first: Report (the `.docx` in the
  side pane, `?docx=`), Markdown (`?md=`, Copy and Download, named
  “Company Quarter.md”), then one column per field; analysts and admins can
  remove one. Field definitions live in `packages/shared/src/earningsCalls.ts`.
- **Request 63** (CI SQUARED; contract 2.3.0; migration 0026): **the Test tab
  is gone**, with the SharePoint workbook sync behind it (requests 55–57):
  the Test menu group, the `/test` pages and their Sync now buttons, the
  Admin card, the `/api/excel/*` routes, the every-minute workbook check and
  the `x-eradigm-space` header. Migration 0026 switches the test spaces off
  (`tenants.active = 0`) and drops `excel_sync`. Old `/test/…` addresses open
  the same live page; a saved menu with the Test group drops it. The Microsoft
  Graph client (`services/sharepoint.ts`) stays for the Epilepsy project,
  which names its workbook by link: `SHAREPOINT_DRIVE_ID` and
  `SHAREPOINT_ITEM_ID` are no longer read.
- **Request 62** (CI SQUARED, web only): **signal clusters spread out** in the
  Explore Signals graphs. Each grouped entry has its own place in its
  cluster (`clusterLayout`, megatrends/model.ts): clusters fill shells around
  their centre with every entry about a gap (`CLUSTER_GAP`) from the next, so
  a big cluster grows outwards; its centre sits further from the hub the
  bigger it is, and further still while it would touch another cluster.
  Grouped entries no longer push or pull each other (no charge, no link
  pull); the pointer finds an entry anywhere in its own bubble (an unseen hit
  sphere) and never through a neighbour's glow.
- **Request 61** (contract 2.2.0; migrations 0023, 0024, 0025): **projects**
  (see docs/PROJECTS.md).
  - The platform (sign-in, people and access, audit, incidents, the shell,
    the Admin page) holds projects. Everything built before is the **CI
    SQUARED** project, in `apps/api/src/projects/ci-squared` and
    `apps/web/src/projects/ci-squared`; the second is **Epilepsy**
    (`projects/epilepsy`). The platform reaches a project only through its
    registry (`projects/registry.ts`, `ProjectModule` / `WebProject`); a
    project never imports another.
  - Workspaces have a kind (`tenants.kind`: `ci2`, `epilepsy`, `test`).
    Migration 0024 names the first CI workspace CI SQUARED, marks the Test
    tab's spaces `test` (never listed), and makes the Epilepsy workspace
    (`tnt_epilepsy`, slug `epilepsy`) with CI SQUARED's admins as its admins.
  - A request names its project by slug (`x-project`); without it, the
    caller's first project (CI SQUARED first). The web app keeps a person's
    first project at the root and any other at `/p/<slug>/…`. A project's
    routes answer only for its own workspaces (`/api/epilepsy/*` for
    Epilepsy, the rest of `/api/*` for CI SQUARED, the platform's for any).
  - `/api/me` gives `project` and `projects`; the sidebar shows the
    project's name under the logo (the subtitles' cyan) and the logo opens a
    menu of the person's projects.
  - Admin → **Projects and access** (`/api/access`, `/api/projects/:id`):
    one account per person, a role or No access per project, rename a
    project, add a person (a one-time sign-in link when they have never
    signed in), sign-in links and End sessions; then a toggle to each
    project's own settings (`WebProject.Admin`).
  - **Epilepsy**: the SharePoint workbook (Admin → Epilepsy settings: its
    link, resolved once to drive and item ids by `/shares`, else by name on
    the link's site) is checked every minute and its four sheets read when it
    changes (`epilepsy_rows`, JSON chunks; numbers shown as Excel shows them:
    percentages and dates). Pages: News (Primary with Full Discussion and KIQ
    Archive, Secondary), Competitor Profiles, Asset Launches, RCA and Trial
    Tracker with its data viewer, built in the browser from
    `/api/epilepsy/data`. Company colours are set on the Admin page.
  - CI SQUARED: Explore Signals keeps the signals list open before a
    Subtrend is chosen, puts a heading per month over it (by Recency),
    clusters a Subtrend's signals by competitor (and a competitor's by
    Macrotrend) in the graph, and flies to a signal opened from the list.
    An alert generated for a Database entry can be reworded in its viewer and
    saved (`/api/deliverables/:id/alert`, migration 0023).
- **Request 60** (no contract change, no migration): numbered lists in
  formatted text (`richText`, `richDoc`, `BulletText`, `RichTextField`).
  - A list split by blank lines keeps counting: the shown list starts at its
    first item's number (`<ol start>`), as the editor already did.
  - A second line in an item (Shift+Enter, or another paragraph in it) is
    stored indented one level past the item, read back as more of it (a `p`
    block with `cont`), shown in the item after a line break, and opened in
    the editor as a line break in the item. Before, it was stored as a plain
    line, which ended the list (the next item started again at 1).
  - Typing "2. " at the start of an item of a numbered list keeps the list's
    own number instead of adding a second one ("2. 2.").
- **Request 59** (web only): in the signals list, a signal's tags read, from
  the right: its date at the far right, then New, then CI Perspective.
- **Request 58** (no contract change, no migration, web only): **Explore
  Signals** (a Macrotrend's dashboard, row 5; a competitor's page,
  `v=signals`).
  - The signals list of a Subtrend or competitor is most recent first (the
    same day's by Impact, High first: `byRecency`), or by Impact, high to low
    (`bySourceOrder`), from a Recency / Impact toggle at the list's top right
    (`EntrySheet`; Recency each time the page opens). ‹ › step in the list's
    order. Each signal shows its Event Date in a small box. The full-page
    graphs' lists work the same way.
  - A time frame bar under the graph (`ExploreTimeFrame`, GraphShell's
    `footer`): the Impact Mix's slider (`TimeFrameSlider`, taken out of
    `ImpactMix`). On these two pages the Impact Mix's time frame and this bar
    share one value in the address, `tf=YYYY-MM~YYYY-MM` (none: all dates;
    `useTimeFrameParam`), so moving either moves the other, and Back and
    shared links keep it. The graph, its counts and the list show only the
    signals in the time frame (filtered in the browser; the drawer stops above
    the bar). Leaving a dashboard, or opening another, clears `tf`; the
    Megatrends Dashboard's own two impact mixes keep separate time frames.
- **Menu in groups** (request 28, contract 1.17; regrouped in request 31,
  contract 1.19; renamed in request 34; `packages/shared/src/menu.ts`): the
  menu is four groups (and, from request 43, the Database tab on its own),
  each a button that opens its tabs: Inputs (Input,
  Eradigm Inbox, Client Inbox), Analytics (Megatrends Dashboard, Knowledge
  Graph, Primary Tracker), Databases (Signals Database, Phantoms Database,
  CI analyses) and Admin (Deliverables, Administration). Dashboard is also the
  current tab on the Trends Analysis pages, and Knowledge Graph on both
  graphs (`MENU_ITEM_ALSO`). A menu saved before request 31 (with Megatrends
  and Competitors groups) takes the new layout and keeps the names given to
  the groups and tabs that remain. A group is open while one of its pages is
  open, unless closed; a closed group shows its tabs' badges. People only see
  the tabs their role allows (`canSeeTab`); a group with none is hidden. Each
  link's accessible name is "Group: Tab".
  - Administration → Menu (admins; `menu` in tenant settings, saved straight
    away): drag or ↑ ↓ the groups, and the tabs within each group (a tab stays
    in its group); type a new name for a group or tab (empty, or the usual
    name, means the usual name); Restore the usual menu. `normaliseMenu` makes
    any stored menu whole (unknown or repeated entries dropped, missing ones
    back after the tab, or group, they follow by default). `navOrder` (the old flat order)
    is kept for older dashboards but no longer used.
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
  (same keys and options). Workstream (request 31, migration 0019) is a
  dropdown: Digital and Data Platforms, Salesforce Tools Effectiveness, DTP
  and Hub-adjacent tech, AI Upskilling, Omni-channel and Engagement
  Platforms, Commercial Excellence, Digital and GenAI training, Digital and
  GenAI Platforms, Agents, and Implementation, EHR Integrations. The
  migration respells values that match an option in another case and keeps
  any other value already in use as an extra option, so no entry loses its
  Workstream.
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

### D1 rows read (Workers Free: 5 million a day)
- **Read cache by data version** (`apps/api/src/lib/cache.ts`, migration
  0017): each workspace has two versions in `tenant_data_versions`. `v` goes
  up with every change: any API request that is not a read (bumped by the
  authentication middleware after the handler, whatever its outcome), every
  background job step and the nightly retention run. `t` goes up only with
  changes that can reach the Tracker side (not Inbox drafts, comments,
  rejections, sends to the client, saved views or users: `INBOX_ONLY` in
  `app.ts`). The heavy reads (Tracker, Phantoms, Newsletter table, bounds,
  Dashboard, Megatrends, Competitors, primary sources, entry detail; and,
  keyed by `v`, the Inbox list, item detail, badges and the Client Inbox) are
  answered from the isolate's memory while their version has not moved:
  one row (the version) instead of the query. The column sets are kept the
  same way. Requests that change things never use the cache. The Alerts table
  is not cached (it creates alerts as it reads). `READ_CACHE=off` turns it off.
- **Query shapes**: the duplicate check is three indexed lookups (URL, file,
  text) instead of an OR that read the whole workspace per Inbox item; table
  pages pick their rows first and work out per-row extras (competitors, saved
  pages, links, names) only for the rows shown; link lookups are pinned to
  the `source_key` index; the Inbox badges and the audit chain are read from
  indexes (`ix_item_waiting`, `ix_audit_chain_seq`).
- **Polling**: the Inbox refreshes every 3 s while something is being
  captured, else every 8 s; badges and the Client Inbox every 20 s; an entry
  being captured on the Input page until it has arrived. Unchanged answers
  cost one row; hidden tabs do not poll.
- `apps/api/test/rows-read.test.ts` counts D1's own `rows_read` per request on
  a workspace of ~460 entries, with a budget per endpoint (first read) and
  ≤ 12 rows for a repeat, and checks that an Inbox change leaves Tracker reads
  cached while pushing to the Tracker refreshes them.

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
