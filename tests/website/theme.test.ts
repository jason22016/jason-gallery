import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { buildFixture, repo } from './fixture';
import { serve } from './server';

let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
const errors: string[] = [];
const directory = path.join(repo, '.cache/theme-fixture');
before(async () => {
  await buildFixture({ root: directory });
  server = await serve(path.join(directory, 'dist'));
  browser = await chromium.launch();
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });

async function pageFor(options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ colorScheme: 'light', ...options });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  return { context, page };
}
async function ready(page: Page, route = '/') {
  await page.goto(`${server.url}${route}`);
  await expect(page.locator('.site-theme-control astro-island')).not.toHaveAttribute('ssr', '');
}
async function settled(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-light')))).toBe(theme === 'light' ? 100 : 0);
}
async function systemMode(page: Page) {
  await page.locator('.site-theme-control').getByLabel('主题设置').click();
  await page.locator('.site-theme-control').getByRole('button', { name: '跟随系统', exact: true }).click();
}
const toggle = (page: Page) => page.locator('.site-theme-control').getByRole('button', { name: '切换明暗主题', exact: true });

test('manual moon cycles and page materials interpolate in both directions', async t => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  await ready(page, '/explore/');
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  await settled(page, 'light');
  await expect(page.locator('.site-theme-control .theme-moon-light')).toBeVisible();
  const endpoints: string[] = [];
  endpoints.push(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor));
  for (const theme of ['dark', 'light'] as const) {
    const frames = await page.evaluate(`new Promise(resolve => {
      const frames = [], start = performance.now();
      document.querySelector('.site-theme-control .theme-toggle').click();
      function sample() {
        const root = document.documentElement;
        const orbit = getComputedStyle(document.querySelector('.site-theme-control .theme-moon-orbit'));
        frames.push({ amount: parseFloat(getComputedStyle(root).getPropertyValue('--theme-light')),
          color: getComputedStyle(document.body).backgroundColor, animation: orbit.animationName, transform: orbit.transform });
        if (performance.now() - start < 950) requestAnimationFrame(sample); else resolve(frames);
      }
      requestAnimationFrame(sample);
    })`) as { amount: number; color: string; animation: string; transform: string }[];
    assert(frames.some(frame => frame.amount > 20 && frame.amount < 80 && !endpoints.includes(frame.color)), `The page must actually paint intermediate colors (${theme}): ${JSON.stringify(frames)}`);
    const moonFrames = frames.filter(frame => frame.animation === (theme === 'dark' ? 'moon-wane' : 'moon-wax'));
    assert(new Set(moonFrames.map(frame => frame.transform)).size >= 3, 'The moon must pass through intermediate phases');
    await settled(page, theme);
    await expect(page.locator(`.site-theme-control .theme-moon-${theme}`)).toBeVisible();
    endpoints.push(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor));
  }
  assert.equal(endpoints[0], endpoints[2]);
  assert.notEqual(endpoints[0], endpoints[1]);
});

test('manual choice survives navigation and reload, and system mode can be restored', async t => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  await ready(page);
  await toggle(page).click();
  await settled(page, 'dark');
  await page.reload();
  await settled(page, 'dark');
  await ready(page, '/stats/');
  await settled(page, 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await settled(page, 'dark');
  await systemMode(page);
  await settled(page, 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('jason-gallery:theme')), null);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-transition', 'dark');
  await settled(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-transition', 'light');
  await settled(page, 'light');
});

test('the existing dark palette remains numerically unchanged', async t => {
  const { page, context } = await pageFor({ colorScheme: 'dark' }); t.after(() => context.close());
  await ready(page, '/projects/fixture-beta/');
  await settled(page, 'dark');
  const expected = {
    '--color-text': 'rgba(255,255,255,.85)', '--color-text-secondary': 'rgba(255,255,255,.5)',
    '--color-text-tertiary': 'rgba(255,255,255,.25)', '--color-text-quaternary': 'rgba(255,255,255,.1)', '--color-text-quinary': 'rgba(255,255,255,.05)',
    '--color-fill': 'rgba(255,255,255,.1)', '--color-fill-secondary': 'rgba(255,255,255,.08)',
    '--color-fill-tertiary': 'rgba(255,255,255,.05)', '--color-fill-quaternary': 'rgba(255,255,255,.03)',
    '--color-material-ultra-thick': 'rgba(40,40,40,.84)', '--color-material-thick': 'rgba(40,40,40,.72)',
    '--color-material-medium': 'rgba(40,40,40,.6)', '--color-material-thin': 'rgba(40,40,40,.48)',
    '--color-material-ultra-thin': 'rgba(40,40,40,.36)', '--color-material-opaque': 'rgb(40,40,40)',
    '--color-background': '#1c1c1e', '--color-accent': '#007aff', '--color-blue': 'rgb(10,132,255)',
    '--color-on-accent': 'rgba(255,255,255,.85)',
    '--color-red': 'rgb(255,105,97)', '--color-green': 'rgb(52,199,89)', '--color-histogram-blue': 'rgb(64,156,255)', '--color-orange': 'rgb(255,159,10)',
    '--gallery-histogram-grid': 'rgba(255,255,255,.04)', '--gallery-histogram-highlight': 'rgba(255,255,255,.03)',
    '--portfolio-background': '#161616', '--portfolio-text': '#eeeeee', '--portfolio-thumbnail': '#282828',
    '--portfolio-error': '#aaaaaa', '--portfolio-footer': '#a7adb0', '--portfolio-muted': '#888888',
  };
  const mismatches = await page.evaluate(values => {
    const context = document.createElement('canvas').getContext('2d')!;
    const style = getComputedStyle(document.body);
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = style.getPropertyValue(key); context.fillRect(0, 0, 1, 1);
      const actual = [...context.getImageData(0, 0, 1, 1).data].join(',');
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      if (actual !== [...context.getImageData(0, 0, 1, 1).data].join(',')) mismatches.push(key);
    }
    return mismatches;
  }, expected);
  assert.deepEqual(mismatches, []);
});

test('all public pages and the native photo dialog share the theme on narrow screens', async t => {
  const { page, context } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => context.close());
  for (const route of ['/', '/explore/', '/map/', '/stats/', '/projects/fixture-beta/', '/not-found/']) {
    await ready(page, route);
    await settled(page, 'light');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} overflowed`);
    const button = await toggle(page).boundingBox();
    assert(button && button.x >= 0 && button.x + button.width <= 390);
  }
  const moonSpacing = await page.evaluate(() => {
    const moon = document.querySelector('.site-theme-control .theme-moon')!.getBoundingClientRect();
    const glyph = document.querySelector('.site-theme-control .theme-moon-light')!.getBoundingClientRect();
    const toggle = document.querySelector('.site-theme-control .theme-toggle')!.getBoundingClientRect();
    const arrow = document.querySelector('.site-theme-control .theme-menu > summary svg')!.getBoundingClientRect();
    return { clipWidth: moon.width, glyphWidth: glyph.width, leftBuffer: glyph.left - moon.left,
      rightBuffer: moon.right - glyph.right, separation: arrow.left - moon.right,
      clipLeft: moon.left, clipRight: moon.right, toggleLeft: toggle.left, toggleRight: toggle.right };
  });
  assert.equal(moonSpacing.clipWidth, 26);
  assert.equal(moonSpacing.glyphWidth, 22);
  assert.equal(moonSpacing.leftBuffer, 2);
  assert.equal(moonSpacing.rightBuffer, 2);
  assert.equal(moonSpacing.separation, 17);
  assert(moonSpacing.clipLeft >= moonSpacing.toggleLeft && moonSpacing.clipRight <= moonSpacing.toggleRight,
    'the expanded moon clip stays inside its touch target');
  await ready(page, '/projects/fixture-beta/');
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  await page.locator('.gallery-live [data-gallery-index="0"]').click();
  const dialog = page.locator('.photo-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('color-scheme', 'light');
  await expect(dialog.getByRole('button', { name: '切换明暗主题', exact: true })).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await settled(page, 'dark');
  await expect(dialog).toHaveCSS('color-scheme', 'dark');
  await dialog.getByRole('button', { name: '关闭照片', exact: true }).tap();
  await settled(page, 'dark');
});

test('reduced motion disables both animations and rapid switches finish in the requested state', async t => {
  const { page, context } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => context.close());
  await ready(page);
  await toggle(page).click();
  await settled(page, 'dark');
  await expect(page.locator('html')).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await toggle(page).click();
  await toggle(page).click();
  await toggle(page).click();
  await settled(page, 'light');
});

test('theme changes synchronize across tabs', async t => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  await ready(page);
  const second = await context.newPage();
  await ready(second, '/explore/');
  await toggle(page).click();
  await settled(second, 'dark');
  await expect(second.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await systemMode(second);
  await settled(page, 'light');
});

test('blocked storage and disabled JavaScript still have usable theme fallbacks', async t => {
  const { page, context } = await pageFor(); t.after(() => context.close());
  await context.addInitScript({ content: `for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = function () { throw new DOMException('Blocked', 'SecurityError'); };` });
  await ready(page);
  await toggle(page).click();
  await settled(page, 'dark');
  const staticContext = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' }); t.after(() => staticContext.close());
  const staticPage = await staticContext.newPage();
  await staticPage.goto(`${server.url}/explore/`);
  await expect(staticPage.locator('body')).toHaveCSS('color-scheme', 'light');
  await staticPage.emulateMedia({ colorScheme: 'dark' });
  await expect(staticPage.locator('body')).toHaveCSS('color-scheme', 'dark');
  await expect(staticPage.locator('.site-theme-control')).toBeHidden();
});

test('theme interactions do not produce browser errors', () => assert.deepEqual(errors, []));
