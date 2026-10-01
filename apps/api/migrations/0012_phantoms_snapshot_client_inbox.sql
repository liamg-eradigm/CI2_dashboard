-- 1. Phantoms are an evergreen snapshot: the entry's values as first pushed to
--    the Tracker. Editing a Tracker entry afterwards no longer changes its
--    Phantom (Markdown, Phantoms table, alerts and newsletters). Option
--    renames still apply (they rename a label, not the content).
CREATE TABLE phantom_snapshots (
  item_id          TEXT PRIMARY KEY REFERENCES intelligence_items(id),
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  pub_date         TEXT,
  title            TEXT,
  macrotrend       TEXT,
  subtrend         TEXT,
  growth           TEXT,
  impact           TEXT,
  record_id        TEXT,
  extra_json       TEXT NOT NULL DEFAULT '{}',
  competitors_json TEXT NOT NULL DEFAULT '[]',
  published_rev    INTEGER NOT NULL DEFAULT 1,
  approved_at      TEXT,
  approved_by      TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX ix_phantom_tenant ON phantom_snapshots (tenant_id, pub_date);

-- Existing entries: their Phantom is what they are today.
INSERT INTO phantom_snapshots (item_id, tenant_id, pub_date, title, macrotrend, subtrend, growth, impact, record_id, extra_json, competitors_json, published_rev, approved_at, approved_by, created_at)
SELECT i.id, i.tenant_id, i.pub_date, i.title, i.macrotrend, i.subtrend, i.growth, i.impact, i.record_id, COALESCE(i.extra_json, '{}'),
       COALESCE((SELECT json_group_array(c.competitor) FROM item_competitors c WHERE c.item_id = i.id), '[]'),
       COALESCE(i.published_rev, 1), i.approved_at, i.approved_by, COALESCE(i.approved_at, i.updated_at)
  FROM intelligence_items i
 WHERE i.status = 'approved';

-- 2. Client Inbox: an entry awaiting review can be sent to the client
--    (with_client_at set) and sent back (client_returned_at set). It stays
--    'needs_review' throughout, so the status rules do not change.
ALTER TABLE intelligence_items ADD COLUMN with_client_at TEXT;
ALTER TABLE intelligence_items ADD COLUMN sent_to_client_by TEXT REFERENCES users(id);
ALTER TABLE intelligence_items ADD COLUMN client_returned_at TEXT;
ALTER TABLE intelligence_items ADD COLUMN client_returned_by TEXT REFERENCES users(id);
CREATE INDEX ix_item_with_client ON intelligence_items (tenant_id, with_client_at) WHERE with_client_at IS NOT NULL;

-- 3. Comments on an entry's text (like Word comments): anchored to a field,
--    the highlighted text and its position in that field.
CREATE TABLE item_comments (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  item_id      TEXT NOT NULL REFERENCES intelligence_items(id),
  field_key    TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  quote        TEXT NOT NULL,
  body         TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  TEXT REFERENCES users(id),
  deleted_at   TEXT
);
CREATE INDEX ix_comments_item ON item_comments (tenant_id, item_id, created_at);
