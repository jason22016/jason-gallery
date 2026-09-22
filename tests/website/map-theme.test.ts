import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { expect } from 'playwright/test';
import sharp from 'sharp';
import { buildFixture, repo } from './fixture';
import { serve } from './server';
import { installMapFixture } from './map-fixture';
import { expectColor } from './viewer-assertions';

let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
const root = path.join(repo, '.cache/map-theme-fixture');
before(async () => {
  await buildFixture({ root });
  server = await serve(path.join(root, 'dist'));
  browser = await chromium.launch();
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });

async function canvasColor(canvas: Locator) {
  const { data } = await sharp(await canvas.screenshot()).extract({ left: 24, top: 80, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data];
}
async function settled(page: Page, theme: 'light' | 'dark', canvas = page.locator('.photo-map canvas')) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  await expect.poll(() => canvasColor(canvas)).toEqual(theme === 'light' ? [243, 245, 247] : [14, 14, 14]);
}

test('map paints both themes smoothly without losing the canvas, camera or selection; MiniMap follows system changes', async t => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1100, height: 780 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installMapFixture(page, server.url);
  await page.goto(`${server.url}/map/?query=Portrait`);
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
  await settled(page, 'light');
  await expect(page.locator('.maplibregl-ctrl-attrib-button')).toHaveCSS('filter', 'invert(0)');
  const canvas = await page.locator('.photo-map canvas').elementHandle();
  await page.locator('.photo-marker-pin').click();
  await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
  // A real pan makes an accidental map recreation/recenter observable.
  await page.mouse.move(210, 300); await page.mouse.down();
  await page.mouse.move(265, 330, { steps: 10 });
  // Hold past MapLibre's 160ms velocity buffer so the baseline is captured
  // after this deliberate pan, not during environment-dependent inertia.
  await page.waitForTimeout(200); await page.mouse.up();
  const markerPosition = () => page.locator('.photo-marker-host').evaluate(el => {
    const { x, y } = el.getBoundingClientRect(); return { x, y };
  });
  const position = await markerPosition();
  const selectedURL = page.url();
  for (const theme of ['dark', 'light'] as const) {
    // Capture composed frames: WebGL clears its drawing buffer after compositing,
    // so readPixels from an unrelated rAF can return transparent pixels.
    const samples: number[] = [];
    const start = Date.now();
    await page.locator('.theme-toggle').evaluate(el => (el as HTMLElement).click());
    do {
      samples.push((await canvasColor(page.locator('.photo-map canvas')))[0]!);
      if (samples.some(value => value > 16 && value < 241)) break;
    } while (Date.now() - start < 1200);
    assert(samples.some(value => value > 16 && value < 241), `Map must paint intermediate shades (${theme}): ${samples}`);
    await settled(page, theme);
    assert(await canvas!.evaluate(el => el === document.querySelector('.photo-map canvas')));
    const current = await markerPosition();
    assert(Math.abs(current.x - position.x) < 1 && Math.abs(current.y - position.y) < 1, 'Theme changes keep the camera position, allowing native marker pixel snapping');
    assert.equal(page.url(), selectedURL);
    await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
    await expectColor(page.locator('.map-info-panel'), 'color', theme === 'dark' ? 'rgba(255,255,255,.85)' : 'rgba(32,36,43,.92)');
    await expect(page.locator('.maplibregl-ctrl-attrib-button')).toHaveCSS('filter', theme === 'dark' ? 'invert(1)' : 'invert(0)');
    await page.getByRole('button', { name: '搜索和筛选', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '搜索和筛选', exact: true });
    await expectColor(panel.locator('.primary-button'), 'color', theme === 'dark' ? 'rgba(255,255,255,.85)' : '#ffffff');
    await panel.locator('.primary-button').click();
    await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
  }
  await page.keyboard.press('Tab');
  await page.locator('.maplibregl-ctrl-attrib-button').focus();
  await expect(page.locator('.maplibregl-ctrl-attrib-button')).toHaveCSS('filter', 'invert(1)');
  await expectColor(page.locator('.maplibregl-ctrl-attrib-button'), 'background-color', 'rgba(255,255,255,.85)');
  await page.getByLabel('主题设置', { exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' }); await settled(page, 'dark');
  await page.locator('[data-card-kind="selected"] .photo-marker-card-title').click();
  await page.getByRole('button', { name: '照片信息', exact: true }).click();
  const mini = page.locator('.viewer-minimap');
  await mini.scrollIntoViewIfNeeded();
  await expect(mini).toHaveAttribute('data-map-state', 'ready');
  await settled(page, 'dark', mini.locator('canvas'));
  const miniCanvas = await mini.locator('canvas').elementHandle();
  await page.emulateMedia({ colorScheme: 'light' }); await settled(page, 'light', mini.locator('canvas'));
  assert(await miniCanvas!.evaluate(el => el === document.querySelector('.viewer-minimap canvas')));
  await expect(page.locator('.photo-dialog .theme-toggle')).toHaveCount(0);
  assert.deepEqual(errors, []);
});

test('mobile map applies a theme chosen while tiles load, respects reduced motion and keeps attribution legible', async t => {
  const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const page = await context.newPage();
  await installMapFixture(page, server.url);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tiles.json', async route => { await gate; await route.fallback(); });
  await page.goto(`${server.url}/map/?query=Portrait`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.site-theme-control astro-island')).not.toHaveAttribute('ssr', '');
  await page.locator('.theme-toggle').tap();
  release();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
  await settled(page, 'dark');
  await page.locator('.theme-toggle').tap(); await settled(page, 'light');
  await expect(page.locator('.maplibregl-ctrl-attrib-button')).toHaveCSS('filter', 'invert(0)');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(page.getByRole('button', { name: '放大地图', exact: true })).toBeEnabled();
});
