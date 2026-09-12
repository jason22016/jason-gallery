import * as fs from 'node:fs/promises';
import { gainmapJPEG, jpeg } from '../../scripts/photos/fixtures.js';
await fs.rm('.cache/viewer-fixtures', { recursive: true, force: true });
await fs.mkdir('.cache/viewer-fixtures', { recursive: true });
await fs.writeFile('.cache/viewer-fixtures/hdr.jpg', await gainmapJPEG());
await fs.writeFile('.cache/viewer-fixtures/ordinary.jpg', await jpeg());

const { colorFixtures } = await import('./color-fixtures');
for (const [name, bytes] of Object.entries(await colorFixtures())) await fs.writeFile(`.cache/viewer-fixtures/${name}`, bytes);

// Synthetic fixtures: no user photographs. HEIC was encoded with macOS sips;
// commit the tiny fixture so Linux CI exercises the same actual HEVC decoder.
await fs.copyFile('tests/viewer/fixtures/ordinary.heic', '.cache/viewer-fixtures/ordinary.heic');
const { default: sharp } = await import('sharp');
await fs.writeFile('.cache/viewer-fixtures/ordinary.tiff', await sharp(await jpeg()).tiff({ compression: 'lzw' }).toBuffer());
await fs.writeFile('.cache/viewer-fixtures/gray.tiff', await sharp(await jpeg()).greyscale().tiff({ compression: 'none' }).toBuffer());
