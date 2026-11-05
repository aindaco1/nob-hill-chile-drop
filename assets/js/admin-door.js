import { request, status, message, withSubmit } from './api.js';
export function setupDoorAdmin(getSession) {
  const find = selector => document.querySelector(selector);
  const form = find('[data-door-settings]'); const feedback = find('[data-door-admin-status]');
  let snapshot, loading = false;
  const mountain = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function dateInput(timestamp) {
    if (!timestamp) return '';
    const parts = Object.fromEntries(mountain.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }
  function cutoff(value) {
    if (!value) return null;
    // This one-edition event occurs during Mountain Standard Time.
    if (!/^(2026-12-31|2027-01-01)T\d{2}:\d{2}$/.test(value)) throw new Error('Choose December 31, 2026 or January 1, 2027, in Mountain Time.');
    const timestamp = Date.parse(`${value}:00-07:00`);
    if (!Number.isFinite(timestamp)) throw new Error('Enter a valid reservation cutoff.');
    return timestamp;
  }
  function render(data, updateForm = true) {
    if (updateForm) snapshot = data;
    if (updateForm) { form.elements.admissionOpen.checked = data.admissionOpen; form.elements.selectedCutoff.value = dateInput(data.selectedCutoffAt); }
    const boxes = [['People initially admitted', data.counts.people], ['Groups initially admitted', data.counts.groups], ['Admitted from waitlist', data.counts.waitlistedPeople]].map(([label, value]) => {
      const box = document.createElement('div'); box.className = 'dashboard-stat'; const strong = document.createElement('strong'); strong.textContent = value; const span = document.createElement('span'); span.textContent = label; box.append(strong, span); return box;
    });
    find('[data-admission-counts]').replaceChildren(...boxes);
    const staff = data.staff.filter(person => person.active).map(person => {
      const li = document.createElement('li'); const span = document.createElement('span'); span.textContent = person.email;
      const button = document.createElement('button'); button.className = 'button button--outline'; button.textContent = 'Remove access'; button.setAttribute('aria-label', `Remove volunteer access for ${person.email}`);
      button.addEventListener('click', async () => { button.disabled = true; try { render(await request('/api/admin/volunteers', { method: 'POST', body: { email: person.email, active: false } }, getSession())); status(feedback, 'Volunteer access and existing sign-ins revoked.', 'success'); } catch(error) { status(feedback, message(error), 'error'); button.disabled = false; } });
      li.append(span, button); return li;
    });
    find('[data-volunteers]').replaceChildren(...staff);
    find('[data-admissions]').replaceChildren(...data.recent.map(entry => {
      const row = document.createElement('tr');
      for (const value of [entry.name, entry.email, entry.groupSize, mountain.format(new Date(entry.admittedAt)), entry.actor]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      return row;
    }));
  }
  async function refresh(updateForm = true) {
    if (!getSession() || loading) return;
    loading = true;
    try { render(await request('/api/admin/door', {}, getSession()), updateForm); }
    catch(error) { status(feedback, message(error), 'error'); }
    finally { loading = false; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); withSubmit(form, async () => { try {
    if (!snapshot) throw new Error('Refresh door settings before saving.');
    render(await request('/api/admin/door', { method: 'PATCH', body: { admissionOpen: form.elements.admissionOpen.checked, selectedCutoffAt: cutoff(form.elements.selectedCutoff.value), revision: snapshot.revision } }, getSession()));
    status(feedback, 'Door settings saved. The group pass now shows the current cutoff.', 'success');
  } catch(error) { status(feedback, message(error), 'error'); } }); });
  const staffForm = find('[data-volunteer-access]');
  staffForm.addEventListener('submit', event => { event.preventDefault(); withSubmit(staffForm, async () => { try { render(await request('/api/admin/volunteers', { method: 'POST', body: { email: staffForm.elements.email.value, active: true } }, getSession())); staffForm.reset(); status(feedback, 'Volunteer added. They can request their sign-in link from the scanner page.', 'success'); } catch(error) { status(feedback, message(error), 'error'); } }); });
  find('[data-refresh-door]').addEventListener('click', () => refresh());
  setInterval(() => { if (!document.hidden && !find('[data-admin-dashboard]').hidden) refresh(false); }, 15_000);
  return { refresh };
}
