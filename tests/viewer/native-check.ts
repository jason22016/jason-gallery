/** Optional Chrome/device check, after pnpm test:viewer. No media-query or GPU mocks.
 * Framebuffer values are evidence of rendering, not physical screen luminance. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../website/server';

const server = await serve(path.resolve('.cache/viewer-dist'));
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, ignoreDefaultArgs: ['--force-color-profile=srgb'] });
  try {
    const page = await browser.newPage();
    // Only add readback usage; retain the actual format, gamut, tone mapping and shader.
    await page.addInitScript({ content: `
      const configure = GPUCanvasContext.prototype.configure;
      const current = GPUCanvasContext.prototype.getCurrentTexture;
      const submit = GPUQueue.prototype.submit;
      let target, device, pending = false;
      GPUCanvasContext.prototype.configure = function(c) {
        device = c.device;
        return configure.call(this, {...c, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC});
      };
      GPUCanvasContext.prototype.getCurrentTexture = function() { target = current.call(this); return target; };
      GPUQueue.prototype.submit = function(commands) {
        submit.call(this, commands);
        if (!target || pending || target.format !== 'rgba16float') return;
        pending = true;
        const buffer = device.createBuffer({size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({texture: target, origin: [Math.floor(target.width/2), Math.floor(target.height/2)]}, {buffer, bytesPerRow: 256}, [1, 1]);
        submit.call(this, [encoder.finish()]);
        buffer.mapAsync(GPUMapMode.READ).then(() => {
          window.testFramebuffer = [...new Float16Array(buffer.getMappedRange()).slice(0, 4)];
          buffer.unmap(); buffer.destroy(); pending = false;
        });
      };
    ` });
    const results = [];
    for (const name of ['ordinary.jpg', 'srgb-icc.jpg', 'p3-icc.jpg', 'hdr.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg', 'broken-gain.jpg']) {
      await page.goto(`${server.url}/?src=/${name}`);
      await page.waitForFunction(() => {
        const text = document.querySelector('#result')!.textContent!;
        if (!text.startsWith('{')) return false;
        const result = JSON.parse(text); return result.loaded || result.fallbackLoaded;
      });
      const result = JSON.parse(await page.locator('#result').textContent() ?? '{}');
      if (result.renderer === 'webgpu') {
        const config = await page.evaluate(() => { const c = document.querySelector('canvas')!.getContext('webgpu')!.getConfiguration()!; return { format: c.format, colorSpace: c.colorSpace, toneMapping: c.toneMapping }; });
        result.config = config;
        if (config.format === 'rgba16float') {
          await page.waitForFunction(() => !!(window as unknown as { testFramebuffer?: number[] }).testFramebuffer);
          result.pixels = await page.evaluate(() => (window as unknown as { testFramebuffer: number[] }).testFramebuffer);
          if (result.hdr) assert(result.pixels.slice(0, 3).some((v: number) => v > 1));
          if (['ordinary.jpg', 'srgb-icc.jpg', 'p3-icc.jpg'].includes(name)) {
            result.reference = await page.evaluate(async name => {
              const image = await createImageBitmap(await (await fetch(`/${name}`)).blob());
              const canvas = new OffscreenCanvas(1, 1);
              const ctx = canvas.getContext('2d', { colorSpace: 'display-p3', colorType: 'float16' })!;
              ctx.drawImage(image, 0, 0, 1, 1); image.close();
              return Array.from(ctx.getImageData(0, 0, 1, 1, { colorSpace: 'display-p3', pixelFormat: 'rgba-float16' }).data);
            }, name);
            assert(result.pixels.every((v: number, i: number) => Math.abs(v - result.reference[i]) < 0.005), name);
          }
        }
      }
      results.push({ name, ...result });
    }
    await fs.writeFile('.cache/phase5-native-check.json', JSON.stringify({ browser: browser.version(), screenCertified: false, results }, null, 2));
    console.log(results.map(r => ({ name: r.name, renderer: r.renderer, hdr: r.hdr, dynamicRange: r.dynamicRange, pixels: r.pixels })));
  } finally { await browser.close(); }
} finally { await server.close(); }
