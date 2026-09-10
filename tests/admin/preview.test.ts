import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { preparePreview } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

let browser: Browser;
let host: Awaited<ReturnType<typeof serve>>;
const errors: string[] = [];
test.before(async () => {
  await preparePreview();
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'tests/admin/vite.config.ts'], repo);
  host = await serve(path.resolve('.cache/admin-dist'));
  browser = await chromium.launch(softwareGPUOptions('webgl'));
});
test.after(async () => { await browser?.close(); await host?.close(); });
async function open(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (!r.url().startsWith(host.url) && !r.url().startsWith('data:')) errors.push(`Unexpected external request: ${r.url()}`);
    if (r.method() !== 'GET') errors.push(`Unexpected write request: ${r.method()}`);
  });
  await page.goto(host.url);
  await page.getByRole('heading', { name: '每一张，都有它的位置。' }).waitFor();
  return page;
}
const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
async function textVisible(page: Page, text: string) { await page.getByText(text, { exact: false }).first().waitFor(); }

test('cross-source selection, Project validation, cover and ordering remain isolated', async () => {
  const page = await open();
  await page.getByRole('button', { name: '旅行手记 10', exact: true }).click();
  await page.getByLabel('选择 FRAME_002.jpg', { exact: true }).click();
  await page.getByRole('button', { name: '日常观察 8', exact: true }).click();
  await page.getByLabel('选择 FRAME_012.jpg', { exact: true }).click();
  await page.getByRole('button', { name: '加入 Project', exact: true }).click();
  await page.getByRole('button', { name: '新建 Project', exact: true }).click();
  await page.getByRole('button', { name: '保存 Project', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.getByLabel('标题', { exact: true }).fill('跨源预览项目');
  await page.getByLabel('网址标识 · slug').fill('fixture-cross-source');
  assert.equal(await page.locator('.sequence-row').count(), 2);
  await page.getByRole('button', { name: '设为封面', exact: true }).click();
  await page.getByLabel('上移照片 2', { exact: true }).click();
  assert.match(await page.locator('.sequence-row').first().innerText(), /FRAME_012/);
  assert.match(await page.locator('.sequence-row').first().innerText(), /封面/);
  await page.getByLabel('Project 状态', { exact: true }).selectOption('published');
  await page.getByRole('button', { name: '保存 Project', exact: true }).click();
  await textVisible(page, '未提交 GitHub，未发布网站');
  await page.getByRole('button', { name: '全部 Project', exact: true }).click();
  await page.getByRole('button', { name: /跨源预览项目/ }).waitFor();
  await page.reload();
  await nav(page, 'Project');
  assert.equal(await page.getByRole('button', { name: /跨源预览项目/ }).count(), 0, 'fixture does not persist formal Projects');
  await page.close();
});

test('source schema, reference impact, new source and disabled source controls', async () => {
  const page = await open();
  await nav(page, '照片源');
  await page.getByLabel('编辑来源 旅行手记').click();
  await page.getByLabel('启用此照片源').uncheck();
  await textVisible(page, '此修改将使以下 Project 的照片引用失效');
  assert.equal(await page.getByRole('button', { name: '保存配置到预览' }).isDisabled(), true);
  await page.getByLabel('启用此照片源').check();
  await page.getByLabel('图片目录', { exact: true }).fill('replacement');
  assert.equal(await page.getByRole('button', { name: '保存配置到预览' }).isDisabled(), true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '新增照片源', exact: true }).click();
  for (const [label, value] of [['显示名称', '测试新来源'], ['稳定来源 ID', 'fixture-new'], ['GitHub 用户 / 组织', 'fixture'], ['仓库名称', 'new-photos']]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('图片目录', { exact: true }).fill('../escape');
  await page.getByRole('button', { name: '保存配置到预览' }).click();
  await page.getByRole('alert').waitFor();
  await page.getByLabel('图片目录', { exact: true }).fill('images');
  await page.getByRole('button', { name: '保存配置到预览' }).click();
  await page.getByRole('heading', { name: '测试新来源' }).waitFor();
  await page.getByLabel('编辑来源 测试新来源').click();
  await page.getByLabel('启用此照片源').uncheck();
  await page.getByRole('button', { name: '保存配置到预览' }).click();
  await textVisible(page, '实际接入后需单独同步照片');
  await page.close();
});

test('missing, expired and failed artifacts offer resync; queued never means published', async () => {
  const page = await open();
  for (const state of ['empty', 'expired', 'failed']) {
    await nav(page, '照片');
    await page.getByLabel('预览产物状态').selectOption(state);
    assert.equal(await page.locator('.photo-card').count(), 0);
    await page.getByRole('button', { name: '重新同步', exact: true }).click();
    await textVisible(page, '任务已排队，等待开始');
    await textVisible(page, '未调用 GitHub Actions');
  }
  await page.getByLabel('预览任务状态').selectOption('failure');
  await textVisible(page, 'Source visibility check failed (HTTP 403)');
  await page.getByLabel('预览任务状态').selectOption('success');
  await textVisible(page, '同步完成不代表网站已发布');
  await page.getByRole('button', { name: '查看发布步骤' }).click();
  await page.getByRole('heading', { name: 'Cloudflare 尚未配置', exact: true }).waitFor();
  await page.getByRole('button', { name: '知道了' }).click();
  await page.close();
});

test('responsive navigation, dialog keyboard handling and fixture bundle isolation', async () => {
  const page = await open(390);
  for (const name of ['照片', 'Project', '照片源', '同步与发布']) {
    await nav(page, name);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} must not overflow mobile viewport`);
  }
  await nav(page, 'Project');
  await page.getByRole('button', { name: /在路上，慢一点/ }).click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await nav(page, '照片源');
  await page.getByLabel('编辑来源 旅行手记').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  assert.equal(await page.locator('.admin.light').count(), 1);
  await page.close();
  assert.deepEqual(errors, []);
  assert.deepEqual((await fs.readdir('src/content/projects')).filter(f => f.endsWith('.json')), []);
  const files = await fs.readdir('.cache/admin-dist/assets');
  const bundle = (await Promise.all(files.filter(f => f.endsWith('.js')).map(f => fs.readFile(path.join('.cache/admin-dist/assets', f), 'utf8')))).join('');
  for (const forbidden of ['JASON_PHOTOS_READ_TOKEN', 'node:fs', 'node:crypto', 'CLOUDFLARE_API_TOKEN']) assert(!bundle.includes(forbidden), forbidden);
});
