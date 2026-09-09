import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
const files = await fs.readdir('.cache/viewer-dist/assets');
assert(files.some(file => /^webgpu-texture.worker-.*[.]js$/.test(file)), 'WebGPU worker emitted');
for (const file of files.filter(file => file.endsWith('.js'))) {
  const text = await fs.readFile(`.cache/viewer-dist/assets/${file}`, 'utf8');
  for (const forbidden of ['JASON_GALLERY_PHOTO_WORKDIR', 'exiftool-vendored', 'node:fs', '@afilmory/builder']) {
    assert(!text.includes(forbidden), `Node engine leaked into browser bundle: ${forbidden}`);
  }
}
console.log('PASS: isolated browser bundle and emitted worker');
