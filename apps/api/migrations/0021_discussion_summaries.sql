-- Request 43 (contract 1.25): the Primary Tracker's AI Summary of a
-- discussion: an entry with its earlier answers from the same source (Full
-- Discussion, mode 'source') or with the same Insight Topic and KIQ too (KIQ
-- Archive, mode 'kiq'). Written by the AI writer when it is connected, or by
-- an admin. `basis` fingerprints the answers it was written from (ids and
-- revisions), so a summary that no longer matches its discussion is known to
-- be out of date (an AI summary is then written again; a hand-written one is
-- kept and flagged).
CREATE TABLE discussion_summaries (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  item_id     TEXT NOT NULL REFERENCES intelligence_items(id),
  mode        TEXT NOT NULL CHECK (mode IN ('source', 'kiq')),
  text        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  model       TEXT,
  basis       TEXT NOT NULL,
  entries     INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, item_id, mode)
);
