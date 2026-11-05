import { request, status, message } from './api.js';
import { takeTicketCode } from './ticket-code.js';
import qrcode from './qr-code.js';
const feedback = document.querySelector('[data-pass-status]');
const incoming = takeTicketCode();
const supplied = new URLSearchParams(location.hash.slice(1)).has('ticket');
const credential = supplied ? incoming : sessionStorage.getItem('chile-drop-group-pass') || '';
if (incoming) sessionStorage.setItem('chile-drop-group-pass', incoming);
else if (supplied) sessionStorage.removeItem('chile-drop-group-pass');
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
async function load() {
  try {
    if (!credential) throw new Error('Open the group QR link from your results email, or request a private link to your entry.');
    const { pass } = await request('/api/pass', { method: 'POST', body: { ticket: credential } });
    const card = document.querySelector('[data-pass-card]'); card.hidden = false;
    const selected = pass.status === 'selected';
    document.querySelector('[data-pass-heading]').textContent = pass.checkedInAt ? 'Group already checked in' : selected ? 'Hot Spot admission' : 'Hot Spot waitlist';
    document.querySelector('[data-pass-group]').textContent = `One QR for your whole group of ${pass.groupSize}.`;
    document.querySelector('[data-pass-instructions]').textContent = pass.checkedInAt ? 'Your group has already used its initial admission. Use your wristbands for re-entry.' : selected ? 'Show this QR to a volunteer when your whole group is together. Scanning alone does not check you in.' : 'Show this waitlist QR to a volunteer. You are welcome to attend and watch from public vantage points. Hot Spot admission is only available after the reservation cutoff when there is room for your whole group; it is not guaranteed.';
    document.querySelector('[data-pass-cutoff]').textContent = pass.selectedCutoffLabel ? `Unused selected reservations are released on ${pass.selectedCutoffLabel}. After that, admission depends on available space.` : 'The organizers have not set the reservation cutoff yet. Check this pass again before arriving.';
    const scan = new URL('../check-in/', location.href); scan.hash = `ticket=${credential}`;
    const qr = qrcode(0, 'M'); qr.addData(scan.href); qr.make(); const image = qr.createDataURL(5, 20);
    document.querySelector('[data-pass-image]').src = image;
    document.querySelector('[data-pass-save]').href = image;
    status(feedback, 'Keep your group QR ready for the volunteer.');
  } catch (error) { status(feedback, message(error), 'error'); }
}
load();
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
