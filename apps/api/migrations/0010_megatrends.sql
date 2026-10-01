-- Megatrends: a short summary per Macrotrend and Subtrend.
--
-- The dashboard ships default summaries (packages/shared/src/megatrends.ts);
-- a row here overrides the default for one tenant: written by an analyst
-- (source 'manual') or by the AI writer from recent entries (source 'ai',
-- with the model, time frame and number of entries it was written from).
-- Summaries are keyed by name and shared by the Primary and Secondary trackers.
-- Clearing a summary deletes its row (back to the default). The tab order and the AI writer's
-- settings live in tenant_settings (navOrder, megatrends): no change needed.
CREATE TABLE trend_summaries (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  level        TEXT NOT NULL CHECK (level IN ('macro', 'sub')),
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
