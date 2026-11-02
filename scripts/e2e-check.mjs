/**
 * End-to-end smoke test: opens the built site in headless Chromium and checks
 * that known example links give the expected verdicts.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e-check.mjs [baseUrl] [screenshotDir]
 *
 * Requires Playwright (npm i -D playwright && npx playwright install chromium).
 */
import { createRequire } from 'node:module';

// CommonJS require so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.argv[2] || 'http://localhost:4173/';
const shots = process.argv[3];

const CASES = [
  // A path with Mt Tabor in the middle must be blocked.
  { name: 'Mt Tabor (hill in the middle)', hash: 'a=32.6866,35.35,2&b=32.6866,35.43,2', expect: (r) => r.verdict === 'fails' && !r.geometry.lineOfSight && r.obstructionLossDb > 20 && r.geometry.points.some((p) => p.blocksLos) },
  // Carmel -> Akko across the bay is a clear link.
  { name: 'Carmel -> Akko (clear)', hash: 'a=32.7614,35.0195,10&b=32.9236,35.0818,5', expect: (r) => r.verdict === 'works' && r.geometry.lineOfSight && r.obstructionLossDb === 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;

for (const c of CASES) {
  await page.goto("about:blank");
  await page.goto(`${base}#${c.hash}`);
  await page.waitForFunction(() => window.__planner?.analysis, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__planner.analysis);
  const ui = await page.locator('#result .verdict b').innerText();
  const redSegments = await page.locator('#profile .outline.block').count();
  const ok = c.expect(r);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: ${ui}, margin ${r.marginDb.toFixed(1)} dB, obstruction ${r.obstructionLossDb.toFixed(1)} dB, red segments ${redSegments}`);
  if (!ok) failed++;
  if (c.name.startsWith('Mt Tabor') && redSegments === 0) {
    console.log('FAIL obstruction not highlighted in the chart');
    failed++;
  }
  if (shots) await page.screenshot({ path: `${shots}/${c.name.replace(/\W+/g, '-').toLowerCase()}.png` });
}

// clicking on the map places A and B
await page.goto(base);
await page.waitForSelector('#map.leaflet-container', { state: 'attached' });
const box = await page.locator('#map').boundingBox();
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
await page.waitForFunction(() => window.__planner?.analysis, null, { timeout: 30000 });
const hash = await page.evaluate(() => location.hash);
const clickOk = /a=.*&b=/.test(hash);
console.log(`${clickOk ? 'PASS' : 'FAIL'} clicking the map places A and B and updates the URL (${hash})`);
if (!clickOk) failed++;

if (errors.length) {
  console.log('FAIL page errors:', errors);
  failed++;
}
await browser.close();
process.exit(failed ? 1 : 0);
