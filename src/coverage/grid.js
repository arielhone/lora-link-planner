/**
 * grid.js - the grid of receiver points used by the coverage map.
 *
 * The grid is regular in latitude/longitude, centred on the transmitter,
 * with square-ish cells of `cellM` metres. Only cells whose centre is within
 * `radiusM` of the transmitter are computed (a disc, not a square).
 * Pure functions, unit tested in test/coverage.test.js.
 */
import { distance } from '../elevation/geo.js';
import { MARGIN_GOOD_DB, MARGIN_MARGINAL_DB } from '../physics/linkBudget.js';

/** Metres per degree of latitude on the spherical earth used everywhere else. */
export const M_PER_DEG_LAT = 111_194.93;

/** Allowed coverage radii in the UI (km). */
export const COVERAGE_RADII_KM = [5, 10, 15, 20, 30];

/**
 * Pick a cell size so the grid has at most ~maxCellsPerSide cells across,
 * rounded to a tidy number of metres, never finer than the DEM (~60 m)... 
 * in practice >= 100 m.
 */
export function autoCellSize(radiusM, maxCellsPerSide = 81) {
  const raw = (2 * radiusM) / maxCellsPerSide;
  const nice = [100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000];
  return nice.find((n) => n >= raw) ?? Math.ceil(raw / 500) * 500;
}

/**
 * Build the grid.
 * @param {{lat:number, lon:number}} center transmitter position
 * @param {number} radiusM
 * @param {number} [cellM] cell size, default autoCellSize(radiusM)
 * @returns {{center, radiusM, cellM, n, half, dLat, dLon, north, south, west, east,
 *            cells: {index:number, row:number, col:number, lat:number, lon:number, distM:number}[]}}
 *   n x n cells; row 0 is the northern edge, col 0 the western edge.
 *   `cells` lists only the cells inside the radius; `index` = row * n + col.
 */
export function coverageGrid(center, radiusM, cellM = autoCellSize(radiusM)) {
  const half = Math.ceil(radiusM / cellM);
  const n = 2 * half + 1;
  const dLat = cellM / M_PER_DEG_LAT;
  const dLon = cellM / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const cells = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const lat = center.lat + (half - row) * dLat;
      const lon = center.lon + (col - half) * dLon;
      const distM = distance(center, { lat, lon });
      if (distM <= radiusM && !(row === half && col === half)) {
        cells.push({ index: row * n + col, row, col, lat, lon, distM });
      }
    }
  }
  return {
    center: { lat: center.lat, lon: center.lon },
    radiusM,
    cellM,
    n,
    half,
    dLat,
    dLon,
    // outer edges of the whole grid (cell centres +- half a cell)
    north: center.lat + (half + 0.5) * dLat,
    south: center.lat - (half + 0.5) * dLat,
    west: center.lon - (half + 0.5) * dLon,
    east: center.lon + (half + 0.5) * dLon,
    cells,
  };
}

/**
 * Which cell (row, col, index) contains a point? null if outside the grid.
 * Does not check the radius: use the margins array (NaN = not computed).
 */
export function cellAt(grid, lat, lon) {
  const row = Math.round((grid.center.lat - lat) / grid.dLat) + grid.half;
  const col = Math.round((lon - grid.center.lon) / grid.dLon) + grid.half;
  if (row < 0 || col < 0 || row >= grid.n || col >= grid.n) return null;
  return {
    row,
    col,
    index: row * grid.n + col,
    lat: grid.center.lat + (grid.half - row) * grid.dLat,
    lon: grid.center.lon + (col - grid.half) * grid.dLon,
  };
}

/** Verdict for a margin, with the same thresholds as the link view. */
export function classifyMargin(m) {
  if (!Number.isFinite(m)) return null;
  if (m >= MARGIN_GOOD_DB) return 'works';
  if (m >= MARGIN_MARGINAL_DB) return 'marginal';
  return 'fails';
}

/** RGBA colour of a cell (alpha 0..255). Discrete green / yellow / red. */
export const CELL_COLORS = {
  works: [22, 163, 74, 150],
  marginal: [234, 179, 8, 160],
  fails: [220, 38, 38, 130],
};

/**
 * Count cells per verdict.
 * @param {Float32Array|number[]} margins one value per grid index, NaN = not computed
 */
export function summarizeCoverage(margins) {
  const out = { works: 0, marginal: 0, fails: 0, total: 0 };
  for (const m of margins) {
    const v = classifyMargin(m);
    if (!v) continue;
    out[v]++;
    out.total++;
  }
  out.pctWorks = out.total ? (100 * out.works) / out.total : 0;
  out.pctMarginal = out.total ? (100 * out.marginal) / out.total : 0;
  out.pctFails = out.total ? (100 * out.fails) / out.total : 0;
  return out;
}

/**
 * Paint the margins into RGBA pixels, one pixel per cell (row-major, north up).
 * @returns {Uint8ClampedArray} length n*n*4
 */
export function coveragePixels(grid, margins) {
  const px = new Uint8ClampedArray(grid.n * grid.n * 4);
  for (let i = 0; i < grid.n * grid.n; i++) {
    const v = classifyMargin(margins[i]);
    if (!v) continue;
    px.set(CELL_COLORS[v], i * 4);
  }
  return px;
}
