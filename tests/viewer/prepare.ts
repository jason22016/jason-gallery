import * as fs from 'node:fs/promises';
import { gainmapJPEG, jpeg } from '../../scripts/photos/fixtures.js';
await fs.mkdir('.cache/viewer-fixtures', { recursive: true });
await fs.writeFile('.cache/viewer-fixtures/hdr.jpg', await gainmapJPEG());
await fs.writeFile('.cache/viewer-fixtures/ordinary.jpg', await jpeg());
