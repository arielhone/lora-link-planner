/**
 * pathAnalysis.js - put all the physics together for one terrain profile.
 *
 * Input: a list of terrain samples between point A and point B plus the radio
 * settings. Output: everything the app shows - losses, verdict, Fresnel
 * clearance, and "what if" suggestions.
 *
 * Still pure: no DOM, no network. The elevation profile is computed elsewhere
 * (src/elevation/profile.js) and passed in as plain arrays.
 */
import { freeSpacePathLoss, fresnelRadius, earthBulge, K_FACTOR_STANDARD } from './propagation.js';
import { heightsAboveLos, deygout, singleKnifeEdge } from './diffraction.js';
import { sensitivity, noiseFloor, timeOnAir, SPREADING_FACTORS } from './lora.js';
import { linkBudget } from './linkBudget.js';
import { checkCompliance } from './regulations.js';

/** Default radio settings (Israel, Heltec V3 class hardware). */
export const DEFAULT_SETTINGS = {
  freqMHz: 917.3,
  txPowerDbm: 14,
  txGainDbi: 0,
  rxGainDbi: 0,
  txCableLossDb: 0,
  rxCableLossDb: 0,
  sf: 9,
  bandwidthKHz: 125,
  codingRate: 1,
  payloadBytes: 20,
  chip: 'sx1262',
  kFactor: K_FACTOR_STANDARD,
  diffraction: 'deygout', // 'deygout' | 'single' | 'none'
};

/** Fraction of the first Fresnel zone that should be clear of obstacles. */
export const FRESNEL_CLEARANCE_TARGET = 0.6;

/**
 * Geometry of the path: line of sight, Fresnel zone and clearance at every sample.
 *
 * @param {number[]} distances metres from A (first 0, last = total length)
 * @param {number[]} elevations ground height above sea level (m)
 * @param {number} heightA antenna A above sea level (m)
 * @param {number} heightB antenna B above sea level (m)
 * @param {number} freqMHz
 * @param {number} [k=4/3]
 */
export function pathGeometry(distances, elevations, heightA, heightB, freqMHz, k = K_FACTOR_STANDARD) {
  const D = distances[distances.length - 1];
  const points = distances.map((d, i) => {
    const bulge = earthBulge(d, D - d, k);
    const terrain = elevations[i] + bulge; // ground as "seen" from a straight line
    const los = heightA + ((heightB - heightA) * d) / D;
    const r1 = fresnelRadius(d, D - d, freqMHz);
    const clearance = los - terrain; // + = line passes above the ground
    return {
      d,
      ground: elevations[i],
      bulge,
      terrain,
      los,
      r1,
      clearance,
      // clearance as a fraction of the Fresnel radius (Infinity at the ends)
      fresnelFraction: r1 > 0 ? clearance / r1 : Infinity,
      blocksLos: i > 0 && i < distances.length - 1 && clearance < 0,
      inFresnel: i > 0 && i < distances.length - 1 && clearance < FRESNEL_CLEARANCE_TARGET * r1,
    };
  });
  const interior = points.slice(1, -1);
  const worst = interior.reduce((w, p) => (w === null || p.fresnelFraction < w.fresnelFraction ? p : w), null);
  return {
    points,
    lineOfSight: interior.every((p) => p.clearance >= 0),
    minFresnelFraction: worst ? worst.fresnelFraction : Infinity,
    worstPoint: worst,
  };
}

/**
 * Smallest extra height (m) to add to the antennas so that at least
 * `target` (default 60%) of the first Fresnel zone is clear everywhere.
 *
 * mode: 'both' raises both antennas by the same amount,
 *       'a' raises only antenna A, 'b' only antenna B.
 *
 * Clearance only ever improves when an antenna goes up, so a simple
 * bisection search finds the answer.
 *
 * @returns {number|null} extra metres (0 if already clear), null if more than maxM would be needed
 */
export function requiredExtraHeight(distances, elevations, heightA, heightB, freqMHz, k, mode = 'both', target = FRESNEL_CLEARANCE_TARGET, maxM = 2000) {
  const ok = (x) => {
    const ha = heightA + (mode === 'b' ? 0 : x);
    const hb = heightB + (mode === 'a' ? 0 : x);
    return pathGeometry(distances, elevations, ha, hb, freqMHz, k).minFresnelFraction >= target;
  };
  if (ok(0)) return 0;
  if (!ok(maxM)) return null;
  let lo = 0;
  let hi = maxM;
  while (hi - lo > 0.1) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 10) / 10;
}

/**
 * Analyse a link end to end.
 *
 * @param {object} p
 * @param {number[]} p.distances metres from A
 * @param {number[]} p.elevations ground elevation (m ASL)
 * @param {number} p.antennaHeightA antenna A above ground (m)
 * @param {number} p.antennaHeightB antenna B above ground (m)
 * @param {object} [p.settings] radio settings, see DEFAULT_SETTINGS
 */
export function analyzeLink({ distances, elevations, antennaHeightA, antennaHeightB, settings = {} }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const D = distances[distances.length - 1];
  const heightA = elevations[0] + antennaHeightA;
  const heightB = elevations[elevations.length - 1] + antennaHeightB;

  const geometry = pathGeometry(distances, elevations, heightA, heightB, s.freqMHz, s.kFactor);

  const pts = heightsAboveLos(distances, elevations, heightA, heightB, s.kFactor);
  let diffraction = { loss: 0, edges: [] };
  if (s.diffraction === 'deygout') diffraction = deygout(pts, s.freqMHz);
  else if (s.diffraction === 'single') diffraction = singleKnifeEdge(pts, s.freqMHz);

  const pathLossDb = freeSpacePathLoss(D, s.freqMHz);
  const common = {
    txPowerDbm: s.txPowerDbm,
    txGainDbi: s.txGainDbi,
    rxGainDbi: s.rxGainDbi,
    txCableLossDb: s.txCableLossDb,
    rxCableLossDb: s.rxCableLossDb,
    pathLossDb,
    obstructionLossDb: diffraction.loss,
  };
  const budgetFor = (sf, bw) =>
    linkBudget({
      ...common,
      sensitivityDbm: sensitivity(sf, bw, s.chip),
      noiseFloorDbm: noiseFloor(bw),
    });

  const budget = budgetFor(s.sf, s.bandwidthKHz);
  const toa = (sf) =>
    timeOnAir({ sf, bandwidthKHz: s.bandwidthKHz, payloadBytes: s.payloadBytes, codingRate: s.codingRate });

  // "What if" #1: every SF at the current bandwidth.
  const sfTable = SPREADING_FACTORS.map((sf) => {
    const b = budgetFor(sf, s.bandwidthKHz);
    return { sf, sensitivityDbm: sensitivity(sf, s.bandwidthKHz, s.chip), marginDb: b.marginDb, verdict: b.verdict, timeOnAirS: toa(sf) };
  });
  const firstWorkingSf = sfTable.find((r) => r.verdict === 'works')?.sf ?? null;
  const firstMarginalSf = sfTable.find((r) => r.marginDb >= 0)?.sf ?? null;

  // "What if" #2: antenna heights for 60% Fresnel clearance.
  const req = (mode) =>
    requiredExtraHeight(distances, elevations, heightA, heightB, s.freqMHz, s.kFactor, mode);
  const extraBoth = req('both');
  const extraA = req('a');
  const extraB = req('b');

  return {
    settings: s,
    distanceM: D,
    heightA,
    heightB,
    geometry,
    pathLossDb,
    obstructionLossDb: diffraction.loss,
    diffractionEdges: diffraction.edges,
    sensitivityDbm: sensitivity(s.sf, s.bandwidthKHz, s.chip),
    noiseFloorDbm: noiseFloor(s.bandwidthKHz),
    ...budget,
    timeOnAirS: toa(s.sf),
    compliance: checkCompliance({ freqMHz: s.freqMHz, eirpDbm: budget.eirpDbm }),
    whatIf: {
      sfTable,
      firstWorkingSf,
      firstMarginalSf,
      extraHeightBothM: extraBoth,
      antennaHeightForAOnlyM: extraA === null ? null : antennaHeightA + extraA,
      antennaHeightForBOnlyM: extraB === null ? null : antennaHeightB + extraB,
      antennaHeightBothA: extraBoth === null ? null : antennaHeightA + extraBoth,
      antennaHeightBothB: extraBoth === null ? null : antennaHeightB + extraBoth,
    },
  };
}

