-- Request 70 (CI SQUARED): competitors' logos for the Dashboard's Competitor
-- Profile, uploaded by admins (PNG, JPEG, WebP or GIF; at most 256 KB, so one
-- D1 value holds it).
CREATE TABLE competitor_logos (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BLOB NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  PRIMARY KEY (tenant_id, name)
);
