import { randomToken, sha256Hex } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';
import { RequestValidationError } from '../../shared/dust-wave-platform/packages/worker-core/src/request-validation.js';
import { prepareMail, mailStatement } from './mail.js';
import { ticketRecord, publicTicket, cutoffLabel } from './tickets.js';

const fail = (message, status = 400, code = 'invalid_request') => { throw new RequestValidationError(message, code, status); };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINUTE = 60_000;

export function createDoor({ admins, normalizedEmail, rateLimit, bodyOf, audit, siteLink, requireMail }) {
  const config = env => env.DB.prepare('SELECT * FROM door_settings WHERE id=1').first();
  async function allowed(env, email) {
    return admins(env).includes(email) || Boolean(await env.DB.prepare('SELECT 1 FROM door_staff WHERE email=? AND active=1').bind(email).first());
  }
  async function authenticate(request, env, now) {
    const bearer = request.headers.get('authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) fail('Sign in with your approved volunteer email.', 401, 'unauthorized');
    const hash = await sha256Hex(bearer.slice(7));
    const token = await env.DB.prepare("SELECT email FROM door_tokens WHERE hash=? AND kind='session' AND expires_at>? AND consumed_at IS NULL")
      .bind(hash, now).first();
    if (token && await allowed(env, token.email)) return { email: token.email, hash, table: 'door_tokens' };
    const admin = await env.DB.prepare("SELECT subject FROM tokens WHERE hash=? AND kind='admin_session' AND expires_at>? AND consumed_at IS NULL")
      .bind(hash, now).first();
    if (admin && admins(env).includes(admin.subject)) return { email: admin.subject, hash, table: 'tokens' };
    fail('Your volunteer sign-in expired or access was removed. Sign in again.', 401, 'unauthorized');
  }
  function view(row, now) {
    return { admissionOpen: Boolean(row.admission_open), selectedCutoffAt: row.selected_cutoff_at,
      selectedCutoffLabel: cutoffLabel(row.selected_cutoff_at), reservationReleased: Boolean(row.selected_cutoff_at && now >= row.selected_cutoff_at), waitlistOpen: Boolean(row.admission_open && row.selected_cutoff_at && now >= row.selected_cutoff_at), revision: row.revision };
  }
  async function summary(env, now) {
    const counts = await env.DB.prepare(`SELECT COUNT(*) AS groups,COALESCE(SUM(group_size),0) AS people,
      COALESCE(SUM(CASE WHEN kind='waitlisted' THEN group_size ELSE 0 END),0) AS waitlistedPeople FROM admissions`).first();
    const staff = await env.DB.prepare('SELECT email,active FROM door_staff ORDER BY email').all();
    const recent = await env.DB.prepare(`SELECT e.name,e.email,a.group_size AS groupSize,a.admitted_at AS admittedAt,a.actor,a.kind
      FROM admissions a JOIN entries e ON e.id=a.entry_id WHERE e.deleted_at IS NULL ORDER BY a.admitted_at DESC LIMIT 30`).all();
    return { ...view(await config(env), now), counts, staff: staff.results, recent: recent.results };
  }
  async function updateSettings(request, env, actor, now) {
    const body = await bodyOf(request);
    if (Object.keys(body).some(key => !['admissionOpen', 'selectedCutoffAt', 'revision'].includes(key)) || typeof body.admissionOpen !== 'boolean' || !Number.isSafeInteger(body.revision) ||
      !(body.selectedCutoffAt === null || (Number.isSafeInteger(body.selectedCutoffAt) && body.selectedCutoffAt > 0 && body.selectedCutoffAt < 8.64e15))) fail('Provide the door state, reservation cutoff and current revision.');
    if (body.admissionOpen && !await env.DB.prepare('SELECT 1 FROM drawing WHERE id=1 AND published_at IS NOT NULL').first()) fail('Publish the reviewed drawing before opening check-in.', 409, 'results_unpublished');
    const result = await env.DB.prepare(`UPDATE door_settings SET admission_open=?,selected_cutoff_at=?,revision=revision+1 WHERE id=1 AND revision=?`)
      .bind(Number(body.admissionOpen), body.selectedCutoffAt, body.revision).run();
    if (!result.meta.changes) fail('Door settings changed in another session. Refresh and review them.', 409, 'stale_door');
    await audit(env, 'door_settings_updated', actor, now, { admissionOpen: body.admissionOpen, selectedCutoffAt: body.selectedCutoffAt }).run();
    return summary(env, now);
  }
  async function updateStaff(request, env, actor, now) {
    const body = await bodyOf(request);
    const email = normalizedEmail(body.email);
    if (typeof body.active !== 'boolean' || Object.keys(body).some(key => !['email','active'].includes(key))) fail('Choose whether volunteer access is active.');
    if (admins(env).includes(email)) fail('Organizer access is managed separately from volunteer access.');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO door_staff(email,active,updated_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at')
        .bind(email, Number(body.active), now),
      env.DB.prepare('DELETE FROM door_tokens WHERE email=?').bind(email),
      audit(env, 'volunteer_access_updated', actor, now, { active: body.active, volunteerHash: await sha256Hex(email) })
    ]);
    return summary(env, now);
  }
  async function login(request, env, now) {
    requireMail(env);
    const email = normalizedEmail((await bodyOf(request)).email);
    await rateLimit(env, `door-email:${email}`, 3, 60 * MINUTE, now);
    if (await allowed(env, email)) {
      const token = randomToken(); const hash = await sha256Hex(token); const expires = now + 15 * MINUTE;
      const job = await prepareMail(env, { kind: 'door_link', key: hash, to: email, now, expiresAt: expires,
        subject: 'Sign in to Chile Drop volunteer check-in',
        text: `Use this one-time link within 15 minutes to sign in to volunteer check-in:\n${siteLink(env, 'check-in', token)}\n\nOnly use this link on your own device. Do not forward it. If you did not request it, ignore this email.` });
      await env.DB.batch([env.DB.prepare("INSERT INTO door_tokens(hash,kind,email,expires_at) VALUES(?,'link',?,?)").bind(hash, email, expires), mailStatement(env, job)]);
    }
    return { ok: true, message: 'If your email has volunteer access, a sign-in link will arrive shortly.' };
  }
  async function verify(request, env, now) {
    const { token } = await bodyOf(request);
    if (typeof token !== 'string' || !TOKEN.test(token)) fail('This volunteer link is invalid or expired.', 401, 'invalid_token');
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare("SELECT email FROM door_tokens WHERE hash=? AND kind='link' AND consumed_at IS NULL AND expires_at>?").bind(hash, now).first();
    if (!row || !await allowed(env, row.email)) fail('This volunteer link is invalid or expired.', 401, 'invalid_token');
    const accessToken = randomToken(); const sessionHash = await sha256Hex(accessToken); const expires = now + 12 * 60 * MINUTE;
    await env.DB.batch([
      env.DB.prepare(`UPDATE door_tokens SET consumed_at=?,consumed_by=? WHERE hash=? AND kind='link' AND consumed_at IS NULL AND expires_at>?
        AND (?=1 OR EXISTS(SELECT 1 FROM door_staff WHERE email=door_tokens.email AND active=1))`).bind(now, sessionHash, hash, now, Number(admins(env).includes(row.email))),
      env.DB.prepare(`INSERT INTO door_tokens(hash,kind,email,expires_at) SELECT ?,'session',email,? FROM door_tokens WHERE hash=? AND consumed_by=?`).bind(sessionHash, expires, hash, sessionHash)
    ]);
    if (!await env.DB.prepare('SELECT 1 FROM door_tokens WHERE hash=?').bind(sessionHash).first()) fail('This volunteer link was already used.', 401, 'invalid_token');
    return { accessToken, expiresAt: expires, email: row.email, door: view(await config(env), now) };
  }
  async function inspect(env, credential, now) {
    const row = await ticketRecord(env, credential); const door = await config(env);
    return { ticket: { ...publicTicket(row, door), id: row.id, name: row.name, email: row.email, checkedInBy: row.actor || null }, door: view(door, now) };
  }
  async function checkIn(request, env, actor, now) {
    const body = await bodyOf(request);
    if (!UUID.test(body.requestId || '') || body.wholeGroupPresent !== true || body.spaceConfirmed !== true || !Number.isSafeInteger(body.revision)) fail('Confirm that the whole group is present and there is room for everyone.');
    const row = await ticketRecord(env, body.ticket);
    const isAdmin = Number(admins(env).includes(actor.email));
    // One row per group and the guarded INSERT are the authority across phones and retries.
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO admissions(entry_id,group_size,admitted_at,actor,request_id,kind)
        SELECT e.id,e.group_size,?,?,?,CASE WHEN r.status='waitlisted' THEN 'waitlisted' WHEN s.selected_cutoff_at IS NOT NULL AND s.selected_cutoff_at<=? THEN 'late_selected' ELSE 'selected' END
        FROM entries e JOIN results r ON r.entry_id=e.id,door_settings s,drawing d
        WHERE e.id=? AND e.deleted_at IS NULL AND e.verified_at IS NOT NULL AND s.id=1 AND d.id=1 AND d.published_at IS NOT NULL
        AND s.admission_open=1 AND s.revision=? AND (r.status='selected' OR (s.selected_cutoff_at IS NOT NULL AND s.selected_cutoff_at<=?))
        AND (?=1 OR EXISTS(SELECT 1 FROM door_staff WHERE email=? AND active=1))`)
        .bind(now, actor.email, body.requestId, now, row.id, body.revision, now, isAdmin, actor.email),
      env.DB.prepare(`INSERT INTO audit(action,actor,created_at,detail) SELECT 'group_admitted',?,?,?
        WHERE EXISTS(SELECT 1 FROM admissions WHERE entry_id=? AND request_id=?)
        AND NOT EXISTS(SELECT 1 FROM audit WHERE action='group_admitted' AND json_extract(detail,'$.requestId')=?)`)
        .bind(actor.email, now, JSON.stringify({ entryId: row.id, requestId: body.requestId, groupSize: row.group_size }), row.id, body.requestId, body.requestId)
    ]);
    const admission = await env.DB.prepare('SELECT * FROM admissions WHERE entry_id=?').bind(row.id).first();
    if (!admission) {
      const door = await config(env);
      if (door.revision !== body.revision) fail('Door settings changed. Scan again before checking in.', 409, 'stale_door');
      if (!door.admission_open) fail('Check-in is closed. Ask an organizer.', 409, 'door_closed');
      if (row.status === 'waitlisted' && (!door.selected_cutoff_at || now < door.selected_cutoff_at)) fail('Selected reservations are still held. Waitlist check-in has not opened.', 409, 'waitlist_closed');
      fail('Check-in could not be confirmed. Refresh and scan again.', 409, 'check_in_conflict');
    }
    return { ...(await inspect(env, body.ticket, now)), alreadyCheckedIn: result[0].meta.changes === 0 };
  }
  async function handle(request, env, now, path) {
    if (['/api/door/login','/api/door/verify'].includes(path) && request.method === 'POST') {
      await rateLimit(env, `door-ip:${request.headers.get('cf-connecting-ip') || 'unknown'}`, 60, 15 * MINUTE, now);
      return path.endsWith('/login') ? login(request, env, now) : verify(request, env, now);
    }
    const actor = await authenticate(request, env, now);
    await rateLimit(env, `door-staff:${actor.email}`, 120, MINUTE, now);
    if (path === '/api/door/session' && request.method === 'GET') return { email: actor.email, door: view(await config(env), now) };
    if (path === '/api/door/logout' && request.method === 'POST') {
      await env.DB.prepare(`DELETE FROM ${actor.table} WHERE hash=?`).bind(actor.hash).run(); return { ok: true };
    }
    if (path === '/api/door/inspect' && request.method === 'POST') return inspect(env, (await bodyOf(request)).ticket, now);
    if (path === '/api/door/check-in' && request.method === 'POST') return checkIn(request, env, actor, now);
    fail('Not found.', 404, 'not_found');
  }
  return { handle, summary, updateSettings, updateStaff, config };
}
