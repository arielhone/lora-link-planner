/**
 * Update the "#L<line>" anchors in docs/LEARN.md so each link points at the
 * line that defines the named symbol, e.g. [`deygout()`](../src/physics/diffraction.js#L136).
 *   node scripts/fix-doc-anchors.mjs          # rewrite in place
 *   node scripts/fix-doc-anchors.mjs --check  # exit 1 if any anchor is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = resolve(root, 'docs/LEARN.md');
const LINK = /\[`([\w.]+)(?:\(\))?`\]\((\.\.\/src\/[\w/.-]+\.js)#L(\d+)\)/g;

/** Line (1-based) where `name` is defined in `file`, or null. */
export function definitionLine(source, name) {
  const short = name.includes('.') ? name.split('.').pop() : name;
  const cls = name.includes('.') ? name.split('.')[0] : null;
  const lines = source.split('\n');
  const patterns = [
    new RegExp(`^export (async )?function ${short}\\b`),
    new RegExp(`^export (const|let|class) ${short}\\b`),
    new RegExp(`^\\s+(async )?${short}\\(.*\\)\\s*\\{`), // class method
  ];
  let start = 0;
  if (cls) {
    const c = lines.findIndex((l) => new RegExp(`^export class ${cls}\\b`).test(l));
    if (c >= 0) start = c;
  }
  for (const re of patterns) {
    const i = lines.findIndex((l, idx) => idx >= start && re.test(l));
    if (i >= 0) return i + 1;
  }
  return null;
}

export function fixAnchors(doc, read) {
  const problems = [];
  const out = doc.replace(LINK, (m, name, rel, line) => {
    const src = read(rel);
    const def = definitionLine(src, name);
    if (def === null) {
      problems.push(`${name} not found in ${rel}`);
      return m;
    }
    if (String(def) !== line) problems.push(`${name}: L${line} -> L${def}`);
    return m.replace(`#L${line})`, `#L${def})`);
  });
  return { out, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = readFileSync(docPath, 'utf8');
  const { out, problems } = fixAnchors(doc, (rel) => readFileSync(resolve(dirname(docPath), rel), 'utf8'));
  if (process.argv.includes('--check')) {
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
  } else {
    writeFileSync(docPath, out);
    console.log(problems.length ? problems.join('\n') : 'all anchors up to date');
  }
}
