-- Additive: existing entrants have no recorded media consent; do not backfill it.
ALTER TABLE entries ADD COLUMN media_consent_version TEXT;
ALTER TABLE entries ADD COLUMN media_consent_at INTEGER;

-- Presentation is independent of the drawing revision and preparation lock.
ALTER TABLE settings ADD COLUMN hero_media TEXT NOT NULL DEFAULT 'animation'
  CHECK (hero_media IN ('animation', 'channel26'));
