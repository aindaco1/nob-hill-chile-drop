import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { dispatchOutbox } from '../src/mail.js';
import { ticketCredential, ticketUrl } from '../src/tickets.js';

const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const variable = name => config.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))[1];
function applyDomain(f) {
  f.env.ALLOWED_ORIGINS = variable('ALLOWED_ORIGINS');
  f.env.PUBLIC_SITE_URL = variable('PUBLIC_SITE_URL');
}

test('deployed domain allowlist accepts both domain forms and the old origin, but rejects lookalikes', async t => {
  const f = fixture(); t.after(f.close); applyDomain(f);
  for (const origin of ['https://chiledrop.com', 'https://www.chiledrop.com', 'https://aindaco1.github.io']) {
    const response = await f.request('/api/entries', { method: 'OPTIONS', origin });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal((await f.request('/api/admin/entries', { origin })).status, 401);
  }
  for (const origin of ['https://chiledrop.com.evil.test', 'https://evil.chiledrop.com', 'http://chiledrop.com', 'http://127.0.0.1:4173']) {
    const response = await f.request('/api/entries', { method: 'OPTIONS', origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('old access tokens survive the domain change; new mail and QR links use the canonical root', async t => {
  const f = fixture(); t.after(f.close);
  const oldOrigin = 'https://aindaco1.github.io';
  f.env.ALLOWED_ORIGINS = oldOrigin;
  f.env.PUBLIC_SITE_URL = `${oldOrigin}/nob-hill-chile-drop`;
  await f.request('/api/admin/login', { method: 'POST', body: { email: f.env.ADMIN_EMAILS } });
  const oldToken = await f.link('admin_link');
  const entryId = f.seedEntry(); const drawingId = crypto.randomUUID();
  const oldCredential = await ticketCredential(f.env, entryId, drawingId);
  applyDomain(f);
  const origin = 'https://chiledrop.com';
  const verified = await f.request('/api/admin/verify', { method: 'POST', origin, body: { token: oldToken } });
  assert.equal(verified.status, 200);
  assert.equal((await f.request('/api/admin/entries', { origin, token: verified.body.accessToken })).status, 200);
  await f.request('/api/admin/login', { method: 'POST', origin, body: { email: f.env.ADMIN_EMAILS } });
  await dispatchOutbox(f.env, f.dependencies);
  const messages = [...f.messages.values()].map(row => row.payload.text);
  assert.ok(messages.some(text => text.includes('https://chiledrop.com/admin/#token=')));
  assert.ok(messages.some(text => text.includes(`${oldOrigin}/nob-hill-chile-drop/admin/#token=`)), 'existing queued payload stays unchanged');
  assert.equal(await ticketCredential(f.env, entryId, drawingId), oldCredential);
  for (const path of ['pass', 'check-in']) {
    assert.equal(ticketUrl(f.env, oldCredential, path), `https://chiledrop.com/${path}/#ticket=${oldCredential}`);
  }
});
