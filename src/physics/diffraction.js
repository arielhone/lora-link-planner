/**
 * diffraction.js - extra loss when terrain sticks into the radio path.
 *
 * When a hill blocks (or nearly blocks) the path, some energy still bends
 * ("diffracts") over the top, like sound you can hear around a corner.
 * We model each hill as a thin sharp blade: the "knife edge".
 *
 * Reference: ITU-R P.526-15 "Propagation by diffraction", sections 4.1 and 4.5.
 */
import { wavelength, earthBulge, K_FACTOR_STANDARD } from './propagation.js';

/**
 * Fresnel-Kirchhoff diffraction parameter nu (ITU-R P.526-15 eq. 26).
 *
 *   nu = h * sqrt( 2 * (d1 + d2) / (lambda * d1 * d2) )
 *
 * h is how far the top of the obstacle is ABOVE the straight line between
 * the antennas (negative when the line passes above the obstacle).
 * nu is basically "h measured in Fresnel-zone units" (times sqrt 2):
 *   nu = sqrt(2) * h / r1
 *
 * @param {number} h obstacle height above the line of sight (m), may be negative
 * @param {number} d1 distance from transmitter to obstacle (m)
 * @param {number} d2 distance from obstacle to receiver (m)
 * @param {number} freqMHz
 * @returns {number} nu (dimensionless)
 */
export function fresnelKirchhoffNu(h, d1, d2, freqMHz) {
  const lambda = wavelength(freqMHz);
  return h * Math.sqrt((2 * (d1 + d2)) / (lambda * d1 * d2));
}

/**
 * Knife-edge diffraction loss J(nu) in dB, ITU-R P.526-15 eq. (31):
 *
 *   J(nu) = 6.9 + 20*log10( sqrt((nu - 0.1)^2 + 1) + nu - 0.1 )
 *
 * valid for nu > -0.78; below that the loss is taken as 0.
 * Landmarks: nu = 0 (edge exactly touching the line) -> ~6 dB.
 *            nu = -0.78 (60% of first Fresnel zone clear) -> ~0 dB.
 *
 * @param {number} nu
 * @returns {number} loss in dB (>= 0)
 */
export function knifeEdgeLoss(nu) {
  if (nu <= -0.78) return 0;
  const x = nu - 0.1;
  return Math.max(0, 6.9 + 20 * Math.log10(Math.sqrt(x * x + 1) + x));
}

/**
 * Turn a terrain profile into heights relative to the line of sight.
 *
 * @param {number[]} distances distance of each sample from end A (m), ascending, first = 0
 * @param {number[]} elevations terrain height above sea level at each sample (m)
 * @param {number} heightA antenna A height above sea level (m)
 * @param {number} heightB antenna B height above sea level (m)
 * @param {number} [k=4/3]
 * @returns {{d:number, h:number}[]} for every sample: distance from A and
 *          the terrain height above (+) or below (-) the line of sight,
 *          including the earth bulge. The two end points are the antennas
 *          themselves, so their h is 0 (they sit on the line of sight).
 */
export function heightsAboveLos(distances, elevations, heightA, heightB, k = K_FACTOR_STANDARD) {
  const D = distances[distances.length - 1];
  const last = distances.length - 1;
  return distances.map((d, i) => {
    if (i === 0 || i === last) return { d, h: 0 };
    const los = heightA + ((heightB - heightA) * d) / D;
    const ground = elevations[i] + earthBulge(d, D - d, k);
    return { d, h: ground - los };
  });
}

/**
 * Single knife edge: find the one sample that sticks furthest into the path
 * (largest nu) and return its loss. Simple, and fine when there is one
 * dominant hill.
 *
 * @param {{d:number,h:number}[]} pts output of heightsAboveLos
 * @param {number} freqMHz
 * @returns {{loss:number, edges:{d:number,h:number,nu:number,loss:number}[]}}
 */
export function singleKnifeEdge(pts, freqMHz) {
  const main = findMainEdge(pts, 0, pts.length - 1, freqMHz);
  if (!main || main.nu <= -0.78) return { loss: 0, edges: [] };
  const loss = knifeEdgeLoss(main.nu);
  return { loss, edges: [{ ...main, loss }] };
}

/**
 * Find the interior sample between indices a and b (exclusive) with the
 * largest nu, measured against the straight line from sample a to sample b.
 * @private
 */
function findMainEdge(pts, a, b, freqMHz) {
  if (b - a < 2) return null;
  const A = pts[a];
  const B = pts[b];
  const span = B.d - A.d;
  let best = null;
  for (let i = a + 1; i < b; i++) {
    const p = pts[i];
    const d1 = p.d - A.d;
    const d2 = B.d - p.d;
    if (d1 <= 0 || d2 <= 0) continue;
    // height of p above the sub-path line A->B
    const line = A.h + ((B.h - A.h) * d1) / span;
    const h = p.h - line;
    const nu = fresnelKirchhoffNu(h, d1, d2, freqMHz);
    if (!best || nu > best.nu) best = { index: i, d: p.d, h, nu };
  }
  return best;
}

/**
 * Deygout method for several obstacles (ITU-R P.526-15 sec. 4.5.1 in its
 * classic form; also described in P.526 editions up to -12).
 *
 *  1. Find the "main" edge: the sample with the largest nu over the whole path.
 *  2. Its loss J(nu) is counted.
 *  3. Repeat the search on the two halves: transmitter -> main edge, and
 *     main edge -> receiver (as if the main edge were a new antenna).
 *  4. Add up all the losses.
 *
 * Recursion depth is limited (default 2 levels = main edge plus up to two
 * secondary edges, the classic Deygout "3 edge" form) because Deygout is known to
 * over-estimate the loss when there are many closely spaced edges.
 * Edges with nu <= -0.78 contribute nothing and stop the recursion.
 *
 * @param {{d:number,h:number}[]} pts output of heightsAboveLos
 * @param {number} freqMHz
 * @param {number} [maxDepth=2]
 * @returns {{loss:number, edges:{d:number,h:number,nu:number,loss:number,depth:number}[]}}
 */
export function deygout(pts, freqMHz, maxDepth = 2) {
  const edges = [];
  const recurse = (a, b, depth) => {
    if (depth > maxDepth) return 0;
    const main = findMainEdge(pts, a, b, freqMHz);
    if (!main || main.nu <= -0.78) return 0;
    const loss = knifeEdgeLoss(main.nu);
    edges.push({ ...main, loss, depth });
    return loss + recurse(a, main.index, depth + 1) + recurse(main.index, b, depth + 1);
  };
  const loss = recurse(0, pts.length - 1, 1);
  edges.sort((x, y) => x.d - y.d);
  return { loss, edges };
}
