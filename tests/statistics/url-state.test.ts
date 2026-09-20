import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statsFocalIntervalFromSearch, statsFocalIntervalURL, statsPeriodURL, statsResultFromSearch, statsScopeURL } from '../../src/components/stats/url-state';
import { allPhotographyStatsScope, resolvePhotographyStats } from '../../src/statistics';
import type { PhotographyStatsPageData } from '../../src/website/photography-stats';
import { assertDeepFrozen, publicFixture, statsPhoto } from './fixtures';
import { freezeDeep } from '../../src/projects/resolver';

function pageData(): PhotographyStatsPageData {
  const { collection, catalog } = publicFixture();
  const photos = collection.listPhotos();
  return freezeDeep({
    all: { ...resolvePhotographyStats(photos, allPhotographyStatsScope)!, explore: { cameras: {}, lenses: {} } },
    projects: catalog.published.listProjects().map(project => ({ ...resolvePhotographyStats(photos, { type: 'project', slug: project.slug })!, explore: { cameras: {}, lenses: {} } })),
  });
}

test('URL defaults select the existing All Photos aggregate, without recomputing or mutating page data', () => {
  const data = pageData();
  const before = JSON.stringify(data);
  for (const search of ['', '?', '?period=year', '?unrelated=value&unrelated=another']) {
    assert.strictEqual(statsResultFromSearch(search, data), data.all, search);
  }
  assert.equal(JSON.stringify(data), before);
  assertDeepFrozen(data);
});

test('direct Project URL and refreshed URL resolve the same precomputed published Project aggregate', () => {
  const data = pageData();
  for (const project of data.projects) {
    const url = new URL(`https://gallery.example/stats/?period=year&project=${project.project!.slug}#when`);
    assert.strictEqual(statsResultFromSearch(url.search, data), project);
    assert.strictEqual(statsResultFromSearch(new URL(url.href).search, data), project);
  }
  assert.strictEqual(statsResultFromSearch('?project=%66irst', data), data.projects[0]);
});

test('draft, unknown, malformed and repeated Project parameters never widen to All Photos', () => {
  const data = pageData();
  for (const search of [
    '?project=private-draft', '?project=unknown', '?project=first-id', '?project=all',
    '?project=', '?project=First', '?project=../first', '?project=%2Ffirst', '?project=%00first',
    '?project=first+second', '?project=first--second', '?project=__proto__', '?project=constructor',
    '?project=first&project=second', '?project=first&project=first', '?project=&project=first',
  ]) assert.equal(statsResultFromSearch(search, data), undefined, search);
});

test('valid published slugs named all or unavailable remain Project scopes', () => {
  const photos = ['all', 'unavailable'].map(slug => statsPhoto(slug, { projects: [{ id: slug, slug, title: slug }] }));
  const data: PhotographyStatsPageData = {
    all: { ...resolvePhotographyStats(photos, allPhotographyStatsScope)!, explore: { cameras: {}, lenses: {} } },
    projects: photos.map(photo => ({ ...resolvePhotographyStats(photos, { type: 'project', slug: photo.id })!, explore: { cameras: {}, lenses: {} } })),
  };
  assert.strictEqual(statsResultFromSearch('', data), data.all);
  assert.strictEqual(statsResultFromSearch('?project=all', data), data.projects[0]);
  assert.strictEqual(statsResultFromSearch('?project=unavailable', data), data.projects[1]);
});

test('scope URLs replace Project parameters and preserve unrelated state and the hash without changing their input', () => {
  const current = new URL('https://gallery.example/explore/?project=first&project=second&period=year&filter=a&filter=b#when');
  const original = current.href;
  const projectScope = Object.freeze({ type: 'project' as const, slug: 'second' });
  const project = statsScopeURL(current, projectScope);
  assert.notStrictEqual(project, current);
  assert.equal(project.origin, current.origin);
  assert.equal(project.pathname, '/stats/');
  assert.deepEqual(project.searchParams.getAll('project'), ['second']);
  assert.equal(project.searchParams.get('period'), 'year');
  assert.deepEqual(project.searchParams.getAll('filter'), ['a', 'b']);
  assert.equal(project.hash, '#when');
  assert.equal(current.href, original);
  assert.deepEqual(projectScope, { type: 'project', slug: 'second' });

  const all = statsScopeURL(current, allPhotographyStatsScope);
  assert.equal(all.pathname, '/stats/');
  assert.equal(all.searchParams.has('project'), false);
  assert.equal(all.searchParams.get('period'), 'year');
  assert.deepEqual(all.searchParams.getAll('filter'), ['a', 'b']);
  assert.equal(all.hash, '#when');
  assert.equal(current.href, original);
});

test('timeline URLs canonicalize only the period while preserving Project, unrelated parameters and hash', () => {
  const current = new URL('https://gallery.example/stats/?project=second&period=month&period=invalid&tag=a&tag=b#rhythm');
  const original = current.href;
  const year = statsPeriodURL(current, 'year');
  assert.notStrictEqual(year, current);
  assert.equal(year.origin, current.origin);
  assert.equal(year.pathname, current.pathname);
  assert.deepEqual(year.searchParams.getAll('period'), ['year']);
  assert.equal(year.searchParams.get('project'), 'second');
  assert.deepEqual(year.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(year.hash, '#rhythm');

  const month = statsPeriodURL(year, 'month');
  assert.equal(month.searchParams.has('period'), false);
  assert.equal(month.searchParams.get('project'), 'second');
  assert.deepEqual(month.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(month.hash, '#rhythm');
  assert.equal(year.searchParams.get('period'), 'year');
  assert.equal(current.href, original);
});

test('scope and period history entries can be replayed backward and forward from the URL alone', () => {
  const data = pageData();
  const start = new URL('https://gallery.example/stats/?campaign=gallery#when');
  const first = statsScopeURL(start, data.projects[0]!.scope);
  const yearly = statsPeriodURL(first, 'year');
  const second = statsScopeURL(yearly, data.projects[1]!.scope);
  const monthly = statsPeriodURL(second, 'month');
  const all = statsScopeURL(monthly, data.all.scope);
  const entries = [start, first, yearly, second, monthly, all];
  const expected = [data.all, data.projects[0], data.projects[0], data.projects[1], data.projects[1], data.all];
  for (const index of [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5]) {
    const restored = new URL(entries[index]!.href);
    assert.strictEqual(statsResultFromSearch(restored.search, data), expected[index]);
    assert.equal(restored.searchParams.get('campaign'), 'gallery');
    assert.equal(restored.hash, '#when');
  }
  assert.equal(start.searchParams.has('project'), false);
  assert.equal(first.searchParams.has('period'), false);
  assert.equal(yearly.searchParams.get('period'), 'year');
});

test('focal interval URLs accept bounded whole millimetres and default safely for invalid or ambiguous input', () => {
  for (const interval of [1, 5, 10, 20, 25, 50, 75, 1000]) assert.equal(statsFocalIntervalFromSearch(`?focalInterval=${interval}`), interval);
  for (const search of ['', '?focalInterval=', '?focalInterval=0', '?focalInterval=-5', '?focalInterval=1.5', '?focalInterval=1001', '?focalInterval=Infinity', '?focalInterval=1e2', '?focalInterval=20&focalInterval=50']) {
    assert.equal(statsFocalIntervalFromSearch(search), 10, search);
  }
});

test('focal interval changes preserve scope, period and other URL state; returning to the default removes only that parameter', () => {
  const current = new URL('https://gallery.example/stats/?project=second&period=year&focalInterval=5&focalInterval=20&tag=a&tag=b#focal-heading');
  const original = current.href;
  const custom = statsFocalIntervalURL(current, 25);
  assert.deepEqual(custom.searchParams.getAll('focalInterval'), ['25']);
  assert.equal(custom.searchParams.get('project'), 'second');
  assert.equal(custom.searchParams.get('period'), 'year');
  assert.deepEqual(custom.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(custom.hash, '#focal-heading');
  const nextScope = statsScopeURL(custom, { type: 'project', slug: 'first' });
  const nextPeriod = statsPeriodURL(nextScope, 'month');
  assert.equal(statsFocalIntervalFromSearch(nextPeriod.search), 25);
  const defaultInterval = statsFocalIntervalURL(nextPeriod, 10);
  assert.equal(defaultInterval.searchParams.has('focalInterval'), false);
  assert.equal(defaultInterval.searchParams.get('project'), 'first');
  assert.equal(current.href, original);
});
