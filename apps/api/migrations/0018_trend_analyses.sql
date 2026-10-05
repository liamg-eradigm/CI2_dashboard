-- Trend Analyses (request 29, contract 1.18): every trend analysis submitted on
-- the Input page (one at a time or from a spreadsheet). Submitting one also
-- writes the trend's summary (trend_summaries), which the Trend analysis
-- subtab and the knowledge graph show; this table keeps each submission for
-- the Trend Analyses tracker and its Markdown file.
CREATE TABLE trend_analyses (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  level         TEXT NOT NULL CHECK (level IN ('macro', 'sub', 'competitor')),
  name          TEXT NOT NULL,
  parent        TEXT,
  text          TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('form', 'import')),
  file_name     TEXT,
  submitted_by  TEXT REFERENCES users(id),
  submitted_at  TEXT NOT NULL
);
CREATE INDEX ix_trend_analyses ON trend_analyses (tenant_id, submitted_at);
