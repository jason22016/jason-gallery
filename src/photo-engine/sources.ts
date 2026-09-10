import fs from 'node:fs';
import { parseSources } from './source-contract.js';
export * from './source-contract.js';
export const loadSources = (file: string | URL = 'config/photo-sources.json') => parseSources(JSON.parse(fs.readFileSync(file, 'utf8')));
