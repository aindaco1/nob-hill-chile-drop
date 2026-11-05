import { request, status, message, takeLinkToken, withSubmit } from './api.js';
(async () => {
const feedback = document.querySelector('[data-page-status]');
const linkForm = document.querySelector('[data-entry-link]');
const editForm = document.querySelector('[data-edit-entry]');
const result = document.querySelector('[data-entry-result]');
const signout = document.querySelector('[data-entry-signout]');
const key = 'chile-drop-entry-session';
let session = sessionStorage.getItem(key) || '';
function render(entry) {
  const labels = { entered: 'Your email is confirmed. Your group is entered in the free drawing.', pending_verification: 'Your email needs confirmation.', selected: 'Your whole group has been selected for Hot Spot admission. Check your email for event instructions.', waitlisted: 'Your group is on the waitlist. You can still watch the drop from public vantage points.' };
  result.textContent = `${labels[entry.status] || 'Your group entry is recorded.'} Group size: ${entry.groupSize}.`;
  result.hidden = false; linkForm.hidden = true; signout.hidden = false;
  if (['selected', 'waitlisted'].includes(entry.status)) loadPass();
  const compatible = entry.requiredMediaConsentVersion === editForm.elements.mediaConsent.value && entry.requiredEntryFormVersion === editForm.dataset.formVersion && entry.maxGroupSize === Number(editForm.elements.groupSize.dataset.maxGroupSize);
  editForm.hidden = !entry.canEdit || !compatible;
  if (entry.canEdit && !compatible) result.textContent += ' Group editing is temporarily unavailable while the entry form is updated. Please refresh in a moment.';
  editForm.elements.name.value = entry.name;
  editForm.elements.groupSize.value = entry.groupSize;
  editForm.elements.city.value = entry.city ?? '';
  editForm.elements.stateProvince.value = entry.stateProvince ?? '';
  editForm.elements.country.value = entry.country ?? 'USA';
}
async function loadPass() {
  const card = document.querySelector('[data-owner-pass]');
  try {
    const { pass } = await request('/api/entries/pass', {}, session);
    if (!pass) return;
    card.hidden = false;
    document.querySelector('[data-owner-pass-image]').src = pass.qrDataUrl;
    document.querySelector('[data-owner-pass-link]').href = pass.url;
    document.querySelector('[data-owner-pass-title]').textContent = pass.checkedInAt ? 'Group already checked in' : pass.status === 'selected' ? 'Your Hot Spot admission QR' : 'Your Hot Spot waitlist QR';
    document.querySelector('[data-owner-pass-note]').textContent = 'Show your QR to a volunteer when your whole group is together. ' + (pass.status === 'waitlisted' ? 'Waitlist admission is subject to available space after the reservation cutoff. ' : '') + (pass.selectedCutoffLabel ? `Unused selected reservations are released on ${pass.selectedCutoffLabel}.` : 'The reservation cutoff has not been set yet.');
  } catch(error) { status(feedback, 'Your result is saved, but the QR could not load. Refresh to try again.', 'error'); }
}
async function load() {
  try { render((await request('/api/entries/status', {}, session)).entry); }
  catch (error) {session = ''; sessionStorage.removeItem(key); status(feedback, message(error), 'error'); linkForm.hidden = false;}
}
const token = takeLinkToken();
if (token) {
  status(feedback, 'Confirming your private entry link…');
  try {
    const response = await request('/api/entries/verify', { method: 'POST', body: { token } });
    session = response.accessToken; sessionStorage.setItem(key, session); render(response.entry);
    status(feedback, 'Your private link is confirmed.', 'success');
  } catch (error) {status(feedback, message(error) + ' Request a fresh link below if this one has expired.', 'error');}
} else if (session) await load();
linkForm.addEventListener('submit', event => {
  event.preventDefault();
  withSubmit(linkForm, async () => {
    try {await request('/api/entries/link', {method:'POST',body:{email:linkForm.elements.email.value}}); status(feedback, 'If that email has an entry, a private link will arrive shortly. Check your inbox and spam folder.', 'success');}
    catch (error) {status(feedback, message(error), 'error');}
  });
});
editForm.addEventListener('submit', event => {
  event.preventDefault();
  withSubmit(editForm, async () => {
    try {const data = await request('/api/entries', {method:'PATCH',body:{name:editForm.elements.name.value,city:editForm.elements.city.value,stateProvince:editForm.elements.stateProvince.value,country:editForm.elements.country.value,entryFormVersion:editForm.dataset.formVersion,groupSize:Number(editForm.elements.groupSize.value),consent:editForm.elements.consent.checked,mediaConsent:editForm.elements.mediaConsent.checked,mediaConsentVersion:editForm.elements.mediaConsent.value}}, session); render(data.entry); status(feedback, 'Your group details have been saved.', 'success');}
    catch (error) {status(feedback, message(error), 'error');}
  });
});
signout.addEventListener('click', () => {sessionStorage.removeItem(key); session=''; location.reload();});

})();
