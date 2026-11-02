import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageGrid, cellAt, autoCellSize, classifyMargin, summarizeCoverage, coveragePixels, CELL_COLORS } from '../src/coverage/grid.js';
import { computeCoverage } from '../src/coverage/compute.js';
import { relayCandidates, findRelays, relaySearchBox } from '../src/relay/relay.js';
import { distance } from '../src/elevation/geo.js';
import { loadNodeDem } from '../src/elevation/node.js';

const close = (a, e, tol, msg = '') => assert.ok(Math.abs(a - e) <= tol, `${msg} expected ${e} ±${tol}, got ${a}`);
const center = { lat: 32.0, lon: 34.9 };

test('autoCellSize keeps the grid under ~81 cells across', () => {
  assert.equal(autoCellSize(5000), 125);
  assert.equal(autoCellSize(10_000), 250);
  assert.equal(autoCellSize(30_000), 750);
  for (const r of [5000, 15_000, 20_000, 30_000]) assert.ok((2 * r) / autoCellSize(r) <= 81.0001);
});

test('coverageGrid: square n x n grid, disc of cells, spacing in metres', () => {
  const g = coverageGrid(center, 5000, 500);
  assert.equal(g.half, 10);
  assert.equal(g.n, 21);
  // every listed cell is inside the radius, the centre (transmitter) is excluded
  for (const c of g.cells) assert.ok(c.distM <= 5000 && c.distM > 0);
  // the disc holds ~ pi r^2 / cell^2 = 314 cells
  close(g.cells.length, Math.PI * 100, 25);
  // neighbouring cells are 500 m apart in both directions
  const byIdx = new Map(g.cells.map((c) => [c.index, c]));
  const c0 = byIdx.get(10 * 21 + 11);
  close(distance(c0, byIdx.get(10 * 21 + 12)), 500, 1);
  close(distance(c0, byIdx.get(9 * 21 + 11)), 500, 1);
  // row 0 is north, col 0 is west
  assert.ok(byIdx.get(0 * 21 + 10).lat > center.lat);
  assert.ok(byIdx.get(10 * 21 + 0).lon < center.lon);
  assert.ok(g.north > center.lat && g.south < center.lat && g.west < center.lon && g.east > center.lon);
});

test('cellAt finds the cell containing a point, null outside the grid', () => {
  const g = coverageGrid(center, 5000, 500);
  for (const c of g.cells.filter((_, i) => i % 37 === 0)) {
    const hit = cellAt(g, c.lat + g.dLat * 0.4, c.lon - g.dLon * 0.4);
    assert.equal(hit.index, c.index);
  }
  assert.equal(cellAt(g, center.lat + 1, center.lon), null);
});

test('classification, summary and pixels', () => {
  assert.equal(classifyMargin(12), 'works');
  assert.equal(classifyMargin(3), 'marginal');
  assert.equal(classifyMargin(-1), 'fails');
  assert.equal(classifyMargin(NaN), null);
  const m = Float32Array.from([12, 3, -1, NaN]);
  const s = summarizeCoverage(m);
  assert.deepEqual([s.works, s.marginal, s.fails, s.total], [1, 1, 1, 3]);
  close(s.pctWorks, 33.33, 0.01);
  const px = coveragePixels({ n: 2 }, m);
  assert.deepEqual([...px.slice(0, 4)], CELL_COLORS.works);
  assert.deepEqual([...px.slice(12, 16)], [0, 0, 0, 0]); // NaN = transparent
});

const dem = loadNodeDem(new URL('../public/dem', import.meta.url).pathname);

test('computeCoverage on real terrain: Mt Tabor summit sees the valley, reports progress', async () => {
  let calls = 0;
  const { grid, margins } = await computeCoverage(
    dem,
    { tx: { lat: 32.687, lon: 35.3905, h: 5 }, radiusM: 5000, cellM: 500, rxHeightM: 2, settings: {} },
    () => calls++,
  );
  const s = summarizeCoverage(margins);
  assert.equal(s.total, grid.cells.length);
  assert.ok(calls > 0);
  // from a 560 m summit, a large part of a 5 km disc in the valley works
  assert.ok(s.pctWorks > 40 && s.pctWorks + s.pctMarginal > 50, `works ${s.pctWorks}%`);
});

test('computeCoverage at the foot of the hill: the far side of Tabor is in shadow', async () => {
  const { grid, margins } = await computeCoverage(dem, { tx: { lat: 32.6866, lon: 35.35, h: 2 }, radiusM: 10_000, cellM: 1000, rxHeightM: 2, settings: {} });
  // cell 7 km east (behind the mountain) must fail
  const east = cellAt(grid, 32.6866, 35.43);
  assert.equal(classifyMargin(margins[east.index]), 'fails');
});

test('relayCandidates stay inside the ellipse and are sorted high to low', () => {
  const a = { lat: 32.6866, lon: 35.35 };
  const b = { lat: 32.6866, lon: 35.43 };
  const flat = relayCandidates(a, b, (lat) => lat * 100, { maxCandidates: 30 });
  const D = distance(a, b);
  for (const c of flat) assert.ok(distance(a, c) + distance(c, b) <= Math.max(1.5 * D, D + 6000) + 1);
  for (let i = 1; i < flat.length; i++) assert.ok(flat[i - 1].ground >= flat[i].ground);
});

test('findRelays: the blocked Tabor path gets a relay on high ground', async () => {
  const a = { lat: 32.6866, lon: 35.35, h: 2 };
  const b = { lat: 32.6866, lon: 35.43, h: 2 };
  const box = relaySearchBox(a, b);
  await dem.ensureBox(box.south, box.west, box.north, box.east);
  const r = findRelays(dem, { a, b, settings: {}, relayHeightM: 5 });
  assert.equal(r.found, true);
  assert.equal(r.candidates.length, 3);
  const best = r.candidates[0];
  assert.ok(best.hop1.marginDb >= 0 && best.hop2.marginDb >= 0, JSON.stringify(best));
  assert.ok(best.ground > 160, `relay ground ${best.ground}`); // endpoints are at ~125 m
  // candidates sorted by their weakest hop
  assert.ok(r.candidates[0].minMarginDb >= r.candidates[1].minMarginDb);
});
