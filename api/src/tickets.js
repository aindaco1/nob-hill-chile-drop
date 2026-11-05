import qrcode from 'qrcode-generator';
import { base64urlEncode } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';
import { RequestValidationError } from '../../shared/dust-wave-platform/packages/worker-core/src/request-validation.js';

const encoder = new TextEncoder();
const pattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export function ticketsReady(env) { return /^[A-Za-z0-9_-]{43}$/.test(env.TICKET_SIGNING_KEY || ''); }
async function key(env) {
  if (!ticketsReady(env)) throw new RequestValidationError('Group passes are temporarily unavailable. Please try again later.', 'tickets_unavailable', 503);
  return crypto.subtle.importKey('raw', bytes(env.TICKET_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function message(entryId, previewId) { return encoder.encode(`chile-drop:group-pass:v1:${previewId}:${entryId}`); }
export async function ticketCredential(env, entryId, previewId) {
  return `${entryId}.${base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), message(entryId, previewId))))}`;
}
export function ticketUrl(env, credential, page = 'check-in') {
  const base = new URL(env.PUBLIC_SITE_URL);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid site URL');
  return `${base.href.replace(/\/$/, '')}/${page}/#ticket=${credential}`;
}
export function ticketImage(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte'); qr.make();
  return qr.createDataURL(5, 20);
}
export function cutoffLabel(timestamp) {
  return timestamp ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(timestamp)) : '';
}
export async function ticketRecord(env, credential) {
  const match = typeof credential === 'string' && credential.match(pattern);
  if (!match) throw new RequestValidationError('This group QR code is invalid.', 'invalid_ticket', 404);
  const drawing = await env.DB.prepare('SELECT preview_id FROM drawing WHERE id=1 AND published_at IS NOT NULL').first();
  if (!drawing || !await crypto.subtle.verify('HMAC', await key(env), bytes(match[2]), message(match[1], drawing.preview_id))) {
    throw new RequestValidationError('This group QR code is invalid or unavailable.', 'invalid_ticket', 404);
  }
  const row = await env.DB.prepare(`SELECT e.id,e.name,e.email,e.group_size,r.status,a.admitted_at,a.actor
    FROM entries e JOIN results r ON r.entry_id=e.id LEFT JOIN admissions a ON a.entry_id=e.id
    WHERE e.id=? AND e.deleted_at IS NULL AND e.verified_at IS NOT NULL`).bind(match[1]).first();
  if (!row) throw new RequestValidationError('This group QR code is invalid or unavailable.', 'invalid_ticket', 404);
  return row;
}
export function publicTicket(row, door) {
  return { status: row.status, groupSize: row.group_size, checkedInAt: row.admitted_at || null,
    selectedCutoffAt: door.selected_cutoff_at || null, selectedCutoffLabel: cutoffLabel(door.selected_cutoff_at) };
}
export async function ownerPass(env, entryId) {
  const drawing = await env.DB.prepare('SELECT preview_id FROM drawing WHERE id=1 AND published_at IS NOT NULL').first();
  if (!drawing) return { pass: null };
  const credential = await ticketCredential(env, entryId, drawing.preview_id);
  const row = await ticketRecord(env, credential);
  const door = await env.DB.prepare('SELECT * FROM door_settings WHERE id=1').first();
  const scanUrl = ticketUrl(env, credential);
  return { pass: { ...publicTicket(row, door), url: ticketUrl(env, credential, 'pass'), qrDataUrl: ticketImage(scanUrl) } };
}

export async function resultEmail(env, entry) {
  const credential = await ticketCredential(env, entry.id, entry.preview_id);
  const url = ticketUrl(env, credential, 'pass');
  const qr = ticketImage(ticketUrl(env, credential));
  const selected = entry.status === 'selected';
  const title = selected ? 'Hot Spot admission' : 'Hot Spot waitlist';
  const cutoff = cutoffLabel(entry.selected_cutoff_at);
  const outcome = selected
    ? `Your group of ${entry.group_size} was selected for free Hot Spot admission at the Nob Hill Chile Drop on December 31, 2026 at Hotel Zazz, Albuquerque.`
    : `Your group of ${entry.group_size} is on the Hot Spot waitlist for the Nob Hill Chile Drop on December 31, 2026 at Hotel Zazz, Albuquerque. You are still welcome to attend and watch from public vantage points. Public viewing does not require a ticket.`;
  const instruction = selected
    ? 'Show this QR code to a volunteer for admission. Your whole group must be present and check in together. After check-in, use your wristbands for re-entry.'
    : 'Bring this waitlist QR code and show it to a volunteer at the Hot Spot. Your whole group must be present. Volunteers may admit waitlisted groups after the reservation cutoff when there is space for everyone. This QR confirms your waitlist entry; it does not guarantee Hot Spot admission.';
  const reservation = cutoff
    ? `Selected groups\u2019 unused reservations are released on ${cutoff}. After that, admission depends on available space.`
    : 'The selected-group reservation cutoff will be set by the organizers. Check your group pass for the current cutoff before coming to the Hot Spot.';
  const details = 'The Hot Spot opens at 10 p.m. Mountain Time. Alcohol sales end at 11:30 p.m.; drinks are purchased separately and valid ID is required. The chile drops at midnight. Hotel guest areas are separate.';
  const text = `Hello ${entry.name},\n\n${outcome}\n\n${instruction}\n\n${reservation}\n\nView or save your group QR: ${url}\n\n${details}\n\nKeep your QR private; it covers one check-in for your whole group. Wristband re-entry is managed at the door and remains subject to available space.\n\nQuestions: nobhillabqmainstreet@gmail.com\n\nNob Hill Chile Drop`;
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const p = value => `<p style="margin:0 0 20px;line-height:1.6">${escape(value)}</p>`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#101921;color:#f7f4e9;font-family:Arial,sans-serif"><div style="max-width:560px;margin:auto;padding:32px 24px"><p style="color:#d7ef8e">NOB HILL CHILE DROP</p><h1 style="font-size:32px">${title}</h1>${p(`Hello ${entry.name},`)}${p(outcome)}${p(instruction)}<div style="background:#ffffff;color:#101921;padding:20px;text-align:center;border-radius:12px;margin:24px 0"><p style="font-weight:bold">${title.toUpperCase()} · GROUP OF ${entry.group_size}</p><img src="cid:group-qr" alt="Your group QR code; show it to a volunteer" width="280" height="280" style="max-width:100%;height:auto;image-rendering:pixelated"><p>${selected ? 'Show this code for group admission.' : 'Waitlist only — admission is not guaranteed.'}</p></div>${p(reservation)}<p style="margin:24px 0"><a href="${escape(url)}" style="display:inline-block;background:#d7ef8e;color:#101921;padding:16px 20px;font-weight:bold;text-decoration:none;border-radius:6px">View or save your group QR →</a></p>${p(details)}${p('Keep your QR private; it covers one check-in for your whole group. Wristband re-entry is managed at the door and remains subject to available space.')}<p>Questions: <a style="color:#d7ef8e" href="mailto:nobhillabqmainstreet@gmail.com">nobhillabqmainstreet@gmail.com</a></p></div></body></html>`;
  return { from: env.EMAIL_FROM, to: [entry.email], subject: selected ? 'Your group was selected — Nob Hill Chile Drop' : 'Your group is on the Hot Spot waitlist — Nob Hill Chile Drop', text, html,
    attachments: [{ filename: selected ? 'hot-spot-admission-qr.gif' : 'hot-spot-waitlist-qr.gif', content: qr.split(',')[1], content_type: 'image/gif', content_id: 'group-qr' }] };
}
