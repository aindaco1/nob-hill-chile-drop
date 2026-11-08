import { request, status, message, takeLinkToken, withSubmit } from './api.js';
import { takeTicketCode, ticketCode } from './ticket-code.js';

const find = selector => document.querySelector(selector);
const feedback = find('[data-door-status]');
const login = find('[data-door-login]');
const workspace = find('[data-door-workspace]');
const confirm = find('[data-door-confirm]');
const key = 'chile-drop-door-session';
let session = sessionStorage.getItem(key) || sessionStorage.getItem('chile-drop-admin-session') || '';
let credential = takeTicketCode();
const signInToken = takeLinkToken();
let snapshot, requestId, stream, timer, scanner, busy = false, cameraAttempt = 0;
const video = find('[data-camera]');
const canvas = document.createElement('canvas');
function stopCamera() { cameraAttempt += 1; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; video.hidden = true; find('[data-camera-stop]').hidden = true; find('[data-camera-start]').disabled = false; }
function clearResult() { snapshot = null; requestId = null; find('[data-door-ticket]').hidden = true; confirm.reset(); }
function signedOut() { stopCamera(); clearResult(); sessionStorage.removeItem(key); session = ''; workspace.hidden = true; login.hidden = false; }
function fail(error) { if (error.status === 401) signedOut(); status(feedback, message(error), 'error'); feedback.focus(); }
function gate(door) {
  find('[data-door-gate]').textContent = !door.admissionOpen ? 'Check-in is closed. An organizer must open it.' : door.waitlistOpen ? 'Check-in is open. Waitlisted groups may enter when staff confirm there is room.' : door.selectedCutoffLabel ? `Selected-group check-in is open. Waitlist check-in opens at ${door.selectedCutoffLabel}.` : 'Selected-group check-in is open. The waitlist cutoff has not been set.';
}
function render(data) {
  snapshot = data; const { ticket, door } = data; gate(door); confirm.reset();
  const used = Boolean(ticket.checkedInAt); const selected = ticket.status === 'selected';
  const card = find('[data-door-ticket]'); card.hidden = false; card.dataset.state = used ? 'used' : selected ? 'selected' : 'waitlisted';
  find('[data-ticket-badge]').textContent = used ? 'Already checked in' : selected ? 'Valid admission QR' : 'Valid waitlist QR';
  find('[data-ticket-heading]').textContent = used ? 'This group already entered.' : selected ? 'Hot Spot admission' : 'Waitlist — check space';
  find('[data-ticket-name]').textContent = ticket.name;
  find('[data-ticket-email]').textContent = ticket.email;
  find('[data-ticket-size]').textContent = ticket.groupSize;
  find('[data-ticket-note]').textContent = used ? `Checked in ${new Date(ticket.checkedInAt).toLocaleString()} by ${ticket.checkedInBy}. Do not issue another initial admission; use wristbands for re-entry.` : selected ? (door.reservationReleased ? 'The reservation cutoff has passed.' : 'This group was selected. Admit everyone together.') : door.waitlistOpen ? 'Waitlist check-in is open. This QR is not a reservation.' : 'Selected reservations are still held. Do not admit this waitlisted group yet.';
  confirm.hidden = used || !door.admissionOpen || (!selected && !door.waitlistOpen);
  find('[data-check-in-button]').textContent = selected ? `Check in all ${ticket.groupSize} people` : `Admit waitlisted group of ${ticket.groupSize}`;
}
async function inspect(value) {
  if (busy) return;
  stopCamera(); clearResult(); credential = ticketCode(value);
  if (!credential) { fail(new Error('That is not a valid Chile Drop group QR. Scan the QR from the results email.')); return; }
  busy = true; status(feedback, 'Verifying this group…');
  try {
    const data = await request('/api/door/inspect', { method: 'POST', body: { ticket: credential } }, session);
    render(data); requestId = crypto.randomUUID();
    status(feedback, data.ticket.checkedInAt ? 'This group has already checked in.' : 'QR verified. Review the group before confirming admission.', 'success');
    find('[data-ticket-heading]').focus({ preventScroll: true });
    find('[data-door-ticket]').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } catch (error) { fail(error); } finally { busy = false; }
}
async function start() {
  try {
    let data;
    if (signInToken) { data = await request('/api/door/verify', { method: 'POST', body: { token: signInToken } }); session = data.accessToken; sessionStorage.setItem(key, session); }
    else if (session) data = await request('/api/door/session', {}, session);
    else return;
    workspace.hidden = false; login.hidden = true; find('[data-door-identity]').textContent = `Signed in as ${data.email}`; gate(data.door);
    if (credential) await inspect(credential);
  } catch (error) { signedOut(); fail(error); }
}
login.addEventListener('submit', event => { event.preventDefault(); withSubmit(login, async () => { try { await request('/api/door/login', { method: 'POST', body: { email: login.elements.email.value } }); status(feedback, 'If your email has volunteer access, a sign-in link will arrive shortly. Open it in this browser.', 'success'); } catch(error) { fail(error); } }); });
confirm.addEventListener('submit', event => {
  event.preventDefault(); if (!snapshot || busy) return;
  withSubmit(confirm, async () => {
    busy = true;
    try {
      const data = await request('/api/door/check-in', { method: 'POST', body: { ticket: credential, requestId, revision: snapshot.door.revision, wholeGroupPresent: confirm.elements.wholeGroupPresent.checked, spaceConfirmed: confirm.elements.spaceConfirmed.checked } }, session);
      render(data); status(feedback, data.alreadyCheckedIn ? 'Already checked in. No additional admission was recorded.' : `Checked in ${data.ticket.groupSize} people. Issue their wristbands.`, 'success'); feedback.focus();
    } catch(error) { clearResult(); fail(error); status(feedback, `${message(error)} Scan again to confirm the saved status before admitting anyone.`, 'error'); }
    finally { busy = false; }
  });
});
find('[data-door-signout]').addEventListener('click', async () => { try { await request('/api/door/logout', { method: 'POST', body: {} }, session); sessionStorage.removeItem('chile-drop-admin-session'); signedOut(); status(feedback, 'Signed out.'); } catch(error) { fail(error); } });
find('[data-camera-stop]').addEventListener('click', stopCamera);
find('[data-camera-start]').addEventListener('click', async () => {
  clearResult(); find('[data-camera-start]').disabled = true;
  const attempt = ++cameraAttempt;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable.');
    scanner ||= (await import('./qr-reader.js')).default;
    if (attempt !== cameraAttempt || document.hidden) return;
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    if (attempt !== cameraAttempt || document.hidden) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    video.srcObject = stream; video.hidden = false; find('[data-camera-stop]').hidden = false; await video.play();
    status(feedback, 'Point the camera at the group QR. Scanning does not check anyone in.');
    const scan = () => {
      if (!stream) return;
      if (video.readyState >= 2 && video.videoWidth) {
        canvas.width = Math.min(video.videoWidth, 800); canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = scanner(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
        if (code) { inspect(code.data); return; }
      }
      timer = setTimeout(scan, 200);
    };
    scan();
  } catch(error) { stopCamera(); fail(new Error('Could not start the camera. Allow camera access and try scanning again.')); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', stopCamera);
start();
