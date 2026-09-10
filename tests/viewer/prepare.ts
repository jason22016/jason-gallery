import * as fs from 'node:fs/promises';
import { gainmapJPEG, jpeg } from '../../scripts/photos/fixtures.js';
await fs.rm('.cache/viewer-fixtures', { recursive: true, force: true });
await fs.mkdir('.cache/viewer-fixtures', { recursive: true });
await fs.writeFile('.cache/viewer-fixtures/hdr.jpg', await gainmapJPEG());
await fs.writeFile('.cache/viewer-fixtures/ordinary.jpg', await jpeg());

const { colorFixtures } = await import('./color-fixtures');
for (const [name, bytes] of Object.entries(await colorFixtures())) await fs.writeFile(`.cache/viewer-fixtures/${name}`, bytes);
