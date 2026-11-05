import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { ticketCredential, ticketUrl } from '../src/tickets.js';
import { dispatchOutbox } from '../src/mail.js';

async function drawing(f, publish = true) {
  const admin = await f.admin();
  f.seedEntry(4, true, 'Example Guest'); f.seedEntry(4, true, '<script>Example</script>'); f.seedEntry(2, false);
  await f.request('/api/admin/settings', { method: 'PATCH', token: admin, body: { registrationOpen: false, capacity: 4 } });
  const preview = await f.request('/api/admin/draw/preview', { method: 'POST', token: admin, body: {} });
  await f.request('/api/admin/draw/commit', { method: 'POST', token: admin, body: { previewId: preview.body.previewId } });
  if (publish) assert.equal((await f.request('/api/admin/draw/publish', { method: 'POST', token: admin, body: {} })).status, 200);
  const results = f.DB.prepare('SELECT e.*,r.status FROM entries e JOIN results r ON r.entry_id=e.id').all().results;
  const selected = results.find(row => row.status === 'selected'); const waitlisted = results.find(row => row.status === 'waitlisted');
  return { admin, selected, waitlisted, selectedCode: await ticketCredential(f.env, selected.id, preview.body.previewId), waitlistCode: await ticketCredential(f.env, waitlisted.id, preview.body.previewId) };
}
async function volunteer(f, admin, email = 'volunteer@example.test') {
  assert.equal((await f.request('/api/admin/volunteers', { method: 'POST', token: admin, body: { email, active: true } })).status, 200);
  await f.request('/api/door/login', { method: 'POST', body: { email } });
  const link = await f.link('door_link', email);
  const result = await f.request('/api/door/verify', { method: 'POST', body: { token: link } });
  assert.equal(result.status, 200);
  return { token: result.body.accessToken, email, link };
}
async function open(f, admin, cutoff = null) {
  const current = await f.request('/api/admin/door', { token: admin });
  const result = await f.request('/api/admin/door', { method: 'PATCH', token: admin, body: { admissionOpen: true, selectedCutoffAt: cutoff, revision: current.body.revision } });
  assert.equal(result.status, 200); return result.body.revision;
}
function admission(ticket, revision, extras = {}) {
  return { ticket, revision, requestId: crypto.randomUUID(), wholeGroupPresent: true, spaceConfirmed: true, ...extras };
}

test('publication queues both outcomes once; each result email includes a distinct QR and honest status', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f);
  const jobs = f.DB.prepare("SELECT kind,COUNT(*) AS n FROM outbox WHERE kind IN ('winner','waitlist') GROUP BY kind").all().results;
  assert.equal(jobs.length, 2); assert.ok(jobs.every(row => row.n === 1));
  await f.request('/api/admin/draw/publish', { method: 'POST', token: d.admin, body: {} });
  await dispatchOutbox(f.env, f.dependencies); await dispatchOutbox(f.env, f.dependencies);
  const emails = [...f.messages.values()].map(row => row.payload).filter(row => row.subject.startsWith('Your group'));
  assert.equal(emails.length, 2);
  for (const email of emails) {
    assert.match(email.html, /cid:group-qr/); assert.equal(email.attachments[0].content_id, 'group-qr');
    assert.equal(Buffer.from(email.attachments[0].content, 'base64').subarray(0, 6).toString(), 'GIF87a');
    assert.match(email.text, /whole group must be present|whole group must be present/i);
    assert.doesNotMatch(email.html, /<script>Example<\/script>/);
  }
  const wait = emails.find(email => email.subject.includes('waitlist'));
  assert.match(wait.text, /Public viewing does not require a ticket/);
  assert.match(wait.text, /does not guarantee Hot Spot admission/);
  assert.notEqual(emails[0].attachments[0].content, emails[1].attachments[0].content);
});

test('QR verification reveals no contact information publicly and never admits the group', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f);
  const pub = await f.request('/api/pass', { method: 'POST', body: { ticket: d.selectedCode } });
  assert.equal(pub.status, 200); assert.equal(pub.body.pass.groupSize, 4);
  assert.doesNotMatch(JSON.stringify(pub.body), /@|name|actor|entryId/);
  assert.equal((await f.request('/api/door/inspect', { method: 'POST', body: { ticket: d.selectedCode } })).status, 401);
  const staff = await volunteer(f, d.admin);
  const inspected = await f.request('/api/door/inspect', { method: 'POST', token: staff.token, body: { ticket: d.selectedCode } });
  assert.equal(inspected.body.ticket.name, d.selected.name); assert.equal(inspected.body.ticket.email, d.selected.email);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n, 0);
  for (const ticket of [d.selectedCode.replace(/^./, d.selectedCode[0] === 'a' ? 'b' : 'a'), d.selectedCode.slice(0,-1)+'!', 'not-a-pass']) {
    assert.equal((await f.request('/api/pass', { method: 'POST', body: { ticket } })).status, 404);
  }
  assert.doesNotMatch(ticketUrl(f.env, d.selectedCode), /@/);
});

test('guest sessions and volunteers cannot administer settings, drawing or other volunteers', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f); const staff = await volunteer(f, d.admin);
  await f.request('/api/entries/link', { method: 'POST', body: { email: d.selected.email } });
  const owner = await f.request('/api/entries/verify', { method: 'POST', body: { token: await f.link('entry_link', d.selected.email) } });
  assert.equal(owner.status, 200);
  for (const token of [undefined, owner.body.accessToken]) {
    assert.equal((await f.request('/api/door/check-in', { method: 'POST', token, body: admission(d.selectedCode, 0) })).status, 401);
  }
  for (const path of ['/api/admin/door','/api/admin/entries.csv']) assert.equal((await f.request(path, { token: staff.token })).status, 401);
  for (const path of ['/api/admin/draw/publish','/api/admin/volunteers']) assert.equal((await f.request(path, { method: 'POST', token: staff.token, body: {} })).status, 401);
  const pass = await f.request('/api/entries/pass', { token: owner.body.accessToken });
  assert.match(pass.body.pass.qrDataUrl, /^data:image\/gif;base64,/);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n, 0);
});

test('volunteer links are single-use; removing access invalidates sessions and old links even if access is restored', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f); const staff = await volunteer(f, d.admin);
  assert.equal((await f.request('/api/door/verify', { method: 'POST', body: { token: staff.link } })).status, 401);
  await f.request('/api/admin/volunteers', { method: 'POST', token: d.admin, body: { email: staff.email, active: false } });
  assert.equal((await f.request('/api/door/session', { token: staff.token })).status, 401);
  await f.request('/api/admin/volunteers', { method: 'POST', token: d.admin, body: { email: staff.email, active: true } });
  assert.equal((await f.request('/api/door/session', { token: staff.token })).status, 401);
  const before = f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n;
  assert.equal((await f.request('/api/door/login', { method: 'POST', body: { email: 'stranger@example.test' } })).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n, before);
});

test('whole-party confirmation, door opening and cutoff are enforced by the API', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f); const staff = await volunteer(f, d.admin);
  assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: staff.token, body: admission(d.selectedCode, 0) })).body.code, 'door_closed');
  let revision = await open(f, d.admin);
  for (const extra of [{ wholeGroupPresent: false }, { spaceConfirmed: false }, { wholeGroupPresent: 'true' }]) {
    assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: staff.token, body: admission(d.selectedCode, revision, extra) })).status, 400);
  }
  assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: staff.token, body: admission(d.waitlistCode, revision) })).body.code, 'waitlist_closed');
  revision = await open(f, d.admin, f.now()+60_000);
  assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: staff.token, body: admission(d.waitlistCode, revision) })).body.code, 'waitlist_closed');
  f.advance(60_000);
  assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: staff.token, body: admission(d.waitlistCode, revision) })).status, 200);
  const count = (await f.request('/api/admin/door', { token: d.admin })).body.counts;
  assert.deepEqual(count, { groups: 1, people: 4, waitlistedPeople: 4 });
});

test('concurrent volunteers and uncertain-response retries record exactly one whole-group admission and audit event', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f); const a = await volunteer(f, d.admin); const b = await volunteer(f, d.admin, 'second@example.test');
  const revision = await open(f, d.admin); const body = admission(d.selectedCode, revision);
  const results = await Promise.all([a,b].map(staff => f.request('/api/door/check-in', { method: 'POST', token: staff.token, body: staff === a ? body : admission(d.selectedCode, revision) })));
  assert.deepEqual(results.map(row => row.status), [200,200]);
  assert.equal(results.filter(row => !row.body.alreadyCheckedIn).length, 1);
  const retry = await f.request('/api/door/check-in', { method: 'POST', token: a.token, body });
  assert.equal(retry.body.alreadyCheckedIn, true);
  assert.equal(f.DB.prepare('SELECT SUM(group_size) AS n FROM admissions').first().n, 4);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='group_admitted'").first().n, 1);
});

test('changing door settings invalidates a previously reviewed admission; scans never expose results before publication', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f, false);
  assert.equal((await f.request('/api/pass', { method: 'POST', body: { ticket: d.selectedCode } })).status, 404);
  assert.equal((await f.request('/api/admin/door', { method: 'PATCH', token: d.admin, body: { admissionOpen: true, selectedCutoffAt: null, revision: 0 } })).status, 409);
  await f.request('/api/admin/draw/publish', { method: 'POST', token: d.admin, body: {} });
  const revision = await open(f, d.admin);
  await open(f, d.admin, f.now());
  const stale = await f.request('/api/door/check-in', { method: 'POST', token: d.admin, body: admission(d.selectedCode, revision) });
  assert.equal(stale.body.code, 'stale_door');
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n, 0);
});

test('initial admission count may grow with staff-managed turnover and never claims to measure occupancy', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f);
  const revision = await open(f, d.admin, f.now());
  for (const ticket of [d.selectedCode, d.waitlistCode]) assert.equal((await f.request('/api/door/check-in', { method: 'POST', token: d.admin, body: admission(ticket, revision) })).status, 200);
  const data = (await f.request('/api/admin/door', { token: d.admin })).body;
  assert.equal(data.counts.people, 8); assert.equal(data.counts.groups, 2);
  assert.equal(f.DB.prepare('SELECT capacity FROM settings').first().capacity, 4);
  assert.equal(f.DB.prepare("SELECT SUM(e.group_size) AS n FROM results r JOIN entries e ON e.id=r.entry_id WHERE r.status='selected'").first().n, 4);
});

test('privacy erasure revokes a QR but preserves non-identifying admission totals and fixed ranks', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f); const revision = await open(f, d.admin);
  await f.request('/api/door/check-in', { method: 'POST', token: d.admin, body: admission(d.selectedCode, revision) });
  await f.request(`/api/admin/entries/${d.selected.id}`, { method: 'DELETE', token: d.admin });
  assert.equal((await f.request('/api/pass', { method: 'POST', body: { ticket: d.selectedCode } })).status, 404);
  const data = (await f.request('/api/admin/door', { token: d.admin })).body;
  assert.equal(data.counts.people, 4); assert.equal(data.recent.length, 0);
  assert.equal(f.DB.prepare('SELECT status FROM results WHERE entry_id=?').bind(d.selected.id).first().status, 'selected');
});

test('ticket readiness gates publication, and volunteer session expiration and logout revoke writes', async t => {
  const f = fixture(); t.after(f.close); const d = await drawing(f, false); const signing = f.env.TICKET_SIGNING_KEY;
  f.env.TICKET_SIGNING_KEY = '';
  assert.equal((await f.request('/api/admin/draw/publish', { method: 'POST', token: d.admin, body: {} })).body.code, 'tickets_unavailable');
  assert.equal(f.DB.prepare('SELECT published_at FROM drawing').first().published_at, null);
  f.env.TICKET_SIGNING_KEY = signing;
  const staff = await volunteer(f, d.admin);
  assert.equal((await f.request('/api/door/logout', { method: 'POST', token: staff.token, body: {} })).status, 200);
  assert.equal((await f.request('/api/door/session', { token: staff.token })).status, 401);
  const second = await volunteer(f, d.admin, 'second@example.test');
  f.advance(12*60*60*1000);
  assert.equal((await f.request('/api/door/session', { token: second.token })).status, 401);
});
