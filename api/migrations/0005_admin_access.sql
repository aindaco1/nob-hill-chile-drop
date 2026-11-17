-- Additive organizer access only. Existing event, auth and mail data is preserved.
CREATE TABLE admin_access (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  updated_at INTEGER NOT NULL
);
