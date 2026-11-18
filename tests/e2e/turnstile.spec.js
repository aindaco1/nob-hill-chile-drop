import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockTurnstile } from './turnstile-mock.js';
import { fixture } from '../../api/test/helpers.js';
import { applyTextScale } from '../../shared/dust-wave-platform/packages/test-core/src/rendering.js';

const api = 'https://nob-hill-chile-drop-api.jogo.workers.dev';
const forms = [
  { page: './#hot-spot', form: '[data-entry-form]', status: '[data-entry-status]', action: 'entry' },
  { page: './admin/', form: '[data-admin-login]', status: '[data-admin-status]', action: 'admin_login' },
  { page: './check-in/', form: '[data-door-login]', status: '[data-door-status]', action: 'volunteer_login' }
];
async function setup(page, options) {
  await mockTurnstile(page, options);
  await page.route('https://www.openstreetmap.org/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Map test</title>' }));
  const f = fixture(); f.env.ALLOWED_ORIGINS = 'http://127.0.0.1:4173';
  const submissions = [];
  await page.route(`${api}/**`, async route => {
    const req = route.request(), url = new URL(req.url());
    const body = req.postData() ? req.postDataJSON() : undefined;
    if (req.method() === 'POST') submissions.push({ path: url.pathname, body });
    const reply = await f.request(url.pathname + url.search, { method: req.method(), body, autoChallenge: false, token: req.headers().authorization?.slice(7) });
    await route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers), body: JSON.stringify(reply.body) });
  });
  return { f, submissions };
}
async function fill(page, item) {
  const form = page.locator(item.form);
  await form.locator('[name=email]').fill('alonso@dustwave.xyz');
  if (item.action === 'entry') {
    for (const [name, value] of Object.entries({ name: 'Test Guest', city: 'Albuquerque', stateProvince: 'NM' })) await form.locator(`[name=${name}]`).fill(value);
    await form.locator('[name=consent]').check(); await form.locator('[name=mediaConsent]').check();
  }
}
async function challenge(page, command) {
  await page.evaluate(command => {
    const id = [...window.__turnstileTest.widgets.keys()][0];
    window.__turnstileTest[command](id);
  }, command);
}

for (const item of forms) test(`${item.action}: requires a challenge, handles expiry, submits a verified token and refreshes after success`, async ({ page }) => {
  const { f, submissions } = await setup(page, { autoSolve: false });
  try {
    await page.goto(item.page); await fill(page, item);
    await expect(page.locator('[data-turnstile-widget] iframe')).toBeVisible();
    await page.locator(`${item.form} button[type=submit]`).click();
    await expect(page.locator(item.status)).toContainText('Complete the security check');
    expect(submissions).toHaveLength(0);
    await challenge(page, 'solve'); await challenge(page, 'expire');
    await page.locator(`${item.form} button[type=submit]`).click();
    expect(submissions).toHaveLength(0);
    await challenge(page, 'solve');
    await page.locator(`${item.form} button[type=submit]`).click();
    await expect(page.locator(item.status)).toContainText(/Check your inbox|a sign-in link will arrive/);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].body.turnstileToken).toMatch(new RegExp(`^test:${item.action}:`));
    expect(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n).toBe(1);
    await expect(page.locator('[data-turnstile-status]')).toHaveText('Complete the security check before submitting.');
    await expect(page.locator(`${item.form} button[type=submit]`)).toBeEnabled();
  } finally { f.close(); }
});

test('failed network submissions retain input and reset the token for a new attempt', async ({ page }) => {
  const { f, submissions } = await setup(page, { autoSolve: false });
  try {
    await page.goto('./admin/'); await fill(page, forms[1]);
    await expect(page.locator('[data-turnstile-widget] iframe')).toBeVisible();
    await challenge(page, 'solve');
    await page.route(`${api}/api/admin/login`, route => route.abort());
    await page.locator('[data-admin-login] button[type=submit]').click();
    await expect(page.locator('[data-admin-status]')).toContainText('could not reach');
    await expect(page.locator('[data-admin-login] [name=email]')).toHaveValue('alonso@dustwave.xyz');
    await expect(page.locator('[data-turnstile-status]')).toContainText('Complete the security check');
    await page.unroute(`${api}/api/admin/login`);
    await challenge(page, 'solve');
    await page.locator('[data-admin-login] button[type=submit]').click();
    await expect(page.locator('[data-admin-status]')).toContainText('a sign-in link will arrive');
    expect(submissions).toHaveLength(1);
  } finally { f.close(); }
});

test('blocked scripts and challenge errors provide keyboard-accessible recovery without bypassing verification', async ({ page }) => {
  const { f, submissions } = await setup(page, { blocked: true, autoSolve: false });
  try {
    await page.goto('./admin/'); await fill(page, forms[1]);
    const retry = page.getByRole('button', { name: 'Retry security check' });
    await expect(retry).toBeVisible();
    await page.locator('[data-admin-login] button[type=submit]').click();
    expect(submissions).toHaveLength(0);
    await mockTurnstile(page, { autoSolve: false });
    await retry.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('[data-turnstile-widget] iframe')).toBeVisible();
    await challenge(page, 'error'); await expect(retry).toBeVisible();
    await retry.click(); await challenge(page, 'solve');
    await expect(page.locator('[data-turnstile-status]')).toHaveText('Security check complete.');
  } finally { f.close(); }
});

test('three widgets reflow on small phones, enlarged text, desktop and resize; footer links remain usable', async ({ page }) => {
  const { f } = await setup(page);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const item of forms) {
      for (const [width, height, scale] of [[320,568,100], [375,667,100], [768,1024,100], [1440,900,100], [320,568,200], [375,667,200]]) {
        await page.setViewportSize({ width, height }); await page.goto(item.page);
        if (scale !== 100) await applyTextScale(page, scale);
        const frame = page.locator('[data-turnstile-widget] iframe');
        await expect(frame).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const box = await frame.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        const container = await page.locator('[data-turnstile-widget]').boundingBox();
        expect(container.width).toBeGreaterThanOrEqual(150);
        expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width + 1);
        await expect(page.locator('[data-security-check]')).toHaveAttribute('data-size', container.width < 300 ? 'compact' : 'flexible');
        await expect(page.getByRole('link', { name: 'Follow on Facebook' })).toHaveAttribute('href', 'https://www.facebook.com/profile.php/?id=61589843461998');
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('./admin/');
    await expect(page.locator('[data-security-check]')).toHaveAttribute('data-size', 'flexible');
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.locator('[data-security-check]')).toHaveAttribute('data-size', 'compact');
    await expect(page.locator('[data-turnstile-widget] iframe')).toHaveCount(1);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;
    expect(violations).toEqual([]);
    await page.locator('[data-admin-login] [name=email]').focus(); await page.keyboard.press('Tab');
    await expect(page.frameLocator('[data-turnstile-widget] iframe').getByRole('button')).toBeFocused();
  } finally { f.close(); }
});

test('private email-link exchange and authenticated staff screens never load the Turnstile script', async ({ page }) => {
  const { f } = await setup(page);
  const loaded = []; page.on('request', req => { if (req.url().startsWith('https://challenges.cloudflare.com/')) loaded.push(req.url()); });
  try {
    for (const [path, kind, destination, workspace] of [
      ['/api/admin/login', 'admin_link', 'admin', '[data-admin-dashboard]'],
      ['/api/door/login', 'door_link', 'check-in', '[data-door-workspace]']
    ]) {
      await f.request(path, { method: 'POST', body: { email: 'alonso@dustwave.xyz' } });
      const token = await f.link(kind);
      await page.goto(`./${destination}/#token=${token}`);
      await expect(page.locator(workspace)).toBeVisible();
      expect(new URL(page.url()).hash).toBe('');
      await page.reload(); await expect(page.locator(workspace)).toBeVisible();
      expect(loaded).toEqual([]);
    }
  } finally { f.close(); }
});

test('staff sign-out loads the challenge in a fresh document without the previous private dashboard', async ({ page }) => {
  const { f } = await setup(page);
  try {
    f.seedEntry(2, true, 'Private Guest Example');
    await f.request('/api/admin/login', { method: 'POST', body: { email: 'alonso@dustwave.xyz' } });
    await page.goto(`./admin/#token=${await f.link('admin_link')}`);
    await expect(page.locator('[data-entries]')).toContainText('Private Guest Example');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('[data-turnstile-status]')).toHaveText('Security check complete.');
    await expect(page.locator('[data-entries]')).toBeEmpty();
    await expect(page.locator('[data-admin-login]')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('chile-drop-admin-session'))).toBeNull();
  } finally { f.close(); }
});
