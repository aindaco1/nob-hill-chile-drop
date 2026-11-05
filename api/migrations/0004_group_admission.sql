-- Additive: preserves entries, immutable drawing ranks and existing mail jobs.
CREATE TABLE door_settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  admission_open INTEGER NOT NULL DEFAULT 0 CHECK (admission_open IN (0,1)),
  selected_cutoff_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO door_settings(id) VALUES (1);
CREATE TABLE door_staff (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE door_tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('link','session')),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by TEXT
);
CREATE INDEX door_tokens_expiry ON door_tokens(expires_at);
CREATE TABLE admissions (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id),
  group_size INTEGER NOT NULL CHECK (group_size BETWEEN 1 AND 2000),
  admitted_at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('selected','waitlisted','late_selected'))
);
