import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
import { resolveProjects } from '../../src/projects/resolver';
import type { Project } from '../../src/projects/schema';
import { photoReference } from '../../src/photo-engine/source-contract';
import { readCollection } from '../../src/photo-engine/collection-contract';
import { fixture, env, head, prepareKeys, config } from './backend-fixture';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

test('saving display order persists it and changes the public gallery order without changing photos', async () => {
  await prepareKeys();
  const f = await fixture();
  const photoId = photoReference(f.c.artifact.snapshot.sources[0], 'same_12345678');
  const a: Project = { schemaVersion: 1, id: 'a', slug: 'a', title: 'A', coverPhotoId: photoId, photos: [{ photoId, caption: 'Caption', alt: 'Alt' }], order: 10, status: 'published' };
  const b: Project = { ...a, id: 'b', slug: 'b', title: 'B', order: 20 };
  f.setProjects([a, b]);
  const service = new AdminService(new GitHub(env, f.fetcher));
  const result = await service.save({ kind: 'project', expectedHead: head, project: { ...b, order: -0.5 } });
  assert.equal(result.status, 'saved');
  const content = await new AdminService(new GitHub(env, f.fetcher)).content();
  const saved = content.projects.find(p => p.id === b.id)!;
  assert.deepEqual(saved, { ...b, order: -0.5 });
  assert.deepEqual(content.projects.find(p => p.id === a.id), a);
  const collection = await readCollection(async p => f.c.files.get(p)!, config);
  const publicProjects = resolveProjects(content.projects.map(data => ({ source: data.slug, data })), {
    getPhoto: id => collection.photos.find(p => p.id === id),
  }).published.listProjects();
  assert.deepEqual(publicProjects.map(p => p.id), ['b', 'a']);
});

test('editor sorts cards, saves order, preserves failed edits and appends new Projects after the highest order', async () => {
  await preparePreview();
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts'], repo);
  const data = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
  const a = { ...data.projects[0], id: 'a', slug: 'a', title: 'Project A', order: 10 };
  const b = { ...a, id: 'b', slug: 'b', title: 'Project B', order: -2, status: 'published' };
  const c = { ...a, id: 'c', slug: 'c', title: 'Project C' };
  const state = { head: head, email: 'admin@example.com', sources: data.sources, projects: [c, a, b], publishEnabled: false, media: { state: 'ready', photos: data.photos, aliases: {}, runId: 1, expiresAt: '2030-01-01' } };
  const host = await serve(path.resolve('.cache/admin-release'));
  const browser = await chromium.launch(softwareGPUOptions('webgl'));
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    let failSave = true; const saves: any[] = [];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      assert.equal(url.pathname, '/api/save');
      const body = route.request().postDataJSON(); saves.push(body);
      if (failSave) return route.fulfill({ status: 500, json: { message: '保存失败' } });
      assert.equal(body.expectedHead, state.head);
      state.head = 'b'.repeat(40);
      state.projects = state.projects.map(p => p.id === body.project.id ? body.project : p);
      return route.fulfill({ json: { status: 'saved', head: state.head } });
    });
    await page.route('**/thumbnails/*', async route => route.fulfill({ contentType: 'image/jpeg', body: await fs.readFile(path.join(fixtureRoot, new URL(route.request().url()).pathname)) }));
    const listOrder = () => page.locator('.project-card h2').allTextContents();
    const orderInput = () => page.getByRole('spinbutton', { name: '展示顺序', exact: true });
    await page.goto(host.url);
    await page.getByRole('navigation').getByRole('button', { name: 'Project', exact: true }).click();
    assert.deepEqual(await listOrder(), ['Project B', 'Project A', 'Project C']);
    await page.getByRole('button', { name: /Project C/ }).click();
    await orderInput().fill('');
    await page.getByRole('button', { name: '保存 Project', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(saves.length, 0);
    await orderInput().fill('-3.5');
    await page.getByText('有未保存修改', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存 Project', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await orderInput().inputValue(), '-3.5');
    assert.equal(saves[0].project.order, -3.5);
    failSave = false;
    await page.getByRole('button', { name: '保存 Project', exact: true }).click();
    await page.getByText('已保存到 GitHub', { exact: true }).waitFor();
    assert.deepEqual(saves[1].project, { ...c, order: -3.5 });
    await page.getByRole('button', { name: '全部 Project', exact: true }).click();
    assert.deepEqual(await listOrder(), ['Project C', 'Project B', 'Project A']);
    await page.getByRole('button', { name: '刷新仓库', exact: true }).click();
    await page.getByText('Git bbbbbbb', { exact: false }).waitFor();
    assert.deepEqual(await listOrder(), ['Project C', 'Project B', 'Project A']);
    await page.getByRole('button', { name: '新建 Project', exact: true }).click();
    assert.equal(await orderInput().inputValue(), '11');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await orderInput().isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await host.close(); }
});
