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

// ---- coverage map: compute in the worker, check the heat map, click a cell
await page.goto('about:blank');
await page.goto(`${base}#m=cov&a=32.6866,35.35,2&cr=10`);
await page.waitForSelector('#cov-run:not([disabled])');
await page.click('#cov-run');
const sawProgress = await page.waitForFunction(() => /\d+ \/ \d+/.test(document.querySelector('#cov-progress span')?.textContent || '') || window.__planner.coverage, null, { timeout: 30000 }).then(() => true, () => false);
await page.waitForFunction(() => window.__planner.coverage, null, { timeout: 60000 });
const cov = await page.evaluate(() => ({ ...window.__planner.coverage.summary, overlay: !!document.querySelector('img.coverage-img'), legend: !document.querySelector('#map-legend').hidden }));
const covOk = sawProgress && cov.total > 1000 && cov.works > 0 && cov.fails > 0 && cov.overlay && cov.legend;
console.log(`${covOk ? 'PASS' : 'FAIL'} coverage map: ${cov.total} cells, ${cov.pctWorks.toFixed(0)}% works / ${cov.pctFails.toFixed(0)}% fails, overlay ${cov.overlay}, legend ${cov.legend}`);
if (!covOk) failed++;
if (shots) await page.screenshot({ path: `${shots}/coverage.png` });
// click the cell 7 km east (behind Mt Tabor): opens the link view with a failing path
const pt = await page.evaluate(() => {
  const p = window.__planner.map.latLngToContainerPoint([32.6866, 35.43]);
  return { x: p.x, y: p.y };
});
const mapBox = await page.locator('#map').boundingBox();
await page.mouse.click(mapBox.x + pt.x, mapBox.y + pt.y);
await page.waitForFunction(() => window.__planner.state.mode === 'link' && window.__planner.analysis, null, { timeout: 30000 });
const cell = await page.evaluate(() => ({ mode: window.__planner.state.mode, b: window.__planner.state.b, verdict: window.__planner.analysis.verdict }));
const cellOk = cell.mode === 'link' && Math.abs(cell.b.lon - 35.43) < 0.01 && cell.verdict === 'fails';
console.log(`${cellOk ? 'PASS' : 'FAIL'} clicking a coverage cell opens its A-B profile (${cell.verdict})`);
if (!cellOk) failed++;

// ---- relay planner on the blocked Tabor path
await page.goto('about:blank');
await page.goto(`${base}#a=32.6866,35.35,2&b=32.6866,35.43,2`);
await page.waitForSelector('#relay-find');
await page.click('#relay-find');
await page.waitForFunction(() => window.__planner.relay?.result, null, { timeout: 60000 });
const rel = await page.evaluate(() => window.__planner.relay.result);
const relayMarkers = await page.locator('.pin-r').count();
const relOk = rel.found && rel.candidates.length === 3 && relayMarkers === 3 && rel.candidates[0].hop1.marginDb >= 0 && rel.candidates[0].hop2.marginDb >= 0;
console.log(`${relOk ? 'PASS' : 'FAIL'} relay planner: best R1 hops ${rel.candidates[0].hop1.marginDb.toFixed(1)} / ${rel.candidates[0].hop2.marginDb.toFixed(1)} dB, ${relayMarkers} markers`);
if (!relOk) failed++;
if (shots) await page.screenshot({ path: `${shots}/relay.png` });
await page.click('#relay button[data-hop="1"][data-i="0"]');
await page.waitForFunction(() => window.__planner.relay?.viewing && window.__planner.analysis && Math.abs(window.__planner.analysis.marginDb - window.__planner.relay.result.candidates[0].hop1.marginDb) < 3, null, { timeout: 30000 });
await page.click('#relay-back');
await page.waitForFunction(() => !window.__planner.relay?.viewing && window.__planner.state.b && Math.abs(window.__planner.state.b.lon - 35.43) < 1e-6 && window.__planner.analysis?.verdict === 'fails' && document.querySelector('#relay-banner').hidden);
console.log('PASS relay hop inspect + back to A-B');

// ---- Hebrew / RTL
await page.click('#lang');
const he = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, tab: document.querySelector('#tab-link').textContent, verdict: document.querySelector('#result .verdict b')?.textContent }));
const heOk = he.dir === 'rtl' && he.lang === 'he' && /[\u0590-\u05FF]/.test(he.tab) && he.verdict === 'הקישור נכשל';
console.log(`${heOk ? 'PASS' : 'FAIL'} Hebrew UI: dir=${he.dir}, tab "${he.tab}", verdict "${he.verdict}"`);
if (!heOk) failed++;
if (shots) await page.screenshot({ path: `${shots}/hebrew.png` });
await page.click('#lang'); // back to English for the next run

if (errors.length) {
  console.log('FAIL page errors:', errors);
  failed++;
}
await browser.close();
process.exit(failed ? 1 : 0);
