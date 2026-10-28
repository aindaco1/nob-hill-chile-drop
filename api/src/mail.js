import { base64urlEncode, randomToken } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';
import { prepareResendEmail } from '../../shared/dust-wave-platform/packages/worker-core/src/email.js';
import { createOutboxJobId, outboxRetryDelayMs } from '../../shared/dust-wave-platform/packages/worker-core/src/outbox.js';
import { classifyResendFailure } from '../../shared/dust-wave-platform/packages/worker-core/src/resend.js';
import { readBoundedJson } from '../../shared/dust-wave-platform/packages/worker-core/src/response-body.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HOUR = 3_600_000;

function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

export function mailReady(env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && /^[A-Za-z0-9_-]{43}$/.test(env.OUTBOX_ENCRYPTION_KEY || ''));
}

async function encryptionKey(env) {
  if (!mailReady(env)) throw new Error('Email is not configured');
  const bytes = decode(env.OUTBOX_ENCRYPTION_KEY);
  if (bytes.byteLength !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encodePayload(env, payload, id) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(id) }, key, encoder.encode(JSON.stringify(payload)));
  return `${base64urlEncode(iv)}.${base64urlEncode(ciphertext)}`;
}

export async function decodePayload(env, value, id) {
  const [iv, ciphertext] = value.split('.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(id) }, await encryptionKey(env), decode(ciphertext));
  return JSON.parse(decoder.decode(bytes));
}

export async function prepareMail(env, { kind, key, recipientId = null, to, subject, text, now, expiresAt = now + 7 * 24 * HOUR }) {
  const id = await createOutboxJobId({ kind, dedupeKey: key });
  const payload = prepareResendEmail({ from: env.EMAIL_FROM, to: [to], subject, text }, { replyTo: env.REPORT_EMAIL || 'alonso@dustwave.xyz' });
  return { id, kind, recipientId, payload: await encodePayload(env, payload, id), now, expiresAt };
}

export function mailStatement(env, job, condition = '1', bindings = []) {
  return env.DB.prepare(`INSERT OR IGNORE INTO outbox (id,kind,recipient_id,payload,created_at,next_attempt_at,expires_at)
    SELECT ?,?,?,?,?,?,? WHERE ${condition}`)
    .bind(job.id, job.kind, job.recipientId, job.payload, job.now, job.now, job.expiresAt, ...bindings);
}

async function materializeWinner(env, job) {
  const entry = job.winner_json ? JSON.parse(job.winner_json) : null;
  if (!entry) {
    await env.DB.prepare("UPDATE outbox SET status='suppressed',payload='',lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?")
      .bind(job.id, job.lease_token).run();
    return false;
  }
  const payload = prepareResendEmail({
    from: env.EMAIL_FROM, to: [entry.email], subject: 'Your group was selected — Nob Hill Chile Drop',
    text: `Hello ${entry.name},\n\nYour group of ${entry.group_size} was selected for free Hot Spot admission at the Nob Hill Chile Drop on December 31, 2026 at Hotel Zazz, Albuquerque. The chile drops at midnight.\n\nYour whole group is selected together. Entry includes closer views of the chile and music, access to alcohol sales for eligible adults, and a chance to appear on camera. Alcohol is not included. Hotel guest areas are separate.\n\nVisit ${env.PUBLIC_SITE_URL}/entry/ and request a private link to see your result. Watch your email for arrival and check-in instructions from the organizers.\n\nNob Hill Chile Drop`
  }, { replyTo: env.REPORT_EMAIL || 'alonso@dustwave.xyz' });
  const frozen = await encodePayload(env, payload, job.id);
  const result = await env.DB.prepare(`UPDATE outbox SET payload=? WHERE id=? AND lease_token=? AND status='sending' AND payload=''
    AND EXISTS(SELECT 1 FROM entries WHERE id=outbox.recipient_id AND deleted_at IS NULL)`)
    .bind(frozen, job.id, job.lease_token).run();
  if (!result.meta.changes) return false;
  job.payload = frozen;
  return true;
}

// A lease plus a provider idempotency key protects crashes and overlapping crons.
// Stop before Resend's 24-hour deduplication window expires; uncertain jobs need review.
export async function dispatchOutbox(env, { fetchTarget = globalThis.fetch, now = Date.now } = {}) {
  if (!mailReady(env)) return { accepted: 0, attempted: 0 };
  const start = now();
  const deadline = start + 20_000;
  await env.DB.prepare(`UPDATE outbox SET status=CASE WHEN first_attempt_at IS NULL THEN 'expired' ELSE 'needs_review' END,
    last_error='retry_window_elapsed', payload=CASE WHEN first_attempt_at IS NULL THEN '' ELSE payload END
    WHERE status IN ('queued','sending') AND (lease_until IS NULL OR lease_until<=?)
    AND (expires_at<=? OR (first_attempt_at IS NOT NULL AND first_attempt_at<=?))`).bind(start, start, start - 23 * HOUR).run();
  const jobs = await env.DB.prepare(`SELECT id FROM outbox WHERE status IN ('queued','sending')
    AND next_attempt_at<=? AND expires_at>? AND (lease_until IS NULL OR lease_until<=?)
    AND (kind<>'winner' OR EXISTS(SELECT 1 FROM drawing WHERE published_at IS NOT NULL))
    ORDER BY CASE kind WHEN 'admin_link' THEN 0 WHEN 'entry_link' THEN 1 WHEN 'weekly_report' THEN 2 ELSE 3 END,
      created_at LIMIT 10`).bind(start, start, start).all();
  let accepted = 0;
  let attempted = 0;
  for (const candidate of jobs.results) {
    const timestamp = now();
    if (timestamp >= deadline) break;
    const lease = randomToken();
    const job = await env.DB.prepare(`UPDATE outbox SET status='sending', lease_until=?, lease_token=?,
      attempts=attempts+1, first_attempt_at=COALESCE(first_attempt_at,?)
      WHERE id=? AND status IN ('queued','sending') AND next_attempt_at<=? AND expires_at>?
      AND (lease_until IS NULL OR lease_until<=?)
      AND (kind<>'winner' OR EXISTS(SELECT 1 FROM drawing WHERE published_at IS NOT NULL))
      AND (first_attempt_at IS NULL OR first_attempt_at>?) RETURNING *,
      CASE WHEN kind='winner' AND payload='' THEN
        (SELECT json_object('name',e.name,'email',e.email,'group_size',e.group_size) FROM entries e
          WHERE e.id=outbox.recipient_id AND e.deleted_at IS NULL)
        ELSE NULL END AS winner_json`)
      .bind(timestamp + 120_000, lease, timestamp, candidate.id, timestamp, timestamp, timestamp, timestamp - 23 * HOUR).first();
    if (!job) continue;
    attempted += 1;
    let failure;
    try {
      // Publication queues only IDs. Freeze the private winner email exactly once
      // before its first send; subsequent retries decrypt the identical payload.
      if (job.kind === 'winner' && !job.payload && !await materializeWinner(env, job)) continue;
      const payload = await decodePayload(env, job.payload, job.id);
      const response = await fetchTarget('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - now()))),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.id },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const result = await readBoundedJson(response, 16_384);
        if (typeof result.id !== 'string' || !result.id) throw new Error('Invalid provider receipt');
        await env.DB.prepare(`UPDATE outbox SET status='sent',provider_id=?,payload='',lease_until=NULL,lease_token=NULL,last_error=NULL
          WHERE id=? AND lease_token=?`).bind(result.id.slice(0, 128), job.id, lease).run();
        accepted += 1;
        continue;
      }
      failure = classifyResendFailure(response.status, { retryAfter: response.headers.get('retry-after'), nowMs: timestamp });
      await response.body?.cancel();
    } catch {
      failure = classifyResendFailure(0);
    }
    const status = failure.retryable ? 'queued' : 'failed';
    const due = timestamp + outboxRetryDelayMs(failure, job.attempts, { maximumMs: HOUR });
    await env.DB.prepare(`UPDATE outbox SET status=?,next_attempt_at=?,lease_until=NULL,lease_token=NULL,last_error=?
      WHERE id=? AND lease_token=?`).bind(status, due, `provider_${failure.statusCode}`, job.id, lease).run();
  }
  return { accepted, attempted };
}

export async function queueWeeklyReport(env, timestamp = Date.now()) {
  if (!mailReady(env) || !env.REPORT_EMAIL) return;
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const stats = await env.DB.prepare(`SELECT COUNT(*) AS totalOrders, COALESCE(SUM(group_size),0) AS totalPeople,
    SUM(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verifiedOrders,
    COALESCE(SUM(CASE WHEN verified_at IS NOT NULL THEN group_size ELSE 0 END),0) AS verifiedPeople,
    SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS newOrders
    FROM entries`).bind(timestamp - 7 * 24 * HOUR).first();
  const email = await env.DB.prepare("SELECT status,COUNT(*) AS count FROM outbox GROUP BY status").all();
  const settings = await env.DB.prepare('SELECT registration_open,capacity FROM settings WHERE id=1').first();
  const text = `Nob Hill Chile Drop — weekly activity, ${day}\n\nFree entries; no sales or payments.\nNew groups in the last 7 days: ${stats.newOrders || 0}\nTotal groups: ${stats.totalOrders}\nTotal people requested: ${stats.totalPeople}\nVerified groups: ${stats.verifiedOrders || 0}\nVerified people requested: ${stats.verifiedPeople}\nRegistration: ${settings.registration_open ? 'open' : 'closed'}\nHot Spot capacity: ${settings.capacity}\n\nEmail queue (sent means provider accepted):\n${email.results.map(row => `${row.status}: ${row.count}`).join('\n') || 'No messages'}\n\nReview private entries and drawing status: ${env.PUBLIC_SITE_URL}/admin/\n`;
  const job = await prepareMail(env, { kind: 'weekly_report', key: day, to: env.REPORT_EMAIL, subject: `Chile Drop activity — ${day}`, text, now: timestamp });
  await mailStatement(env, job).run();
}
