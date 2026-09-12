import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

test('completed source sync adds exactly ten new photos to existing/new Projects, survives reload and never publishes', async () => {
  await preparePreview();
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts'], repo);
  const data = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
  data.projects[0].photos[0].caption = 'Preserved caption';
  const additions = Array.from({ length: 10 }, (_, i) => ({ ...data.photos[i], photo: { ...data.photos[i].photo, id: `fixture-travel--new-${i}`, title: `NEW_${i + 1}.jpg` } }));
  const expected = additions.map(p => p.photo.id);
  const state = { head: 'a'.repeat(40), email: 'admin@example.com', sources: data.sources, projects: data.projects, publishEnabled: false,
    media: { state: 'ready', runId: 1, aliases: {}, photos: data.photos, expiresAt: '2030-01-01' } };
  const counts = { total: 20, previous: 10, added: 10, updated: 1, removed: 0, unchanged: 9 };
  let completed = false, failRefresh = false, failedSync = false;
  const summary = () => ({ action: 'sync', photos: { status: 'success' }, adminRead: { status: 'success' }, sync: { applied: true, counts, sourceIds: ['fixture-travel'], sources: [{ sourceId: 'fixture-travel', changes: [...additions.map(p => ({ kind: 'added', reference: p.photo.id, key: p.photo.title })), { kind: 'updated', reference: data.photos[0].photo.id, key: 'FRAME_001.jpg' }] }] } });
  const host = await serve(path.resolve('.cache/admin-release'));
  const browser = await chromium.launch(softwareGPUOptions('webgl'));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const writes: { path: string; body: any }[] = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST') writes.push({ path: url.pathname, body: request.postDataJSON() });
      if (url.pathname === '/api/state') {
        if (failRefresh && completed) return route.fulfill({ status: 503, json: { message: 'Refresh unavailable' } });
        return route.fulfill({ json: state });
      }
      if (url.pathname === '/api/sync-preview') return route.fulfill({ json: { head: state.head, revision: 'b'.repeat(64), checkedAt: '2026-09-12T12:00:00Z', sourceIds: ['fixture-travel'], baselineRunId: 1, counts: { ...counts, added: 11 }, conflicts: [], errors: [], partialAllowed: true, sources: [] } });
      if (url.pathname === '/api/dispatch') {
        completed = true; state.media.runId = 2; state.media.photos = [...data.photos, ...additions];
        return route.fulfill({ json: { requestId: 'f274873e-f93d-4511-83d3-2468d2b105c6', mode: 'sync', state: 'pending' } });
      }
      if (url.pathname === '/api/tasks') return route.fulfill({ json: { pending: false, tasks: completed ? [{ id: 2, title: 'Gallery sync', state: 'completed', conclusion: failedSync ? 'failure' : 'success', head: state.head, url: host.url, steps: [], summary: summary() }] : [] } });
      if (url.pathname === '/api/save') {
        const body = request.postDataJSON(); assert.equal(body.expectedHead, state.head);
        state.projects = [...state.projects.filter((p: any) => p.id !== body.project.id), body.project];
        state.head = (state.head.startsWith('a') ? 'b' : 'c').repeat(40);
        return route.fulfill({ json: { status: 'saved', head: state.head } });
      }
      throw new Error(`Unexpected API: ${url.pathname}`);
    });
    await page.route('**/thumbnails/*', async route => route.fulfill({ contentType: 'image/jpeg', body: await fs.readFile(path.join(fixtureRoot, new URL(route.request().url()).pathname)) }));
    const syncTab = () => page.getByRole('tab', { name: '同步照片', exact: true }).click();
    const batch = () => page.getByRole('button', { name: '将新增的 10 张照片加入 Project', exact: true });
    await page.goto(host.url); await syncTab();
    assert.equal(await batch().count(), 0);
    await page.getByLabel('同步来源 日常观察', { exact: true }).uncheck();
    failRefresh = true;
    await page.getByRole('button', { name: '同步照片', exact: true }).click();
    await page.getByText('同步已完成，但照片库刷新失败，请重试刷新。网站尚未发布。', { exact: true }).waitFor();
    assert.equal(await batch().isDisabled(), true, 'Cannot add against the preceding library after a failed refresh');
    failRefresh = false;
    await page.getByRole('button', { name: '刷新后台数据', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('将新增的 10 张照片加入 Project') && !b.disabled));
    await page.setViewportSize({ width: 390, height: 844 });
    await batch().scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '.cache/sync-additions-mobile.png' });
    await batch().click();
    await page.getByRole('heading', { name: '将 10 张照片加入 Project', exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: /在路上，慢一点/ }).click();
    assert.equal(await page.locator('.sequence-row').count(), 14);
    assert.equal(writes.filter(w => w.path === '/api/save').length, 0);
    await page.getByRole('button', { name: '保存 Project', exact: true }).click();
    await page.getByText('已保存到 GitHub', { exact: true }).waitFor();
    const saved = writes.find(w => w.path === '/api/save')!.body.project;
    assert.deepEqual(saved.photos.slice(4).map((p: any) => p.photoId), expected);
    assert.equal(saved.coverPhotoId, data.projects[0].coverPhotoId);
    assert.equal(saved.photos[0].caption, 'Preserved caption');
    // Repeat from history, including after reload: no duplicate photos or automatic saves.
    await page.reload(); await syncTab(); await batch().click();
    await page.getByRole('dialog').getByRole('button', { name: /在路上，慢一点/ }).click();
    assert.equal(await page.locator('.sequence-row').count(), 14);
    // Reload discards the repeated local edit; create a new Project with the same batch.
    await page.reload(); await syncTab(); await batch().click();
    await page.getByRole('dialog').getByRole('button', { name: '新建 Project', exact: true }).click();
    assert.equal(await page.locator('.sequence-row').count(), 10);
    await page.getByLabel('标题', { exact: true }).fill('本次新增照片');
    await page.getByLabel('网址标识 · slug').fill('sync-additions');
    await page.getByRole('button', { name: '保存 Project', exact: true }).click();
    await page.getByText('已保存到 GitHub', { exact: true }).waitFor();
    const saves = writes.filter(w => w.path === '/api/save');
    assert.equal(saves.length, 2);
    assert.deepEqual(saves[1].body.project.photos.map((p: any) => p.photoId), expected);
    assert.equal(saves[1].body.project.coverPhotoId, expected[0]);
    failedSync = true; await page.reload(); await syncTab();
    await page.getByRole('region', { name: '最近完成的同步', exact: true }).getByText(/Gallery sync/).waitFor();
    assert.equal(await batch().count(), 0, 'Failed execution must not expose an add action');
    assert.equal(writes.filter(w => w.path === '/api/dispatch').length, 1);
    assert(writes.every(w => w.path === '/api/save' || w.path === '/api/dispatch' && w.body.mode === 'sync'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await host.close(); }
});
