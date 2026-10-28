import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from '../src/worker.js';
import { decodePayload } from '../src/mail.js';

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_drawing.sql', import.meta.url), 'utf8'));
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    first() { return sqlite.prepare(this.sql).get(...this.params) || null; }
    all() {
      const results = sqlite.prepare(this.sql).all(...this.params);
      return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() AS count').get().count } };
    }
    run() { return this.all(); }
  }
  return { sqlite, prepare: sql => new Statement(sql), batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.all()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}

export function fixture() {
  const DB = database();
  let time = Date.parse('2026-11-01T17:00:00Z');
  const messages = new Map();
  const calls = [];
  const env = {
    DB, ALLOWED_ORIGINS: 'https://aindaco1.github.io', PUBLIC_SITE_URL: 'https://aindaco1.github.io/nob-hill-chile-drop',
    ADMIN_EMAILS: 'alonso@dustwave.xyz', REPORT_EMAIL: 'alonso@dustwave.xyz', EMAIL_FROM: 'Chile Drop <hello@example.test>',
    RESEND_API_KEY: 'test-only-no-network', OUTBOX_ENCRYPTION_KEY: 'j86WBIp6sDlQ2NpGa6VH4fh6HUaq3XVccN4moM3TLYA'
  };
  const fetchTarget = async (url, init) => {
    if (url !== 'https://api.resend.com/emails') throw new Error('Unexpected network URL');
    const key = init.headers['Idempotency-Key'];
    calls.push(key);
    if (!messages.has(key)) messages.set(key, { payload: JSON.parse(init.body), id: `email_${messages.size}` });
    return Response.json({ id: messages.get(key).id });
  };
  const dependencies = { now: () => time, fetchTarget };
  const worker = createWorker(dependencies);
  async function request(path, { method = 'GET', body, token, origin = env.ALLOWED_ORIGINS, headers: extra = {} } = {}) {
    const headers = { origin, 'cf-connecting-ip': '203.0.113.1', ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await worker.fetch(new Request(`https://api.example.test${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text };
  }
  async function link(kind, to) {
    const rows = DB.prepare('SELECT * FROM outbox WHERE kind=? ORDER BY rowid DESC').bind(kind).all();
    for (const row of rows.results) {
      if (!row.payload) continue;
      const payload = await decodePayload(env, row.payload, row.id);
      if (!to || payload.to[0] === to) return payload.text.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    }
    throw new Error('No link found');
  }
  async function admin() {
    await request('/api/admin/login', { method: 'POST', body: { email: 'alonso@dustwave.xyz' } });
    const result = await request('/api/admin/verify', { method: 'POST', body: { token: await link('admin_link') } });
    if (result.status !== 200) throw new Error(JSON.stringify(result));
    return result.body.accessToken;
  }
  function seedEntry(groupSize = 1, verified = true, name = 'Guest') {
    const id = crypto.randomUUID();
    DB.prepare('INSERT INTO entries (id,email,name,group_size,consent_version,created_at,updated_at,verified_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, `${id}@example.test`, name, groupSize, 'test', time, time, verified ? time : null).run();
    return id;
  }
  return { env, DB, worker, request, link, admin, seedEntry, messages, calls, dependencies,
    now: () => time, advance: milliseconds => { time += milliseconds; }, close: () => DB.sqlite.close() };
}
