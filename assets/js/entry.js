import { request, status, message, withSubmit } from './api.js';
import { renderHeroMedia } from './hero-media.js';
(async () => {
const form = document.querySelector('[data-entry-form]');
const availability = document.querySelector('[data-registration-status]');
const feedback = document.querySelector('[data-entry-status]');
let refreshing = false;
async function refreshConfig(initial = false) {
if (refreshing) return;
refreshing = true;
try {
  const config = await request('/api/config');
  renderHeroMedia(config.heroMedia);
  const compatible = config.mediaConsentVersion === form.elements.mediaConsent.value;
  const open = config.registrationOpen && compatible;
  form.hidden = !open;
  const closedMessage = !compatible
    ? 'Entry is temporarily unavailable while the recording consent is updated. Please refresh in a moment.'
    : config.resultsPublished && config.results
    ? `The drawing is complete: ${config.results.selectedOrders} groups, with ${config.results.selectedPeople} guests, were selected. Use your private entry link to see your result.`
    : 'Entries are closed. Check back for drawing news.';
  status(availability, open ? 'Entries are open. Join the free drawing below.' : closedMessage, open ? 'success' : 'info');
} catch (error) { if (initial) status(availability, message(error), 'error'); }
finally { refreshing = false; }
}
await refreshConfig(true);
// Keep visitors at the event in sync without interrupting an unchanged stream.
setInterval(() => { if (!document.hidden) refreshConfig(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshConfig(); });
form.addEventListener('submit', event => {
  event.preventDefault();
  withSubmit(form, async () => {
    const fields = new FormData(form);
    if (fields.get('website')) return;
    try {
      await request('/api/entries', { method: 'POST', body: { name: fields.get('name'), email: fields.get('email'), groupSize: Number(fields.get('groupSize')), consent: fields.get('consent') === 'on', mediaConsent: form.elements.mediaConsent.checked, mediaConsentVersion: fields.get('mediaConsent') } });
      status(feedback, 'Check your inbox for a private link to confirm or manage your group entry. Your email must be confirmed before the drawing.', 'success');
      form.reset();
      feedback.focus();
    } catch (error) { status(feedback, message(error), 'error'); feedback.focus(); }
  });
});

})();
