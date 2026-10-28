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
  editForm.hidden = !entry.canEdit;
  editForm.elements.name.value = entry.name;
  editForm.elements.groupSize.value = entry.groupSize;
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
    try {const data = await request('/api/entries', {method:'PATCH',body:{name:editForm.elements.name.value,groupSize:Number(editForm.elements.groupSize.value),consent:editForm.elements.consent.checked}}, session); render(data.entry); status(feedback, 'Your group details have been saved.', 'success');}
    catch (error) {status(feedback, message(error), 'error');}
  });
});
signout.addEventListener('click', () => {sessionStorage.removeItem(key); session=''; location.reload();});

})();
