import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { dispatchOutbox, prepareMail, mailStatement, queueWeeklyReport, decodePayload } from '../src/mail.js';

const entry = { name: 'A Guest', email: 'guest@example.test', groupSize: 4, city: 'Albuquerque', stateProvince: 'NM', country: 'USA', entryFormVersion: 'group-location-2026-11-04', consent: true, mediaConsent: true, mediaConsentVersion: 'hot-spot-media-2026-11-04' };

test('recording consent is required, versioned and saved only on an accepted entry or owner edit', async t => {
  const f = fixture(); t.after(f.close);
  for (const patch of [{ mediaConsent: undefined }, { mediaConsent: false }, { mediaConsent: 'true' }, { mediaConsentVersion: undefined }, { mediaConsentVersion: 'old' }]) {
    assert.equal((await f.request('/api/entries', { method: 'POST', body: { ...entry, ...patch } })).status, 400);
  }
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM entries').first().count, 0);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM outbox').first().count, 0);
  assert.equal((await f.request('/api/entries', { method: 'POST', body: entry })).status, 202);
  const first = f.DB.prepare('SELECT * FROM entries').first();
  assert.equal(first.media_consent_version, entry.mediaConsentVersion);
  assert.equal(first.media_consent_at, f.now());
  f.advance(1000);
  await f.request('/api/entries', { method: 'POST', body: { ...entry, name: 'Not the owner' } });
  assert.deepEqual(f.DB.prepare('SELECT * FROM entries').first(), first);
  const verified = await f.request('/api/entries/verify', { method: 'POST', body: { token: await f.link('entry_link') } });
  const token = verified.body.accessToken;
  for (const mediaConsent of [undefined, false, 'true']) {
    assert.equal((await f.request('/api/entries', { method: 'PATCH', token, body: { ...entry, groupSize: 8, mediaConsent } })).status, 400);
  }
  assert.equal(f.DB.prepare('SELECT group_size FROM entries').first().group_size, 4);
  assert.equal((await f.request('/api/entries', { method: 'PATCH', token, body: { ...entry, groupSize: 8 } })).status, 200);
  assert.equal(f.DB.prepare('SELECT media_consent_at FROM entries').first().media_consent_at, f.now());
  // A public submission cannot retroactively record consent for a legacy entrant.
  f.DB.prepare('UPDATE entries SET media_consent_version=NULL,media_consent_at=NULL').run();
  await f.request('/api/entries', { method: 'POST', body: entry });
  assert.equal(f.DB.prepare('SELECT media_consent_at FROM entries').first().media_consent_at, null);
});

test('only admins can switch display; switching never changes or invalidates a fixed drawing', async t => {
  const f = fixture(); t.after(f.close);
  assert.equal((await f.request('/api/config')).body.heroMedia, 'animation');
  assert.equal((await f.request('/api/admin/display', { method: 'PATCH', body: { heroMedia: 'channel26' } })).status, 401);
  const token = await f.admin();
  for (const body of [{}, { heroMedia: 'https://evil.test' }, { heroMedia: null }, { heroMedia: 'channel26', registrationOpen: true }]) {
    assert.equal((await f.request('/api/admin/display', { method: 'PATCH', token, body })).status, 400);
  }
  f.seedEntry(5);
  await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: false } });
  const prepared = await f.request('/api/admin/draw/preview', { method: 'POST', token, body: {} });
  const before = f.DB.prepare('SELECT * FROM settings').first();
  const preview = f.DB.prepare('SELECT * FROM draw_preview').first();
  const mailCount = f.DB.prepare('SELECT COUNT(*) AS count FROM outbox').first().count;
  for (const heroMedia of ['channel26', 'channel26', 'animation', 'channel26']) {
    assert.equal((await f.request('/api/admin/display', { method: 'PATCH', token, body: { heroMedia } })).status, 200);
    assert.equal((await f.request('/api/config')).body.heroMedia, heroMedia);
    assert.equal((await f.request('/api/admin/entries', { token })).body.settings.heroMedia, heroMedia);
    assert.deepEqual({ ...f.DB.prepare('SELECT * FROM settings').first(), hero_media: before.hero_media }, { ...before });
    assert.deepEqual(f.DB.prepare('SELECT * FROM draw_preview').first(), preview);
    assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM outbox').first().count, mailCount);
  }
  assert.equal((await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: true } })).status, 409);
  assert.equal((await f.request('/api/admin/draw/commit', { method: 'POST', token, body: { previewId: prepared.body.previewId } })).status, 200);
  assert.equal((await f.request('/api/admin/draw/publish', { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await f.request('/api/admin/display', { method: 'PATCH', token, body: { heroMedia: 'animation' } })).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM audit WHERE action=?').bind('display_updated').first().count, 5);
});

test('config defaults to free/open and reveals no private entries or credentials', async t => {
  const f = fixture(); t.after(f.close);
  f.seedEntry();
  const result = await f.request('/api/config');
  assert.equal(result.body.registrationOpen, true);
  assert.equal(result.body.priceCents, 0);
  assert.equal(result.body.capacity, 2000);
  assert.equal(result.body.maxGroupSize, 8);
  assert.equal(result.body.entryFormVersion, entry.entryFormVersion);
  assert.equal(JSON.stringify(result.body).includes('@'), false);
  delete f.env.RESEND_API_KEY;
  assert.equal((await f.request('/api/config')).body.registrationOpen, false);
  assert.equal((await f.request('/api/entries', { method: 'POST', body: entry })).status, 503);
});

test('exact-origin CORS, bearer auth and bounded JSON fail closed', async t => {
  const f = fixture(); t.after(f.close);
  assert.equal((await f.request('/api/entries', { method: 'POST', body: entry, origin: 'https://aindaco1.github.io.evil.test' })).status, 403);
  assert.equal((await f.request('/api/admin/entries')).status, 401);
  assert.equal((await f.request('/api/entries/status', { token: 'a'.repeat(43) })).status, 401);
  assert.equal((await f.request('/api/entries', { method: 'POST', body: { ...entry, name: 'a'.repeat(9000) } })).status, 413);
  for (const patch of [{ groupSize: 0 }, { groupSize: 2001 }, { groupSize: 1.5 }, { groupSize: '2' }, { consent: false }, { email: 'bad' }, { name: 'Line\nbreak' }]) {
    assert.equal((await f.request('/api/entries', { method: 'POST', body: { ...entry, ...patch } })).status, 400);
  }
  const response = await f.request('/api/config');
  assert.equal(response.headers.get('access-control-allow-origin'), f.env.ALLOWED_ORIGINS);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('email ownership, normalized deduplication, safe group edit and one-time verification', async t => {
  const f = fixture(); t.after(f.close);
  const initial = await f.request('/api/entries', { method: 'POST', body: { ...entry, email: ' GUEST@EXAMPLE.TEST ' } });
  const originalLink = await f.link('entry_link');
  const duplicate = await f.request('/api/entries', { method: 'POST', body: { ...entry, name: 'Attacker', groupSize: 8, city: 'Wrong city', stateProvince: 'Wrong state', country: 'Wrong country' } });
  assert.deepEqual(initial.body, duplicate.body);
  assert.equal(f.DB.prepare('SELECT count(*) AS count FROM entries').first().count, 1);
  assert.equal(f.DB.prepare('SELECT name,group_size FROM entries').first().name, entry.name);
  assert.equal(f.DB.prepare('SELECT name,group_size FROM entries').first().group_size, entry.groupSize);
  assert.deepEqual({ ...f.DB.prepare('SELECT city,state_province,country FROM entries').first() }, { city: entry.city, state_province: entry.stateProvince, country: entry.country });
  assert.ok(f.DB.prepare('SELECT payload FROM outbox').first().payload.includes('.'));
  assert.equal(f.DB.prepare('SELECT payload FROM outbox').first().payload.includes(originalLink), false);
  assert.equal(f.DB.prepare('SELECT hash FROM tokens').first().hash.length, 64);
  const verified = await f.request('/api/entries/verify', { method: 'POST', body: { token: originalLink } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.entry.verified, true);
  assert.equal((await f.request('/api/entries/verify', { method: 'POST', body: { token: originalLink } })).status, 401);
  const updated = await f.request('/api/entries', { method: 'PATCH', token: verified.body.accessToken, body: { ...entry, name: 'Owner', groupSize: 6 } });
  assert.equal(updated.body.entry.groupSize, 6);
  assert.equal((await f.request('/api/admin/entries', { token: verified.body.accessToken })).status, 401);
  assert.equal((await f.request('/api/admin/display', { method: 'PATCH', token: verified.body.accessToken, body: { heroMedia: 'channel26' } })).status, 401);
  f.advance(86_400_001);
  assert.equal((await f.request('/api/entries/status', { token: verified.body.accessToken })).status, 401);
});

test('concurrent link redemption creates one session and link expiry is enforced', async t => {
  const f = fixture(); t.after(f.close);
  await f.request('/api/entries', { method: 'POST', body: entry });
  const token = await f.link('entry_link');
  const results = await Promise.all([1, 2].map(() => f.request('/api/entries/verify', { method: 'POST', body: { token } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  await f.request('/api/entries/link', { method: 'POST', body: { email: entry.email } });
  const expired = await f.link('entry_link');
  f.advance(30 * 60_000 + 1);
  assert.equal((await f.request('/api/entries/verify', { method: 'POST', body: { token: expired } })).status, 401);
});

test('admin allowlist is generic, sessions expire and repeated mail requests are limited', async t => {
  const f = fixture(); t.after(f.close);
  const denied = await f.request('/api/admin/login', { method: 'POST', body: { email: 'outsider@example.test' } });
  assert.equal(denied.status, 202);
  assert.equal(f.DB.prepare('SELECT count(*) AS count FROM outbox').first().count, 0);
  const allowed = await f.request('/api/admin/login', { method: 'POST', body: { email: 'alonso@dustwave.xyz' } });
  assert.deepEqual(allowed.body, denied.body);
  const token = await f.link('admin_link');
  const auth = await f.request('/api/admin/verify', { method: 'POST', body: { token } });
  assert.equal(auth.status, 200);
  assert.equal((await f.request('/api/admin/verify', { method: 'POST', body: { token } })).status, 401);
  assert.equal((await f.request('/api/admin/entries', { token: auth.body.accessToken })).status, 200);
  f.advance(2 * 3_600_000 + 1);
  assert.equal((await f.request('/api/admin/entries', { token: auth.body.accessToken })).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await f.request('/api/entries/link', { method: 'POST', body: { email: 'nobody@example.test' } })).status, 202);
  assert.equal((await f.request('/api/entries/link', { method: 'POST', body: { email: 'nobody@example.test' } })).status, 429);
});

test('closed registration blocks new entries, pending verification and group changes', async t => {
  const f = fixture(); t.after(f.close);
  const admin = await f.admin();
  await f.request('/api/entries', { method: 'POST', body: entry });
  const pending = await f.link('entry_link');
  await f.request('/api/admin/settings', { method: 'PATCH', token: admin, body: { registrationOpen: false } });
  assert.equal((await f.request('/api/entries', { method: 'POST', body: entry })).status, 409);
  assert.equal((await f.request('/api/entries/verify', { method: 'POST', body: { token: pending } })).status, 401);
  assert.equal(f.DB.prepare('SELECT verified_at FROM entries').first().verified_at, null);
  assert.equal((await f.request('/api/entries/link', { method: 'POST', body: { email: entry.email } })).status, 202);
});

test('manual draw requires closure; preparation and commit are atomic and cannot reroll', async t => {
  const f = fixture(); t.after(f.close);
  const token = await f.admin();
  [700, 600, 900, 1].forEach(size => f.seedEntry(size));
  f.seedEntry(2000, false);
  assert.equal((await f.request('/api/admin/draw/preview', { method: 'POST', token, body: {} })).status, 409);
  await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: false } });
  const previews = await Promise.all([1, 2].map(() => f.request('/api/admin/draw/preview', { method: 'POST', token, body: {} })));
  assert.equal(previews[0].status, 200);
  assert.deepEqual(previews[0].body, previews[1].body);
  const preview = previews[0].body;
  assert.equal(preview.eligibleOrders, 4);
  assert.ok(preview.selectedPeople <= 2000);
  assert.equal((await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: true } })).status, 409);
  const commits = await Promise.all([1, 2].map(() => f.request('/api/admin/draw/commit', { method: 'POST', token, body: { previewId: preview.previewId } })));
  assert.deepEqual(commits.map(result => result.status), [200, 200]);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM drawing').first().count, 1);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM results').first().count, 4);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE kind='winner'").first().count, 0);
  assert.equal((await f.request('/api/config')).body.resultsPublished, false);
  assert.equal((await f.request('/api/admin/draw/commit', { method: 'POST', token, body: { previewId: 'wrong' } })).status, 409);
  const published = await Promise.all([1, 2].map(() => f.request('/api/admin/draw/publish', { method: 'POST', token, body: {} })));
  assert.deepEqual(published.map(result => result.status), [200, 200]);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE kind='winner'").first().count, preview.selectedOrders);
  const config = (await f.request('/api/config')).body;
  assert.equal(config.results.selectedPeople, preview.selectedPeople);
  assert.equal(JSON.stringify(config).includes('@'), false);
  await dispatchOutbox(f.env, f.dependencies);
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal([...f.messages.values()].filter(message => message.payload.subject.startsWith('Your group')).length, preview.eligibleOrders);
});

test('CSV requires admin and neutralizes spreadsheet formulas', async t => {
  const f = fixture(); t.after(f.close);
  f.seedEntry(1, true, '=HYPERLINK("https://evil.test")');
  f.DB.prepare('UPDATE entries SET city=?,state_province=?,country=?').bind('=1+1','Québec, QC','Canada').run();
  assert.equal((await f.request('/api/admin/entries.csv')).status, 401);
  const token = await f.admin();
  const result = await f.request('/api/admin/entries.csv', { token });
  assert.equal(result.status, 200);
  assert.ok(result.body.includes("'="));
  assert.ok(result.body.includes('city,state_province,country'));
  assert.ok(result.body.includes("\"'=1+1\",\"Québec, QC\",\"Canada\""));
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});

test('durable email leases, crash retries, immutable idempotency and retry-window cutoff', async t => {
  const f = fixture(); t.after(f.close);
  const job = await prepareMail(f.env, { kind: 'test', key: 'one-message', to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
  await mailStatement(f.env, job).run();
  await Promise.all([dispatchOutbox(f.env, f.dependencies), dispatchOutbox(f.env, f.dependencies)]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.messages.size, 1);
  // Simulate provider acceptance followed by a process crash before storing its receipt.
  f.DB.prepare("UPDATE outbox SET status='sending',payload=?,lease_until=?,lease_token='old' WHERE id=?").bind(job.payload, f.now() - 1, job.id).run();
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal(f.calls.length, 2);
  assert.equal(f.messages.size, 1);
  assert.equal(f.calls[0], f.calls[1]);
  const next = await prepareMail(f.env, { kind: 'test', key: 'uncertain', to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
  await mailStatement(f.env, next).run();
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async () => { throw new Error('network'); } });
  assert.equal(f.DB.prepare('SELECT status FROM outbox WHERE id=?').bind(next.id).first().status, 'queued');
  f.advance(23 * 3_600_000 + 1);
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal(f.DB.prepare('SELECT status FROM outbox WHERE id=?').bind(next.id).first().status, 'needs_review');
  assert.equal(f.messages.size, 1);
});

test('winner email cannot dispatch before explicit publication and weekly report deduplicates', async t => {
  const f = fixture(); t.after(f.close);
  const job = await prepareMail(f.env, { kind: 'winner', key: 'draft', to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
  await mailStatement(f.env, job).run();
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal(f.calls.length, 0);
  f.seedEntry(4);
  await Promise.all([queueWeeklyReport(f.env, f.now()), queueWeeklyReport(f.env, f.now())]);
  const reports = f.DB.prepare("SELECT * FROM outbox WHERE kind='weekly_report'").all().results;
  assert.equal(reports.length, 1);
  const payload = await decodePayload(f.env, reports[0].payload, reports[0].id);
  assert.equal(payload.to[0], 'alonso@dustwave.xyz');
  assert.ok(payload.text.includes('Free entries; no sales or payments.'));
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal(f.messages.size, 1);
});

test('privacy erasure deletes before preparation, revokes tokens and suppresses queued email', async t => {
  const f = fixture(); t.after(f.close);
  const token = await f.admin();
  await f.request('/api/entries', { method: 'POST', body: entry });
  const link = await f.link('entry_link');
  const verified = await f.request('/api/entries/verify', { method: 'POST', body: { token: link } });
  const id = verified.body.entry.id;
  assert.equal((await f.request(`/api/admin/entries/${id}`, { method: 'DELETE' })).status, 401);
  const erased = await f.request(`/api/admin/entries/${id}`, { method: 'DELETE', token });
  assert.equal(erased.body.action, 'deleted');
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM entries').first().count, 0);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM tokens WHERE subject=?').bind(id).first().count, 0);
  assert.equal(f.DB.prepare('SELECT status FROM outbox WHERE recipient_id=?').bind(id).first().status, 'suppressed');
  assert.equal((await f.request('/api/entries/status', { token: verified.body.accessToken })).status, 401);
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal([...f.messages.values()].some(message => message.payload.to[0] === entry.email), false);
});

test('erasure after preparation anonymizes without invalidating or changing the drawing', async t => {
  const f = fixture(); t.after(f.close);
  const token = await f.admin();
  const id = f.seedEntry(5);
  f.DB.prepare('UPDATE entries SET city=?,state_province=?,country=? WHERE id=?').bind('Albuquerque','NM','USA',id).run();
  await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: false } });
  const preview = await f.request('/api/admin/draw/preview', { method: 'POST', token, body: {} });
  assert.equal((await f.request(`/api/admin/entries/${id}`, { method: 'DELETE', token })).body.action, 'anonymized');
  const row = f.DB.prepare('SELECT * FROM entries WHERE id=?').bind(id).first();
  assert.equal(row.name, 'Deleted entrant');
  assert.equal(row.email, `${id}@deleted.invalid`);
  assert.equal(row.group_size, 5);
  assert.equal(row.city, null);
  assert.equal(row.state_province, null);
  assert.equal(row.country, null);
  assert.equal((await f.request('/api/admin/draw/commit', { method: 'POST', token, body: { previewId: preview.body.previewId } })).status, 200);
  assert.equal((await f.request('/api/admin/draw/publish', { method: 'POST', token, body: {} })).body.queuedResultEmails, 0);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS count FROM results').first().count, 1);
});

test('maximum 2,000 single-person winners publish atomically as ID-only jobs', async t => {
  const f = fixture(); t.after(f.close);
  const token = await f.admin();
  for (let i = 0; i < 2000; i++) f.seedEntry(1);
  await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: false } });
  const preview = await f.request('/api/admin/draw/preview', { method: 'POST', token, body: {} });
  assert.equal(preview.body.selectedPeople, 2000);
  await f.request('/api/admin/draw/commit', { method: 'POST', token, body: { previewId: preview.body.previewId } });
  const published = await f.request('/api/admin/draw/publish', { method: 'POST', token, body: {} });
  assert.equal(published.status, 200);
  assert.equal(published.body.queuedResultEmails, 2000);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE kind='winner'").first().count, 2000);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE kind='winner' AND payload='' AND id LIKE 'winner:%'").first().count, 2000);
  assert.equal(f.calls.length, 0);
});

test('outbox work stops at its deadline and leaves remaining messages durably queued', async t => {
  const f = fixture(); t.after(f.close);
  for (let i = 0; i < 12; i++) {
    const job = await prepareMail(f.env, { kind: 'test', key: `budget-${i}`, to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
    await mailStatement(f.env, job).run();
  }
  const result = await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async (...args) => {
    const response = await f.dependencies.fetchTarget(...args);
    f.advance(10_000);
    return response;
  } });
  assert.equal(result.accepted, 2);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE status='queued'").first().count, 10);
  assert.equal(f.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE status='sending'").first().count, 0);
});

test('expiring sign-in links take priority over a winner notification backlog', async t => {
  const f = fixture(); t.after(f.close);
  f.DB.prepare('INSERT INTO drawing (id,preview_id,capacity,committed_at,published_at) VALUES (1,?,?,?,?)').bind('test-draw', 2000, f.now(), f.now()).run();
  for (let i = 0; i < 12; i++) {
    const job = await prepareMail(f.env, { kind: 'winner', key: `backlog-${i}`, to: 'nobody@example.test', subject: 'Winner', text: 'Test only', now: f.now() });
    await mailStatement(f.env, job).run();
  }
  f.advance(1);
  await f.request('/api/admin/login', { method: 'POST', body: { email: 'alonso@dustwave.xyz' } });
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal([...f.messages.values()][0].payload.subject, 'Sign in to Chile Drop administration');
  assert.equal(f.messages.size, 10);
});

test('lazy winner materialization freezes the payload before an uncertain send and reuses it', async t => {
  const f = fixture(); t.after(f.close);
  const token = await f.admin();
  f.seedEntry(1);
  await f.request('/api/admin/settings', { method: 'PATCH', token, body: { registrationOpen: false } });
  const preview = await f.request('/api/admin/draw/preview', { method: 'POST', token, body: {} });
  await f.request('/api/admin/draw/commit', { method: 'POST', token, body: { previewId: preview.body.previewId } });
  await f.request('/api/admin/draw/publish', { method: 'POST', token, body: {} });
  const attempts = [];
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async (_url, init) => {
    attempts.push({ key: init.headers['Idempotency-Key'], body: init.body });
    throw new Error('uncertain send');
  } });
  const winner = f.DB.prepare("SELECT * FROM outbox WHERE kind='winner'").first();
  assert.ok(winner.payload.length > 0);
  assert.equal(winner.status, 'queued');
  f.env.EMAIL_FROM = 'Changed <changed@example.test>';
  f.advance(3 * 60_000);
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async (_url, init) => {
    attempts.push({ key: init.headers['Idempotency-Key'], body: init.body });
    return Response.json({ id: 'accepted' });
  } });
  const winnerAttempts = attempts.filter(attempt => attempt.key === winner.id);
  assert.equal(winnerAttempts.length, 2);
  assert.equal(winnerAttempts[0].body, winnerAttempts[1].body);
});

test('provider transport preserves the native global receiver', async t => {
  const f = fixture(); t.after(f.close);
  const job = await prepareMail(f.env, { kind: 'test', key: 'native-fetch', to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
  await mailStatement(f.env, job).run();
  let receiver;
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async function () {
    receiver = this;
    return Response.json({ id: 'accepted' });
  } });
  assert.equal(receiver, globalThis);
  assert.equal(f.DB.prepare('SELECT status FROM outbox WHERE id=?').bind(job.id).first().status, 'sent');
});

test('mail failure evidence names only safe stages and allowlisted error names', async t => {
  const f = fixture(); t.after(f.close);
  const job = await prepareMail(f.env, { kind: 'test', key: 'safe-error', to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
  await mailStatement(f.env, job).run();
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async () => {
    const error = new Error('secret recipient and token must never appear');
    error.name = 'recipient@example.test';
    throw error;
  } });
  assert.equal(f.DB.prepare('SELECT last_error FROM outbox WHERE id=?').bind(job.id).first().last_error, 'fetch:Error');
  f.advance(3 * 60_000);
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async () => new Response('not JSON', { status: 200 }) });
  assert.equal(f.DB.prepare('SELECT last_error FROM outbox WHERE id=?').bind(job.id).first().last_error, 'receipt:SyntaxError');
  f.advance(5 * 60_000);
  f.DB.prepare("UPDATE outbox SET payload='invalid.payload' WHERE id=?").bind(job.id).run();
  await dispatchOutbox(f.env, f.dependencies);
  assert.match(f.DB.prepare('SELECT last_error FROM outbox WHERE id=?').bind(job.id).first().last_error, /^decrypt:(OperationError|InvalidCharacterError)$/);
  assert.equal(f.calls.length, 0);
});

test('Worker-compatible manual redirects never follow a provider redirect or forward credentials', async t => {
  const f = fixture(); t.after(f.close);
  const job = await prepareMail(f.env, { kind: 'test', key: 'no-redirect', to: 'nobody@example.test', subject: 'Test', text: 'Test only', now: f.now() });
  await mailStatement(f.env, job).run();
  const calls = [];
  await dispatchOutbox(f.env, { ...f.dependencies, fetchTarget: async (url, init) => {
    if (init.redirect === 'error') throw new TypeError('Invalid redirect value');
    assert.equal(init.redirect, 'manual');
    calls.push(url);
    return new Response(null, { status: 307, headers: { Location: 'https://untrusted.example.test' } });
  } });
  assert.deepEqual(calls, ['https://api.resend.com/emails']);
  const stored = f.DB.prepare('SELECT status,last_error,provider_id FROM outbox WHERE id=?').bind(job.id).first();
  assert.equal(stored.status, 'failed');
  assert.equal(stored.last_error, 'provider_307');
  assert.equal(stored.provider_id, null);
});


test('required location is trimmed, persisted, owner-editable and available only to authorized readers', async t => {
  const f = fixture(); t.after(f.close);
  await f.request('/api/entries', { method: 'POST', body: { ...entry, city: ' Albuquerque ', stateProvince: ' NM ', country: ' USA ' } });
  const before = f.DB.prepare('SELECT * FROM entries').first();
  assert.equal(before.city, 'Albuquerque'); assert.equal(before.state_province, 'NM'); assert.equal(before.country, 'USA');
  const verified = await f.request('/api/entries/verify', { method: 'POST', body: { token: await f.link('entry_link') } });
  const token = verified.body.accessToken;
  assert.equal(verified.body.entry.city, 'Albuquerque');
  assert.equal(verified.body.entry.requiredEntryFormVersion, entry.entryFormVersion);
  assert.equal(verified.body.entry.maxGroupSize, 8);
  for (const field of ['city', 'stateProvince', 'country']) {
    for (const value of [undefined, null, 123, '', '   ', 'a'.repeat(121), 'line\nbreak']) {
      for (const method of ['POST', 'PATCH']) {
        const response = await f.request('/api/entries', { method, token, body: { ...entry, [field]: value } });
        assert.equal(response.status, 400, `${method} rejects ${field}: ${JSON.stringify(value)}`);
      }
    }
  }
  assert.equal(f.DB.prepare('SELECT city FROM entries').first().city, 'Albuquerque');
  const update = await f.request('/api/entries', { method: 'PATCH', token, body: { ...entry, city: ' Montréal ', stateProvince: ' Québec ', country: ' Canada ' } });
  assert.equal(update.status, 200);
  for (const response of [update, await f.request('/api/entries/status', { token })]) {
    assert.equal(response.body.entry.city, 'Montréal');
    assert.equal(response.body.entry.stateProvince, 'Québec');
    assert.equal(response.body.entry.country, 'Canada');
  }
  const admin = await f.admin();
  const snapshot = await f.request('/api/admin/entries', { token: admin });
  assert.equal(snapshot.body.entries[0].city, 'Montréal');
  assert.equal(snapshot.body.entries[0].stateProvince, 'Québec');
  assert.equal(snapshot.body.entries[0].country, 'Canada');
  assert.equal(JSON.stringify((await f.request('/api/config')).body).includes('Montréal'), false);
});

test('both entry routes require the current form and enforce groups of one through eight', async t => {
  const f = fixture(); t.after(f.close);
  assert.equal((await f.request('/api/entries', { method: 'POST', body: { ...entry, groupSize: 8 } })).status, 202);
  const verified = await f.request('/api/entries/verify', { method: 'POST', body: { token: await f.link('entry_link') } });
  const token = verified.body.accessToken;
  for (const patch of [{ groupSize: 0 }, { groupSize: 9 }, { groupSize: 2000 }, { groupSize: 1.5 }, { groupSize: '8' }, { entryFormVersion: undefined }, { entryFormVersion: 'old' }]) {
    for (const method of ['POST', 'PATCH']) assert.equal((await f.request('/api/entries', { method, token, body: { ...entry, ...patch } })).status, 400);
  }
  assert.equal(f.DB.prepare('SELECT group_size FROM entries').first().group_size, 8);
  for (const groupSize of [1, 8]) assert.equal((await f.request('/api/entries', { method: 'PATCH', token, body: { ...entry, groupSize } })).body.entry.groupSize, groupSize);
  assert.equal(f.DB.prepare('SELECT capacity FROM settings').first().capacity, 2000);
});
