/**
 * propagation.js - how a radio wave spreads out over distance.
 *
 * Pure functions, no DOM, no side effects. Every distance is in metres and
 * every frequency in MHz unless the parameter name says otherwise.
 * See docs/LEARN.md for the plain-language story behind each formula.
 */

/** Speed of light in vacuum (m/s). */
export const SPEED_OF_LIGHT = 299_792_458;

/** Mean radius of the Earth (m), as used by ITU-R P.452 / P.526. */
export const EARTH_RADIUS_M = 6_371_000;

/** Standard "effective earth radius" factor for a normal atmosphere. */
export const K_FACTOR_STANDARD = 4 / 3;

/**
 * Wavelength of a radio wave.
 *
 *   lambda = c / f
 *
 * At 917 MHz this is about 0.327 m (a third of a metre).
 *
 * @param {number} freqMHz frequency in MHz
 * @returns {number} wavelength in metres
 */
export function wavelength(freqMHz) {
  return SPEED_OF_LIGHT / (freqMHz * 1e6);
}

/**
 * Free-space path loss (FSPL): how much weaker the signal gets just because
 * its energy spreads over a bigger and bigger sphere as it travels.
 * No hills, no buildings, just empty space.
 *
 *   FSPL(dB) = 20*log10(4*pi*d / lambda)
 *            = 20*log10(d_km) + 20*log10(f_MHz) + 32.45
 *
 * Doubling the distance adds 6 dB of loss (the power drops to 1/4).
 *
 * Reference: ITU-R P.525-4, eq. (4).
 *
 * @param {number} distanceM distance between the antennas (m), > 0
 * @param {number} freqMHz frequency (MHz)
 * @returns {number} loss in dB (positive number)
 */
export function freeSpacePathLoss(distanceM, freqMHz) {
  if (!(distanceM > 0)) return 0;
  const lambda = wavelength(freqMHz);
  return 20 * Math.log10((4 * Math.PI * distanceM) / lambda);
}

/**
 * Radius of the n-th Fresnel zone at a point along the path.
 *
 * The first Fresnel zone is a long "rugby ball" (ellipsoid) around the
 * straight line between the antennas. Most of the energy that reaches the
 * receiver travels inside it, so it must be mostly clear of obstacles -
 * a clear straight line is not enough.
 *
 *   r_n = sqrt( n * lambda * d1 * d2 / (d1 + d2) )
 *
 * where d1, d2 are the distances from the point to each end.
 * The ball is fattest in the middle of the path.
 *
 * Reference: ITU-R P.530-18 eq. (2) / P.526-15 section 2.
 *
 * @param {number} d1 distance from transmitter (m)
 * @param {number} d2 distance from receiver (m)
 * @param {number} freqMHz frequency (MHz)
 * @param {number} [n=1] zone number
 * @returns {number} radius in metres (0 at the end points)
 */
export function fresnelRadius(d1, d2, freqMHz, n = 1) {
  if (d1 <= 0 || d2 <= 0) return 0;
  return Math.sqrt((n * wavelength(freqMHz) * d1 * d2) / (d1 + d2));
}

/**
 * Effective earth radius: the atmosphere bends radio waves slightly
 * downwards, so they follow the Earth's curve a little. We pretend the
 * waves travel straight and instead make the Earth bigger (flatter) by k.
 *
 *   R_eff = k * R      (k = 4/3 for a "standard" atmosphere)
 *
 * Reference: ITU-R P.453 / P.834, k = 4/3 median value.
 *
 * @param {number} [k=4/3]
 * @returns {number} effective radius in metres
 */
export function effectiveEarthRadius(k = K_FACTOR_STANDARD) {
  return k * EARTH_RADIUS_M;
}

/**
 * Earth bulge: how much the ground at a point is pushed *up* into the
 * radio path because the Earth is round.
 *
 *   h = d1 * d2 / (2 * k * R)
 *
 * Over a 10 km path the middle is lifted by ~1.5 m; over 50 km by ~37 m.
 * We add this to every terrain sample so we can then treat the line of
 * sight as a straight line.
 *
 * Reference: ITU-R P.526-15 eq. (1) (the "b" term in the profile).
 *
 * @param {number} d1 distance from one end (m)
 * @param {number} d2 distance from the other end (m)
 * @param {number} [k=4/3] effective earth radius factor
 * @returns {number} bulge height in metres
 */
export function earthBulge(d1, d2, k = K_FACTOR_STANDARD) {
  return (d1 * d2) / (2 * effectiveEarthRadius(k));
}

/**
 * Radio horizon distance for an antenna at height h over smooth earth.
 *
 *   d = sqrt(2 * k * R * h)
 *
 * @param {number} heightM antenna height above the surrounding ground (m)
 * @param {number} [k=4/3]
 * @returns {number} distance to the horizon (m)
 */
export function radioHorizon(heightM, k = K_FACTOR_STANDARD) {
  return Math.sqrt(2 * effectiveEarthRadius(k) * Math.max(0, heightM));
}
