import { normalizeEmail, randomToken, sha256Hex } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';
import { readJsonObject, RequestValidationError } from '../../shared/dust-wave-platform/packages/worker-core/src/request-validation.js';
import { prepareDrawing, drawingSummary } from './drawing.js';
import { mailReady, prepareMail, mailStatement, dispatchOutbox, queueWeeklyReport } from './mail.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const CONSENT_VERSION = 'free-drawing-2026-10-27';
const GENERIC = { ok: true, message: 'If this address can receive a link, check your email. Links may take a few minutes.' };
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function fail(message, status = 400, code = 'invalid_request') { throw new RequestValidationError(message, code, status); }
function admins(env) { return String(env.ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean); }
function settingsView(row, env) {
  return { registrationOpen: row.registration_open === 1 && mailReady(env), capacity: row.capacity, locked: Boolean(row.locked), revision: row.revision };
}
async function settings(env) {
  return env.DB.prepare('SELECT *, EXISTS(SELECT 1 FROM draw_preview) AS locked FROM settings WHERE id=1').first();
}
function normalizedEmail(value) {
  if (typeof value !== 'string') fail('Enter a valid email address.');
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@<>\x00-\x1f]+@[^\s@<>\x00-\x1f]+\.[^\s@<>\x00-\x1f]+$/.test(email)) fail('Enter a valid email address.');
  return email;
}
function entryFields(body) {
  if (typeof body.name !== 'string') fail('Enter your name.');
  const name = body.name.trim();
  if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) fail('Enter a name of up to 120 characters.');
  if (!Number.isInteger(body.groupSize) || body.groupSize < 1 || body.groupSize > 2000) fail('Group size must be a whole number from 1 to 2,000.');
  if (body.consent !== true) fail('Confirm the drawing rules and entry consent.');
  return { name, groupSize: body.groupSize };
}
function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  const allowlist = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(value => {
    try { const url = new URL(value); return url.origin === value && ['https:', 'http:'].includes(url.protocol); } catch { return false; }
  });
  return origin && allowlist.includes(origin) ? origin : '';
}
function reply(request, env, payload, status = 200, contentType = 'application/json; charset=utf-8') {
  const headers = new Headers({
    'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Origin'
  });
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (contentType.startsWith('text/csv')) headers.set('Content-Disposition', 'attachment; filename="chile-drop-entries.csv"');
  return new Response(status === 204 ? null : contentType.startsWith('application/json') ? JSON.stringify(payload) : payload, { status, headers });
}
async function bodyOf(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail('Use application/json.', 415);
  return readJsonObject(request, 8192);
}
async function rateLimit(env, key, maximum, interval, now) {
  const bucket = Math.floor(now / interval);
  const digest = await sha256Hex(`${env.OUTBOX_ENCRYPTION_KEY || ''}:${key}:${bucket}`);
  const row = await env.DB.prepare(`INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(digest, (bucket + 1) * interval).first();
  if (row.count > maximum) fail('Too many attempts. Please try again later.', 429, 'rate_limited');
}
async function authenticate(request, env, kind, now) {
  const value = request.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) fail('Sign in using a fresh email link.', 401, 'unauthorized');
  const hash = await sha256Hex(value.slice(7));
  const token = await env.DB.prepare('SELECT subject FROM tokens WHERE hash=? AND kind=? AND expires_at>? AND consumed_at IS NULL')
    .bind(hash, kind, now).first();
  if (!token || (kind === 'admin_session' && !admins(env).includes(token.subject))) fail('Sign in using a fresh email link.', 401, 'unauthorized');
  return token.subject;
}
function audit(env, action, actor, now, detail = {}) {
  return env.DB.prepare('INSERT INTO audit (action,actor,created_at,detail) VALUES (?,?,?,?)').bind(action, actor, now, JSON.stringify(detail));
}
function requireMail(env) { if (!mailReady(env)) fail('Email service is not ready. Please try again later.', 503, 'email_unavailable'); }
function siteLink(env, page, token) {
  const base = new URL(env.PUBLIC_SITE_URL);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid site URL');
  return `${base.href.replace(/\/$/, '')}/${page}/#token=${encodeURIComponent(token)}`;
}

async function sendEntryLink(env, entry, now) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const expires = now + 30 * MINUTE;
  const job = await prepareMail(env, { kind: 'entry_link', key: hash, recipientId: entry.id, to: entry.email,
    subject: 'Verify your free Chile Drop drawing entry',
    text: `Follow this link within 30 minutes to verify or view your Nob Hill Chile Drop entry:\n${siteLink(env, 'entry', token)}\n\nOne group per email address. Entry is free and does not guarantee Hot Spot admission. Your group stays together if selected.\n\nIf you did not request this link, ignore it. Nothing will be verified without using the link.`, now, expiresAt: expires });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tokens (hash,kind,subject,expires_at) SELECT ?,'entry_link',?,?
      WHERE EXISTS(SELECT 1 FROM entries WHERE id=? AND deleted_at IS NULL)`).bind(hash, entry.id, expires, entry.id),
    mailStatement(env, job, 'EXISTS(SELECT 1 FROM entries WHERE id=? AND deleted_at IS NULL)', [entry.id])
  ]);
}
async function register(request, env, now) {
  requireMail(env);
  const body = await bodyOf(request);
  const email = normalizedEmail(body.email);
  const fields = entryFields(body);
  if (!(await settings(env)).registration_open) fail('Drawing entries are closed.', 409, 'registration_closed');
  await rateLimit(env, `entry-email:${email}`, 3, 60 * MINUTE, now);
  // A public re-submission never changes a group's details. Only its verified owner can edit.
  await env.DB.prepare(`INSERT OR IGNORE INTO entries (id,email,name,group_size,consent_version,created_at,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=1 AND registration_open=1)
    AND NOT EXISTS(SELECT 1 FROM draw_preview)`)
    .bind(crypto.randomUUID(), email, fields.name, fields.groupSize, CONSENT_VERSION, now, now).run();
  const entry = await env.DB.prepare('SELECT id,email FROM entries WHERE email=?').bind(email).first();
  if (entry) await sendEntryLink(env, entry, now);
  return GENERIC;
}
async function requestEntryLink(request, env, now) {
  requireMail(env);
  const email = normalizedEmail((await bodyOf(request)).email);
  await rateLimit(env, `entry-email:${email}`, 3, 60 * MINUTE, now);
  const entry = await env.DB.prepare('SELECT id,email FROM entries WHERE email=?').bind(email).first();
  if (entry) await sendEntryLink(env, entry, now);
  return GENERIC;
}
async function login(request, env, now) {
  requireMail(env);
  const email = normalizedEmail((await bodyOf(request)).email);
  await rateLimit(env, `admin-email:${email}`, 3, 60 * MINUTE, now);
  if (admins(env).includes(email)) {
    const token = randomToken();
    const hash = await sha256Hex(token);
    const expires = now + 15 * MINUTE;
    const job = await prepareMail(env, { kind: 'admin_link', key: hash, to: email,
      subject: 'Sign in to Chile Drop administration',
      text: `Use this one-time link within 15 minutes:\n${siteLink(env, 'admin', token)}\n\nIf you did not request it, ignore this email.`, now, expiresAt: expires });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tokens (hash,kind,subject,expires_at) VALUES (?,'admin_link',?,?)").bind(hash, email, expires),
      mailStatement(env, job)
    ]);
  }
  return GENERIC;
}
async function verify(request, env, now, role) {
  const token = (await bodyOf(request)).token;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) fail('This link is invalid or expired.', 401, 'invalid_token');
  const hash = await sha256Hex(token);
  const source = await env.DB.prepare('SELECT subject FROM tokens WHERE hash=? AND kind=? AND consumed_at IS NULL AND expires_at>?')
    .bind(hash, `${role}_link`, now).first();
  if (!source || (role === 'admin' && !admins(env).includes(source.subject))) fail('This link is invalid or expired.', 401, 'invalid_token');
  const accessToken = randomToken();
  const sessionHash = await sha256Hex(accessToken);
  const sessionExpires = now + (role === 'admin' ? 2 * 60 * MINUTE : DAY);
  const eligible = role === 'entry' ? `AND EXISTS(SELECT 1 FROM entries WHERE id=tokens.subject AND
    (verified_at IS NOT NULL OR (EXISTS(SELECT 1 FROM settings WHERE registration_open=1) AND NOT EXISTS(SELECT 1 FROM draw_preview))))` : '';
  const statements = [env.DB.prepare(`UPDATE tokens SET consumed_at=?,consumed_by=? WHERE hash=? AND kind=?
    AND consumed_at IS NULL AND expires_at>? ${eligible}`).bind(now, sessionHash, hash, `${role}_link`, now)];
  if (role === 'entry') statements.push(env.DB.prepare(`UPDATE entries SET verified_at=?,updated_at=? WHERE verified_at IS NULL
    AND id=(SELECT subject FROM tokens WHERE hash=? AND consumed_by=?)`).bind(now, now, hash, sessionHash));
  statements.push(env.DB.prepare(`INSERT INTO tokens (hash,kind,subject,expires_at)
    SELECT ?,?,subject,? FROM tokens WHERE hash=? AND consumed_by=?`)
    .bind(sessionHash, `${role}_session`, sessionExpires, hash, sessionHash));
  await env.DB.batch(statements);
  if (!await env.DB.prepare('SELECT hash FROM tokens WHERE hash=?').bind(sessionHash).first()) fail('This link was used, expired, or entry verification has closed.', 401, 'invalid_token');
  return { accessToken, expiresAt: new Date(sessionExpires).toISOString(), ...(role === 'entry' ? { entry: await entryStatus(env, source.subject) } : {}) };
}
async function entryStatus(env, id) {
  const entry = await env.DB.prepare(`SELECT e.*, CASE WHEN d.published_at IS NOT NULL THEN r.status ELSE NULL END AS result
    FROM entries e LEFT JOIN results r ON r.entry_id=e.id LEFT JOIN drawing d ON d.id=1 WHERE e.id=?`).bind(id).first();
  if (!entry) fail('Entry not found.', 404);
  const config = await settings(env);
  return { id: entry.id, name: entry.name, email: entry.email, groupSize: entry.group_size,
    verified: Boolean(entry.verified_at), status: entry.result || (entry.verified_at ? 'entered' : 'pending_verification'),
    canEdit: Boolean(config.registration_open && !config.locked), createdAt: new Date(entry.created_at).toISOString() };
}
async function updateEntry(request, env, id, now) {
  const fields = entryFields(await bodyOf(request));
  const result = await env.DB.prepare(`UPDATE entries SET name=?,group_size=?,updated_at=?,consent_version=? WHERE id=?
    AND verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM settings WHERE registration_open=1)
    AND NOT EXISTS(SELECT 1 FROM draw_preview)`).bind(fields.name, fields.groupSize, now, CONSENT_VERSION, id).run();
  if (!result.meta.changes) fail('Changes are closed for this drawing.', 409, 'registration_closed');
  return { entry: await entryStatus(env, id) };
}
async function adminEntries(env, url) {
  const limit = Number(url.searchParams.get('limit') || 50);
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) fail('Invalid page.');
  const entries = await env.DB.prepare(`SELECT e.*,r.status AS result,r.rank FROM entries e LEFT JOIN results r ON r.entry_id=e.id
    ORDER BY e.created_at DESC,e.id LIMIT ? OFFSET ?`).bind(limit, offset).all();
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS totalOrders, COALESCE(SUM(group_size),0) AS totalPeople,
    COALESCE(SUM(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END),0) AS verifiedOrders,
    COALESCE(SUM(CASE WHEN verified_at IS NOT NULL THEN group_size ELSE 0 END),0) AS verifiedPeople FROM entries`).first();
  const preview = await env.DB.prepare('SELECT * FROM draw_preview WHERE id=1').first();
  const drawing = await env.DB.prepare('SELECT * FROM drawing WHERE id=1').first();
  const outbox = await env.DB.prepare('SELECT status,COUNT(*) AS count FROM outbox GROUP BY status').all();
  return { entries: entries.results.map(entry => ({ id: entry.id, name: entry.name, email: entry.email, groupSize: entry.group_size,
    verified: Boolean(entry.verified_at), createdAt: new Date(entry.created_at).toISOString(), status: entry.result || (entry.verified_at ? 'entered' : 'pending_verification'), rank: entry.rank })),
    total: counts.totalOrders, counts, settings: settingsView(await settings(env), env),
    preview: preview ? { previewId: preview.preview_id, ...drawingSummary(JSON.parse(preview.results_json), preview.capacity) } : null,
    drawing: drawing ? { previewId: drawing.preview_id, committedAt: new Date(drawing.committed_at).toISOString(), publishedAt: drawing.published_at ? new Date(drawing.published_at).toISOString() : null } : null,
    outbox: Object.fromEntries(outbox.results.map(row => [row.status, row.count])) };
}
async function updateSettings(request, env, actor, now) {
  const body = await bodyOf(request);
  const current = await settings(env);
  if ('registrationOpen' in body && typeof body.registrationOpen !== 'boolean') fail('registrationOpen must be true or false.');
  if ('capacity' in body && (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 2000)) fail('Capacity must be a whole number from 1 to 2,000.');
  if (!('registrationOpen' in body) && !('capacity' in body)) fail('No setting supplied.');
  if (body.registrationOpen) requireMail(env);
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE settings SET registration_open=?,capacity=?,revision=revision+1 WHERE id=1 AND NOT EXISTS(SELECT 1 FROM draw_preview)`)
      .bind(body.registrationOpen === undefined ? current.registration_open : Number(body.registrationOpen), body.capacity ?? current.capacity),
    audit(env, 'settings_requested', actor, now, { registrationOpen: body.registrationOpen, capacity: body.capacity })
  ]);
  if (!result[0].meta.changes) fail('A random drawing order is already prepared. Registration and capacity are locked.', 409, 'drawing_locked');
  return { settings: settingsView(await settings(env), env) };
}
async function previewDrawing(env, actor, now) {
  const config = await settings(env);
  if (config.registration_open) fail('Close entries before preparing the drawing.', 409, 'registration_open');
  let preview = await env.DB.prepare('SELECT * FROM draw_preview WHERE id=1').first();
  if (!preview) {
    const entries = await env.DB.prepare('SELECT id,group_size FROM entries WHERE verified_at IS NOT NULL ORDER BY id').all();
    if (!entries.results.length) fail('No verified groups are eligible.', 409, 'no_entries');
    const results = prepareDrawing(entries.results, config.capacity);
    const previewId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO draw_preview (id,preview_id,revision,capacity,created_at,results_json)
        SELECT 1,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM settings WHERE registration_open=0 AND revision=?)`)
        .bind(previewId, config.revision, config.capacity, now, JSON.stringify(results), config.revision),
      audit(env, 'preview_requested', actor, now)
    ]);
    preview = await env.DB.prepare('SELECT * FROM draw_preview WHERE id=1').first();
    if (!preview) fail('Entries changed while preparing the drawing. Please try again.', 409, 'stale_preview');
  }
  const members = await env.DB.prepare(`SELECT e.id,e.name,e.email FROM entries e
    JOIN json_each(?) j ON json_extract(j.value,'$.entryId')=e.id`).bind(preview.results_json).all();
  const byId = new Map(members.results.map(entry => [entry.id, entry]));
  const results = JSON.parse(preview.results_json);
  return { previewId: preview.preview_id, createdAt: new Date(preview.created_at).toISOString(),
    ...drawingSummary(results, preview.capacity), results: results.map(entry => ({ ...entry, name: byId.get(entry.entryId).name, email: byId.get(entry.entryId).email })) };
}
async function commitDrawing(request, env, actor, now) {
  const { previewId } = await bodyOf(request);
  if (typeof previewId !== 'string' || previewId.length > 100) fail('A valid previewId is required.');
  const existing = await env.DB.prepare('SELECT preview_id FROM drawing WHERE id=1').first();
  if (existing && existing.preview_id !== previewId) fail('This drawing is already committed.', 409, 'drawing_committed');
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO drawing (id,preview_id,capacity,committed_at)
      SELECT 1,p.preview_id,p.capacity,? FROM draw_preview p,settings s WHERE p.id=1 AND s.id=1
      AND p.preview_id=? AND p.revision=s.revision AND s.registration_open=0`).bind(now, previewId),
    env.DB.prepare(`INSERT OR IGNORE INTO results (entry_id,rank,status)
      SELECT json_extract(j.value,'$.entryId'),json_extract(j.value,'$.rank'),json_extract(j.value,'$.status')
      FROM draw_preview p,json_each(p.results_json) j,drawing d WHERE p.id=1 AND d.id=1 AND p.preview_id=d.preview_id AND d.preview_id=?`).bind(previewId),
    audit(env, 'draw_commit_requested', actor, now, { previewId })
  ]);
  const drawing = await env.DB.prepare('SELECT * FROM drawing WHERE id=1').first();
  if (!drawing || drawing.preview_id !== previewId) fail('The preview is missing or stale.', 409, 'stale_preview');
  return { ok: true, previewId, committedAt: new Date(drawing.committed_at).toISOString(), published: Boolean(drawing.published_at) };
}
async function publishDrawing(env, actor, now) {
  requireMail(env);
  const drawing = await env.DB.prepare('SELECT * FROM drawing WHERE id=1').first();
  if (!drawing) fail('Commit a reviewed drawing before publishing.', 409, 'drawing_missing');
  if (drawing.published_at) return { ok: true, publishedAt: new Date(drawing.published_at).toISOString(), alreadyPublished: true };
  // Queue only immutable IDs in one transaction. Each winner's private payload
  // is frozen by the dispatcher before any send, avoiding bulk HTTP-request CPU.
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO outbox (id,kind,recipient_id,payload,created_at,next_attempt_at,expires_at)
      SELECT 'winner:'||d.preview_id||':'||e.id,'winner',e.id,'',?,?,?
      FROM drawing d,results r JOIN entries e ON e.id=r.entry_id
      WHERE d.id=1 AND d.published_at IS NULL AND r.status='selected' AND e.deleted_at IS NULL`)
      .bind(now, now, now + 7 * DAY),
    env.DB.prepare('UPDATE drawing SET published_at=? WHERE id=1 AND published_at IS NULL').bind(now),
    audit(env, 'draw_publish_requested', actor, now)
  ]);
  const published = await env.DB.prepare('SELECT published_at FROM drawing WHERE id=1').first();
  return { ok: true, publishedAt: new Date(published.published_at).toISOString(), queuedWinnerEmails: result[0].meta.changes };
}
async function eraseEntry(env, id, actor, now) {
  if (!/^[0-9a-f-]{36}$/.test(id)) fail('Entry not found.', 404);
  const entry = await env.DB.prepare('SELECT id FROM entries WHERE id=?').bind(id).first();
  if (!entry) fail('Entry not found.', 404);
  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM tokens WHERE subject=?').bind(id),
    env.DB.prepare(`UPDATE outbox SET status=CASE WHEN status='sent' THEN status ELSE 'suppressed' END,
      payload='',lease_until=NULL,lease_token=NULL WHERE recipient_id=?`).bind(id),
    env.DB.prepare('DELETE FROM entries WHERE id=? AND NOT EXISTS(SELECT 1 FROM draw_preview)').bind(id),
    env.DB.prepare(`UPDATE entries SET name='Deleted entrant',email=?,deleted_at=? WHERE id=? AND deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM draw_preview)`).bind(`${id}@deleted.invalid`, now, id),
    audit(env, 'privacy_erasure', actor, now, { entryId: id })
  ]);
  return { ok: true, action: result[2].meta.changes ? 'deleted' : 'anonymized' };
}
function csvCell(value) {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
async function exportEntries(env) {
  const rows = await env.DB.prepare(`SELECT e.id,e.name,e.email,e.group_size,e.created_at,e.verified_at,r.status,r.rank
    FROM entries e LEFT JOIN results r ON r.entry_id=e.id ORDER BY e.created_at,e.id`).all();
  const fields = ['id', 'name', 'email', 'group_size', 'created_at', 'verified_at', 'status', 'rank'];
  return [fields.join(','), ...rows.results.map(row => fields.map(key => csvCell(row[key])).join(','))].join('\r\n');
}

export function createWorker(dependencies = {}) {
  const deps = { now: Date.now, fetchTarget: globalThis.fetch, ...dependencies };
  return {
    async fetch(request, env, context) {
      try {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '') || '/';
        const method = request.method;
        if (method === 'OPTIONS') {
          if (!allowedOrigin(request, env)) fail('Origin is not allowed.', 403, 'origin_forbidden');
          return reply(request, env, null, 204);
        }
        if (method === 'GET' && path === '/health') {
          await settings(env);
          return reply(request, env, { ok: true, emailConfigured: mailReady(env) });
        }
        if (method === 'GET' && path === '/api/config') {
          const row = await settings(env);
          const drawing = await env.DB.prepare('SELECT published_at FROM drawing WHERE id=1').first();
          const totals = drawing?.published_at ? await env.DB.prepare("SELECT COUNT(*) AS selectedOrders,COALESCE(SUM(e.group_size),0) AS selectedPeople FROM results r JOIN entries e ON e.id=r.entry_id WHERE r.status='selected'").first() : null;
          return reply(request, env, { ...settingsView(row, env), freeEntry: true, priceCents: 0, maxGroupSize: 2000,
            consentVersion: CONSENT_VERSION, resultsPublished: Boolean(drawing?.published_at), results: totals,
            eventDate: '2026-12-31', dropTime: '2027-01-01T00:00:00-07:00', timezone: 'America/Denver' });
        }
        if (!allowedOrigin(request, env)) fail('Origin is not allowed.', 403, 'origin_forbidden');
        const now = deps.now();
        if (['POST', 'PATCH', 'DELETE'].includes(method)) {
          const ip = request.headers.get('cf-connecting-ip') || 'unknown';
          await rateLimit(env, `ip:${ip}`, 60, 15 * MINUTE, now);
        }
        let payload;
        let status = 200;
        if (method === 'POST' && path === '/api/entries') { payload = await register(request, env, now); status = 202; }
        else if (method === 'POST' && path === '/api/entries/link') { payload = await requestEntryLink(request, env, now); status = 202; }
        else if (method === 'POST' && path === '/api/entries/verify') payload = await verify(request, env, now, 'entry');
        else if (method === 'POST' && path === '/api/admin/login') { payload = await login(request, env, now); status = 202; }
        else if (method === 'POST' && path === '/api/admin/verify') payload = await verify(request, env, now, 'admin');
        else if (path === '/api/entries/status' && method === 'GET') payload = { entry: await entryStatus(env, await authenticate(request, env, 'entry_session', now)) };
        else if (path === '/api/entries' && method === 'PATCH') payload = await updateEntry(request, env, await authenticate(request, env, 'entry_session', now), now);
        else if (path.startsWith('/api/admin/')) {
          const actor = await authenticate(request, env, 'admin_session', now);
          if (method === 'GET' && path === '/api/admin/entries') payload = await adminEntries(env, url);
          else if (method === 'GET' && path === '/api/admin/entries.csv') return reply(request, env, await exportEntries(env), 200, 'text/csv; charset=utf-8');
          else if (method === 'PATCH' && path === '/api/admin/settings') payload = await updateSettings(request, env, actor, now);
          else if (method === 'POST' && path === '/api/admin/draw/preview') { await bodyOf(request); payload = await previewDrawing(env, actor, now); }
          else if (method === 'POST' && path === '/api/admin/draw/commit') payload = await commitDrawing(request, env, actor, now);
          else if (method === 'POST' && path === '/api/admin/draw/publish') { await bodyOf(request); payload = await publishDrawing(env, actor, now); }
          else if (method === 'DELETE' && path.startsWith('/api/admin/entries/')) payload = await eraseEntry(env, path.slice('/api/admin/entries/'.length), actor, now);
          else fail('Not found.', 404, 'not_found');
        } else fail('Not found.', 404, 'not_found');
        // Keep publication's atomic ID-only queue separate from delivery work.
        // The cron dispatches winners; entry/login links get a prompt first attempt.
        if (method === 'POST' && ['/api/entries', '/api/entries/link', '/api/admin/login'].includes(path)) {
          context?.waitUntil(dispatchOutbox(env, deps));
        }
        return reply(request, env, payload, status);
      } catch (error) {
        const known = error instanceof RequestValidationError;
        return reply(request, env, { error: known ? error.message : 'The service could not complete this request. Please try again.', code: known ? error.code : 'service_error' }, known ? error.status : 503);
      }
    },
    async scheduled(event, env, context) {
      const operation = (async () => {
        const now = deps.now();
        if (event.cron === '0 16 * * MON') await queueWeeklyReport(env, event.scheduledTime || now);
        await dispatchOutbox(env, deps);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now - DAY),
          env.DB.prepare('DELETE FROM tokens WHERE expires_at<?').bind(now - DAY)
        ]);
      })();
      context?.waitUntil(operation);
      return operation;
    }
  };
}
export default createWorker();
