/**
 * compute.js - the coverage computation itself: one full link analysis from
 * the transmitter to the centre of every grid cell. Environment-agnostic
 * (runs in the Web Worker in the browser and directly in Node tests).
 */
import { coverageGrid } from './grid.js';
import { terrainProfileSync } from '../elevation/profile.js';
import { analyzeLink } from '../physics/pathAnalysis.js';

/** Terrain sample spacing for coverage paths (m): the DEM grid is ~60 m. */
export const COVERAGE_STEP_M = 60;

/**
 * @param {import('../elevation/dem.js').Dem} dem
 * @param {object} p
 * @param {{lat:number, lon:number, h:number}} p.tx transmitter (h = antenna height above ground)
 * @param {number} p.radiusM
 * @param {number} [p.cellM]
 * @param {number} p.rxHeightM receiver antenna height above ground
 * @param {object} p.settings radio settings
 * @param {(done:number, total:number) => void} [onProgress]
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<{grid:object, margins:Float32Array}>} margins indexed by row*n+col, NaN outside the disc
 */
export async function computeCoverage(dem, { tx, radiusM, cellM, rxHeightM, settings, stepM = COVERAGE_STEP_M }, onProgress, isCancelled) {
  const grid = coverageGrid(tx, radiusM, cellM);
  await dem.ensureBox(grid.south, grid.west, grid.north, grid.east);
  const margins = new Float32Array(grid.n * grid.n).fill(NaN);
  const total = grid.cells.length;
  let lastReport = 0;
  for (let k = 0; k < total; k++) {
    const c = grid.cells[k];
    const prof = terrainProfileSync(dem, tx, c, stepM);
    const r = analyzeLink({
      distances: prof.distances,
      elevations: prof.elevations,
      antennaHeightA: tx.h,
      antennaHeightB: rxHeightM,
      settings,
      whatIf: false,
      geometry: false,
    });
    margins[c.index] = r.marginDb;
    if (onProgress && (k - lastReport >= 50 || k === total - 1)) {
      lastReport = k;
      onProgress(k + 1, total);
      // let the event loop breathe so cancel messages can arrive
      await new Promise((res) => setTimeout(res, 0));
      if (isCancelled?.()) throw new Error('cancelled');
    }
  }
  return { grid, margins };
}
