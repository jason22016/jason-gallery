import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

test('dirty Project replacement guards new/other targets; cancel, failure and conflict preserve edits and selection', async () => {
  await preparePreview();
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts'], repo);
  const data = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
  const a = data.projects[0]; a.title = 'Project A';
  const b = { ...structuredClone(a), id: 'fixture-b', slug: 'project-b', title: 'Project B' };
  const state = { head: 'a'.repeat(40), email: 'admin@example.com', sources: data.sources, projects: [a, b], publishEnabled: false, media: { state: 'ready', photos: data.photos, aliases: {}, runId: 1, expiresAt: '2030-01-01' } };
  const host = await serve(path.resolve('.cache/admin-release'));
  const browser = await chromium.launch(softwareGPUOptions('webgl'));
  try {
    const page = await browser.newPage(); const failures: string[] = [];
    page.on('pageerror', e => failures.push(e.message));
    let saveStatus = 500; const saves: any[] = [];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      assert.equal(url.pathname, '/api/save'); saves.push(route.request().postDataJSON());
      return route.fulfill({ status: saveStatus, json: saveStatus === 200 ? { head: 'b'.repeat(40) } : { message: saveStatus === 409 ? '版本冲突' : '保存失败，请重试' } });
    });
    await page.route('**/thumbnails/*', async route => route.fulfill({ contentType: 'image/jpeg', body: await fs.readFile(path.join(fixtureRoot, new URL(route.request().url()).pathname)) }));
    const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    const guard = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '当前 Project 有未保存修改' }) });
    await page.goto(host.url); await nav('Project'); await page.getByRole('button', { name: /Project A/ }).click();
    await page.getByLabel('标题', { exact: true }).fill('A 的未保存标题');
    await page.getByLabel('地点', { exact: true }).fill('未保存地点');
    await page.getByLabel('上移照片 2', { exact: true }).click();
    const sequence = await page.locator('.sequence-list').innerText();
    await page.getByRole('button', { name: '添加照片', exact: true }).click();
    await page.getByLabel('选择 FRAME_015.jpg', { exact: true }).click();
    const choose = async (target: string) => {
      await page.getByRole('button', { name: '加入 Project', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: target === 'new' ? '新建 Project' : /Project B/, exact: target === 'new' }).click();
      await guard().waitFor();
    };
    const unchanged = async () => {
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), 'A 的未保存标题');
      assert.equal(await page.getByLabel('地点', { exact: true }).inputValue(), '未保存地点');
      assert.equal(await page.locator('.sequence-list').innerText(), sequence);
    };
    await choose('new'); await page.keyboard.press('Escape');
    assert.equal(await page.getByLabel('选择 FRAME_015.jpg', { exact: true }).getAttribute('aria-pressed'), 'true');
    await nav('Project'); await unchanged(); await nav('照片');
    await choose('other'); await guard().getByRole('button', { name: '保留编辑，取消切换' }).click();
    assert.equal(saves.length, 0);
    await nav('Project'); await unchanged(); await nav('照片');
    // Adding to the same editor appends without replacing it or prompting.
    await page.getByRole('button', { name: '加入 Project', exact: true }).click();
    await page.getByRole('button', { name: /继续编辑：A 的未保存标题/ }).click();
    assert.equal(await guard().count(), 0); assert.equal(await page.locator('.sequence-row').count(), 5);
    await page.getByRole('button', { name: '添加照片', exact: true }).click();
    await page.getByLabel('选择 FRAME_016.jpg', { exact: true }).click();
    await choose('other');
    await guard().getByRole('button', { name: '保存后继续' }).click();
    await guard().getByRole('alert').waitFor(); assert.equal(saves[0].project.id, a.id);
    assert.equal(saves[0].project.title, 'A 的未保存标题'); assert.equal(saves[0].project.photos.length, 5);
    saveStatus = 409; await guard().getByRole('button', { name: '保存后继续' }).click();
    await page.getByRole('heading', { name: '保存版本冲突' }).waitFor();
    await page.getByRole('button', { name: '保留编辑，返回检查' }).click(); await guard().waitFor();
    saveStatus = 200; await guard().getByRole('button', { name: '保存后继续' }).click();
    await page.getByRole('heading', { name: 'Project B', exact: true }).waitFor();
    assert.equal(await page.locator('.sequence-row').count(), 5);
    assert.equal(await guard().count(), 0);
    // Explicit discard is required to replace dirty B with a new draft.
    await page.getByRole('button', { name: '添加照片', exact: true }).click();
    await page.getByLabel('选择 FRAME_018.jpg', { exact: true }).click();
    await choose('new'); await guard().getByRole('button', { name: '放弃编辑并继续' }).click();
    assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('.sequence-row').count(), 1);
    // Invalid drafts cannot be discarded by choosing save-and-continue.
    await page.getByRole('button', { name: '添加照片', exact: true }).click();
    await page.getByLabel('选择 FRAME_017.jpg', { exact: true }).click();
    await choose('other'); const count = saves.length;
    await guard().getByRole('button', { name: '保存后继续' }).click(); await guard().getByRole('alert').waitFor();
    assert.equal(saves.length, count); assert.deepEqual(failures, []);
  } finally { await browser.close(); await host.close(); }
});
