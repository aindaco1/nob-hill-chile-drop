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


test('location migration leaves legacy details, eligibility and fixed drawing untouched', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const migration = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  db.exec(migration('0001_drawing.sql'));
  db.exec(migration('0002_media_consent_and_display.sql'));
  db.exec(`INSERT INTO entries (id,email,name,group_size,consent_version,created_at,updated_at,verified_at)
    VALUES ('legacy','legacy@example.test','Legacy guest',10,'old',1,1,1);
    UPDATE settings SET registration_open=0,hero_media='channel26';
    INSERT INTO draw_preview (id,preview_id,revision,capacity,created_at,results_json)
    SELECT 1,'fixed',revision,capacity,2,'[{"entryId":"legacy","groupSize":10,"rank":1,"status":"selected"}]' FROM settings;`);
  const entry = db.prepare('SELECT * FROM entries').get();
  const settings = db.prepare('SELECT * FROM settings').get();
  const preview = db.prepare('SELECT * FROM draw_preview').get();
  db.exec(migration('0003_entry_location.sql'));
  assert.deepEqual({ ...db.prepare('SELECT * FROM entries').get() }, { ...entry, city: null, state_province: null, country: null });
  assert.deepEqual(db.prepare('SELECT * FROM settings').get(), settings);
  assert.deepEqual(db.prepare('SELECT * FROM draw_preview').get(), preview);
});

test('admission migration preserves the current drawing, entries and queued messages and starts closed', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const migration = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
  for (const name of ['0001_drawing.sql','0002_media_consent_and_display.sql','0003_entry_location.sql']) db.exec(migration(name));
  db.exec(`INSERT INTO entries(id,email,name,group_size,consent_version,created_at,updated_at,verified_at) VALUES('legacy','legacy@example.test','Legacy',4,'old',1,1,1);
    UPDATE settings SET registration_open=0;
    INSERT INTO draw_preview SELECT 1,'fixed',revision,capacity,2,'[]' FROM settings;
    INSERT INTO drawing VALUES(1,'fixed',2000,3,4);
    INSERT INTO results VALUES('legacy',1,'selected');
    INSERT INTO outbox(id,kind,recipient_id,payload,created_at,next_attempt_at,expires_at) VALUES('winner:fixed:legacy','winner','legacy','frozen',4,4,999);`);
  const tables = ['entries','settings','draw_preview','drawing','results','outbox'];
  const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
  db.exec(migration('0004_group_admission.sql'));
  assert.deepEqual(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.deepEqual({ ...db.prepare('SELECT * FROM door_settings').get() }, {id:1,admission_open:0,selected_cutoff_at:null,revision:0});
  for (const table of ['admissions','door_staff','door_tokens']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});
