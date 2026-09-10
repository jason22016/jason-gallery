import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { chromium, type Browser, type Page } from 'playwright';
import { softwareGPUOptions } from '../browser';
import { serve } from '../website/server';
import { extractJPEGGainMap, parseISOGainMap, parseXMPGainMap } from '../../packages/afilmory/webgl-viewer/src/jpeg-gainmap';
import { isoMetadata } from './color-fixtures';
import type { AfilmoryManifest } from '../../src/photo-engine';

const root = path.resolve('.cache/color-test');
const dist = path.resolve('.cache/viewer-dist');
let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let manifest: AfilmoryManifest;
const diagnostics = path.join(root, 'diagnostics');
const pageLogs = new WeakMap<Page, string[]>();
let loadNumber = 0;
async function newPage() {
  const page = await browser.newPage();
  const logs: string[] = [];
  pageLogs.set(page, logs);
  page.on('console', message => logs.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', error => logs.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('requestfailed', request => logs.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  return page;
}
const names = ['ordinary.jpg', 'hdr.jpg', 'srgb-icc.jpg', 'p3-icc.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg', 'broken-gain.jpg'];
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const extract = (b: Buffer) => extractJPEGGainMap(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
before(async () => {
  await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true });
  await fs.mkdir(diagnostics, { recursive: true });
  const ref = '5'.repeat(40);
  const files = Object.fromEntries(names.map(name => [`images/${name}`, { file: path.join(dist, name), commit: ref }]));
  await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({ ref, files }));
  const before = await Promise.all(names.map(async name => hash(await fs.readFile(path.join(dist, name)))));
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/photos/cli.ts', '--fixture', path.join(root, 'fixture.json'), '--root', path.join(root, 'engine')], { encoding: 'utf8', timeout: 90_000 });
  await fs.writeFile(path.join(root, 'engine.log'), result.stdout + result.stderr);
  assert.ifError(result.error); assert.equal(result.status, 0, `See ${root}/engine.log`);
  assert.deepEqual(await Promise.all(names.map(async name => hash(await fs.readFile(path.join(dist, name))))), before);
  manifest = JSON.parse(await fs.readFile(path.join(root, 'engine/output/photos-manifest.json'), 'utf8'));
  await fs.cp(path.join(root, 'engine/output/public/thumbnails'), path.join(dist, 'thumbnails'), { recursive: true });
  server = await serve(dist);
  // Actual APIs/shaders on SwiftShader; dynamic-range simulation below tests logic only.
  browser = await chromium.launch(softwareGPUOptions());
  console.log(`Color browser: ${browser.version()} (software GPU; no screen certification)`);
  const session = await browser.newBrowserCDPSession();
  const gpu = await session.send('SystemInfo.getInfo');
  const probe = await browser.newPage();
  let adapter;
  try {
    // Same secure loopback origin, without mounting a Viewer or test overrides.
    await probe.goto(`${server.url}/ordinary.jpg`);
    adapter = await probe.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return { error: 'No WebGPU adapter' };
      const { vendor, architecture, device, description, isFallbackAdapter } = adapter.info;
      const gpuDevice = await adapter.requestDevice();
      gpuDevice.destroy();
      return { vendor, architecture, device, description, isFallbackAdapter, deviceCreated: true };
    });
  } catch (error) { adapter = { error: String(error) }; }
  finally { await probe.close(); }
  await fs.writeFile(path.join(diagnostics, 'browser.json'), JSON.stringify({ version: browser.version(), options: softwareGPUOptions(), adapter, ...gpu }, null, 2));
  console.log(`Color GPU: ${JSON.stringify({ devices: gpu.gpu.devices, featureStatus: gpu.gpu.featureStatus, adapter })}`);
  await session.detach();
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });

async function load(page: Page, src: string, mode = 'auto') {
  const logs = pageLogs.get(page)!;
  logs.length = 0;
  let state: unknown;
  try {
    await page.goto(`${server.url}/?mode=${mode}&src=${encodeURIComponent(src)}`);
    await page.waitForFunction(() => { const text = document.querySelector('#result')!.textContent!; if (!text.startsWith('{')) return false; const r = JSON.parse(text); return r.loaded || r.fallbackLoaded || r.fallbackError; });
    const result = JSON.parse(await page.locator('#result').textContent() ?? '{}');
    state = result;
    const detail = JSON.stringify({ src, mode, result, logs }, null, 2);
    assert.deepEqual(logs.filter(line => line.startsWith('pageerror:')), [], detail);
    if (mode === 'no-gpu') assert.equal(result.fallbackLoaded, true, detail);
    else {
      assert.equal(result.renderer, mode === 'auto' ? 'webgpu' : 'webgl', detail);
      assert.equal(result.loaded, true, detail);
      assert.equal(result.fallbackLoaded, undefined, detail);
    }
    return result;
  } finally {
    state ??= await page.locator('#result').textContent().catch(() => null);
    await fs.writeFile(path.join(diagnostics, `${++loadNumber}-${mode}.json`), JSON.stringify({ src, mode, state, logs }, null, 2));
  }
}
async function pixel(page: Page, selector: string) {
  const png = await page.locator(selector).screenshot();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}
function near(a: number[], b: number[], tolerance = 3) {
  assert(a.every((v, i) => Math.abs(v - b[i]!) <= tolerance), `${a} vs ${b} (tolerance ${tolerance}/255)`);
}

test('native Engine HDR flags, original byte preservation, ICC retention and SDR thumbnail color', async () => {
  assert.equal(manifest.version, 'v10'); assert.equal(manifest.data.length, names.length);
  assert.deepEqual(Object.keys(manifest).sort(), ['cameras', 'data', 'lenses', 'version']);
  for (const name of names) {
    const photo = manifest.data.find(p => p.s3Key === name)!;
    assert.equal(photo.isHDR, ['hdr.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg', 'broken-gain.jpg'].includes(name), name);
    assert.equal(photo.originalUrl, `https://raw.githubusercontent.com/jason22016/jason-photos/${'5'.repeat(40)}/images/${name}`);
    const original = await fs.readFile(path.join(dist, name));
    const thumbnail = await fs.readFile(path.join(dist, photo.thumbnailUrl!));
    const metadata = await sharp(thumbnail).metadata();
    assert.equal(metadata.depth, 'uchar'); assert.equal(metadata.icc, undefined); assert.equal(extract(thumbnail), null);
    const expected = await sharp(original).toColourspace('srgb').resize(1, 1).removeAlpha().raw().toBuffer();
    const actual = await sharp(thumbnail).resize(1, 1).removeAlpha().raw().toBuffer();
    near([...actual], [...expected]);
  }
  for (const name of ['hdr.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg']) {
    const bytes = await fs.readFile(path.join(dist, name)); const parsed = extract(bytes)!;
    assert(parsed && parsed.metadata.capacityMax === 2, name);
    assert.equal((await sharp(Buffer.from(await parsed.gain.arrayBuffer())).metadata()).width, 48);
    assert.deepEqual((await sharp(Buffer.from(await parsed.base.arrayBuffer())).metadata()).icc, (await sharp(bytes).metadata()).icc);
  }
});

test('malformed or unsupported gain metadata is rejected independently of the source flag', async () => {
  const bad = isoMetadata(); bad.writeUInt16BE(1, 0); assert.throws(() => parseISOGainMap(bad), /version/);
  const hdrBase = isoMetadata(); hdrBase[4]! |= 4; assert.throws(() => parseISOGainMap(hdrBase), /HDR base/);
  const zero = isoMetadata(); zero.writeUInt32BE(0, 5); assert.throws(() => parseISOGainMap(zero), /denominator/);
  assert.throws(() => parseISOGainMap(new Uint8Array(1)));
  assert.throws(() => parseXMPGainMap('<x xmlns="http://ns.adobe.com/hdr-gain-map/1.0/" GainMapMax="2" Gamma="0"/>'), /Invalid gain/);
  assert.throws(() => extractJPEGGainMap(new Uint8Array([255, 216, 255]).buffer), /Truncated|Invalid JPEG/);
  const broken = await fs.readFile(path.join(dist, 'broken-gain.jpg'));
  assert.throws(() => extract(broken));
});

test('ICC SDR, wide-gamut P3, HDR base and Engine thumbnails agree across SDR rendering paths', { timeout: 90_000 }, async () => {
  const page = await newPage();
  const results = [];
  try {
    assert.equal(await page.evaluate(() => matchMedia('(dynamic-range: high)').matches), false);
    for (const name of ['ordinary.jpg', 'srgb-icc.jpg', 'p3-icc.jpg', 'hdr.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg']) {
      const photo = manifest.data.find(p => p.s3Key === name)!;
      const image = await load(page, `/${name}`, 'no-gpu'); assert.equal(image.fallbackLoaded, true);
      const reference = await pixel(page, '#root img');
      const colors: Record<string, number[]> = {};
      for (const mode of ['auto', 'webgl']) {
        const result = await load(page, `/${name}`, mode);
        assert.equal(result.renderer, mode === 'auto' ? 'webgpu' : 'webgl'); assert.equal(result.hdr, false);
        colors[mode] = await pixel(page, '#root canvas'); near(colors[mode]!, reference);
      }
      await load(page, photo.thumbnailUrl!, 'no-gpu'); const thumbnail = await pixel(page, '#root img'); near(thumbnail, reference);
      results.push({ name, reference, ...colors, thumbnail });
    }
    await fs.writeFile(path.join(diagnostics, 'sdr-pixels.json'), JSON.stringify(results, null, 2));
  } finally { await page.close(); }
});

test('extended WebGPU requires valid gain data and high-range media; loss of capability clears HDR', { timeout: 60_000 }, async () => {
  const page = await newPage();
  await page.addInitScript({ content: `
    const original = window.matchMedia.bind(window);
    const media = new EventTarget();
    let high = true;
    Object.defineProperties(media, { matches: { get: () => high }, media: { value: '(dynamic-range: high)' } });
    window.matchMedia = query => query === '(dynamic-range: high)' ? media : original(query);
    window.setTestHDR = value => { high = value; media.dispatchEvent(new Event('change')); };
  ` });
  try {
    for (const name of ['hdr.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg']) {
      const result = await load(page, `/${name}`); assert.equal(result.renderer, 'webgpu'); assert.equal(result.hdr, true, JSON.stringify(result));
      const hdrPixel = await pixel(page, '#root canvas');
      const config = await page.evaluate(() => document.querySelector('canvas')!.getContext('webgpu')!.getConfiguration());
      assert.equal(config?.format, 'rgba16float'); assert.equal(config?.toneMapping?.mode, 'extended');
      await page.evaluate(() => (window as unknown as { setTestHDR: (v: boolean) => void }).setTestHDR(false));
      await page.waitForFunction(() => JSON.parse(document.querySelector('#result')!.textContent!).hdr === false);
      const sdrPixel = await pixel(page, '#root canvas');
      assert(hdrPixel.some((v, i) => v > sdrPixel[i]! + 30), `Gain reconstruction changes rendered pixels: ${hdrPixel} vs ${sdrPixel}`);
    }
    for (const name of ['ordinary.jpg', 'p3-icc.jpg', 'broken-gain.jpg']) {
      const result = await load(page, `/${name}`); assert.equal(result.renderer, 'webgpu'); assert.equal(result.hdr, false);
    }
    for (const mode of ['webgl', 'webgpu-failure', 'no-gpu']) {
      const result = await load(page, '/hdr.jpg', mode); assert.equal(result.hdr, false);
      assert.equal(mode === 'no-gpu' ? result.fallbackLoaded : result.renderer, mode === 'no-gpu' ? true : 'webgl');
    }
  } finally { await page.close(); }
});

test('extended canvas rejection uses WebGPU SDR; WebGL context loss after load reaches image fallback', async () => {
  const page = await newPage();
  await page.addInitScript(() => {
    const configure = GPUCanvasContext.prototype.configure;
    GPUCanvasContext.prototype.configure = function (config) {
      if (config.toneMapping?.mode === 'extended') throw new Error('Injected extended canvas rejection');
      return configure.call(this, config);
    };
  });
  try {
    const result = await load(page, '/hdr.jpg'); assert.equal(result.renderer, 'webgpu'); assert.equal(result.hdr, false);
    const config = await page.evaluate(() => document.querySelector('canvas')!.getContext('webgpu')!.getConfiguration());
    assert.equal(config?.toneMapping?.mode, 'standard', 'Injected extended rejection must select an SDR canvas');
    assert.notEqual(config?.format, 'rgba16float');
    await load(page, '/hdr.jpg', 'webgl');
    await page.evaluate(() => document.querySelector('canvas')!.getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext());
    await page.waitForFunction(() => JSON.parse(document.querySelector('#result')!.textContent!).fallbackLoaded === true);
    const lost = JSON.parse(await page.locator('#result').textContent() ?? '{}');
    assert.equal(lost.viewerError, 'WebGL context lost'); assert.equal(lost.hdr, false);
  } finally { await page.close(); }
});
