-- Request 23: the Competitors tab. Competitor summaries are stored with the
-- Megatrends summaries under a new level, 'competitor' (defaults ship with the
-- dashboard in packages/shared/src/competitors.ts). SQLite cannot change a
-- CHECK constraint in place, so the table is rebuilt with its rows.
CREATE TABLE trend_summaries_new (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  level        TEXT NOT NULL CHECK (level IN ('macro', 'sub', 'competitor')),
  name         TEXT NOT NULL,
  parent       TEXT,
  text         TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  model        TEXT,
  window_days  INTEGER,
  entries      INTEGER,
  updated_by   TEXT REFERENCES users(id),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, level, name)
);
INSERT INTO trend_summaries_new (tenant_id, level, name, parent, text, source, model, window_days, entries, updated_by, updated_at)
  SELECT tenant_id, level, name, parent, text, source, model, window_days, entries, updated_by, updated_at FROM trend_summaries;
DROP TABLE trend_summaries;
ALTER TABLE trend_summaries_new RENAME TO trend_summaries;

-- Competitor pages: entries per competitor and pairs named together.
CREATE INDEX IF NOT EXISTS ix_comp_item ON item_competitors (item_id);
