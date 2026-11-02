// docs/LEARN.md links to exact lines in the code; make sure they stay right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fixAnchors } from '../scripts/fix-doc-anchors.mjs';

const docPath = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/LEARN.md');

test('every code link in docs/LEARN.md points at the line defining that symbol', () => {
  const doc = readFileSync(docPath, 'utf8');
  const { problems } = fixAnchors(doc, (rel) => readFileSync(resolve(dirname(docPath), rel), 'utf8'));
  assert.deepEqual(problems, [], 'run: node scripts/fix-doc-anchors.mjs');
});
