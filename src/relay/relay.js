/**
 * relay.js - when A cannot reach B directly, find a spot C in between that
 * can hear both (A -> C -> B). A relay on a hilltop "sees over" the hill
 * that blocks the direct path.
 *
 * Search strategy (fast enough to run in a fraction of a second):
 *  1. Consider points inside an ellipse with foci A and B: a relay far off
 *     to the side only makes both hops longer.
 *  2. Prefer high ground: sample the ellipse on a grid and keep the highest
 *     points, spread out so they are not all on one summit.
 *  3. For each candidate, run the full link analysis for both hops.
 *  4. Score = the WEAKER of the two hop margins (a chain is as strong as its
 *     weakest link). Ties are broken by ground height.
 *  5. Return the 3 best candidates that are well apart from each other.
 */
import { distance, interpolate } from '../elevation/geo.js';
import { terrainProfileSync, DEFAULT_STEP_M } from '../elevation/profile.js';
import { analyzeLink } from '../physics/pathAnalysis.js';
import { M_PER_DEG_LAT } from '../coverage/grid.js';

export const DEFAULT_RELAY_HEIGHT_M = 5;

/**
 * Candidate points inside the A-B ellipse, highest first and spread apart.
 * @param {(lat:number, lon:number) => number} elevationAt
 * @returns {{lat:number, lon:number, ground:number}[]}
 */
export function relayCandidates(a, b, elevationAt, { maxCandidates = 150, gridCells = 70, detour = 1.5, minDetourM = 6000 } = {}) {
  const D = distance(a, b);
  const sumMax = Math.max(D * detour, D + minDetourM); // |AC| + |CB| <= sumMax
  const mid = interpolate(a, b, 0.5);
  const semi = sumMax / 2;
  const cellM = Math.max(100, (2 * semi) / gridCells);
  const dLat = cellM / M_PER_DEG_LAT;
  const dLon = cellM / (M_PER_DEG_LAT * Math.cos((mid.lat * Math.PI) / 180));
  const half = Math.ceil(semi / cellM);
  const pts = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const p = { lat: mid.lat + i * dLat, lon: mid.lon + j * dLon };
      const da = distance(a, p);
      const db = distance(p, b);
      if (da + db > sumMax || da < cellM || db < cellM) continue;
      pts.push({ ...p, ground: elevationAt(p.lat, p.lon) });
    }
  }
  pts.sort((p, q) => q.ground - p.ground);
  const spacing = cellM * 2.5;
  const chosen = [];
  for (const p of pts) {
    if (chosen.length >= maxCandidates) break;
    if (chosen.some((c) => distance(c, p) < spacing)) continue;
    chosen.push(p);
  }
  return chosen;
}

/**
 * Score candidates and return the best relay sites.
 * The DEM tiles covering the search area must already be loaded.
 *
 * @param {import('../elevation/dem.js').Dem} dem
 * @param {object} p
 * @param {{lat:number, lon:number, h:number}} p.a
 * @param {{lat:number, lon:number, h:number}} p.b
 * @param {object} p.settings
 * @param {number} [p.relayHeightM=5]
 * @param {number} [p.top=3]
 * @returns {{candidates: object[], searched: number, found: boolean}}
 */
export function findRelays(dem, { a, b, settings, relayHeightM = DEFAULT_RELAY_HEIGHT_M, top = 3, stepM = DEFAULT_STEP_M * 2 }) {
  const D = distance(a, b);
  const cands = relayCandidates(a, b, (lat, lon) => dem.elevationAt(lat, lon));
  const hop = (from, fromH, to, toH) => {
    const prof = terrainProfileSync(dem, from, to, stepM);
    const r = analyzeLink({ distances: prof.distances, elevations: prof.elevations, antennaHeightA: fromH, antennaHeightB: toH, settings, whatIf: false, geometry: false });
    return { marginDb: r.marginDb, verdict: r.verdict, distanceM: r.distanceM, obstructionLossDb: r.obstructionLossDb };
  };
  const scored = cands.map((c) => {
    const hop1 = hop(a, a.h, c, relayHeightM);
    const hop2 = hop(c, relayHeightM, b, b.h);
    return { lat: c.lat, lon: c.lon, ground: c.ground, h: relayHeightM, hop1, hop2, minMarginDb: Math.min(hop1.marginDb, hop2.marginDb) };
  });
  scored.sort((p, q) => q.minMarginDb - p.minMarginDb || q.ground - p.ground);
  const spread = Math.max(1000, D / 8);
  const best = [];
  for (const c of scored) {
    if (best.length >= top) break;
    if (best.some((x) => distance(x, c) < spread)) continue;
    best.push(c);
  }
  return { candidates: best, searched: scored.length, found: best.length > 0 && best[0].minMarginDb >= 0 };
}

/** Bounding box (south, west, north, east) of the relay search area. */
export function relaySearchBox(a, b, { detour = 1.5, minDetourM = 6000 } = {}) {
  const D = distance(a, b);
  const semi = Math.max(D * detour, D + minDetourM) / 2;
  const mid = interpolate(a, b, 0.5);
  const dLat = semi / M_PER_DEG_LAT;
  const dLon = semi / (M_PER_DEG_LAT * Math.cos((mid.lat * Math.PI) / 180));
  return { south: mid.lat - dLat, west: mid.lon - dLon, north: mid.lat + dLat, east: mid.lon + dLon };
}
