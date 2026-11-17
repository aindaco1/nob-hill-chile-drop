import { request, status, message, withSubmit } from './api.js';
import { mountConfirmationDialog } from './confirmation-dialog.js';

export function setupAdminAccess(getSession) {
  const panel = document.querySelector('[data-admin-access]');
  const form = panel.querySelector('form');
  const feedback = panel.querySelector('[data-admin-access-status]');
  const list = panel.querySelector('[data-admin-access-list]');
  const confirmation = mountConfirmationDialog(panel.querySelector('[data-admin-access-dialog]'), { confirmLabel: 'Remove admin' });
  let allowed = false, generation = 0;
  function setViewer(viewer) {
    const next = viewer?.canManageAdmins === true;
    if (allowed !== next) generation++;
    allowed = next; panel.hidden = !allowed;
    if (!allowed) { list.replaceChildren(); status(feedback, ''); confirmation.close(); }
  }
  function showFailure(error) {
    if (error.status === 401 || error.status === 403) { setViewer(null); return; }
    status(feedback, message(error), 'error'); feedback.focus();
  }
  function render(data) {
    list.replaceChildren(...data.admins.map(admin => {
      const row = document.createElement('li');
      const details = document.createElement('div');
      const email = document.createElement('strong'); email.textContent = admin.email;
      const role = document.createElement('span'); role.className = 'small muted';
      role.textContent = admin.role === 'super_admin' ? 'Super admin · protected' : admin.protected ? 'Admin · protected' : 'Admin';
      details.append(email, role); row.append(details);
      if (!admin.protected) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button--outline';
        remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove admin ${admin.email}`);
        remove.addEventListener('click', async () => {
          const ticket = generation;
          const result = await confirmation.open({ title: 'Remove admin access?', description: `${admin.email} will lose organizer access. Their existing organizer and check-in sign-in links and sessions will be revoked.`, returnFocus: remove });
          if (!result.confirmed || !allowed || ticket !== generation) return;
          remove.disabled = true;
          try {
            const data = await request('/api/admin/access', { method: 'POST', body: { email: admin.email, active: false } }, getSession());
            if (!allowed || ticket !== generation) return;
            render(data); status(feedback, 'Admin access removed. Existing sign-in links and sessions have been revoked.', 'success'); form.elements.email.focus();
          } catch (error) { if (allowed && ticket === generation) showFailure(error); }
          finally { remove.disabled = false; }
        });
        row.append(remove);
      }
      return row;
    }));
  }
  async function refresh() {
    if (!allowed) return;
    const ticket = ++generation;
    try {
      const data = await request('/api/admin/access', {}, getSession());
      if (allowed && ticket === generation) render(data);
    } catch (error) { if (allowed && ticket === generation) showFailure(error); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!allowed) return;
    const ticket = generation;
    withSubmit(form, async () => {
      try {
        const data = await request('/api/admin/access', { method: 'POST', body: { email: form.elements.email.value, active: true } }, getSession());
        if (!allowed || ticket !== generation) return;
        render(data); form.reset(); status(feedback, 'Admin access added. They can use the organizer sign-in page.', 'success'); form.elements.email.focus();
      } catch (error) { if (allowed && ticket === generation) showFailure(error); }
    });
  });
  return { setViewer, refresh };
}
