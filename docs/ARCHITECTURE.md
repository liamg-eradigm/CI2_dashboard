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
- **Menu in groups** (request 28, contract 1.17; regrouped in request 31,
  contract 1.19; renamed in request 34; `packages/shared/src/menu.ts`): the
  menu is four groups, each a button that opens its tabs: Inputs (Input,
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
