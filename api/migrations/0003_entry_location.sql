-- Preserve legacy entries and fixed drawing ranks; unknown locations stay NULL.
-- Required location and the eight-person limit are enforced on new entries/owner edits.
ALTER TABLE entries ADD COLUMN city TEXT;
ALTER TABLE entries ADD COLUMN state_province TEXT;
ALTER TABLE entries ADD COLUMN country TEXT;
