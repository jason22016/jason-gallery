import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { expect } from 'playwright/test';

/** Blob URLs are opaque: verify actual bytes and the retained original-link
 * identity, rather than comparing img.src with a network URL as before. */
export async function expectFallbackSource(page: Page, originalSrc: string) {
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.viewer-actions a[aria-label="打开原图"]')).toHaveAttribute('href', originalSrc);
  const bytes = await page.locator('.viewer-fallback').evaluate(async (element, expected) => {
    const actual = await (await fetch((element as HTMLImageElement).src)).arrayBuffer();
    const original = await (await fetch(expected)).arrayBuffer();
    return { actual: Array.from(new Uint8Array(actual)), original: Array.from(new Uint8Array(original)) };
  }, originalSrc);
  assert.deepEqual(bytes.actual, bytes.original, `Fallback must display the bytes of ${originalSrc}`);
}
