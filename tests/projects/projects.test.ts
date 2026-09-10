import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadPhotoIndex } from '../../src/photo-engine/index';
import { loadProjects } from '../../src/projects/index';
import { loadProjectCatalog } from '../../src/projects/loader';
import { resolveProjects } from '../../src/projects/resolver';
import { ProjectSchema } from '../../src/projects/schema';
import { fixture, photo, project } from './fixtures';

test('full Project JSON resolves through Phase 1 Photo Index without changing Manifest', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.manifestFile);
  f.write(project());
  const index = loadProjects(f);
  const result = index.getProject('project-one')!;
  assert.equal(index.getProjectBySlug('project-one'), result);
  assert.equal(result.location, 'Fixture location');
  assert.equal(result.description, 'Plain text\nsecond line');
  assert.equal(result.summary, 'Summary');
  assert.deepEqual(result.tags, ['project-tag']);
  assert.deepEqual(result.period, { start: '2024-02-29', end: '2024-03-01' });
  assert.deepEqual(result.photos.map(entry => entry.photoId), ['photo-b', 'photo-a']);
  assert.deepEqual(result.cover, photo('photo-b'));
  assert.equal(result.cover, result.photos[0].photo);
  assert.equal(result.photos[0].caption, 'Local caption');
  assert.equal(result.photos[0].alt, 'Local alt');
  assert.equal(result.photos[0].photo.description, 'Photo description');
  assert.deepEqual(result.photos[0].photo.tags, ['photo-tag']);
  assert.deepEqual(fs.readFileSync(f.manifestFile), before);
  assert.equal(index.getProject('missing'), undefined);
  assert.equal(index.getProjectBySlug('missing'), undefined);
});

test('minimal contract accepts omitted optional fields and an independent permanent ID', t => {
  const f = fixture(t);
  f.write({ schemaVersion: 1, id: 'permanent-id', slug: 'route-name', title: 'Title',
    coverPhotoId: 'photo-a', photos: [{ photoId: 'photo-a' }], order: -0.5, status: 'published' });
  const result = loadProjects(f).getProject('permanent-id')!;
  assert.equal(result.slug, 'route-name');
  assert.equal(result.location, undefined);
});

test('one photo can belong to multiple Projects with independent captions', t => {
  const f = fixture(t);
  f.write(project());
  f.write(project({ id: 'second', slug: 'second', photos: [{ photoId: 'photo-b', caption: 'Another caption' }] }));
  const index = loadProjects(f);
  assert.equal(index.listProjects().length, 2);
  assert.equal(index.getProject('second')!.photos[0].caption, 'Another caption');
  assert.equal(index.getProject('project-one')!.photos[0].caption, 'Local caption');
});

const invalidCases: Array<[string, unknown, RegExp]> = [
  ['dangling photo ID', project({ photos: [{ photoId: 'missing' }], coverPhotoId: 'missing' }), /photos\.0\.photoId: unknown photo ID "missing"/],
  ['cover outside Project', project({ coverPhotoId: 'photo-a', photos: [{ photoId: 'photo-b' }] }), /coverPhotoId: Cover must belong/],
  ['duplicate photo', project({ photos: [{ photoId: 'photo-b' }, { photoId: 'photo-b' }] }), /photos\.1\.photoId: Duplicate photo ID/],
  ['empty photos', project({ photos: [] }), /photos: Project must contain at least one photo/],
  ['unknown field', { ...project(), originalUrl: 'forbidden' }, /Unrecognized key.*originalUrl/],
  ['nested photo metadata', { ...project(), photos: [{ photoId: 'photo-b', width: 100 }] }, /photos\.0: Unrecognized key.*width/],
  ['unknown period field', { ...project(), period: { start: '2024-01-01', zone: 'UTC' } }, /period: Unrecognized key.*zone/],
  ['unsupported version', { ...project(), schemaVersion: 2 }, /schemaVersion/],
  ['numeric string order', { ...project(), order: '1' }, /order/],
  ['infinite order', project({ order: Infinity }), /order/],
  ['NaN order', project({ order: NaN }), /order/],
  ['invalid status', { ...project(), status: 'hidden' }, /status/],
  ['blank id', project({ id: '  ' }), /id: Must not be blank/],
  ['blank title', project({ title: '\t' }), /title: Must not be blank/],
  ['empty photo id', project({ coverPhotoId: '', photos: [{ photoId: '' }] }), /photoId: Must not be blank/],
  ['blank tag', project({ tags: [' '] }), /tags\.0/],
  ['invalid slug', project({ slug: '../route' }), /slug/],
  ['non-object root', [], /<root>/],
  ['null root', null, /<root>/],
];
for (const [name, data, expected] of invalidCases) {
  test(`rejects ${name} with source and field diagnostics`, t => {
    const f = fixture(t);
    assert.throws(() => resolveProjects([{ source: 'bad-project.json', data }], loadPhotoIndex(f.manifestFile)), error => {
      assert(error instanceof Error);
      assert.match(error.message, /bad-project\.json/);
      assert.match(error.message, expected);
      return true;
    });
  });
}

for (const field of ['id', 'slug'] as const) {
  test(`rejects duplicate Project ${field} across published and draft`, t => {
    const f = fixture(t);
    const first = project();
    const second = project({ id: 'second', slug: 'second', status: 'draft', [field]: first[field] });
    assert.throws(() => resolveProjects([
      { source: 'first.json', data: first }, { source: 'second.json', data: second },
    ], loadPhotoIndex(f.manifestFile)), new RegExp(`second.json: duplicate Project ${field}.*first.json`));
  });
}

for (const start of ['2023-02-29', '1900-02-29', '2024-02-30', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '0000-01-01', '10000-01-01', '2024-1-01', '2024-01-01T00:00:00Z', 'not-a-date']) {
  test(`rejects invalid calendar date ${start}`, () => {
    assert.equal(ProjectSchema.safeParse(project({ period: { start } })).success, false);
    assert.equal(ProjectSchema.safeParse(project({ period: { start: '0001-01-01', end: start } })).success, false);
  });
}

test('date ranges allow real leap days, open end and equal endpoints, reject reversed ranges', () => {
  for (const start of ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) {
    assert(ProjectSchema.safeParse(project({ period: { start } })).success);
    assert(ProjectSchema.safeParse(project({ period: { start, end: start } })).success);
  }
  assert.equal(ProjectSchema.safeParse(project({ period: { start: '2024-03-01', end: '2024-02-29' } })).success, false);
  assert.equal(ProjectSchema.safeParse({ ...project(), period: { end: '2024-01-01' } }).success, false);
});

test('public queries and serialization exclude drafts; explicit draft index is separate and sorted', t => {
  const f = fixture(t);
  f.write(project());
  f.write(project({ id: 'draft-b', slug: 'draft-b', title: 'SECRET DRAFT', status: 'draft', order: -10 }));
  f.write(project({ id: 'draft-a', slug: 'draft-a', status: 'draft', order: -10 }));
  const publicIndex = loadProjects(f);
  assert.deepEqual(publicIndex.listProjects().map(p => p.id), ['project-one']);
  assert.equal(publicIndex.getProject('draft-b'), undefined);
  assert.equal(publicIndex.getProjectBySlug('draft-b'), undefined);
  assert(!JSON.stringify(publicIndex.listProjects()).includes('SECRET DRAFT'));
  const drafts = loadProjectCatalog(f).drafts;
  assert.deepEqual(drafts.listProjects().map(p => p.id), ['draft-a', 'draft-b']);
  assert.equal(drafts.getProject('draft-b')!.status, 'draft');
  assert.equal(drafts.getProject('project-one'), undefined);
});

test('invalid draft is validated before public filtering', t => {
  const f = fixture(t);
  f.write(project());
  f.write(project({ id: 'draft', slug: 'draft', status: 'draft', coverPhotoId: 'missing', photos: [{ photoId: 'missing' }] }));
  assert.throws(() => loadProjects(f), /draft.json.*unknown photo ID/);
});

test('sorting is independent of input order and locale, with slug breaking order ties', t => {
  const f = fixture(t);
  const data = [['z', 2], ['a', 2], ['a-1', 2], ['first', -0.5], ['last', 10]] as const;
  const sources = data.map(([slug, order]) => ({ source: slug, data: project({ slug, id: slug, order }) }));
  const index = loadPhotoIndex(f.manifestFile);
  for (const inputs of [sources, [...sources].reverse(), [...sources.slice(2), ...sources.slice(0, 2)]]) {
    const result = resolveProjects(inputs, index).published;
    assert.deepEqual(result.listProjects().map(p => p.slug), ['first', 'a', 'a-1', 'z', 'last']);
    assert.equal(result.listProjects(), result.listProjects());
  }
});

test('query snapshots are deeply frozen and detached from caller-owned data/photos', () => {
  const data = project();
  const original = photo('photo-b');
  const catalog = resolveProjects([{ source: 'memory', data }], { getPhoto: id => id === original.id ? original : photo(id) });
  const index = catalog.published;
  const result = index.listProjects()[0];
  assert(Object.isFrozen(catalog));
  assert(Object.isFrozen(index));
  assert(Object.isFrozen(index.listProjects()));
  assert.equal(Reflect.set(result, 'title', 'changed'), false);
  assert.equal(Reflect.set(result.photos[0], 'caption', 'changed'), false);
  assert.equal(Reflect.set(result.cover, 'originalUrl', 'changed'), false);
  assert.equal(Reflect.set(result.photos[0].photo.tags, '0', 'changed'), false);
  assert.equal(Reflect.set(result.period!, 'start', 'changed'), false);
  data.title = 'caller change';
  data.photos[0].caption = 'caller change';
  original.tags[0] = 'caller change';
  assert.equal(result.title, 'Fixture project');
  assert.equal(result.photos[0].caption, 'Local caption');
  assert.deepEqual(result.cover.tags, ['photo-tag']);
  assert(!Object.isFrozen(original));
});

test('empty content directory and draft-only content produce empty public indices', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, '.gitkeep'), '');
  assert.deepEqual(loadProjects(f).listProjects(), []);
  f.write(project({ status: 'draft' }));
  assert.deepEqual(loadProjects(f).listProjects(), []);
});

test('loader rejects malformed JSON and mismatched filename', t => {
  const f = fixture(t);
  const file = path.join(f.directory, 'broken.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => loadProjects(f), /Cannot read Project JSON.*broken.json/);
  fs.rmSync(file);
  f.write(project(), 'wrong-name.json');
  assert.throws(() => loadProjects(f), /wrong-name.json.*slug.*must match filename/);
});

test('loader fails closed for missing directory, non-JSON files, nested directories and symlinks', t => {
  const f = fixture(t);
  assert.throws(() => loadProjects({ ...f, directory: path.join(f.root, 'missing') }), /ENOENT/);
  const extra = path.join(f.directory, 'notes.txt');
  fs.writeFileSync(extra, 'unexpected');
  assert.throws(() => loadProjects(f), /expected a regular <slug>.json file/);
  fs.rmSync(extra);
  const nested = path.join(f.directory, 'nested');
  fs.mkdirSync(nested);
  assert.throws(() => loadProjects(f), /expected a regular <slug>.json file/);
  fs.rmdirSync(nested);
  fs.symlinkSync(f.manifestFile, path.join(f.directory, 'linked.json'));
  assert.throws(() => loadProjects(f), /expected a regular <slug>.json file/);
});

test('Phase 1 duplicate photo IDs still fail before returning Project data', t => {
  const f = fixture(t);
  f.manifest.data.push(photo('photo-a'));
  fs.writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
  assert.throws(() => loadProjects(f), /Duplicate photo ID/);
});
