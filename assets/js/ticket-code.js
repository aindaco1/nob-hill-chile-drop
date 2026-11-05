const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
export function ticketCode(value) {
  const text = String(value || '').trim();
  if (pattern.test(text)) return text;
  try {
    const url = new URL(text);
    const base = new URL(document.body.dataset.siteBase, location.origin);
    if (url.origin !== location.origin || !['check-in/', 'pass/'].some(path => url.pathname === new URL(path, base).pathname)) return '';
    const token = new URLSearchParams(url.hash.slice(1)).get('ticket') || '';
    return pattern.test(token) ? token : '';
  } catch { return ''; }
}
export function takeTicketCode() {
  const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
  return ticketCode(ticket);
}
