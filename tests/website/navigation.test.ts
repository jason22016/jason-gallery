import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { buildFixture, repo } from './fixture';
import { serve } from './server';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });
const root = path.join(repo, '.cache/navigation-fixture');
let server: Awaited<ReturnType<typeof serve>>;

before(async () => {
  await buildFixture({ root });
  server = await serve(path.join(root, 'dist'));
}, { timeout: 120_000 });
after(async () => { await server?.close(); });

for (const engine of [chromium, webkit]) {
  test(`${engine.name()}: mobile navigation follows each menu link with one tap`, async t => {
    const browser = await engine.launch(engine === chromium ? softwareGPUOptions('webgl') : {});
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 427, height: 780 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(browserReadyTimeout(5_000));
    await page.addInitScript({ content: `
      window.navigationEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'focusin', 'focusout', 'click', 'touchstart', 'touchend']) {
        document.addEventListener(type, event => {
          window.navigationEvents.push({ type, target: event.target?.outerHTML?.slice(0, 200), related: event.relatedTarget?.outerHTML?.slice(0, 200) });
        }, true);
      }
    ` });
    for (const [name, route] of [['Projects', '/'], ['Explore', '/explore/'], ['Map', '/map/'], ['Stats', '/stats/']] as const) {
      await page.goto(`${server.url}/projects/fixture-beta/`);
      await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
      const menu = page.locator('.gallery-live .site-navigation-menu');
      await menu.locator('summary').tap();
      await expect(menu).toHaveAttribute('open', '');
      const link = menu.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      try {
        await link.tap();
        await expect(page).toHaveURL(server.url + route);
      } catch (error) {
        console.log(engine.name(), name, await page.evaluate('window.navigationEvents'));
        await page.screenshot({ path: path.join(root, `navigation-${engine.name()}-failure.png`) });
        throw error;
      }
    }
    await page.goto(`${server.url}/projects/fixture-beta/`);
    await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
    const menu = page.locator('.gallery-live .site-navigation-menu');
    const toggle = menu.locator('summary');
    await toggle.tap();
    await expect(menu).toHaveAttribute('open', '');
    await toggle.tap();
    await expect(menu).not.toHaveAttribute('open');
    await toggle.tap();
    await page.locator('.gallery-live .gallery-count').tap();
    await expect(menu).not.toHaveAttribute('open');
  });

  test(`${engine.name()}: desktop navigation keeps mouse and keyboard dismissal working`, async t => {
    const browser = await engine.launch(engine === chromium ? softwareGPUOptions('webgl') : {});
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
    page.setDefaultTimeout(browserReadyTimeout(5_000));
    await page.goto(`${server.url}/projects/fixture-beta/`);
    await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
    const menu = page.locator('.gallery-live .site-navigation-menu');
    const toggle = menu.locator('summary');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('open', '');
    // Safari's native Tab order depends on the user's keyboard preferences.
    await menu.getByRole('link', { name: 'Projects', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await menu.getByRole('link', { name: 'Stats', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(menu).not.toHaveAttribute('open');
    await toggle.click();
    await menu.getByRole('link', { name: 'Explore', exact: true }).click();
    await expect(page).toHaveURL(server.url + '/explore/');
  });
}
