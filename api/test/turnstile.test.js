import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { verifyTurnstile } from '../src/turnstile.js';

const routes = [
  ['/api/entries', 'entry', { name: 'Example', email: 'guest@example.test', groupSize: 2, city: 'Albuquerque', stateProvince: 'NM', country: 'USA', entryFormVersion: 'group-location-2026-11-04', consent: true, mediaConsent: true, mediaConsentVersion: 'hot-spot-media-2026-11-04' }],
  ['/api/admin/login', 'admin_login', { email: 'alonso@dustwave.xyz' }],
  ['/api/door/login', 'volunteer_login', { email: 'alonso@dustwave.xyz' }]
];
function protectedState(f) {
  return Object.fromEntries(['entries', 'tokens', 'door_tokens', 'outbox', 'settings', 'draw_preview', 'drawing', 'results', 'admissions'].map(table => [table, f.DB.prepare(`SELECT * FROM ${table}`).all().results]));
}

test('all three public forms reject absent, malformed and oversized challenges before entry or mail changes', async () => {
  for (const [path, , body] of routes) {
    const f = fixture({ siteverify: () => { throw new Error('Must not contact provider for malformed tokens'); } });
    try {
      const before = protectedState(f);
      for (const turnstileToken of [undefined, null, '', ' ', 123, 'x'.repeat(2049)]) {
        const result = await f.request(path, { method: 'POST', body: { ...body, turnstileToken } });
        assert.equal(result.status, 400); assert.equal(result.body.code, 'turnstile_failed');
        assert.deepEqual(protectedState(f), before);
      }
    } finally { f.close(); }
  }
});

test('provider rejections, expired/reused tokens and wrong host/action cannot queue mail on any protected form', async () => {
  for (const [path, action, body] of routes) {
    for (const result of [
      { success: false, 'error-codes': ['invalid-input-response'] },
      { success: false, 'error-codes': ['timeout-or-duplicate'] },
      { success: true, hostname: 'attacker.example', action },
      { success: true, hostname: 'chiledrop.com', action: 'wrong_form' },
      { success: true, hostname: 'chiledrop.com' },
      { success: 'true', hostname: 'chiledrop.com', action }
    ]) {
      const f = fixture({ siteverify: async () => Response.json(result) });
      try {
        const before = protectedState(f);
        const reply = await f.request(path, { method: 'POST', body });
        assert.equal(reply.status, 400); assert.equal(reply.body.code, 'turnstile_failed');
        assert.deepEqual(protectedState(f), before);
      } finally { f.close(); }
    }
  }
});

test('valid challenges preserve entry and staff login flows; replay rejection creates no further jobs', async () => {
  for (const [path, action, body] of routes) {
    const f = fixture();
    try {
      const turnstileToken = `test:${action}:single-use`;
      const reply = await f.request(path, { method: 'POST', body: { ...body, turnstileToken } });
      assert.equal(reply.status, path === '/api/door/login' ? 200 : 202);
      assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n, 1);
      const after = protectedState(f);
      const replay = await f.request(path, { method: 'POST', body: { ...body, turnstileToken } });
      assert.equal(replay.status, 400); assert.equal(replay.body.code, 'turnstile_failed');
      assert.deepEqual(protectedState(f), after);
    } finally { f.close(); }
  }
});

test('unavailable/malformed provider responses fail closed without leaking credentials or provider messages', async () => {
  for (const siteverify of [
    async () => { throw new TypeError('private-provider-detail'); },
    async () => { throw new DOMException('private-provider-detail', 'TimeoutError'); },
    async () => new Response('private-provider-detail', { status: 500 }),
    async () => new Response('not json'),
    async () => new Response('x'.repeat(9000)),
    async () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] })
  ]) {
    const f = fixture({ siteverify });
    try {
      const before = protectedState(f);
      const result = await f.request('/api/admin/login', { method: 'POST', body: { email: 'alonso@dustwave.xyz' } });
      assert.equal(result.status, 503); assert.equal(result.body.code, 'turnstile_unavailable');
      assert.doesNotMatch(JSON.stringify(result.body), /private-provider-detail|test-secret/);
      assert.deepEqual(protectedState(f), before);
    } finally { f.close(); }
  }
});

test('configuration exposes only the public site key and missing configuration never disables verification', async () => {
  const f = fixture();
  try {
    assert.equal((await f.request('/api/config')).body.turnstileSiteKey, 'test-site-key');
    assert.equal((await f.request('/health')).body.turnstileConfigured, true);
    assert.doesNotMatch(JSON.stringify((await f.request('/api/config')).body), /test-secret/);
    for (const name of ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_HOSTNAMES']) {
      const saved = f.env[name]; delete f.env[name];
      assert.equal((await f.request('/api/config')).body.turnstileSiteKey, null);
      for (const [path, , body] of routes) {
        const result = await f.request(path, { method: 'POST', body });
        assert.equal(result.status, 503); assert.equal(result.body.code, 'turnstile_unavailable');
      }
      f.env[name] = saved;
    }
  } finally { f.close(); }
});

test('Siteverify uses the native receiver, timeout, no redirects and correct token/client IP', async () => {
  const f = fixture();
  try {
    await verifyTurnstile(new Request('https://api.example.test', { headers: { 'cf-connecting-ip': '203.0.113.1' } }), f.env, 'test:admin_login:transport', 'admin_login', async function (url, init) {
      assert.equal(this, globalThis);
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(init.body), { secret: 'test-secret-key', response: 'test:admin_login:transport', remoteip: '203.0.113.1' });
      return Response.json({ success: true, action: 'admin_login', hostname: 'chiledrop.com' });
    });
  } finally { f.close(); }
});
