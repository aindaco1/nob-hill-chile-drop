import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('media migration preserves legacy entry consent, settings, revision and fixed order', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const migration = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  db.exec(migration('0001_drawing.sql'));
  db.exec(`INSERT INTO entries (id,email,name,group_size,consent_version,created_at,updated_at,verified_at)
    VALUES ('legacy','legacy@example.test','Legacy guest',3,'free-drawing-2026-10-27',1,1,1);
    UPDATE settings SET capacity=100,registration_open=0 WHERE id=1;
    INSERT INTO draw_preview (id,preview_id,revision,capacity,created_at,results_json)
    SELECT 1,'fixed',revision,capacity,2,'[{"entryId":"legacy","groupSize":3,"rank":1,"status":"selected"}]' FROM settings;`);
  const entry = db.prepare('SELECT * FROM entries').get();
  const settings = db.prepare('SELECT * FROM settings').get();
  const preview = db.prepare('SELECT * FROM draw_preview').get();
  db.exec(migration('0002_media_consent_and_display.sql'));
  assert.deepEqual({ ...db.prepare('SELECT * FROM entries').get() }, { ...entry, media_consent_version: null, media_consent_at: null });
  assert.deepEqual({ ...db.prepare('SELECT * FROM settings').get() }, { ...settings, hero_media: 'animation' });
  assert.deepEqual(db.prepare('SELECT * FROM draw_preview').get(), preview);
  assert.throws(() => db.prepare('UPDATE settings SET hero_media=?').run('arbitrary-html'));
});
