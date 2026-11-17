import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixture } from '../../api/test/helpers.js';
import { applyTextScale } from '../../shared/dust-wave-platform/packages/test-core/src/rendering.js';

const api = 'https://nob-hill-chile-drop-api.jogo.workers.dev';
const owner = 'owner@example.test';
async function setup(page, holdList = null) {
  const f = fixture(); f.env.SUPER_ADMIN_EMAILS = owner; f.env.ALLOWED_ORIGINS = 'http://127.0.0.1:4173';
  await page.route(`${api}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const result = await f.request(url.pathname + url.search, { method: request.method(), token: request.headers().authorization?.slice(7), ...(request.postData() ? { body: request.postDataJSON() } : {}) });
    if (holdList && request.method() === 'GET' && url.pathname === '/api/admin/access') await holdList();
    await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) });
  });
  async function login(email) {
    await f.request('/api/admin/login', { method: 'POST', body: { email } });
    const token = await f.link('admin_link', email);
    await page.goto('about:blank');
    await page.goto(`./admin/#token=${token}`);
    await expect(page.locator('[data-admin-dashboard]')).toBeVisible();
  }
  return { f, login };
}

test('super admin manages access through shared confirmation controls; regular admins cannot see them', async ({ page }) => {
  const { f, login } = await setup(page);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(owner);
    const panel = page.locator('[data-admin-access]');
    const roster = page.locator('[data-admin-access-list]');
    await expect(roster).toContainText(owner);
    await expect(panel.getByRole('button', { name: `Remove admin ${owner}`, exact: true })).toHaveCount(0);
    const initialMail = f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n;
    const added = 'new.organizer@example.test';
    await panel.getByLabel('New admin email').fill(`  ${added.toUpperCase()}  `);
    await panel.getByRole('button', { name: 'Add admin', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(roster).toContainText(added);
    await expect(panel.getByLabel('New admin email')).toBeFocused();
    expect(f.DB.prepare('SELECT active FROM admin_access WHERE email=?').bind(added).first().active).toBe(1);
    expect(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n).toBe(initialMail);
    expect((await new AxeBuilder({ page }).include('[data-admin-access]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    for (const [width,height] of [[1280,900],[375,667],[320,568]]) {
      await page.setViewportSize({ width,height }); await panel.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.screenshot({ path: test.info().outputPath(`access-${width}.png`) });
    }
    const remove = panel.getByRole('button', { name: `Remove admin ${added}`, exact: true });
    await remove.click();
    const dialog = page.getByRole('dialog', { name: 'Remove admin access?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(remove).toBeFocused();
    expect(f.DB.prepare('SELECT active FROM admin_access WHERE email=?').bind(added).first().active).toBe(1);
    await applyTextScale(page,200); await remove.click();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.dw-admin-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('access-confirm-320-enlarged.png') });
    await dialog.getByRole('button', { name: 'Remove admin', exact: true }).click();
    await expect(roster).not.toContainText(added);
    expect(f.DB.prepare('SELECT active FROM admin_access WHERE email=?').bind(added).first().active).toBe(0);
    expect(f.DB.prepare('SELECT COUNT(*) AS n FROM outbox').first().n).toBe(initialMail);
    expect(f.calls.length).toBe(0);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await login(f.env.ADMIN_EMAILS);
    await expect(panel).toBeHidden(); await expect(roster).toBeEmpty();
    await expect(page.getByRole('button',{name:'Save registration settings',exact:true})).toBeVisible();
  } finally { f.close(); }
});

test('a late admin roster response cannot restore access controls after sign-out', async ({ page }) => {
  let release, requested;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  const { f, login } = await setup(page, () => { requested(); return held; });
  try {
    await login(owner); await started;
    await page.getByRole('button', { name:'Sign out', exact:true }).click();
    release();
    await expect(page.locator('[data-admin-login]')).toBeVisible();
    await expect(page.locator('[data-admin-access]')).toBeHidden();
    await expect(page.locator('[data-admin-access-list]')).toBeEmpty();
  } finally { release(); await page.unrouteAll({ behavior:'wait' }); f.close(); }
});
