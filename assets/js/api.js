import { AdminApiClient } from './api-client.js';
const client = new AdminApiClient({ baseUrl: document.body.dataset.apiBase, credentials: 'omit' });
export function request(path, options = {}, token = '') {
  return client.request(path, { ...options, headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) });
}
export function status(element, message, kind = 'info') {
  element.textContent = message;
  element.dataset.kind = kind;
}
export function message(error) {
  if (error.name === 'TimeoutError' || error.name === 'TypeError') return 'We could not reach the entry service. Please try again in a moment.';
  return error.message || 'Something went wrong. Please try again.';
}
export function takeLinkToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token') || '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return token;
}
export async function withSubmit(form, action) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  try { await action(); } finally { button.disabled = false; form.removeAttribute('aria-busy'); }
}
