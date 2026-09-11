// Browser tests use isolated API responses and never modify the real repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

test('delete UI confirms targets, preserves edits on cancel/failure, blocks references and updates state only after success', { timeout: 90000 }, async () => {
  await preparePreview();
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts'], repo);
  const data = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
  const draft = { ...data.projects[0], title: '删除测试草稿' };
  const published = { ...draft, id: 'published-fixture', slug: 'published-fixture', title: '已发布测试作品', status: 'published' };
  const state = { saveProof: 'old-proof', head: 'a'.repeat(40), email: 'admin@example.com', sources: data.sources, projects: [draft, published], publishEnabled: false, media: { state: 'ready', photos: data.photos, aliases: {}, runId: 1, expiresAt: '2030-01-01' } };
  const host = await serve(path.resolve('.cache/admin-release'));
  const browser = await chromium.launch(softwareGPUOptions('webgl'));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const deletes: any[] = [], saves: any[] = [];
    let failure = '', impactFailure = false, staleImpact = false, version = 10;
    let release: (() => void) | undefined;
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/state') return route.fulfill({ json: state });
      const body = route.request().postDataJSON();
      if (p === '/api/impact') {
        if (impactFailure) return route.fulfill({ status: 502, json: { message: '引用检查暂时失败' } });
        const removed = state.sources.filter((s: any) => !body.sources.some((v: any) => v.sourceId === s.sourceId));
        const impacts = state.projects.flatMap((project: any) => removed.flatMap((s: any) => {
          const count = project.photos.filter((r: any) => data.photos.find((p: any) => p.photo.id === r.photoId)?.sourceId === s.sourceId).length;
          return count ? [{ sourceId: s.sourceId, projectId: project.id, title: project.title, status: project.status, count }] : [];
        }));
        return route.fulfill({ json: { head: staleImpact ? 'f'.repeat(40) : state.head, impacts } });
      }
      assert.equal(body.expectedHead, state.head);
      if (p === '/api/save') {
        saves.push(body); assert.equal(body.saveProof, undefined, 'A deletion invalidates the old save proof');
        state.projects = state.projects.map((p: any) => p.id === body.project.id ? body.project : p);
        state.head = (++version).toString(16).padStart(40, '0');
        return route.fulfill({ json: { head: state.head, status: 'saved' } });
      }
      assert.equal(p, '/api/delete'); deletes.push(body);
      if (failure === 'html') return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Error 1102</h1>Worker exceeded resource limits' });
      if (failure === 'conflict') return route.fulfill({ status: 409, json: { error: 'conflict', message: '仓库已有更新，未执行删除' } });
      if (failure === 'pending') await new Promise<void>(resolve => { release = resolve; });
      state.head = (++version).toString(16).padStart(40, '0');
      if (body.kind === 'project') state.projects = state.projects.filter((p: any) => p.id !== body.projectId);
      else state.sources = state.sources.filter((s: any) => s.sourceId !== body.sourceId);
      await route.fulfill({ json: { status: 'deleted', head: state.head, kind: body.kind, id: body.projectId ?? body.sourceId } });
    });
    await page.route('**/thumbnails/*', async route => route.fulfill({ contentType: 'image/jpeg', body: await fs.readFile(path.join(fixtureRoot, new URL(route.request().url()).pathname)) }));
    const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    const dialog = () => page.getByRole('dialog');
    const confirm = () => dialog().getByRole('button', { name: '确认删除', exact: true });
    const cancel = () => dialog().getByRole('button', { name: '取消', exact: true }).click();
    await page.goto(host.url); await nav('照片源');
    await page.getByRole('button', { name: '删除来源 旅行手记', exact: true }).click();
    await dialog().getByText('暂时无法删除：仍有 Project 引用').waitFor();
    assert.match(await dialog().innerText(), /删除测试草稿.*草稿/); assert.match(await dialog().innerText(), /已发布测试作品.*已设为发布/);
    assert(await confirm().isDisabled()); await cancel(); assert.equal(deletes.length, 0);

    await nav('Project'); await page.getByRole('button', { name: /删除测试草稿/ }).click();
    await page.getByLabel('标题', { exact: true }).fill('尚未保存的修改');
    await nav('照片源'); assert(await page.getByRole('button', { name: '删除来源 旅行手记', exact: true }).isDisabled());
    await nav('Project'); await page.getByRole('button', { name: '删除 Project', exact: true }).click();
    await dialog().getByText(/未保存修改也会/).waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的修改'); assert.equal(deletes.length, 0);
    for (const mode of ['html', 'conflict']) {
      failure = mode; await page.getByRole('button', { name: '删除 Project', exact: true }).click(); await confirm().click();
      await dialog().getByRole('alert').waitFor(); assert(await confirm().isDisabled());
      assert.equal(state.projects.length, 2); await cancel();
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的修改');
    }
    failure = 'pending'; await page.getByRole('button', { name: '删除 Project', exact: true }).click(); await confirm().click();
    await dialog().getByRole('button', { name: '正在删除…', exact: true }).waitFor();
    await page.keyboard.press('Escape'); assert(await dialog().isVisible()); assert(await dialog().getByRole('button', { name: '取消', exact: true }).isDisabled());
    assert(release); release();
    await page.getByText('Project 已删除并提交 GitHub。网站尚未发布，原图已保留。', { exact: true }).waitFor();
    assert.equal(await page.locator('.project-card').count(), 1); assert.equal(deletes.length, 3); assert.equal(deletes[2].projectId, draft.id);
    assert.equal(await page.getByLabel('标题', { exact: true }).count(), 0);

    failure = ''; await page.getByRole('button', { name: /已发布测试作品/ }).click();
    await page.getByLabel('地点', { exact: true }).fill('保留的项目仍可保存'); await page.getByRole('button', { name: '保存 Project', exact: true }).click();
    await page.getByText('Project 已提交 GitHub。网站尚未发布。', { exact: true }).waitFor(); assert.equal(saves.length, 1);
    await page.getByRole('button', { name: '删除 Project', exact: true }).click();
    await dialog().getByText('主站会在下一次成功发布后移除这个 Project。').waitFor(); await confirm().click();
    await page.getByText('Project 已删除并提交 GitHub。网站尚未发布，原图已保留。', { exact: true }).waitFor();
    assert.equal(await page.locator('.project-card').count(), 0);

    await nav('照片源'); impactFailure = true;
    await page.getByRole('button', { name: '删除来源 旅行手记', exact: true }).click(); await dialog().getByRole('alert').waitFor(); assert(await confirm().isDisabled());
    impactFailure = false; staleImpact = true;
    await dialog().getByRole('button', { name: '重新检查引用' }).click(); await dialog().getByText('仓库已有更新，请关闭弹窗并刷新仓库后重新检查。').waitFor(); assert(await confirm().isDisabled()); await cancel();
    staleImpact = false;
    for (const name of ['旅行手记', '日常观察', '旧时光']) {
      await page.getByRole('button', { name: `删除来源 ${name}`, exact: true }).click();
      await dialog().getByText('没有 Project 引用此照片源，可以删除。').waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert(await dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      if (name === '旅行手记') await page.screenshot({ path: '.cache/admin-delete-confirm-mobile.png', fullPage: true });
      await confirm().click(); await dialog().waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('button', { name: `删除来源 ${name}`, exact: true }).count(), 0);
    }
    await page.getByText('0 个启用 · 0 个来源', { exact: true }).waitFor();
    assert.deepEqual(state.sources, []); assert.deepEqual(errors, []);
    assert.equal(deletes.length, 7, 'No automatic retries, syncs or publishes');
    await page.screenshot({ path: '.cache/admin-delete-empty-mobile.png', fullPage: true });
  } finally { await browser.close(); await host.close(); }
});
