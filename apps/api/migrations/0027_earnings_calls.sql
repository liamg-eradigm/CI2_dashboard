-- Request 64 (CI SQUARED): earnings calls. Each holds its text fields, the
-- Markdown made from them, and its report (.docx) in chunks of bytes (a D1
-- value is at most 2 MB).
CREATE TABLE earnings_calls (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  quarter       TEXT NOT NULL,
  company       TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT '',
  loe           TEXT NOT NULL DEFAULT '',
  ai_tools      TEXT NOT NULL DEFAULT '',
  dtp           TEXT NOT NULL DEFAULT '',
  ira           TEXT NOT NULL DEFAULT '',
  investment    TEXT NOT NULL DEFAULT '',
  trends        TEXT NOT NULL DEFAULT '',
  markdown      TEXT NOT NULL,
  report_name   TEXT NOT NULL,
  report_size   INTEGER NOT NULL,
  submitted_at  TEXT NOT NULL,
  submitted_by  TEXT REFERENCES users(id)
);
CREATE INDEX ix_earnings_calls_tenant ON earnings_calls (tenant_id, submitted_at);

CREATE TABLE earnings_call_files (
  call_id    TEXT NOT NULL REFERENCES earnings_calls(id),
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  seq        INTEGER NOT NULL,
  data       BLOB NOT NULL,
  PRIMARY KEY (call_id, seq)
);
