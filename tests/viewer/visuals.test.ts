import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { chromium, type Browser, type BrowserContextOptions } from 'playwright';
import { expect } from 'playwright/test';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';
import { BIN_COUNT, calculateHistogram } from '../../src/components/viewer/HistogramChart';
import { clampAccentContrast, contrastRatio, dataUrlFromThumbhash } from '../../src/components/viewer/color';
import { readFile } from 'node:fs/promises';

let browser: Browser, server: Awaited<ReturnType<typeof serve>>;
before(async () => { server = await serve('.cache/viewer-dist'); browser = await chromium.launch(softwareGPUOptions('webgl')); });
after(async () => { await browser?.close(); await server?.close(); });

async function fixture(options: BrowserContextOptions = {}, webgl = false) {
  const context = await browser.newContext(options);
  await context.addInitScript({ content: `
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return !${webgl} && ['webgl','webgl2','webgpu'].includes(kind) ? null : Reflect.apply(get, this, [kind, ...args]); };
  ` });
  const page = await context.newPage();
  await page.route('https://**', route => route.abort());
  await page.route('**/visual-metadata.json?*', route => route.fulfill({ json: {
    exif: { FocalLength: 35, FNumber: 1.4, ExposureTime: '1/125', ISO: 100, ExposureCompensation: 0, GPSAltitude: 0,
      Artist: 'Metadata fixture', ExposureProgram: 'Manual', WhiteBalance: 'Auto', Copyright: 'Fixture owner',
      FujiRecipe: { Clarity: 0, FilmMode: 'Classic Chrome', DynamicRange: 100, ExtraSetting: 'Preserved Jason field' } },
    toneAnalysis: { toneType: 'normal', brightness: 40, contrast: 50, shadowRatio: .2, highlightRatio: .1 },
  } }));
  await page.goto(`${server.url}/visuals.html`);
  return { page, context };
}

async function open(page: import('playwright').Page) {
  await page.getByRole('button', { name: 'Open visual viewer' }).click();
  await page.locator('[data-viewer-transition-variant]').waitFor({ state: 'detached' });
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
}

test('upstream histogram keeps 128 bins, RGB and Rec.709 luminance', () => {
  const bins = calculateHistogram({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255]) } as ImageData);
  assert.equal(BIN_COUNT, 128);
  for (const values of Object.values(bins)) { assert.equal(values.length, 128); assert.equal(values.reduce((a, b) => a + b, 0), 3); }
  assert.equal(bins.red[127], 2);
  assert.equal(bins.green[0], 2);
  assert.equal(bins.luminance[27], 1);
  assert.equal(bins.luminance[0], 1);
  assert.equal(bins.luminance[127], 1);
});

test('photo accents stay in the upstream contrast band and malformed hashes are harmless', () => {
  for (const color of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 255, g: 0, b: 0 }, { r: 20, g: 50, b: 100 }]) {
    const ratio = contrastRatio(clampAccentContrast(color), { r: 28, g: 28, b: 30 });
    assert(ratio >= 2.2 && ratio <= 4.5);
  }
  assert.equal(dataUrlFromThumbhash('malformed-hash'), null);
});

test('dark-only materials, local icons/font, quiet desktop controls and spring Inspector stay usable', async t => {
  const { page, context } = await fixture({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' }); t.after(() => context.close());
  await open(page);
  await page.mouse.move(1270, 5);
  await expect(page.locator('.viewer-next')).toHaveCSS('opacity', '0');
  await expect(page.getByRole('button', { name: '放大', exact: true })).toHaveCSS('opacity', '0');
  await expect(page.locator('.photo-dialog')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('.viewer-backdrop-base')).toHaveCSS('background-color', 'rgb(40, 40, 40)');
  await expect(page.locator('.viewer-desktop-inspector')).toHaveCSS('backdrop-filter', 'blur(40px)');
  await expect(page.locator('.viewer-close')).toHaveCSS('width', '32px');
  await expect(page.locator('.viewer-close')).toHaveCSS('border-radius', '999px');
  assert((await page.locator('.viewer-close i').evaluate(el => getComputedStyle(el).maskImage)).includes('data:image/svg+xml'));
  await expect.poll(() => page.evaluate(() => document.fonts.check('12px Geist'))).toBe(true);
  const accent = await page.locator('.photo-dialog').evaluate(el => getComputedStyle(el).getPropertyValue('--color-accent'));
  await page.mouse.move(400, 300);
  await expect(page.locator('.viewer-next')).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.photo-dialog').evaluate(el => getComputedStyle(el).getPropertyValue('--color-accent'))).not.toBe(accent);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.viewer-backdrop-base')).toHaveCSS('background-color', 'rgb(40, 40, 40)');
  await page.evaluate(`
    window.inspectorWidths = [];
    const sample = () => {
      const width = document.querySelector('.viewer-inspector-slot').getBoundingClientRect().width;
      window.inspectorWidths.push(width);
      if (width > 0) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  `);
  await page.getByRole('button', { name: '收起照片信息' }).click();
  await expect(page.locator('.viewer-inspector')).toHaveCount(0);
  await expect(page.locator('.viewer-inspector-slot')).toHaveCSS('width', '0px');
  const widths = await page.evaluate('window.inspectorWidths') as number[];
  assert(widths.some(width => width > 0 && width < 320), `Inspector width must move continuously: ${widths.join(',')}`);
  await expect(page.getByRole('button', { name: '照片信息', exact: true })).toBeFocused();
  await page.keyboard.press('i');
  await expect(page.locator('.viewer-inspector-slot')).toHaveCSS('width', '320px');
  await expect(page.locator('.metadata-content')).toContainText('Metadata fixture');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'true');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'false');
  await expect(page.getByRole('button', { name: '放大', exact: true })).toBeEnabled();
});

test('background crossfades, holds the prior layer until fallback decodes, and ignores stale loads', async t => {
  const { page, context } = await fixture({ viewport: { width: 1280, height: 900 } }); t.after(() => context.close());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/ordinary.jpg?background=2', async route => { await held; await route.continue().catch(() => {}); });
  await open(page);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-background-photo="visual-1"]')).toBeAttached();
  assert.equal(await page.locator('.viewer-background-layer').count(), 2, 'Outgoing and incoming hashes overlap');
  await expect(page.locator('.viewer-background-layer')).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await expect(page.locator('[data-background-photo="visual-1"]')).toBeVisible();
  await expect(page.locator('[data-background-photo="visual-2"]')).toHaveCount(0);
  await page.keyboard.press('Home');
  release();
  await expect(page.locator('.viewer-background-layer')).toHaveCount(1);
  await expect(page.locator('[data-background-photo="visual-0"]')).toBeVisible();
});

test('metadata sections preserve recipe extras and zero GPS; histogram resizes and errors remain honest', async t => {
  const { page, context } = await fixture({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }); t.after(() => context.close());
  await open(page);
  await expect(page.locator('.viewer-histogram')).toHaveAttribute('data-histogram-state', 'ready');
  assert.deepEqual(await page.locator('.metadata-section h3').allTextContents(), ['基本信息', '拍摄参数', '照片说明', '标签', '影调分析', '直方图', '设备信息', '拍摄模式', '胶片模拟配方', '拍摄位置', '技术参数']);
  for (const text of ['Preserved Jason field', '0 EV', '0 m', '0 °', 'Fixture owner']) await expect(page.locator('.metadata-content')).toContainText(text);
  const dimensions = await page.locator('canvas.histogram').evaluate(el => ({ width: (el as HTMLCanvasElement).width, css: el.clientWidth }));
  assert.equal(dimensions.width, dimensions.css * 2);
  await page.locator('.viewer-minimap').scrollIntoViewIfNeeded();
  await expect(page.locator('.viewer-minimap')).toHaveAttribute('data-map-state', 'error');
  await expect(page.locator('.viewer-minimap-link')).toHaveAttribute('href', /mlat=0&mlon=0/);
  await expect(page.locator('.viewer-minimap-status')).toContainText('底图暂时不可用');
  await page.route('**/ordinary.jpg?background=1', route => route.abort());
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-histogram')).toHaveAttribute('data-histogram-state', 'error');
  await expect(page.locator('canvas.histogram')).toHaveCSS('opacity', '0');
});

test('MiniMap renders its local style with real WebGL and retains provider attribution', async t => {
  const { page, context } = await fixture({ viewport: { width: 1280, height: 900 } }, true); t.after(() => context.close());
  const png = await readFile('.cache/viewer-fixtures/ordinary.jpg');
  await page.route('https://**', route => {
    const url = route.request().url();
    if (url.endsWith('tiles.json')) return route.fulfill({ json: { tilejson: '3.0.0', tiles: [`${server.url}/empty/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14 } });
    if (/sprite.*\.json/.test(url)) return route.fulfill({ json: {} });
    if (/sprite.*\.png/.test(url)) return route.fulfill({ body: png, contentType: 'image/jpeg' });
    return route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
  });
  await page.route('**/empty/**/*.pbf', route => route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' }));
  await open(page);
  await page.locator('.viewer-minimap').scrollIntoViewIfNeeded();
  await expect(page.locator('.viewer-minimap')).toHaveAttribute('data-map-state', 'ready');
  await expect(page.locator('.viewer-minimap-marker')).toBeVisible();
  assert(await page.locator('.viewer-minimap-canvas canvas').evaluate(el => (el as HTMLCanvasElement).width > 0));
  await expect(page.locator('.viewer-minimap-attribution')).toContainText('© OpenStreetMap · © CARTO');
});

test('mobile Sheet keeps opaque backing, safe-area geometry and 32px controls with 44px hit targets', async t => {
  const { page, context } = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); t.after(() => context.close());
  await page.addStyleTag({ content: '.photo-dialog .viewer-thumbnail-bar { padding-bottom: 34px; }' });
  await open(page);
  await expect(page.locator('.viewer-previous, .viewer-next')).toHaveCount(0);
  const stage = await page.locator('.viewer-image-stage').boundingBox();
  assert(stage && stage.height === 844 - 48 - 34);
  const close = await page.locator('.viewer-close').boundingBox(); assert(close && close.width === 32);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: close.x + 16, y: close.y - 4 }), '关闭照片');
  await page.getByRole('button', { name: '照片信息', exact: true }).tap();
  await expect(page.locator('.mobile-inspector-sheet')).not.toHaveAttribute('inert');
  await expect(page.locator('.viewer-backdrop-base')).toHaveCSS('opacity', '1');
  await expect(page.locator('.inspector-sheet-surface')).toHaveCSS('border-top-left-radius', '16px');
  await expect(page.locator('.inspector-sheet-handle')).toHaveCSS('width', '48px');
  await expect(page.locator('.inspector-sheet-surface')).toHaveCSS('backdrop-filter', 'blur(40px)');
  assert(await page.locator('.inspector-sheet-content').evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.getByRole('button', { name: '收起照片信息' }).tap();
  await expect(page.locator('.mobile-inspector-sheet')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
});

test('shared-element handoff includes the mobile thumbnail safe area without a final frame jump', async t => {
  const { page, context } = await fixture({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => context.close());
  await page.addStyleTag({ content: '.photo-dialog .viewer-thumbnail-bar { padding-bottom: 34px; }' });
  await page.evaluate(`
    window.handoffSamples = [];
    let entered = false;
    const sample = () => {
      const element = document.querySelector('[data-viewer-transition-variant="entry"]');
      if (element) { entered = true; const { x, y, width, height } = element.getBoundingClientRect(); window.handoffSamples.push({ x, y, width, height }); }
      if (!entered || element) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  `);
  await open(page);
  const result = await page.evaluate(() => {
    const stage = document.querySelector('.viewer-image-stage')!.getBoundingClientRect();
    const samples = (window as unknown as { handoffSamples: { x: number; y: number; width: number; height: number }[] }).handoffSamples;
    const width = Math.min(stage.width, stage.height * 2 / 3), height = width * 3 / 2;
    return { last: samples.at(-1), count: samples.length, target: { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height } };
  });
  assert(result.count > 2 && result.last);
  for (const key of ['x', 'y', 'width', 'height'] as const) assert(Math.abs(result.last[key] - result.target[key]) < 2, `${key} must hand off within 2px`);
});
