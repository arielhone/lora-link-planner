/**
 * clutter.js - extra loss from the "stuff" near the antennas: buildings,
 * trees, walls, parked cars. The terrain model only sees hills (and, roughly,
 * big buildings in the 60 m surface model); clutter loss covers the rest.
 *
 * The planner offers three presets plus a custom value (e.g. from Field-mode
 * calibration). See DECISIONS.md section 7 for how the defaults were chosen.
 */

/** Default extra loss per environment (dB), applied once per link. */
export const ENVIRONMENT_LOSS_DB = {
  open: 0, // fields, desert, sea, hilltop to hilltop
  suburban: 10, // houses and gardens, low-rise towns, light woodland
  urban: 20, // city streets, devices at street level between buildings
};

export const ENVIRONMENTS = ['open', 'suburban', 'urban', 'custom'];

/**
 * Extra clutter loss for the given settings.
 * @param {{environment?: string, clutterLossDb?: number}} s
 * @returns {number} dB (>= 0)
 */
export function clutterLoss(s) {
  if (s.environment === 'custom') return Math.max(0, Number(s.clutterLossDb) || 0);
  return ENVIRONMENT_LOSS_DB[s.environment] ?? 0;
}

/**
 * Inverse of the complementary standard normal distribution, Q^-1(p).
 * Abramowitz & Stegun 26.2.23 (|error| < 4.5e-4), as used by ITU-R P.2108.
 * @param {number} p probability, 0 < p < 1
 */
export function inverseQ(p) {
  if (p <= 0 || p >= 1) throw new RangeError('p must be in (0, 1)');
  const q = p > 0.5 ? 1 - p : p;
  const t = Math.sqrt(-2 * Math.log(q));
  const x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return p > 0.5 ? -x : x;
}

/**
 * ITU-R P.2108-1 section 3.2: statistical clutter loss for a terrestrial
 * path with one end inside urban/suburban clutter (the reference used to
 * choose the presets above).
 *
 *   Ll   = 23.5 + 9.6 log10(f)
 *   Ls   = 32.98 + 23.9 log10(d) + 3 log10(f)
 *   L    = -5 log10( 10^(-0.2 Ll) + 10^(-0.2 Ls) ) - 6 Q^-1(p/100)
 *
 * @param {number} freqGHz 0.5 .. 67 GHz
 * @param {number} distanceKm path length, >= 0.25 km
 * @param {number} [percent=50] percentage of locations not exceeded
 * @returns {number} clutter loss in dB
 */
export function p2108TerrestrialClutterLoss(freqGHz, distanceKm, percent = 50) {
  const ll = 23.5 + 9.6 * Math.log10(freqGHz);
  const ls = 32.98 + 23.9 * Math.log10(distanceKm) + 3 * Math.log10(freqGHz);
  return -5 * Math.log10(10 ** (-0.2 * ll) + 10 ** (-0.2 * ls)) - 6 * inverseQ(percent / 100);
}
