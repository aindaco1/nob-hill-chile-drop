PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  registration_open INTEGER NOT NULL DEFAULT 1 CHECK (registration_open IN (0,1)),
  capacity INTEGER NOT NULL DEFAULT 2000 CHECK (capacity BETWEEN 1 AND 2000),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  group_size INTEGER NOT NULL CHECK (group_size BETWEEN 1 AND 2000),
  consent_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  verified_at INTEGER,
  deleted_at INTEGER
);
CREATE TRIGGER entry_insert_revision AFTER INSERT ON entries BEGIN
  UPDATE settings SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER entry_update_revision AFTER UPDATE OF group_size,verified_at ON entries BEGIN
  UPDATE settings SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER entry_delete_revision AFTER DELETE ON entries BEGIN
  UPDATE settings SET revision = revision + 1 WHERE id = 1;
END;

CREATE TABLE tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('entry_link','entry_session','admin_link','admin_session')),
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by TEXT
);
CREATE INDEX tokens_expiry ON tokens(expires_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE draw_preview (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preview_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  results_json TEXT NOT NULL
);
CREATE TABLE drawing (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preview_id TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL,
  committed_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE TABLE results (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id),
  rank INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('selected','waitlisted'))
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  recipient_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','needs_review','expired','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  lease_until INTEGER,
  lease_token TEXT,
  provider_id TEXT,
  last_error TEXT
);
CREATE INDEX outbox_due ON outbox(status,next_attempt_at);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
