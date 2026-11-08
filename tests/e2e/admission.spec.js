import { test, expect } from '@playwright/test';
import { fixture } from '../../api/test/helpers.js';
import { ticketCredential, ticketUrl, ticketImage } from '../../api/src/tickets.js';
import { dispatchOutbox } from '../../api/src/mail.js';
import { applyTextScale } from '../../shared/dust-wave-platform/packages/test-core/src/rendering.js';

const api = 'https://nob-hill-chile-drop-api.jogo.workers.dev';
const base = 'http://127.0.0.1:4173/nob-hill-chile-drop';
async function setup(page) {
  const f = fixture(); f.env.ALLOWED_ORIGINS = 'http://127.0.0.1:4173'; f.env.PUBLIC_SITE_URL = base;
  const admin = await f.admin();
  f.seedEntry(4, true, 'Alex Example'); f.seedEntry(4, true, 'Sam Example');
  await f.request('/api/admin/settings', { method: 'PATCH', token: admin, body: { registrationOpen: false, capacity: 4 } });
  const preview = await f.request('/api/admin/draw/preview', { method: 'POST', token: admin, body: {} });
  await f.request('/api/admin/draw/commit', { method: 'POST', token: admin, body: { previewId: preview.body.previewId } });
  await f.request('/api/admin/draw/publish', { method: 'POST', token: admin, body: {} });
  await dispatchOutbox(f.env, f.dependencies);
  const rows = f.DB.prepare('SELECT e.*,r.status FROM entries e JOIN results r ON r.entry_id=e.id').all().results;
  const selected = rows.find(row => row.status === 'selected'); const waitlisted = rows.find(row => row.status === 'waitlisted');
  const selectedCode = await ticketCredential(f.env, selected.id, preview.body.previewId);
  const waitlistCode = await ticketCredential(f.env, waitlisted.id, preview.body.previewId);
  let abortCheckIn = false;
  await page.route(`${api}/**`, async route => {
    const request = route.request(); const url = new URL(request.url());
    const result = await f.request(url.pathname + url.search, { method: request.method(), token: request.headers().authorization?.slice(7),
      ...(request.postData() ? { body: request.postDataJSON() } : {}) });
    if (abortCheckIn && url.pathname === '/api/door/check-in') { abortCheckIn = false; return route.abort('failed'); }
    return route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function settings(cutoff = null) {
    const state = (await f.request('/api/admin/door', { token: admin })).body;
    return f.request('/api/admin/door', { method: 'PATCH', token: admin, body: { admissionOpen: true, selectedCutoffAt: cutoff, revision: state.revision } });
  }
  async function login() {
    await f.request('/api/admin/volunteers', { method: 'POST', token: admin, body: { email: 'door@example.test', active: true } });
    await page.goto(`${base}/check-in/`);
    await page.locator('[data-door-login] [name=email]').fill('door@example.test');
    await page.locator('[data-door-login] button').click();
    await expect(page.locator('[data-door-status]')).toContainText('a sign-in link will arrive');
    const token = await f.link('door_link', 'door@example.test');
    await page.goto('about:blank'); await page.goto(`${base}/check-in/#token=${token}`);
    await expect(page.locator('[data-door-workspace]')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  }
  async function scan(code) {
    await page.evaluate(data => {
      navigator.mediaDevices.getUserMedia = async () => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 640, 480);
        context.drawImage(image, (640-image.naturalWidth)/2, (480-image.naturalHeight)/2);
        const stream = canvas.captureStream(10); window.__cameraStream = stream; return stream;
      };
    }, ticketImage(ticketUrl(f.env, code)));
    await page.locator('[data-camera-start]').click();
    await expect(page.locator('[data-door-ticket]')).toBeVisible();
    await expect(page.locator('[data-ticket-heading]')).toBeFocused();
    await expect(page.locator('[data-ticket-badge]')).toBeInViewport({ ratio: 1 });
  }
  return { f, admin, selected, waitlisted, selectedCode, waitlistCode, settings, login, scan, errors, dropResponse: () => { abortCheckIn = true; } };
}

test('emailed QR image decodes to the protected scanner; guest pass cannot self-check in', async ({ page }) => {
  const s = await setup(page);
  try {
    await page.goto(ticketUrl(s.f.env, s.waitlistCode, 'pass'));
    await expect(page.locator('[data-pass-heading]')).toHaveText('Hot Spot waitlist');
    await expect(page.locator('[data-pass-instructions]')).toContainText('not guaranteed');
    await expect(page.locator('[data-pass-image]')).toBeVisible();
    const email = [...s.f.messages.values()].map(row => row.payload).find(row => row.to.includes(s.waitlisted.email));
    const decoded = await page.evaluate(async data => {
      const { default: decode } = await import('/nob-hill-chile-drop/assets/js/qr-reader.js');
      const image = new Image(); image.src = `data:image/gif;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image,0,0); const frame = context.getImageData(0,0,canvas.width,canvas.height);
      return decode(frame.data, frame.width, frame.height)?.data;
    }, email.attachments[0].content);
    expect(decoded).toBe(ticketUrl(s.f.env, s.waitlistCode));
    await page.reload(); await expect(page.locator('[data-pass-heading]')).toHaveText('Hot Spot waitlist');
    await page.goto('about:blank'); await page.goto(`${base}/pass/#ticket=invalid`);
    await expect(page.locator('[data-pass-card]')).toBeHidden();
    await expect(page.locator('[data-pass-status]')).toContainText('Open the group QR link');
    await page.goto(decoded);
    await expect(page.locator('[data-door-login]')).toBeVisible();
    await expect(page.locator('[data-door-workspace]')).toBeHidden();
    expect(s.f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n).toBe(0);
    expect(s.errors).toEqual([]);
  } finally { s.f.close(); }
});

test('volunteer verifies contact details, explicitly checks in the whole group and sees duplicate scans', async ({ page }) => {
  const s = await setup(page);
  try {
    await s.settings(); await s.login(); await s.scan(s.selectedCode);
    await expect(page.locator('[data-ticket-name]')).toHaveText(s.selected.name);
    await expect(page.locator('[data-ticket-email]')).toHaveText(s.selected.email);
    await expect(page.locator('[data-ticket-size]')).toHaveText('4');
    expect(s.f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n).toBe(0);
    await page.locator('[data-check-in-button]').click();
    expect(s.f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n).toBe(0);
    await page.locator('[name=wholeGroupPresent]').check(); await page.locator('[name=spaceConfirmed]').check();
    await page.locator('[data-check-in-button]').click();
    await expect(page.locator('[data-door-status]')).toContainText('Checked in 4 people');
    await expect(page.locator('[data-door-confirm]')).toBeHidden();
    await s.scan(s.selectedCode); await expect(page.locator('[data-ticket-badge]')).toHaveText('Already checked in');
    expect((await s.f.request('/api/admin/door', { token: s.admin })).body.counts.people).toBe(4);
    expect(s.errors).toEqual([]);
  } finally { s.f.close(); }
});

test('waitlist check-in stays closed until cutoff and recovers safely after a lost success response', async ({ page }) => {
  const s = await setup(page);
  try {
    await s.settings(s.f.now()+60_000); await s.login(); await s.scan(s.waitlistCode);
    await expect(page.locator('[data-door-confirm]')).toBeHidden();
    s.f.advance(60_000); await s.scan(s.waitlistCode);
    await expect(page.locator('[data-door-confirm]')).toBeVisible();
    await page.locator('[name=wholeGroupPresent]').check(); await page.locator('[name=spaceConfirmed]').check();
    s.dropResponse(); await page.locator('[data-check-in-button]').click();
    await expect(page.locator('[data-door-status]')).toContainText('Scan again to confirm the saved status');
    await expect(page.locator('[data-door-ticket]')).toBeHidden();
    await s.scan(s.waitlistCode); await expect(page.locator('[data-ticket-badge]')).toHaveText('Already checked in');
    expect((await s.f.request('/api/admin/door', { token: s.admin })).body.counts.people).toBe(4);
    expect(s.errors).toEqual([]);
  } finally { s.f.close(); }
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`camera scan reveals the result card and stops without admitting (${reducedMotion})`, async ({ page }) => {
    const s = await setup(page);
    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.emulateMedia({ reducedMotion });
      await s.settings(); await s.login();
      await expect(page.locator('[data-door-lookup]')).toHaveCount(0);
      await s.scan(s.selectedCode);
      await expect(page.locator('[data-ticket-name]')).toHaveText(s.selected.name);
      await expect(page.locator('[data-camera]')).toBeHidden();
      expect(await page.evaluate(() => window.__cameraStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
      await expect.poll(async () => (await page.locator('[data-door-ticket]').boundingBox()).y).toBeCloseTo(16, 0);
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
      expect(s.f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n).toBe(0);
      expect(s.errors).toEqual([]);
    } finally { s.f.close(); }
  });
}

test('camera permission failure allows another scan without admitting a group', async ({ page }) => {
  const s = await setup(page);
  try {
    await s.settings(); await s.login();
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    });
    await page.locator('[data-camera-start]').click();
    await expect(page.locator('[data-door-status]')).toContainText('Allow camera access and try scanning again');
    await expect(page.locator('[data-camera-start]')).toBeEnabled();
    await expect(page.locator('[data-door-ticket]')).toBeHidden();
    await s.scan(s.selectedCode);
    expect(s.f.DB.prepare('SELECT COUNT(*) AS n FROM admissions').first().n).toBe(0);
    expect(s.errors).toEqual([]);
  } finally { s.f.close(); }
});

test('guest and volunteer pages fit small phones, enlarged text and keyboard controls', async ({ page }) => {
  const s = await setup(page);
  try {
    await s.settings(s.f.now()); await s.login();
    for (const size of [{width:320,height:568},{width:375,height:667},{width:1280,height:900}]) {
      await page.setViewportSize(size); await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${base}/check-in/`);
      if (size.width === 375) await applyTextScale(page, 200);
      await s.scan(s.waitlistCode);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.door-ticket,.ticket-details dd').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().right <= innerWidth+1))).toBe(true);
      await page.locator('[name=wholeGroupPresent]').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Tab');
      await expect(page.locator('[name=spaceConfirmed]')).toBeFocused();
      await page.goto(ticketUrl(s.f.env,s.waitlistCode,'pass'));
      await expect(page.locator('[data-pass-image]')).toBeVisible();
      if (size.width === 375) await applyTextScale(page, 200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(s.errors).toEqual([]);
  } finally { s.f.close(); }
});

test('organizer controls cutoff in Mountain Time, volunteer access and an initial-admission counter', async ({ page }) => {
  const s = await setup(page);
  try {
    await page.goto(`${base}/admin/`);
    await page.evaluate(token => sessionStorage.setItem('chile-drop-admin-session',token),s.admin);
    await page.reload();
    await expect(page.locator('[data-admission-counts]')).toContainText('People initially admitted');
    await page.locator('[data-door-settings] [name=selectedCutoff]').fill('2026-12-31T23:15');
    await page.locator('[data-door-settings] [name=admissionOpen]').check();
    await page.locator('[data-door-settings] button[type=submit]').click();
    await expect(page.locator('[data-door-admin-status]')).toContainText('Door settings saved');
    expect(s.f.DB.prepare('SELECT selected_cutoff_at FROM door_settings').first().selected_cutoff_at).toBe(Date.parse('2027-01-01T06:15:00Z'));
    await page.locator('[data-volunteer-access] [name=email]').fill('volunteer@example.test');
    await page.locator('[data-volunteer-access] button').click();
    await expect(page.locator('[data-volunteers]')).toContainText('volunteer@example.test');
    for (const width of [320,375]) {
      await page.setViewportSize({width,height:667}); await page.reload();
      await expect(page.locator('[data-volunteers]')).toContainText('volunteer@example.test');
      if (width === 375) await applyTextScale(page,200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', {name:'Remove volunteer access for volunteer@example.test'}).click();
    await expect(page.locator('[data-volunteers]')).not.toContainText('volunteer@example.test');
    expect(s.errors).toEqual([]);
  } finally { s.f.close(); }
});
