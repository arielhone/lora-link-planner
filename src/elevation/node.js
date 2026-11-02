/**
 * Node.js helper to open the DEM from disk (tests and scripts only).
 */
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { Dem } from './dem.js';

export function loadNodeDem(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return new Dem(manifest, async (name) => {
    const f = join(dir, `${name}.i16.gz`);
    return existsSync(f) ? gunzipSync(readFileSync(f)) : null;
  });
}
