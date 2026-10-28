import { request, status, message, withSubmit } from './api.js';
(async () => {
const form = document.querySelector('[data-entry-form]');
const availability = document.querySelector('[data-registration-status]');
const feedback = document.querySelector('[data-entry-status]');
try {
  const config = await request('/api/config');
  const open = config.registrationOpen;
  form.hidden = !open;
  const closedMessage = config.resultsPublished && config.results
    ? `The drawing is complete: ${config.results.selectedOrders} groups, with ${config.results.selectedPeople} guests, were selected. Use your private entry link to see your result.`
    : 'Entries are closed. Check back for drawing news.';
  status(availability, open ? 'Entries are open. Join the free drawing below.' : closedMessage, open ? 'success' : 'info');
} catch (error) { status(availability, message(error), 'error'); }
form.addEventListener('submit', event => {
  event.preventDefault();
  withSubmit(form, async () => {
    const fields = new FormData(form);
    if (fields.get('website')) return;
    try {
      await request('/api/entries', { method: 'POST', body: { name: fields.get('name'), email: fields.get('email'), groupSize: Number(fields.get('groupSize')), consent: fields.get('consent') === 'on' } });
      status(feedback, 'Check your inbox for a private link to confirm or manage your group entry. Your email must be confirmed before the drawing.', 'success');
      form.reset();
      feedback.focus();
    } catch (error) { status(feedback, message(error), 'error'); feedback.focus(); }
  });
});

})();
