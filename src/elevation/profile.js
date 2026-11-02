/**
 * profile.js - the terrain "slice" between two points.
 *
 * Walk along the great circle from A to B in small steps (default 30 m) and
 * read the ground height at each step. The result feeds the physics
 * (src/physics/pathAnalysis.js) and the profile chart.
 */
import { distance, interpolate } from './geo.js';

/** Default spacing between samples (m). */
export const DEFAULT_STEP_M = 30;

/** Never take more samples than this (keeps very long paths fast). */
export const MAX_SAMPLES = 4000;

/**
 * Evenly spaced points from a to b, spacing <= stepM (but at most maxSamples).
 * @returns {{lat:number, lon:number, d:number}[]}
 */
export function pathPoints(a, b, stepM = DEFAULT_STEP_M, maxSamples = MAX_SAMPLES) {
  const D = distance(a, b);
  const n = Math.min(maxSamples - 1, Math.max(1, Math.ceil(D / stepM)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    pts.push({ ...interpolate(a, b, f), d: f * D });
  }
  return pts;
}

/**
 * Sample the terrain between a and b.
 * @param {import('./dem.js').Dem} dem
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @param {number} [stepM=30]
 * @returns {Promise<{distances:number[], elevations:number[], points:{lat:number,lon:number,d:number}[]}>}
 */
export async function terrainProfile(dem, a, b, stepM = DEFAULT_STEP_M) {
  const points = pathPoints(a, b, stepM);
  await dem.ensure(points);
  return terrainProfileSync(dem, a, b, stepM, points);
}

/**
 * Same as terrainProfile, but synchronous: every tile on the path must
 * already be loaded (e.g. with dem.ensureBox). Used by bulk jobs.
 */
export function terrainProfileSync(dem, a, b, stepM = DEFAULT_STEP_M, points = pathPoints(a, b, stepM)) {
  return {
    points,
    distances: points.map((p) => p.d),
    elevations: points.map((p) => dem.elevationAt(p.lat, p.lon)),
  };
}
