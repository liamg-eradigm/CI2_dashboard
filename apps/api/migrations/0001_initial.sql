-- Eradigm CI platform — initial schema (Cloudflare D1 / SQLite).
--
-- Every tenant-owned table carries tenant_id and every query in the API
-- filters on it. Large page snapshots live in R2; this database only holds
-- the reference, fingerprint, descriptive details, retention status and
-- access scope of each snapshot (4_Backend_Design).

PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- No passwords are ever stored: identity comes from the trusted sign-in
-- service (Cloudflare Access + the organisation's identity provider).
CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                  TEXT NOT NULL,
  -- Sessions whose token was issued before this instant are rejected ("end active sessions").
  sessions_valid_after  TEXT,
  last_sign_in_at       TEXT,  -- issued-at of the most recent sign-in token (sign-ins are audited once per session)
  created_at            TEXT NOT NULL,
  created_by            TEXT,
  last_seen_at          TEXT
);

-- Assigned roles are separate, append-only records: a role change revokes the
-- current assignment and inserts a new one, so history is preserved.
CREATE TABLE role_assignments (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL CHECK (role IN ('admin', 'analyst', 'client')),
  active       INTEGER NOT NULL DEFAULT 1,
  assigned_by  TEXT,
  assigned_at  TEXT NOT NULL,
  revoked_at   TEXT,
  revoked_by   TEXT
);
CREATE UNIQUE INDEX ux_role_current ON role_assignments (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_role_user ON role_assignments (user_id);

CREATE TABLE tenant_settings (
  tenant_id      TEXT PRIMARY KEY REFERENCES tenants(id),
  settings_json  TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

-- ---------------------------------------------------------------------------
-- Tracker schema (columns + dropdown options, editable per tenant)
-- ---------------------------------------------------------------------------

CREATE TABLE schema_meta (
  tenant_id  TEXT PRIMARY KEY REFERENCES tenants(id),
  revision   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tracker_columns (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('date', 'multi', 'macro', 'sub', 'text', 'select')),
  core        INTEGER NOT NULL DEFAULT 0,
  required    INTEGER NOT NULL DEFAULT 0,
  ai_assist   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL,
  deleted_at  TEXT,
  PRIMARY KEY (tenant_id, key)
);

-- Options for select/multi columns. Macrotrends use column_key='macrotrend';
-- subtrends use column_key='subtrend' with parent = macrotrend name.
CREATE TABLE column_options (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  column_key  TEXT NOT NULL,
  value       TEXT NOT NULL,
  parent      TEXT,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_option ON column_options (tenant_id, column_key, value);

CREATE TABLE counters (
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  value      INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- Ingestion
-- ---------------------------------------------------------------------------

CREATE TABLE submissions (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  submitted_by     TEXT NOT NULL REFERENCES users(id),
  input_type       TEXT NOT NULL CHECK (input_type IN ('url', 'file')),
  submitted_url    TEXT,
  normalized_url   TEXT,
  file_name        TEXT,
  file_sha256      TEXT,
  idempotency_key  TEXT,
  created_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_submission_idem ON submissions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE intelligence_items (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  submission_id       TEXT NOT NULL REFERENCES submissions(id),
  code                TEXT NOT NULL,              -- INB-2207
  signal_code         TEXT,                       -- SIG-1180 once approved
  status              TEXT NOT NULL CHECK (status IN ('queued','fetching','extracting','needs_review','approved','rejected','failed','deleted')),
  version             INTEGER NOT NULL DEFAULT 1, -- optimistic concurrency for edits/decisions
  op_token            TEXT,                       -- token of the last state-changing operation (guards multi-statement batches)
  attempts            INTEGER NOT NULL DEFAULT 1,
  input_type          TEXT NOT NULL,
  url_key             TEXT,                       -- normalised URL for duplicate detection
  file_sha256         TEXT,
  content_sha256      TEXT,                       -- fingerprint of extracted article text
  duplicate_of        TEXT,
  quarantined         INTEGER NOT NULL DEFAULT 0,
  outlet              TEXT,
  submitted_url       TEXT,
  final_url           TEXT,
  received_at         TEXT NOT NULL,
  submitted_by        TEXT,
  headline            TEXT,
  body_text           TEXT,
  publication_date    TEXT,                       -- as extracted from the source (source-derived)
  current_snapshot_id TEXT,
  draft_json          TEXT NOT NULL DEFAULT '{}',
  provenance_json     TEXT NOT NULL DEFAULT '{}', -- per field: source | ai | analyst
  extraction_json     TEXT,                       -- per field: value, confidence, evidence, warnings
  model_warnings_json TEXT NOT NULL DEFAULT '[]',
  warnings_count      INTEGER NOT NULL DEFAULT 0,
  error_code          TEXT,
  error_message       TEXT,
  -- Published projection (only populated while status = 'approved').
  published_rev       INTEGER,
  pub_date            TEXT,
  title               TEXT,
  macrotrend          TEXT,
  subtrend            TEXT,
  growth              TEXT,
  impact              TEXT,
  extra_json          TEXT NOT NULL DEFAULT '{}',
  approved_at         TEXT,
  approved_by         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE UNIQUE INDEX ux_item_code ON intelligence_items (tenant_id, code);
CREATE UNIQUE INDEX ux_item_signal ON intelligence_items (tenant_id, signal_code) WHERE signal_code IS NOT NULL;
-- Idempotent submissions: one live item per URL / uploaded file per tenant.
CREATE UNIQUE INDEX ux_item_url ON intelligence_items (tenant_id, url_key) WHERE url_key IS NOT NULL AND status <> 'deleted';
CREATE UNIQUE INDEX ux_item_file ON intelligence_items (tenant_id, file_sha256) WHERE file_sha256 IS NOT NULL AND status <> 'deleted';
CREATE INDEX ix_item_status ON intelligence_items (tenant_id, status, received_at);
CREATE INDEX ix_item_content ON intelligence_items (tenant_id, content_sha256);
CREATE INDEX ix_item_pub ON intelligence_items (tenant_id, status, pub_date);
CREATE INDEX ix_item_macro ON intelligence_items (tenant_id, status, macrotrend, subtrend);

-- Published competitor associations (multi-valued Competitor column).
CREATE TABLE item_competitors (
  tenant_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL REFERENCES intelligence_items(id),
  competitor  TEXT NOT NULL,
  PRIMARY KEY (item_id, competitor)
);
CREATE INDEX ix_comp ON item_competitors (tenant_id, competitor);

CREATE TABLE source_snapshots (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  item_id           TEXT NOT NULL REFERENCES intelligence_items(id),
  attempt           INTEGER NOT NULL,
  r2_key            TEXT NOT NULL,
  sha256            TEXT NOT NULL,            -- digital fingerprint of the stored (sanitised) snapshot
  raw_sha256        TEXT,                     -- fingerprint of the bytes as retrieved
  bytes             INTEGER NOT NULL,
  content_type      TEXT NOT NULL,
  http_status       INTEGER,
  final_url         TEXT,
  redirects         INTEGER NOT NULL DEFAULT 0,
  capture_method    TEXT NOT NULL,            -- fetch | browser | container | upload
  single_file       INTEGER NOT NULL DEFAULT 0,
  encrypted         INTEGER NOT NULL DEFAULT 0,
  access_scope      TEXT NOT NULL DEFAULT 'tenant',
  retention_status  TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'expired', 'deleted')),
  retain_until      TEXT,
  retrieved_at      TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE UNIQUE INDEX ux_snapshot ON source_snapshots (item_id, sha256);
CREATE INDEX ix_snapshot_retention ON source_snapshots (retention_status, retain_until);

CREATE TABLE processing_attempts (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  item_id             TEXT NOT NULL REFERENCES intelligence_items(id),
  attempt             INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  stage               TEXT NOT NULL,
  requested_by        TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  error_code          TEXT,
  error_message       TEXT,
  extraction_version  TEXT,
  prompt_version      TEXT,
  schema_version      TEXT,
  redaction_version   TEXT,
  provider            TEXT,
  model               TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  steps_json          TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX ux_attempt ON processing_attempts (item_id, attempt);

CREATE TABLE item_revisions (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  item_id          TEXT NOT NULL REFERENCES intelligence_items(id),
  seq              INTEGER NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('llm_draft', 'analyst_edit', 'published')),
  published_rev    INTEGER,
  values_json      TEXT NOT NULL,
  provenance_json  TEXT NOT NULL DEFAULT '{}',
  changed_keys     TEXT NOT NULL DEFAULT '[]',
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  note             TEXT
);
CREATE UNIQUE INDEX ux_revision_seq ON item_revisions (item_id, seq);
CREATE UNIQUE INDEX ux_revision_pub ON item_revisions (item_id, published_rev) WHERE published_rev IS NOT NULL;

CREATE TABLE review_decisions (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  item_id      TEXT NOT NULL REFERENCES intelligence_items(id),
  revision_id  TEXT,
  decision     TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'reprocess')),
  reviewer_id  TEXT NOT NULL,
  decided_at   TEXT NOT NULL,
  note         TEXT,
  corrected_keys TEXT NOT NULL DEFAULT '[]'  -- fields the analyst changed from the AI draft
);
CREATE INDEX ix_decision_item ON review_decisions (item_id);
CREATE INDEX ix_decision_tenant ON review_decisions (tenant_id, decided_at);

CREATE TABLE capture_log (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  item_id    TEXT,
  at         TEXT NOT NULL,
  input      TEXT NOT NULL,
  final_url  TEXT,
  outcome    TEXT NOT NULL,
  ok         INTEGER NOT NULL
);
CREATE INDEX ix_capture_log ON capture_log (tenant_id, at);

-- Quarantine incidents: only a non-sensitive category and timestamp.
CREATE TABLE incidents (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  item_id      TEXT,
  category     TEXT NOT NULL,
  at           TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  TEXT
);
CREATE INDEX ix_incident ON incidents (tenant_id, at);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'admin',
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  read_at     TEXT
);

CREATE TABLE saved_views (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('dashboard', 'tracker', 'trend')),
  state_json  TEXT NOT NULL,
  shared      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX ix_views ON saved_views (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- Tamper-resistant audit record
-- ---------------------------------------------------------------------------
-- Each tenant has a hash chain: hash = HMAC(key, prev_hash || canonical event).
-- The unique index on (chain, prev_hash) makes the chain strictly linear even
-- under concurrent writers; triggers make the table append-only.

CREATE TABLE audit_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  chain        TEXT NOT NULL,
  tenant_id    TEXT,
  at           TEXT NOT NULL,
  actor_id     TEXT,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_audit_chain ON audit_events (chain, prev_hash);
CREATE INDEX ix_audit_tenant ON audit_events (tenant_id, seq);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;
