-- Request 34 (contract 1.20): a Macrotrend's analysis in sections, one per
-- text cell of its dashboard (Analytics → Megatrends Dashboard → Megatrends →
-- a Macrotrend). Each section is optional; a submission changes only the
-- sections it fills in. CI analyses (trend_analyses) keeps each submission
-- with the sections it filled in.
CREATE TABLE macrotrend_sections (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  macrotrend  TEXT NOT NULL,
  section     TEXT NOT NULL CHECK (section IN ('overview', 'why', 'current', 'longterm', 'next', 'abbvie')),
  text        TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, macrotrend, section)
);
ALTER TABLE trend_analyses ADD COLUMN sections_json TEXT;
