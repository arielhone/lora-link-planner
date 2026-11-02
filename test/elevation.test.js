import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, interpolate, bearing } from '../src/elevation/geo.js';
import { Dem, decodeTile, bilinear } from '../src/elevation/dem.js';
import { pathPoints, terrainProfile } from '../src/elevation/profile.js';
import { loadNodeDem } from '../src/elevation/node.js';

const close = (a, e, tol, msg = '') => assert.ok(Math.abs(a - e) <= tol, `${msg} expected ${e} ±${tol}, got ${a}`);

test('haversine: 1 degree of latitude is ~111.2 km', () => {
  close(distance({ lat: 31, lon: 35 }, { lat: 32, lon: 35 }), 111_195, 5);
});

test('haversine: Tel Aviv (Azrieli) to Jerusalem (Old City) is ~54 km', () => {
  close(distance({ lat: 32.0744, lon: 34.7924 }, { lat: 31.7767, lon: 35.2345 }) / 1000, 54.2, 1);
});

test('great-circle interpolation: midpoint is equidistant, ends are exact', () => {
  const a = { lat: 29.55, lon: 34.95 };
  const b = { lat: 33.3, lon: 35.6 };
  const m = interpolate(a, b, 0.5);
  close(distance(a, m), distance(m, b), 0.01);
  close(interpolate(a, b, 0).lat, a.lat, 1e-9);
  close(interpolate(a, b, 1).lon, b.lon, 1e-9);
  close(bearing({ lat: 31, lon: 35 }, { lat: 32, lon: 35 }), 0, 1e-9);
  close(bearing({ lat: 31, lon: 35 }, { lat: 31, lon: 35.1 }), 90, 0.1);
});

test('pathPoints spacing is at most the step', () => {
  const pts = pathPoints({ lat: 31.0, lon: 35.0 }, { lat: 31.1, lon: 35.0 }, 30);
  assert.ok(pts.length >= 371);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].d - pts[i - 1].d <= 30.0001);
});

test('decodeTile undoes row-delta encoding with int16 wrap-around', () => {
  const values = [100, 120, 90, -400, 2800, -32768 + 5];
  const deltas = new Int16Array(values.length);
  deltas[0] = values[0];
  for (let i = 1; i < values.length; i++) deltas[i] = (values[i] - values[i - 1]) << 16 >> 16;
  // pad into a 3x3 tile: row 0 = first 3, row 1 = next 3, row 2 zeros
  const tile = new Int16Array(9);
  tile.set([deltas[0], deltas[1], deltas[2]], 0);
  tile.set([values[3], (values[4] - values[3]) << 16 >> 16, (values[5] - values[4]) << 16 >> 16], 3);
  const out = decodeTile(new Uint8Array(tile.buffer), 3);
  assert.deepEqual([...out.slice(0, 6)], values);
});

test('bilinear interpolation', () => {
  assert.equal(bilinear(0, 10, 20, 30, 0.5, 0.5), 15);
  assert.equal(bilinear(0, 10, 20, 30, 1, 0), 10);
});

// A synthetic 4x4 grid split into four 2x2 tiles: height = 10*R + C.
function synthetic() {
  const manifest = { north: 32, west: 35, south: 31.996, east: 35.004, step: 0.001, tileSize: 2, rows: 4, cols: 4, tiles: ['0_0', '0_1', '1_0'] };
  const loader = async (name) => {
    const [tr, tc] = name.split('_').map(Number);
    const t = new Int16Array(4);
    for (let r = 0; r < 2; r++) {
      let prev = 0;
      for (let c = 0; c < 2; c++) {
        const v = 10 * (tr * 2 + r) + (tc * 2 + c);
        t[r * 2 + c] = v - prev;
        prev = v;
      }
    }
    return new Uint8Array(t.buffer);
  };
  return new Dem(manifest, loader);
}

test('Dem: exact samples, interpolation across tile borders, missing tile = sea', async () => {
  const dem = synthetic();
  const at = (R, C) => ({ lat: 32 - R * 0.001, lon: 35 + C * 0.001 });
  await dem.ensure([at(0, 0), at(1.5, 1.5), at(3, 3)]);
  close(dem.elevationAt(at(0, 0).lat, at(0, 0).lon), 0, 1e-6);
  close(dem.elevationAt(at(1, 1).lat, at(1, 1).lon), 11, 1e-6);
  // between R=1..2, C=1..2 spans all four tiles; tile 1_1 is missing (0 m)
  // samples: (1,1)=11 (1,2)=12 (2,1)=21 (2,2)=0
  close(dem.elevationAt(at(1.5, 1.5).lat, at(1.5, 1.5).lon), (11 + 12 + 21 + 0) / 4, 1e-6);
  close(dem.elevationAt(at(3, 3).lat, at(3, 3).lon), 0, 1e-6);
});

test('Dem: throws if a tile was not loaded first', () => {
  const dem = synthetic();
  assert.throws(() => dem.elevationAt(32, 35), /not loaded/);
});

// ---- real data (public/dem) sanity checks against well-known heights
const dem = loadNodeDem(new URL('../public/dem', import.meta.url).pathname);
const elev = async (lat, lon) => {
  await dem.ensure([{ lat, lon }]);
  return dem.elevationAt(lat, lon);
};

test('real DEM: famous places have the right height', async () => {
  close(await elev(33.4163, 35.8572), 2780, 80, 'Mt Hermon summit (2814 m)');
  close(await elev(32.9981, 35.4103), 1180, 50, 'Mt Meron (1208 m)');
  close(await elev(32.6866, 35.3906), 560, 40, 'Mt Tabor (575 m)');
  close(await elev(31.5, 35.48), -430, 15, 'Dead Sea surface (~ -430 m)');
  close(await elev(32.0, 34.5), 0, 1, 'Mediterranean');
  close(await elev(31.7781, 35.2354), 740, 40, 'Jerusalem Old City (~740 m)');
});

test('real DEM: profile across Mt Tabor peaks in the middle', async () => {
  const a = { lat: 32.6866, lon: 35.35 };
  const b = { lat: 32.6866, lon: 35.43 };
  const p = await terrainProfile(dem, a, b, 30);
  const max = Math.max(...p.elevations);
  const iMax = p.elevations.indexOf(max);
  assert.ok(max > 500, `max ${max}`);
  assert.ok(p.elevations[0] < 250 && p.elevations.at(-1) < 250, `ends ${p.elevations[0]} ${p.elevations.at(-1)}`);
  const f = iMax / (p.elevations.length - 1);
  assert.ok(f > 0.3 && f < 0.7, `peak at ${f}`);
});
