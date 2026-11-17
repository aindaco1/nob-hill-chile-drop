import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { buildEmailPreviews } from '../../scripts/preview-emails.mjs';

test('transactional emails remain readable on phones, with accessible actions and no remote assets', async ({ page }) => {
  const remoteRequests = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', route => { remoteRequests.push(route.request().url()); return route.abort(); });
  for (const { name, html } of await buildEmailPreviews()) {
    await page.setViewportSize({ width: 800, height: 1000 });
    await page.setContent(html);
    await expect(page.locator('h1')).toHaveCount(1);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations, name).toEqual([]);
    for (const [width, height] of [[800, 1000], [375, 667], [320, 568]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}`).toBe(true);
      await expect(page.getByRole('link').first()).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
    }
    await page.getByRole('link').first().focus();
    await expect(page.getByRole('link').first()).toBeFocused();
    await page.emulateMedia({ colorScheme: 'dark' });
    // Email clients commonly use pixel sizes. Enlarge text itself, including
    // explicit line heights, without enlarging the viewport or QR image.
    await page.evaluate(() => {
      const sizes = [...document.body.querySelectorAll('*')].map(element => {
        const style = getComputedStyle(element);
        return { element, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
      });
      for (const { element, fontSize, lineHeight } of sizes) {
        element.style.fontSize = `${fontSize * 2}px`;
        if (Number.isFinite(lineHeight)) element.style.lineHeight = `${lineHeight * 2}px`;
      }
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} enlarged`).toBe(true);
    const wrappedValues = await page.locator('td[align="right"]').evaluateAll(cells => cells.filter(cell => {
      const range = document.createRange(); range.selectNodeContents(cell);
      return range.getClientRects().length > 1;
    }).map(cell => cell.textContent));
    expect(wrappedValues, `${name} metrics remain on one line at 200% text`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`${name}-320-enlarged.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  expect(remoteRequests).toEqual([]);
});
