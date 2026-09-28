-- Sign-in with Microsoft Entra ID (any organisation's work or school account).
--
-- A platform account is linked to exactly one Microsoft identity, identified by
-- the immutable pair (tenant id, object id) from the ID token, never by email:
-- in multi-organisation sign-in the email claim is set by each organisation's
-- own administrators, so it cannot prove who someone is. Linking happens only
-- through a one-time invite link issued by an admin or analyst.
ALTER TABLE users ADD COLUMN entra_tid TEXT;
ALTER TABLE users ADD COLUMN entra_oid TEXT;
ALTER TABLE users ADD COLUMN entra_linked_at TEXT;
CREATE UNIQUE INDEX ux_users_entra ON users (entra_tid, entra_oid) WHERE entra_oid IS NOT NULL;

-- Server-side sessions. Only a SHA-256 hash of the session token is stored.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,          -- sha256(token), hex
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,             -- absolute limit
  user_agent    TEXT
);
CREATE INDEX ix_sessions_user ON sessions (user_id);
CREATE INDEX ix_sessions_expiry ON sessions (expires_at);

-- One-time invite / sign-in links. Only a SHA-256 hash of the token is stored.
CREATE TABLE user_invites (
  id            TEXT PRIMARY KEY,          -- sha256(token), hex
  user_id       TEXT NOT NULL REFERENCES users(id),
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  revoked_at    TEXT
);
CREATE INDEX ix_invites_user ON user_invites (user_id);
