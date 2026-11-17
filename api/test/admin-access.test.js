import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { ticketCredential } from '../src/tickets.js';

const owner = 'owner@example.test', added = 'new-admin@example.test';
async function login(f, email, kind = 'admin') {
  assert.equal((await f.request(`/api/${kind}/login`, { method: 'POST', body: { email } })).status, kind === 'admin' ? 202 : 200);
  return f.request(`/api/${kind}/verify`, { method: 'POST', body: { token: await f.link(`${kind}_link`, email) } });
}
async function setup(t) {
  const f = fixture(); t.after(f.close); f.env.SUPER_ADMIN_EMAILS = owner;
  const root = (await login(f, owner)).body.accessToken;
  const change = (email, active, token = root, extra = {}) => f.request('/api/admin/access', { method: 'POST', token, body: { email, active, ...extra } });
  return { f, root, change };
}

test('only a configured super admin can list or change admins; access changes send no mail', async t => {
  const { f, root, change } = await setup(t);
  const regular = await f.admin();
  const beforeMail = f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n;
  assert.equal((await f.request('/api/admin/access')).status, 401);
  assert.equal((await f.request('/api/admin/access', { token: regular })).status, 403);
  assert.equal((await change(added, true, regular)).status, 403);
  const result = await change('  NEW-admin@EXAMPLE.test  ', true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.admins.find(row => row.email === added), { email: added, role: 'admin', protected: false });
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n, beforeMail);
  assert.equal(f.calls.length, 0);
  const auth = (await login(f, added)).body.accessToken;
  assert.equal((await f.request('/api/admin/entries', { token: auth })).status, 200);
  assert.deepEqual((await f.request('/api/admin/session', { token: auth })).body, { email: added, role: 'admin', canManageAdmins: false });
  assert.equal((await f.request('/api/admin/entries', { token: root })).body.viewer.canManageAdmins, true);
  assert.equal((await change('attacker@example.test', true, auth)).status, 403);
  assert.equal((await f.request('/api/admin/access', { token: auth })).status, 403);
  await f.request('/api/admin/volunteers', { method: 'POST', token: regular, body: { email: 'door@example.test', active: true } });
  const volunteer = (await login(f, 'door@example.test', 'door')).body.accessToken;
  assert.equal((await change(added, false, volunteer)).status, 401);
  const entryId = f.seedEntry();
  const email = f.DB.prepare('SELECT email FROM entries WHERE id=?').bind(entryId).first().email;
  await f.request('/api/entries/link', { method: 'POST', body: { email } });
  const guest = await f.request('/api/entries/verify', { method: 'POST', body: { token: await f.link('entry_link', email) } });
  assert.equal((await change(added, false, guest.body.accessToken)).status, 401);
});

test('protected accounts cannot be removed or promoted through the management API', async t => {
  const { f, root, change } = await setup(t);
  for (const email of [owner, f.env.ADMIN_EMAILS]) assert.equal((await change(email, false)).status, 409);
  for (const [email, active, extra] of [['bad', true, {}], [added, 'true', {}], [added, true, { role: 'super_admin' }], [added, true, { canManageAdmins: true }]]) {
    assert.equal((await change(email, active, root, extra)).status, 400);
  }
  assert.equal((await change(added, true)).status, 200);
  const auth = (await login(f, added)).body.accessToken;
  assert.equal((await change(added, true)).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM admin_access').first().n, 1);
  assert.equal((await f.request('/api/admin/session', { token: auth })).status, 200);
  f.env.SUPER_ADMIN_EMAILS = '';
  assert.equal((await change('other@example.test', true)).status, 401);
});

test('revocation invalidates organizer and check-in sessions and pending links, including after re-add', async t => {
  const { f, change } = await setup(t);
  await change(added, true);
  const admin = (await login(f, added)).body.accessToken;
  const door = (await login(f, added, 'door')).body.accessToken;
  await f.request('/api/admin/login', { method: 'POST', body: { email: added } });
  const pendingAdmin = await f.link('admin_link', added);
  await f.request('/api/door/login', { method: 'POST', body: { email: added } });
  const pendingDoor = await f.link('door_link', added);
  assert.equal((await f.request('/api/door/session', { token: admin })).status, 200);
  assert.equal((await f.request('/api/door/session', { token: door })).status, 200);
  const before = f.DB.prepare('SELECT * FROM outbox ORDER BY id').all().results;
  await change(added, false);
  assert.deepEqual(f.DB.prepare('SELECT * FROM outbox ORDER BY id').all().results, before);
  for (const token of [admin, door]) {
    assert.equal((await f.request('/api/admin/entries', { token })).status, 401);
    assert.equal((await f.request('/api/door/session', { token })).status, 401);
  }
  await change(added, true);
  for (const [kind, token] of [['admin', pendingAdmin], ['door', pendingDoor]]) {
    assert.equal((await f.request(`/api/${kind}/verify`, { method: 'POST', body: { token } })).status, 401);
  }
  assert.equal((await f.request('/api/admin/session', { token: admin })).status, 401);
  assert.equal((await login(f, added)).status, 200);
});

test('database-backed admins retain guarded whole-group check-in permissions', async t => {
  const { f, root, change } = await setup(t);
  await change(added, true);
  const auth = (await login(f, added)).body.accessToken;
  const id = f.seedEntry(3);
  await f.request('/api/admin/settings', { method: 'PATCH', token: root, body: { registrationOpen: false, capacity: 2000 } });
  const preview = (await f.request('/api/admin/draw/preview', { method: 'POST', token: root, body: {} })).body;
  await f.request('/api/admin/draw/commit', { method: 'POST', token: root, body: { previewId: preview.previewId } });
  await f.request('/api/admin/draw/publish', { method: 'POST', token: root, body: {} });
  const door = (await f.request('/api/admin/door', { token: root })).body;
  const open = await f.request('/api/admin/door', { method: 'PATCH', token: root, body: { admissionOpen: true, selectedCutoffAt: null, revision: door.revision } });
  const body = { ticket: await ticketCredential(f.env, id, preview.previewId), requestId: crypto.randomUUID(), revision: open.body.revision, wholeGroupPresent: true, spaceConfirmed: true };
  assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: auth, body })).status, 200);
  assert.equal(f.DB.prepare('SELECT SUM(group_size) AS n FROM admissions').first().n, 3);
});

test('revocation during a pending login cannot create a usable organizer or door link', async t => {
  for (const kind of ['admin', 'door']) {
    const { f, change } = await setup(t);
    await change(added, true);
    const original = f.DB.batch;
    const oldMail = f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n;
    f.DB.batch = statements => {
      f.DB.prepare('UPDATE admin_access SET active=0 WHERE email=?').bind(added).run();
      return original(statements);
    };
    const result = await f.request(`/api/${kind}/login`, { method: 'POST', body: { email: added } });
    assert.equal(result.status, kind === 'admin' ? 202 : 200);
    assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n, oldMail);
    assert.equal(f.DB.prepare(kind === 'admin' ? 'SELECT COUNT(*) AS n FROM tokens WHERE subject=?' : 'SELECT COUNT(*) AS n FROM door_tokens WHERE email=?').bind(added).first().n, 0);
  }
});

test('revocation at link exchange prevents new organizer and door sessions', async t => {
  for (const kind of ['admin', 'door']) {
    const { f, change } = await setup(t);
    await change(added, true);
    await f.request(`/api/${kind}/login`, { method: 'POST', body: { email: added } });
    const token = await f.link(`${kind}_link`, added);
    const original = f.DB.batch;
    f.DB.batch = statements => {
      f.DB.prepare('UPDATE admin_access SET active=0 WHERE email=?').bind(added).run();
      return original(statements);
    };
    assert.equal((await f.request(`/api/${kind}/verify`, { method: 'POST', body: { token } })).status, 401);
    const sql = kind === 'admin' ? "SELECT COUNT(*) AS n FROM tokens WHERE subject=? AND kind='admin_session'" : "SELECT COUNT(*) AS n FROM door_tokens WHERE email=? AND kind='session'";
    assert.equal(f.DB.prepare(sql).bind(added).first().n, 0);
  }
});

test('admin-access migration preserves every existing table and row', t => {
  const f = fixture(); t.after(f.close);
  f.DB.sqlite.exec('DROP TABLE admin_access');
  f.seedEntry(5, false, 'Preserved guest');
  const tables = f.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const before = tables.map(table => f.DB.sqlite.prepare(`SELECT * FROM ${table}`).all());
  f.DB.sqlite.exec(readFileSync(new URL('../migrations/0005_admin_access.sql', import.meta.url), 'utf8'));
  assert.deepEqual(tables.map(table => f.DB.sqlite.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM admin_access').first().n, 0);
});
