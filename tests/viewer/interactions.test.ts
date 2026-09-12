import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { chromium, type Browser, type Page, type CDPSession, type BrowserContextOptions } from 'playwright';
import { expect } from 'playwright/test';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';
import '../../packages/afilmory/viewer-motion/src/frame-utils.test';
import '../../packages/afilmory/viewer-motion/src/trigger-utils.test';
import '../../packages/afilmory/viewer-motion/src/mobile-interactions.test';
import { resolvePhotoViewerEntryState, shouldHideCurrentViewerImage } from '../../src/components/viewer/entry-animation-state';

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
  await page.route('**/metadata.json', route => route.fulfill({ json: { exif: null, toneAnalysis: null } }));
  await page.goto(`${server.url}/interactions.html`);
  return { page, context };
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Open viewer' }).click();
  await page.locator('[data-viewer-transition-variant]').waitFor({ state: 'detached' });
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
  await expect(page.locator('.viewer-entry-catchup')).toHaveCount(0);
}
async function transform(page: Page, selector: string) {
  return page.locator(selector).evaluate(el => {
    const css = getComputedStyle(el), matrix = new DOMMatrixReadOnly(css.transform);
    return { x: matrix.m41, y: matrix.m42, scale: matrix.m22, opacity: Number(css.opacity), radius: parseFloat(css.borderRadius) || 0 };
  });
}
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x = 0, y = 0, second?: [number, number]) {
  const points = [{ x, y, id: 1 }, ...(second ? [{ x: second[0], y: second[1], id: 2 }] : [])];
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : points });
}
async function drag(cdp: CDPSession, from: [number, number], to: [number, number], release = true) {
  await touch(cdp, 'touchStart', ...from);
  for (let i = 1; i <= 8; i++) await touch(cdp, 'touchMove', from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8);
  if (release) await touch(cdp, 'touchEnd');
}
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test('entry catch-up remains until the slide is visually ready; only current slide is hidden', () => {
  for (const ready of [false, true]) {
    const state = resolvePhotoViewerEntryState({ hasTransitionTrigger: true, isCurrentImageVisualReady: ready, isEntryTransitionActive: false, isOpen: true, isViewerContentVisible: true });
    assert(state.shouldMountImageStage);
    assert.equal(state.shouldShowEntryImageCatchup, !ready);
    assert.equal(shouldHideCurrentViewerImage({ isCurrentImage: false, isEntryImageCatchupVisible: state.shouldShowEntryImageCatchup }), false);
  }
  assert.equal(resolvePhotoViewerEntryState({ hasTransitionTrigger: true, isCurrentImageVisualReady: false, isEntryTransitionActive: true, isOpen: true, isViewerContentVisible: false }).shouldMountImageStage, false);
});

test('Swiper Virtual slides follow the finger continuously with the adjacent photo before release', async t => {
  const { page, context } = await fixture(mobile); t.after(() => context.close()); await open(page);
  const cdp = await context.newCDPSession(page);
  await drag(cdp, [310, 350], [210, 350], false);
  const wrapper = await transform(page, '.swiper-wrapper');
  assert(wrapper.x < -50 && wrapper.x > -160, `Expected live horizontal translation, got ${wrapper.x}`);
  const current = await page.locator('.swiper-slide[data-photo-id="photo-0"]').boundingBox();
  const neighbor = await page.locator('.swiper-slide[data-photo-id="photo-1"]').boundingBox();
  assert(current && neighbor && current.x < 0 && neighbor.x < 390 && neighbor.x > 0);
  assert(Math.abs(neighbor.x - (current.x + current.width)) < 2, 'Adjacent slides must remain contiguous');
  assert.equal(await page.locator('.viewer-media').count(), 1);
  await touch(cdp, 'touchMove', 70, 350); await touch(cdp, 'touchEnd');
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 180');
  await expect(page).toHaveURL(/photo=photo-1/);
  await expect(page.locator('.swiper-slide-active')).toHaveAttribute('data-photo-id', 'photo-1');
});

test('drag dismissal links photo, backdrop, chrome, thumbnails, radius and hint; short drag springs back', async t => {
  const { page, context } = await fixture(mobile); t.after(() => context.close()); await open(page);
  const cdp = await context.newCDPSession(page);
  await drag(cdp, [190, 260], [215, 320], false);
  const photo = await transform(page, '.viewer-drag-content'), chrome = await transform(page, '.viewer-toolbar');
  const backdrop = await transform(page, '.viewer-backdrop'), thumbs = await transform(page, '.viewer-thumbnails-motion');
  const hint = await transform(page, '.viewer-gesture-hint');
  assert(photo.y > 30 && photo.scale < 1 && photo.radius > 0);
  assert(chrome.opacity < 1 && backdrop.opacity < 1 && thumbs.opacity < 1 && thumbs.y > 0);
  assert(hint.opacity < .42 && hint.y > 0);
  await page.waitForTimeout(250); await touch(cdp, 'touchEnd');
  await expect.poll(async () => Math.abs((await transform(page, '.viewer-drag-content')).y)).toBeLessThan(.01);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 180');
  await drag(cdp, [190, 260], [210, 530]);
  await page.locator('[data-viewer-transition-variant="exit"]').waitFor();
  const exit = await transform(page, '[data-viewer-transition-variant="exit"]');
  assert(exit.y > 0, 'Exit starts from a projected drag frame');
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
});

test('Inspector Sheet y/opacity/scale follow partial gesture and remain inert when closed', async t => {
  const { page, context } = await fixture(mobile); t.after(() => context.close()); await open(page);
  const sheet = page.locator('.mobile-inspector-sheet');
  await expect(sheet).toHaveAttribute('inert', '');
  const cdp = await context.newCDPSession(page);
  const inputTrace: Array<Record<string, unknown>> = [];
  cdp.on('Tracing.dataCollected', ({ value }) => inputTrace.push(...value));
  await cdp.send('Tracing.start', { categories: 'input,benchmark', transferMode: 'ReportEvents' });
  const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const closed = await transform(page, '.mobile-inspector-sheet');
  await drag(cdp, [190, 460], [190, 400], false);
  const partial = await transform(page, '.mobile-inspector-sheet');
  const surface = await transform(page, '.inspector-sheet-surface');
  assert(partial.y > 0 && partial.y < closed.y && partial.opacity > 0 && partial.opacity < 1);
  assert(surface.scale > .965 && surface.scale < 1);
  // Continue the same touch over rendered frames instead of teleporting it
  // 190px in one packet, which gives the native recognizer an extreme velocity.
  for (let y = 380; y >= 220; y -= 20) { await touch(cdp, 'touchMove', 190, y); await frame(); }
  await touch(cdp, 'touchMove', 190, 210); await frame();
  await touch(cdp, 'touchEnd'); await frame();
  await expect.poll(async () => (await transform(page, '.mobile-inspector-sheet')).y).toBe(0);
  await expect.poll(async () => (await transform(page, '.inspector-sheet-surface')).scale).toBe(1);
  await expect(page.locator('.viewer-thumbnails-motion')).toHaveAttribute('inert', '');
  await page.evaluate(`
    window.inspectorTouchEvents = [];
    window.inspectorTouchTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'contextmenu']) {
      document.addEventListener(type, event => window.inspectorTouchTrace.push({
        type, time: performance.now(), timestamp: event.timeStamp, prevented: event.defaultPrevented,
        target: event.target.closest('button')?.getAttribute('aria-label') || event.target.tagName,
        bounds: document.querySelector('.mobile-inspector-sheet button').getBoundingClientRect().toJSON(),
      }), true);
    }
    const prevent = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (/^(touch|pointer|click)/.test(this.type)) window.inspectorTouchTrace.push({type: 'prevent:' + this.type, stack: new Error().stack});
      return prevent.call(this);
    };
    const button = document.querySelector('.mobile-inspector-sheet button');
    for (const type of ['touchstart', 'touchend', 'click']) {
      button.addEventListener(type, event => window.inspectorTouchEvents.push(type + ':' + event.isTrusted));
    }
  `);
  const close = await page.getByRole('button', { name: '收起照片信息' }).boundingBox(); assert(close);
  const point = { x: close.x + close.width / 2, y: close.y + close.height / 2 };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), point), '收起照片信息');
  // Chromium schedules the full native gesture; locator.tap sends down/up concurrently.
  await cdp.send('Input.synthesizeTapGesture', { ...point, gestureSourceType: 'touch' });
  try {
    await expect.poll(() => page.evaluate('window.inspectorTouchEvents')).toEqual(['touchstart:true', 'touchend:true', 'click:true']);
  } catch (error) {
    console.log('Inspector native touch trace:', await page.evaluate('window.inspectorTouchTrace'));
    const ended = new Promise<void>(resolve => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.end'); await ended;
    console.log('Chromium gesture trace:', JSON.stringify(inputTrace.filter(event => /Gesture|Touch|Suppress|Fling/i.test(String(event.name)))));
    throw error;
  }
  await cdp.send('Tracing.end');
  await expect(sheet).toHaveAttribute('inert', '');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 180');
});

test('pinch and zoom block slide/dismiss gestures, reset on navigation, and canceled touches recover', async t => {
  const { page, context } = await fixture(mobile); t.after(() => context.close()); await open(page);
  const cdp = await context.newCDPSession(page);
  await touch(cdp, 'touchStart', 150, 350, [240, 350]);
  await touch(cdp, 'touchMove', 140, 350, [250, 350]);
  await touch(cdp, 'touchMove', 100, 350, [290, 350]);
  await touch(cdp, 'touchEnd');
  await expect.poll(() => page.locator('.viewer-fallback').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m11)).toBeGreaterThan(1.1);
  await drag(cdp, [280, 340], [80, 350]); await drag(cdp, [190, 260], [190, 530]);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 180');
  assert.equal((await transform(page, '.viewer-drag-content')).y, 0);
  await page.keyboard.press('End');
  await expect(page.locator('.viewer-counter')).toHaveText('180 / 180');
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
  await expect.poll(() => page.locator('.viewer-fallback').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m11)).toBe(1);
  await expect.poll(() => page.locator('.swiper').evaluate(el => (el as HTMLElement & { swiper: { animating: boolean } }).swiper.animating)).toBe(false);
  await touch(cdp, 'touchStart', 100, 300); await touch(cdp, 'touchCancel');
  // Let Chromium retire the canceled native touch sequence before starting another.
  await page.waitForTimeout(150);
  // Exercise a deliberate long swipe: threshold handling consumes the first move,
  // so the old 220px gesture traveled less than half of the 390px slide.
  const startTranslate = (await transform(page, '.swiper-wrapper')).x;
  await drag(cdp, [40, 350], [350, 350], false);
  assert((await transform(page, '.swiper-wrapper')).x - startTranslate > 390 / 2);
  const longSwipeDuration = await page.locator('.swiper').evaluate(el => (el as HTMLElement & { swiper: { params: { longSwipesMs: number } } }).swiper.params.longSwipesMs);
  await page.waitForTimeout(longSwipeDuration + 50);
  await touch(cdp, 'touchEnd');
  await expect(page.locator('.viewer-counter')).toHaveText('179 / 180');
});

test('thumbnail aspect ratios, virtualization, centering, wheel, hover preview and responsive resize', async t => {
  const { page, context } = await fixture({ viewport: { width: 1280, height: 900 } }); t.after(() => context.close()); await open(page);
  assert(await page.locator('[data-filmstrip-id]').count() < 40, '180 thumbnails must be horizontally virtualized');
  const portrait = await page.locator('.viewer-thumbnail-item').first().boundingBox(); assert(portrait);
  assert.equal(portrait.height, 64); assert(Math.abs(portrait.width - 64 * 2 / 3) < 1);
  const filmstrip = page.locator('.viewer-filmstrip');
  // The selected thumbnail's 1.1 scale can extend scrollWidth beyond the layout track.
  const atEnd = () => expect.poll(() => filmstrip.evaluate(el => (el.firstElementChild as HTMLElement).offsetWidth - el.clientWidth - el.scrollLeft)).toBeLessThan(2);
  const slideSettled = () => expect.poll(() => page.locator('.swiper').evaluate(el => (el as HTMLElement & { swiper: { animating: boolean } }).swiper.animating)).toBe(false);
  await page.keyboard.press('End'); await expect(page.locator('.viewer-counter')).toHaveText('180 / 180');
  await slideSettled(); await atEnd();
  await expect(page.locator('[data-filmstrip-id="photo-179"]')).toBeInViewport();
  await page.keyboard.press('Home'); await expect(page.locator('.viewer-counter')).toHaveText('1 / 180');
  await slideSettled(); await expect.poll(() => filmstrip.evaluate(el => el.scrollLeft)).toBe(0);
  await page.keyboard.press('ArrowRight'); await expect(page.locator('.viewer-counter')).toHaveText('2 / 180');
  await slideSettled();
  await page.locator('[data-filmstrip-id="photo-1"]').hover(); await expect(page.locator('.viewer-thumbnail-hover')).toBeVisible();
  await page.keyboard.press('End'); await expect(page.locator('.viewer-counter')).toHaveText('180 / 180');
  await slideSettled(); await atEnd();
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('.viewer-counter')).toHaveText('179 / 180');
  await slideSettled(); await atEnd();
  const beforeWheel = await filmstrip.evaluate(el => el.scrollLeft);
  await filmstrip.hover(); await page.mouse.wheel(0, -600);
  await expect.poll(() => filmstrip.evaluate(el => el.scrollLeft)).toBeLessThan(beforeWheel - 500);
  // Pick an immutable identity whose center is reachable, excluding clamped edge items.
  const id = await filmstrip.evaluate(bar => {
    const bounds = bar.getBoundingClientRect();
    return [...bar.querySelectorAll<HTMLElement>('[data-filmstrip-id]')].map(item => {
      const box = item.getBoundingClientRect();
      const center = box.x + box.width / 2 - bounds.x;
      return { id: item.dataset.filmstripId, center, absolute: center + bar.scrollLeft, selected: item.hasAttribute('aria-current') };
    }).filter(item => !item.selected && item.center > 0 && item.center < bar.clientWidth && item.absolute >= bar.clientWidth / 2 && item.absolute <= bar.scrollWidth - bar.clientWidth / 2)
      .sort((a, b) => Math.abs(a.center - bar.clientWidth / 2) - Math.abs(b.center - bar.clientWidth / 2))[0]?.id;
  });
  assert(id, 'A visible non-edge thumbnail must be available');
  await page.locator(`[data-filmstrip-id="${id}"]`).click();
  await expect(page.locator(`[data-filmstrip-id="${id}"]`)).toHaveAttribute('aria-current', 'true');
  await expect.poll(async () => {
    const item = await page.locator(`[data-filmstrip-id="${id}"]`).boundingBox(), bar = await page.locator('.viewer-filmstrip').boundingBox();
    return item && bar ? Math.abs(item.x + item.width / 2 - bar.x - bar.width / 2) : 1000;
  }).toBeLessThan(2);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'true');
  await expect.poll(() => page.locator('.viewer-thumbnail-item').first().evaluate(el => el.getBoundingClientRect().height)).toBe(48);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'false');
  await expect.poll(() => page.locator('.viewer-thumbnail-item').first().evaluate(el => el.getBoundingClientRect().height)).toBe(64);
});

test('reduced motion uses Swiper at zero duration and usable immediate Sheet/dismiss gestures', async t => {
  const { page, context } = await fixture({ ...mobile, reducedMotion: 'reduce' }); t.after(() => context.close()); await open(page);
  await expect(page.locator('[data-viewer-transition-variant]')).toHaveCount(0);
  const cdp = await context.newCDPSession(page);
  await drag(cdp, [300, 350], [80, 350]);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 180');
  await expect(page.locator('.swiper-wrapper')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: '照片信息', exact: true }).tap();
  await expect.poll(async () => (await transform(page, '.mobile-inspector-sheet')).y).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-inspector-sheet')).toHaveAttribute('inert', '');
  await drag(cdp, [190, 260], [190, 540]);
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
});

test('shared-element entry hands off a decoded thumbnail while high-res is held, then exits to trigger', async t => {
  const { page, context } = await fixture({ viewport: { width: 1280, height: 900 } }); t.after(() => context.close());
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/viewer-portrait.jpg?photo=0', async route => { await held; await route.continue().catch(() => {}); });
  const trigger = page.locator('[data-viewer-trigger="photo-0"]');
  const source = await trigger.boundingBox(); assert(source);
  await trigger.click();
  const entry = page.locator('[data-viewer-transition-variant="entry"]');
  await entry.waitFor();
  await expect(entry.locator('.viewer-thumbhash')).toHaveAttribute('src', /^data:image/);
  assert.equal(await trigger.evaluate(el => getComputedStyle(el).visibility), 'hidden');
  const midway = await entry.boundingBox(); assert(midway && midway.width >= source.width && midway.width < 900);
  await entry.waitFor({ state: 'detached' });
  await expect(page.locator('.viewer-entry-catchup')).toHaveCount(0);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loading');
  await expect(page.locator('.swiper-slide-active .viewer-preview').first()).toBeVisible();
  release(); await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
  await page.getByRole('button', { name: '关闭照片' }).click();
  await page.locator('[data-viewer-transition-variant="exit"]').waitFor();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});


test('real WebGL double-tap zoom blocks swipe and dismiss, then zoom reset restores Swiper', async t => {
  const { page, context } = await fixture(mobile, true); t.after(() => context.close()); await open(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl');
  const cdp = await context.newCDPSession(page);
  const doubleTap = async () => {
    // Let the browser schedule both taps inside the engine's 300ms window;
    // four host round trips can exceed it on the software-rendered CI runner.
    await cdp.send('Input.synthesizeTapGesture', { x: 190, y: 340, gestureSourceType: 'touch', tapCount: 2 });
    await page.waitForTimeout(350);
  };
  await doubleTap();
  await expect.poll(() => page.locator('.swiper').evaluate(el => (el as HTMLElement & { swiper: { allowTouchMove: boolean } }).swiper.allowTouchMove)).toBe(false);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 180');
  await drag(cdp, [310, 340], [60, 340]); await drag(cdp, [190, 230], [190, 520]);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 180');
  assert.equal((await transform(page, '.viewer-drag-content')).y, 0);
  // Upstream cycles fit → fill → native pixels → fit for this portrait.
  await doubleTap(); await doubleTap();
  await drag(cdp, [310, 340], [50, 340]);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 180');
});
