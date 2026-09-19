import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page, type Route } from 'playwright';
import { sourceImpacts } from '../../admin/server/service';
import type { PreviewData } from '../../admin/client/model';
import { ProjectSchema } from '../../src/projects/schema';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

// Inspect actual browser listeners as well as their effect; a no-op listener on
// clean pages would pass an event-only check but still violate the lifecycle.
async function assertProtection(page: Page, dirty: boolean) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
    assert.equal(listeners.filter(listener => listener.type === 'beforeunload').length, dirty ? 1 : 0);
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), dirty);
  } finally { await cdp.detach(); }
}

type Failure = 'rejected' | 'conflict' | 'html' | 'network' | 'invalid';
async function rejectSave(route: Route, failure: Failure) {
  if (failure === 'network') return route.abort('failed');
  if (failure === 'html') return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Error 1102</h1>' });
  if (failure === 'invalid') return route.fulfill({ json: { status: 'saved', head: 'invalid-head' } });
  return route.fulfill({ status: failure === 'conflict' ? 409 : 422, json: { message: failure === 'conflict' ? '版本冲突' : '保存失败，请重试' } });
}

test('Project draft protection across source saves and page unloads', async t => {
  await preparePreview();
  run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts'], repo);
  const data: PreviewData = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
  data.sources = ['fixture-travel', 'fixture-everyday', 'fixture-archive'].map(id => data.sources.find(source => source.sourceId === id)!);
  const host = await serve(path.resolve('.cache/admin-release'));
  const browser = await chromium.launch(softwareGPUOptions('webgl'));
  try {
    async function fixture(t: TestContext) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [], dialogs: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
      t.after(async () => { try { assert.deepEqual(errors, []); } finally { await context.close(); } });
      const project = ProjectSchema.parse({ ...structuredClone(data.projects[0]!), title: 'Project A', photos: data.projects[0]!.photos.filter(ref => data.photos.find(p => p.photo.id === ref.photoId)?.sourceId === data.sources[0]!.sourceId) });
      const state = { head: 'a'.repeat(40), saveProof: 'initial-proof' as string | undefined, email: 'admin@example.com', sources: structuredClone(data.sources), projects: [project], publishEnabled: false, media: { state: 'ready', photos: data.photos, aliases: {}, runId: 1, expiresAt: '2030-01-01' } };
      const controls: { projectFailure?: Failure; sourceFailure?: Failure; projectWait?: Promise<void>; impactFailure?: boolean; sourceAppliedWithoutResponse?: boolean } = {};
      const saves: any[] = [], impacts: { head: string; projects: typeof state.projects }[] = [], dispatches: any[] = [];
      let version = 10, reads = 0;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/state') { reads++; return route.fulfill({ json: state }); }
        if (url.pathname === '/api/tasks') return route.fulfill({ json: { pending: true, tasks: [] } });
        if (url.pathname === '/api/impact') {
          impacts.push({ head: state.head, projects: structuredClone(state.projects) });
          if (controls.impactFailure) return route.fulfill({ status: 503, json: { message: '引用检查失败' } });
          return route.fulfill({ json: { head: state.head, impacts: sourceImpacts({ schemaVersion: 1, sources: state.sources }, route.request().postDataJSON(), state.projects) } });
        }
        if (url.pathname === '/api/sync-preview') return route.fulfill({ json: { head: state.head, revision: 'd'.repeat(64), checkedAt: '2026-09-19T12:00:00Z', sourceIds: state.sources.filter(s => s.enabled).map(s => s.sourceId), baselineRunId: 1, sources: [], counts: null, conflicts: [], errors: [], partialAllowed: true } });
        if (url.pathname === '/api/dispatch') { dispatches.push(route.request().postDataJSON()); return route.fulfill({ json: { requestId: 'f274873e-f93d-4511-83d3-2468d2b105c6', mode: 'sync' } }); }
        assert.equal(url.pathname, '/api/save');
        const body = route.request().postDataJSON(); saves.push(body);
        if (body.kind === 'project') await controls.projectWait;
        const failure = body.kind === 'project' ? controls.projectFailure : controls.sourceFailure;
        if (failure) return rejectSave(route, failure);
        if (body.expectedHead !== state.head) return rejectSave(route, 'conflict');
        if (body.kind === 'project') state.projects = [...state.projects.filter(p => p.id !== body.project.id), body.project];
        else {
          const affected = sourceImpacts({ schemaVersion: 1, sources: state.sources }, body.config, state.projects);
          if (affected.length) return route.fulfill({ status: 422, json: { message: '照片引用失效', details: affected } });
          state.sources = body.config.sources; state.media.state = 'stale';
        }
        state.head = (++version).toString(16).repeat(40);
        state.saveProof = body.kind === 'project' ? 'proof-' + state.head : undefined;
        if (body.kind === 'sources' && controls.sourceAppliedWithoutResponse) return route.abort('failed');
        return route.fulfill({ json: { status: 'saved', head: state.head, saveProof: state.saveProof } });
      });
      await page.route('**/thumbnails/*', async route => route.fulfill({ contentType: 'image/jpeg', body: await fs.readFile(path.join(fixtureRoot, new URL(route.request().url()).pathname)) }));
      const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      const guard = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '当前 Project 有未保存修改', exact: true }) });
      const sourceDialog = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '编辑照片源', exact: true }) });
      async function editSource(index = 0, label = '显示名称', value = '新的显示名称') {
        await nav('照片源');
        await page.getByRole('button', { name: `编辑来源 ${state.sources[index]!.name}`, exact: true }).click();
        await sourceDialog().getByText('服务端未发现失效的 Project 引用。', { exact: true }).waitFor();
        const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/impact');
        await page.getByLabel(label, { exact: true }).fill(value); await checked;
        await sourceDialog().getByRole('button', { name: '保存配置到 GitHub', exact: true }).click();
      }
      async function editTitle(title = '尚未保存的标题') {
        await nav('Project'); await page.getByLabel('标题', { exact: true }).fill(title);
      }
      const savedSource = () => page.getByText('照片源配置已提交 GitHub。请前往“照片 → 同步照片”检查变化并同步。', { exact: true }).waitFor();
      await page.goto(host.url); await nav('Project');
      await page.getByRole('button', { name: /Project A/ }).click();
      return { page, state, controls, saves, impacts, dispatches, dialogs, nav, guard, sourceDialog, editSource, editTitle, savedSource, reads: () => reads };
    }

    await t.test('display-name save waits for Project success, carries the new HEAD and releases sync/refresh', async t => {
      const f = await fixture(t), { page } = f;
      await assertProtection(page, false);
      await f.editTitle(); await f.editSource(); await f.guard().waitFor();
      assert.equal(f.saves.length, 0);
      const pending = Promise.withResolvers<void>(); f.controls.projectWait = pending.promise;
      const sent = page.waitForRequest(request => new URL(request.url()).pathname === '/api/save');
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click(); await sent;
      assert.equal(f.saves.length, 1); assert.equal(f.saves[0].kind, 'project');
      await page.keyboard.press('Escape'); assert(await f.guard().isVisible());
      await assertProtection(page, true);
      pending.resolve(); await f.savedSource();
      assert.deepEqual(f.saves.map(s => s.kind), ['project', 'sources']);
      assert.equal(f.saves[0].project.title, '尚未保存的标题');
      assert.equal(f.saves[0].expectedHead, 'a'.repeat(40));
      assert.equal(f.saves[0].saveProof, 'initial-proof');
      assert.equal(f.saves[1].expectedHead, 'b'.repeat(40));
      assert.equal(f.saves[1].saveProof, undefined);
      assert.equal(f.state.sources[0]!.name, '新的显示名称');
      assert(f.impacts.some(i => i.head === 'b'.repeat(40) && i.projects[0]!.title === '尚未保存的标题'));
      await assertProtection(page, false);
      await f.nav('Project');
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的标题');
      assert(await page.getByRole('button', { name: '保存 Project', exact: true }).isDisabled(), 'Source changes must still expire the library');
      await f.nav('照片'); await page.getByRole('tab', { name: '同步照片', exact: true }).click();
      assert(await page.getByRole('button', { name: '同步照片', exact: true }).isEnabled());
      await page.getByRole('button', { name: '同步照片', exact: true }).click();
      await page.getByText('同步请求已发送，等待实际执行结果。', { exact: true }).waitFor();
      assert.equal(f.dispatches[0].expectedHead, 'c'.repeat(40));
      await page.getByRole('button', { name: '刷新仓库', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('main[aria-busy="true"]'));
      assert.equal(f.reads(), 2);
    });

    await t.test('identity changes can follow a saved title without stale HEAD conflicts', async t => {
      const f = await fixture(t);
      await f.editTitle(); await f.editSource(1, '仓库名称', 'replacement-photos');
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click(); await f.savedSource();
      assert.deepEqual(f.saves.map(s => [s.kind, s.expectedHead]), [['project', 'a'.repeat(40)], ['sources', 'b'.repeat(40)]]);
      assert.equal(f.state.sources[1]!.repo, 'replacement-photos');
      await assertProtection(f.page, false);
    });

    for (const failure of ['rejected', 'conflict', 'html', 'network', 'invalid'] as const) await t.test(`Project ${failure} stops source submission and retains the draft and unload protection`, async t => {
      const f = await fixture(t), { page } = f;
      f.controls.projectFailure = failure;
      await f.editTitle(); await f.editSource();
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click();
      if (failure === 'conflict') {
        await page.getByRole('heading', { name: '保存版本冲突', exact: true }).waitFor();
        await page.getByRole('button', { name: '保留编辑，返回检查', exact: true }).click();
      }
      await f.guard().getByRole('alert').waitFor();
      assert.deepEqual(f.saves.map(s => s.kind), ['project']);
      assert.equal(f.state.head, 'a'.repeat(40)); assert.equal(f.state.sources[0]!.name, data.sources[0]!.name);
      await assertProtection(page, true);
      await f.guard().getByRole('button', { name: '保留编辑，取消来源提交', exact: true }).click();
      assert.equal(await page.getByLabel('显示名称', { exact: true }).inputValue(), '新的显示名称');
      await f.sourceDialog().getByRole('button', { name: '取消', exact: true }).click(); await f.nav('Project');
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的标题');
      assert(await page.getByRole('button', { name: '保存 Project', exact: true }).isEnabled());
      assert.equal(f.saves.length, 1, 'No automatic retry or source write');
    });

    await t.test('invalid Project validation also stops source submission', async t => {
      const f = await fixture(t);
      await f.editTitle(''); await f.editSource();
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click();
      await f.guard().getByRole('alert').waitFor(); assert.equal(f.saves.length, 0);
      await assertProtection(f.page, true);
    });

    await t.test('cancel, Escape and close preserve both editors without submitting either', async t => {
      const f = await fixture(t), { page } = f;
      await f.editTitle(); await f.editSource();
      for (const action of ['cancel', 'escape', 'close']) {
        if (action === 'cancel') await f.guard().getByRole('button', { name: '保留编辑，取消来源提交', exact: true }).click();
        else if (action === 'escape') await page.keyboard.press('Escape');
        else await f.guard().getByRole('button', { name: '关闭对话框', exact: true }).click();
        assert.equal(await f.guard().count(), 0); assert.equal(f.saves.length, 0);
        assert.equal(await page.getByLabel('显示名称', { exact: true }).inputValue(), '新的显示名称');
        await assertProtection(page, true);
        if (action !== 'close') await f.sourceDialog().getByRole('button', { name: '保存配置到 GitHub', exact: true }).click();
      }
      await f.sourceDialog().getByRole('button', { name: '取消', exact: true }).click(); await f.nav('Project');
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的标题');
      assert.equal(f.state.sources[0]!.name, data.sources[0]!.name);
    });

    await t.test('discard restores the saved Project and allows source submission without a Project save', async t => {
      const f = await fixture(t), { page } = f;
      await f.editTitle(); await f.editSource();
      await f.guard().getByRole('button', { name: '放弃编辑并继续', exact: true }).click(); await f.savedSource();
      assert.deepEqual(f.saves.map(s => s.kind), ['sources']); assert.equal(f.saves[0].expectedHead, 'a'.repeat(40));
      await f.nav('Project'); assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), 'Project A');
      await assertProtection(page, false);
    });

    await t.test('discarding a new unsaved Project removes it before saving the source', async t => {
      const f = await fixture(t), { page } = f;
      await page.getByRole('button', { name: '全部 Project', exact: true }).click();
      await page.getByRole('button', { name: '新建 Project', exact: true }).click();
      await f.editTitle('新 Project'); await f.editSource();
      await f.guard().getByRole('button', { name: '放弃编辑并继续', exact: true }).click(); await f.savedSource();
      await f.nav('Project'); assert.equal(await page.getByLabel('标题', { exact: true }).count(), 0);
      assert.equal(f.state.projects.length, 1); assert.deepEqual(f.saves.map(s => s.kind), ['sources']);
      await assertProtection(page, false);
    });

    await t.test('newly saved photo references block an identity change despite an earlier clear impact preview', async t => {
      const f = await fixture(t), { page } = f;
      await page.getByRole('button', { name: '添加照片', exact: true }).click();
      await page.getByLabel('选择 FRAME_015.jpg', { exact: true }).click();
      await page.getByRole('button', { name: '加入 Project A', exact: true }).click();
      await f.editSource(1, '仓库名称', 'replacement-photos');
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click();
      await f.sourceDialog().getByRole('alert').filter({ hasText: '移除或迁移照片引用' }).waitFor();
      assert.deepEqual(f.saves.map(s => s.kind), ['project']);
      assert.equal(f.state.projects[0]!.photos.length, 3); assert.equal(f.state.sources[1]!.repo, data.sources[1]!.repo);
      assert(await f.sourceDialog().getByRole('button', { name: '保存配置到 GitHub', exact: true }).isDisabled());
      await assertProtection(page, false);
    });

    await t.test('saving removed references refreshes impact checks before an identity change', async t => {
      const f = await fixture(t), { page } = f;
      await page.getByRole('button', { name: '添加照片', exact: true }).click();
      await page.getByLabel('选择 FRAME_015.jpg', { exact: true }).click();
      await page.getByRole('button', { name: '加入 Project A', exact: true }).click();
      await page.getByLabel('移除照片 1', { exact: true }).click(); await page.getByLabel('移除照片 1', { exact: true }).click();
      await f.editSource(0, '仓库名称', 'replacement-photos');
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click(); await f.savedSource();
      assert.deepEqual(f.saves.map(s => s.kind), ['project', 'sources']);
      assert.equal(f.state.projects[0]!.photos.length, 1); assert.equal(f.saves[1].expectedHead, 'b'.repeat(40));
    });

    await t.test('discard does not bypass source references in the saved Project', async t => {
      const f = await fixture(t);
      await f.editTitle(); await f.editSource(0, '仓库名称', 'replacement-photos');
      await f.guard().getByRole('button', { name: '放弃编辑并继续', exact: true }).click();
      await f.sourceDialog().getByRole('alert').filter({ hasText: '移除或迁移照片引用' }).waitFor();
      assert.equal(f.saves.length, 0); assert.equal(f.state.sources[0]!.repo, data.sources[0]!.repo);
      assert.equal(f.state.projects[0]!.title, 'Project A');
      await assertProtection(f.page, false);
    });

    for (const failure of ['rejected', 'conflict', 'network'] as const) await t.test(`source ${failure} preserves the saved Project, edited source and new HEAD for retry`, async t => {
      const f = await fixture(t), { page } = f;
      f.controls.sourceFailure = failure;
      await f.editTitle(); await f.editSource();
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click();
      if (failure === 'conflict') {
        await page.getByRole('heading', { name: '保存版本冲突', exact: true }).waitFor();
        await page.getByRole('button', { name: '保留编辑，返回检查', exact: true }).click();
      }
      await f.sourceDialog().getByRole('alert').waitFor();
      assert.equal(await f.guard().count(), 0); assert.equal(f.saves.length, 2);
      assert.equal(f.state.projects[0]!.title, '尚未保存的标题'); assert.equal(f.state.head, 'b'.repeat(40));
      assert.equal(f.state.sources[0]!.name, data.sources[0]!.name);
      assert.equal(await page.getByLabel('显示名称', { exact: true }).inputValue(), '新的显示名称');
      await assertProtection(page, false);
      f.controls.sourceFailure = undefined;
      await f.sourceDialog().getByRole('button', { name: '保存配置到 GitHub', exact: true }).click(); await f.savedSource();
      assert.deepEqual(f.saves.map(s => s.kind), ['project', 'sources', 'sources']);
      assert.equal(f.saves[2].expectedHead, 'b'.repeat(40));
    });

    await t.test('an uncertain source result can be recovered by closing its editor and refreshing the repository', async t => {
      const f = await fixture(t), { page } = f;
      f.controls.sourceAppliedWithoutResponse = true;
      await f.editTitle(); await f.editSource();
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click();
      await f.sourceDialog().getByRole('alert').filter({ hasText: '保存结果尚未确认' }).waitFor();
      assert.equal(f.saves.length, 2); assert.equal(f.state.head, 'c'.repeat(40));
      await f.sourceDialog().getByRole('button', { name: '取消', exact: true }).click(); await f.nav('Project');
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的标题');
      assert(await page.getByRole('button', { name: '保存 Project', exact: true }).isEnabled(), 'An unconfirmed source write must not expire local state');
      await page.getByRole('button', { name: '刷新仓库', exact: true }).click();
      await page.getByRole('button', { name: '全部 Project', exact: true }).waitFor({ state: 'hidden' });
      await f.nav('照片源'); await page.getByRole('heading', { name: '新的显示名称', exact: true }).waitFor();
      assert.equal(f.reads(), 2); assert.equal(f.saves.length, 2);
    });

    await t.test('a failed impact recheck stops the source write after Project success', async t => {
      const f = await fixture(t);
      await f.editTitle(); await f.editSource(); f.controls.impactFailure = true;
      await f.guard().getByRole('button', { name: '保存后继续', exact: true }).click();
      await f.sourceDialog().getByRole('alert').filter({ hasText: '引用检查失败' }).waitFor();
      assert.deepEqual(f.saves.map(s => s.kind), ['project']);
      await assertProtection(f.page, false);
    });

    await t.test('page refresh prompts only for dirty Projects; save and explicit discard remove the listener', async t => {
      const f = await fixture(t), { page } = f;
      await assertProtection(page, false); await page.reload();
      await f.nav('Project'); await page.getByRole('button', { name: /Project A/ }).click();
      assert.deepEqual(f.dialogs, []);
      await f.editTitle(); await assertProtection(page, true);
      // A dismissed reload never reaches "load"; observe the dialog directly.
      await Promise.all([page.waitForEvent('dialog'), page.evaluate(() => location.reload())]);
      assert.deepEqual(f.dialogs, ['beforeunload']);
      assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '尚未保存的标题');
      await page.getByRole('button', { name: '保存 Project', exact: true }).click();
      await page.getByText('已保存到 GitHub', { exact: true }).waitFor(); await assertProtection(page, false);
      await page.reload(); await f.nav('Project'); await page.getByRole('button', { name: /尚未保存的标题/ }).click();
      assert.deepEqual(f.dialogs, ['beforeunload']);
      await f.editTitle('要放弃的标题'); await assertProtection(page, true);
      await page.getByRole('button', { name: '放弃当前修改', exact: true }).click();
      await f.guard().getByRole('button', { name: '放弃编辑并继续', exact: true }).click();
      await assertProtection(page, false); await page.reload();
      assert.deepEqual(f.dialogs, ['beforeunload']);
    });

    await t.test('explicit discard and reload after conflict does not prompt a second time', async t => {
      const f = await fixture(t), { page } = f;
      f.controls.projectFailure = 'conflict'; await f.editTitle();
      await page.getByRole('button', { name: '保存 Project', exact: true }).click();
      await page.getByRole('heading', { name: '保存版本冲突', exact: true }).waitFor(); await assertProtection(page, true);
      await page.getByRole('button', { name: '放弃本地编辑，加载最新版本', exact: true }).click();
      await page.getByRole('heading', { name: '每一张，都有它的位置。', exact: true }).waitFor();
      await assertProtection(page, false); assert.deepEqual(f.dialogs, []);
    });
  } finally { await browser.close(); await host.close(); }
});
