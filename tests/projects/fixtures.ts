import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import type { AfilmoryManifest, PhotoManifestItem } from '../../src/photo-engine/index';
import type { Project } from '../../src/projects/schema';

export function photo(id: string): PhotoManifestItem {
  return {
    id, title: `Fixture ${id}`, dateTaken: '2024-02-29', tags: ['photo-tag'], description: 'Photo description',
    originalUrl: `https://example.invalid/${id}.jpg`, thumbnailUrl: `/thumbnails/${id}.jpg`,
    format: 'jpeg', thumbHash: null, width: 40, height: 20, aspectRatio: 2,
    s3Key: `${id}.jpg`, lastModified: '2024-02-29T00:00:00Z', size: 100,
    exif: null, keywords: [], regions: [], toneAnalysis: null, location: null, isHDR: false,
  };
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1, id: 'project-one', slug: 'project-one', title: 'Fixture project',
    summary: 'Summary', description: 'Plain text\nsecond line', location: 'Fixture location',
    coverPhotoId: 'photo-b', photos: [{ photoId: 'photo-b', caption: 'Local caption', alt: 'Local alt' }, { photoId: 'photo-a' }],
    tags: ['project-tag'], period: { start: '2024-02-29', end: '2024-03-01' }, order: 1, status: 'published',
    ...overrides,
  };
}

export function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jason-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'src/content/projects');
  fs.mkdirSync(directory, { recursive: true });
  const manifestFile = path.join(root, 'src/data/photos-manifest.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const manifest: AfilmoryManifest = { version: 'v10', data: [photo('photo-a'), photo('photo-b')], cameras: [], lenses: [] };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  return {
    root, directory, manifestFile, manifest,
    write: (data: Project, filename = `${data.slug}.json`) => fs.writeFileSync(path.join(directory, filename), JSON.stringify(data)),
  };
}
