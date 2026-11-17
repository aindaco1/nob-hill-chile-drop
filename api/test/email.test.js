import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { decodePayload, dispatchOutbox, prepareMail, mailStatement, queueWeeklyReport } from '../src/mail.js';
import { resultEmail, ticketImage, ticketUrl, ticketCredential } from '../src/tickets.js';

const MINUTE = 60_000;
async function requestEntry(f) {
  const id = f.seedEntry(3, false);
  const email = f.DB.prepare('SELECT email FROM entries WHERE id=?').bind(id).first().email;
  await f.request('/api/entries/link', { method: 'POST', body: { email } });
  return f.link('entry_link', email);
}

test('entry links and queued mail share the one-hour deadline, including the exact expiry boundary', async t => {
  for (const elapsed of [30 * MINUTE + 1, 60 * MINUTE - 1, 60 * MINUTE]) {
    const f = fixture(); t.after(f.close);
    const issued = f.now(); const token = await requestEntry(f);
    const job = f.DB.prepare("SELECT * FROM outbox WHERE kind='entry_link'").first();
    assert.equal(job.expires_at, issued + 60 * MINUTE);
    assert.equal(f.DB.prepare("SELECT expires_at FROM tokens WHERE kind='entry_link'").first().expires_at, job.expires_at);
    const mail = await decodePayload(f.env, job.payload, job.id);
    assert.match(mail.text, /1 hour after you requested it/);
    assert.match(mail.html, /1 hour after you requested it/);
    assert.ok(mail.text.includes(`#token=${token}`));
    assert.ok(mail.html.includes(`href="https://chiledrop.com/entry/#token=${token}"`));
    f.advance(elapsed);
    const result = await f.request('/api/entries/verify', { method: 'POST', body: { token } });
    assert.equal(result.status, elapsed < 60 * MINUTE ? 200 : 401);
    if (elapsed < 60 * MINUTE) {
      assert.equal((await f.request('/api/entries/verify', { method: 'POST', body: { token } })).status, 401);
    } else {
      await dispatchOutbox(f.env, f.dependencies);
      assert.equal(f.messages.size, 0);
      assert.equal(f.DB.prepare('SELECT status FROM outbox WHERE id=?').bind(job.id).first().status, 'expired');
    }
  }
});

test('staff sign-in deadlines remain fifteen minutes and both templates travel through the encrypted outbox', async t => {
  const f = fixture(); t.after(f.close);
  for (const path of ['/api/admin/login', '/api/door/login']) {
    await f.request(path, { method: 'POST', body: { email: f.env.ADMIN_EMAILS } });
  }
  const adminLink = await f.link('admin_link'); const doorLink = await f.link('door_link');
  for (const job of f.DB.prepare('SELECT * FROM outbox').all().results) {
    assert.equal(job.expires_at, f.now() + 15 * MINUTE);
    const mail = await decodePayload(f.env, job.payload, job.id);
    assert.match(mail.text, /15 minutes/); assert.match(mail.html, /15 minutes/);
    assert.equal(mail.reply_to, f.env.REPORT_EMAIL);
    assert.equal(mail.headers['Auto-Submitted'], 'auto-generated');
  }
  await dispatchOutbox(f.env, f.dependencies);
  assert.equal(f.messages.size, 2);
  assert.ok([...f.messages.values()].every(({ payload }) => payload.html && payload.text));
  f.advance(15 * MINUTE);
  assert.equal((await f.request('/api/admin/verify', { method: 'POST', body: { token: adminLink } })).status, 401);
  assert.equal((await f.request('/api/door/verify', { method: 'POST', body: { token: doorLink } })).status, 401);
});

test('branded messages stay text-first, escape guest content and preserve signed QR attachments and destinations', async t => {
  const f = fixture(); t.after(f.close);
  await requestEntry(f);
  await f.request('/api/admin/login', { method: 'POST', body: { email: f.env.ADMIN_EMAILS } });
  await f.request('/api/door/login', { method: 'POST', body: { email: f.env.ADMIN_EMAILS } });
  await queueWeeklyReport(f.env, f.now());
  const messages = await Promise.all(f.DB.prepare('SELECT * FROM outbox').all().results.map(job => decodePayload(f.env, job.payload, job.id)));
  for (const status of ['selected', 'waitlisted']) {
    const entry = { id: crypto.randomUUID(), preview_id: crypto.randomUUID(), name: '<img src=x onerror="bad()"> & Guest', email: 'guest@example.test', group_size: 3, status, selected_cutoff_at: null };
    const result = await resultEmail(f.env, entry);
    const credential = await ticketCredential(f.env, entry.id, entry.preview_id);
    assert.equal(result.attachments[0].content, ticketImage(ticketUrl(f.env, credential)).split(',')[1]);
    assert.ok(result.text.includes(ticketUrl(f.env, credential, 'pass')));
    assert.ok(result.html.includes(`href="${ticketUrl(f.env, credential, 'pass')}"`));
    assert.match(result.html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp; Guest/);
    assert.doesNotMatch(result.html, /<img src=x/);
    if (status === 'waitlisted') {
      assert.match(result.html, /does not guarantee Hot Spot admission/);
      assert.match(result.text, /does not guarantee Hot Spot admission/);
    }
    messages.push(result);
  }
  assert.equal(messages.length, 6);
  for (const { html, text } of messages) {
    assert.ok(text.length > 100);
    assert.ok(Buffer.byteLength(html) < 20_000, 'HTML stays well below mail clipping limits');
    assert.match(html, /<html lang="en" dir="ltr">/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b|@font-face|<link\b/i);
    assert.ok([...html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].every(match => match[1] === 'cid:group-qr'));
    for (const match of html.matchAll(/href="(https:[^"]+)"/g)) {
      assert.equal(new URL(match[1]).origin, 'https://chiledrop.com');
      assert.ok(text.includes(match[1]), 'each action destination has a plain-text fallback');
    }
  }
});

test('already queued plain-text mail keeps its original payload and deadline', async t => {
  const f = fixture(); t.after(f.close);
  const job = await prepareMail(f.env, { kind: 'entry_link', key: 'legacy-frozen-test', to: 'guest@example.test', subject: 'Existing entry link', text: 'Original 30-minute message.', now: f.now(), expiresAt: f.now() + 30 * MINUTE });
  await mailStatement(f.env, job).run();
  const original = await decodePayload(f.env, job.payload, job.id);
  await dispatchOutbox(f.env, f.dependencies);
  assert.deepEqual([...f.messages.values()][0].payload, original);
  assert.equal(f.DB.prepare('SELECT expires_at FROM outbox WHERE id=?').bind(job.id).first().expires_at, job.expiresAt);
});
