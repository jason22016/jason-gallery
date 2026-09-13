import sharp from 'sharp';
import type { Page } from 'playwright';

export async function installMapFixture(page: Page, serverURL: string) {
  await page.route('**/tiles.json', route => route.fulfill({ json: {
    tilejson: '3.0.0', tiles: [`${serverURL}/empty/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14,
    attribution: '<a href="https://example.com/">Fixture attribution</a>',
  } }));
  await page.route('**/empty/**/*.pbf', route => route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));
  await page.route('**/fonts/**/*.pbf', route => route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));
  await page.route('**/sprite*.json', route => route.fulfill({ json: {} }));
  const sprite = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#00000000' } }).png().toBuffer();
  await page.route('**/sprite*.png', route => route.fulfill({ contentType: 'image/png', body: sprite }));
}

export async function openMapPhotoList(page: Page) {
  const drawer = page.locator('.map-photo-drawer');
  if (await drawer.count() && await drawer.getAttribute('open') === null) await drawer.locator('summary').click();
}
