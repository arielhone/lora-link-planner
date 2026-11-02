// Unit tests for the physics core. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wavelength,
  freeSpacePathLoss,
  fresnelRadius,
  earthBulge,
  effectiveEarthRadius,
  radioHorizon,
  fresnelKirchhoffNu,
  knifeEdgeLoss,
  heightsAboveLos,
  singleKnifeEdge,
  deygout,
  sensitivity,
  noiseFloor,
  timeOnAir,
  symbolTime,
  lowDataRateOptimize,
  bitRate,
  REQUIRED_SNR_DB,
  linkBudget,
  verdict,
  eirp,
  checkCompliance,
  ISRAEL_REGULATION,
  analyzeLink,
  pathGeometry,
  requiredExtraHeight,
} from '../src/physics/index.js';

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ±${tol}, got ${actual}`);

// ---------------------------------------------------------------- propagation
test('wavelength at 917.3 MHz is ~0.327 m', () => {
  close(wavelength(917.3), 0.32682, 1e-4);
});

test('FSPL matches ITU-R P.525 reference values', () => {
  // 1 km at 1 GHz: 92.45 dB (20log(1)+20log(1000)+32.45)
  close(freeSpacePathLoss(1000, 1000), 92.45, 0.01);
  // 1 km at 915 MHz: 91.68 dB
  close(freeSpacePathLoss(1000, 915), 91.68, 0.02);
  // 10 km at 868 MHz: 111.21 dB
  close(freeSpacePathLoss(10_000, 868), 111.22, 0.02);
});

test('FSPL grows 6 dB per doubling of distance and is 0 for d=0', () => {
  close(freeSpacePathLoss(2000, 917) - freeSpacePathLoss(1000, 917), 6.02, 0.01);
  assert.equal(freeSpacePathLoss(0, 917), 0);
});

test('first Fresnel radius matches the 17.32*sqrt(d1 d2 / (f D)) rule of thumb', () => {
  // 10 km path at 1 GHz, midpoint: 17.32 * sqrt(5*5/(1*10)) = 27.39 m
  close(fresnelRadius(5000, 5000, 1000), 27.39, 0.02);
  // 2 km path at 917 MHz, 500 m from one end: 17.32*sqrt(0.5*1.5/(0.917*2))
  close(fresnelRadius(500, 1500, 917), 17.32 * Math.sqrt((0.5 * 1.5) / (0.917 * 2)), 0.02);
  // zero at the ends, larger for the 2nd zone by sqrt(2)
  assert.equal(fresnelRadius(0, 1000, 917), 0);
  close(fresnelRadius(500, 500, 917, 2) / fresnelRadius(500, 500, 917, 1), Math.SQRT2, 1e-9);
});

test('effective earth radius with k=4/3 is ~8495 km', () => {
  close(effectiveEarthRadius(), 8_494_667, 1);
});

test('earth bulge reference values (k=4/3)', () => {
  close(earthBulge(5000, 5000), 1.4716, 1e-3); // 10 km path, middle
  close(earthBulge(25_000, 25_000), 36.79, 0.01); // 50 km path, middle
  close(earthBulge(5000, 5000, 1), 1.962, 1e-3); // true earth
  assert.equal(earthBulge(0, 10_000), 0);
});

test('radio horizon of a 10 m mast is ~13 km', () => {
  close(radioHorizon(10) / 1000, 13.03, 0.01);
});

// ---------------------------------------------------------------- diffraction
test('knife-edge J(nu) matches ITU-R P.526 figure 9 landmarks', () => {
  close(knifeEdgeLoss(0), 6.03, 0.01); // grazing: ~6 dB
  close(knifeEdgeLoss(-0.78), 0, 1e-9);
  close(knifeEdgeLoss(-0.7), 0.3, 0.3); // just above the cutoff - tiny loss
  close(knifeEdgeLoss(1), 13.93, 0.02);
  close(knifeEdgeLoss(2.4), 20.5, 0.15); // Lee: 13 + 20log(2.4) = 20.6
  close(knifeEdgeLoss(10), 13 + 20 * Math.log10(10), 0.2); // large-nu asymptote
  assert.equal(knifeEdgeLoss(-2), 0);
});

test('nu equals sqrt(2) * h / r1', () => {
  const nu = fresnelKirchhoffNu(10, 5000, 5000, 1000);
  close(nu, 0.5166, 1e-3);
  close(nu, (Math.SQRT2 * 10) / fresnelRadius(5000, 5000, 1000), 1e-9);
});

test('heightsAboveLos includes the earth bulge', () => {
  const pts = heightsAboveLos([0, 5000, 10_000], [0, 0, 0], 10, 10);
  close(pts[1].h, -10 + 1.4716, 1e-3);
});

test('Deygout: flat, clear path has no loss', () => {
  const d = Array.from({ length: 101 }, (_, i) => i * 100);
  const e = d.map(() => 0);
  const pts = heightsAboveLos(d, e, 50, 50);
  assert.equal(deygout(pts, 917).loss, 0);
  assert.equal(singleKnifeEdge(pts, 917).loss, 0);
});

test('Deygout: one obstacle grazing the line of sight gives ~6 dB', () => {
  const d = [0, 5000, 10_000];
  // obstacle height chosen so that terrain + bulge exactly touches the LOS (100 m)
  const e = [0, 100 - earthBulge(5000, 5000), 0];
  const pts = heightsAboveLos(d, e, 100, 100);
  close(deygout(pts, 917).loss, 6.03, 0.01);
  close(singleKnifeEdge(pts, 917).loss, 6.03, 0.01);
});

test('Deygout: two hills cost more than the single main edge', () => {
  const d = Array.from({ length: 11 }, (_, i) => i * 1000);
  const e = d.map(() => 0);
  e[3] = 60;
  e[7] = 60;
  const pts = heightsAboveLos(d, e, 50, 50);
  const single = singleKnifeEdge(pts, 917);
  const multi = deygout(pts, 917);
  assert.ok(single.loss > 6, `single ${single.loss}`);
  assert.ok(multi.loss > single.loss, `deygout ${multi.loss} > single ${single.loss}`);
  assert.equal(multi.edges.length, 2);
});

// ---------------------------------------------------------------- LoRa
test('required SNR steps by 2.5 dB per SF', () => {
  assert.equal(REQUIRED_SNR_DB[7], -7.5);
  assert.equal(REQUIRED_SNR_DB[12], -20);
});

test('noise floor at 125 kHz, NF 6 dB is ~ -117 dBm', () => {
  close(noiseFloor(125), -117.03, 0.01);
});

test('SX1262 (formula) sensitivity', () => {
  close(sensitivity(7, 125), -124.53, 0.01);
  close(sensitivity(12, 125), -137.03, 0.01); // datasheet: -137 dBm
  close(sensitivity(12, 500), -131.01, 0.01);
  // each SF step buys 2.5 dB, each bandwidth doubling costs 3 dB
  close(sensitivity(10, 125) - sensitivity(9, 125), -2.5, 1e-9);
  close(sensitivity(9, 250) - sensitivity(9, 125), 3.01, 0.01);
});

test('SX1276 datasheet sensitivity table', () => {
  assert.equal(sensitivity(7, 125, 'sx1276'), -123);
  assert.equal(sensitivity(12, 125, 'sx1276'), -136);
  assert.equal(sensitivity(12, 500, 'sx1276'), -130);
  assert.throws(() => sensitivity(13, 125));
});

test('symbol time and low data rate optimisation', () => {
  close(symbolTime(7, 125), 0.001024, 1e-9);
  close(symbolTime(12, 125), 0.032768, 1e-9);
  assert.equal(lowDataRateOptimize(10, 125), false);
  assert.equal(lowDataRateOptimize(11, 125), true);
  assert.equal(lowDataRateOptimize(12, 250), true);
  assert.equal(lowDataRateOptimize(12, 500), false);
});

test('time on air matches Semtech calculator', () => {
  // SF7, 125 kHz, CR 4/5, 8 preamble, explicit header, CRC, 10 bytes: 41.216 ms
  close(timeOnAir({ sf: 7, bandwidthKHz: 125, payloadBytes: 10 }) * 1000, 41.216, 1e-3);
  // SF12, 125 kHz, same: 991.232 ms (LDRO on)
  close(timeOnAir({ sf: 12, bandwidthKHz: 125, payloadBytes: 10 }) * 1000, 991.232, 1e-3);
  // SF9, 125 kHz, 20 bytes: 185.344 ms
  close(timeOnAir({ sf: 9, bandwidthKHz: 125, payloadBytes: 20 }) * 1000, 185.344, 1e-3);
  // SF10, 500 kHz, 51 bytes, CR 4/8
  close(timeOnAir({ sf: 10, bandwidthKHz: 500, payloadBytes: 51, codingRate: 4 }) * 1000, 221.696, 1e-3);
});

test('bit rate of SF7/125 is ~5.47 kbps', () => {
  close(bitRate(7, 125), 5468.75, 0.01);
});

// ---------------------------------------------------------------- link budget
test('link budget accounting', () => {
  const b = linkBudget({
    txPowerDbm: 14,
    txGainDbi: 2,
    rxGainDbi: 3,
    txCableLossDb: 1,
    rxCableLossDb: 0.5,
    pathLossDb: 120,
    obstructionLossDb: 6,
    sensitivityDbm: -130,
    noiseFloorDbm: -117,
  });
  assert.equal(b.eirpDbm, 15);
  assert.equal(b.rxPowerDbm, 15 - 120 - 6 + 3 - 0.5);
  close(b.marginDb, -108.5 + 130, 1e-9);
  close(b.snrDb, -108.5 + 117, 1e-9);
  assert.equal(b.verdict, 'works');
  assert.equal(b.lines.reduce((a, l) => a + l.value, 0), b.rxPowerDbm);
});

test('verdict thresholds', () => {
  assert.equal(verdict(10), 'works');
  assert.equal(verdict(9.9), 'marginal');
  assert.equal(verdict(0), 'marginal');
  assert.equal(verdict(-0.1), 'fails');
  assert.equal(eirp(14, 3, 1), 16);
});

test('Israeli compliance check', () => {
  assert.deepEqual(checkCompliance({ freqMHz: 917.3, eirpDbm: 14 }), []);
  assert.equal(checkCompliance({ freqMHz: 868.1, eirpDbm: 14 }).length, 1);
  assert.equal(checkCompliance({ freqMHz: 917.3, eirpDbm: 20 }).length, 1);
  assert.equal(ISRAEL_REGULATION.maxEirpDbm, 14);
});

// ---------------------------------------------------------------- path analysis
const flat = (n, step, h = 0) => ({
  distances: Array.from({ length: n }, (_, i) => i * step),
  elevations: Array.from({ length: n }, () => h),
});

test('analyzeLink: short flat link with high masts works', () => {
  const { distances, elevations } = flat(101, 20); // 2 km
  const r = analyzeLink({ distances, elevations, antennaHeightA: 30, antennaHeightB: 30 });
  assert.equal(r.obstructionLossDb, 0);
  close(r.pathLossDb, freeSpacePathLoss(2000, 917.3), 1e-9);
  assert.equal(r.verdict, 'works');
  assert.equal(r.geometry.lineOfSight, true);
  assert.equal(r.whatIf.extraHeightBothM, 0);
  assert.equal(r.whatIf.firstWorkingSf, 7);
  assert.equal(r.whatIf.sfTable.length, 6);
});

test('analyzeLink: a hill in the middle blocks the path', () => {
  const { distances, elevations } = flat(201, 50); // 10 km
  for (let i = 90; i <= 110; i++) elevations[i] = 150; // 150 m ridge
  const r = analyzeLink({ distances, elevations, antennaHeightA: 2, antennaHeightB: 2 });
  assert.equal(r.geometry.lineOfSight, false);
  assert.ok(r.obstructionLossDb > 20, `loss ${r.obstructionLossDb}`);
  assert.ok(r.geometry.points.some((p) => p.blocksLos));
  // to clear 60% of F1 over a 150 m ridge both masts must exceed ~150 m
  assert.ok(r.whatIf.extraHeightBothM > 148, `extra ${r.whatIf.extraHeightBothM}`);
  // and with those heights the geometry is indeed clear
  const g = pathGeometry(distances, elevations, r.whatIf.antennaHeightBothA, r.whatIf.antennaHeightBothB, 917.3);
  assert.ok(g.minFresnelFraction >= 0.6);
});

test('requiredExtraHeight: only raising one end needs more height than both', () => {
  const { distances, elevations } = flat(101, 100); // 10 km
  elevations[50] = 20;
  const both = requiredExtraHeight(distances, elevations, 5, 5, 917.3, 4 / 3, 'both');
  const onlyA = requiredExtraHeight(distances, elevations, 5, 5, 917.3, 4 / 3, 'a');
  assert.ok(both > 0 && onlyA > both, `${both} ${onlyA}`);
});

// ---------------------------------------------------------------- clutter
import { clutterLoss, ENVIRONMENT_LOSS_DB, inverseQ, p2108TerrestrialClutterLoss } from '../src/physics/index.js';

test('environment presets and custom clutter loss', () => {
  assert.equal(clutterLoss({ environment: 'open' }), 0);
  assert.equal(clutterLoss({ environment: 'suburban' }), ENVIRONMENT_LOSS_DB.suburban);
  assert.equal(clutterLoss({ environment: 'urban' }), 20);
  assert.equal(clutterLoss({ environment: 'custom', clutterLossDb: 7.5 }), 7.5);
  assert.equal(clutterLoss({ environment: 'custom', clutterLossDb: -3 }), 0);
  assert.equal(clutterLoss({}), 0);
});

test('inverse Q function', () => {
  close(inverseQ(0.5), 0, 1e-3);
  close(inverseQ(0.1), 1.2816, 1e-3);
  close(inverseQ(0.9), -1.2816, 1e-3);
});

test('ITU-R P.2108 terrestrial clutter loss: ~23 dB median at 917 MHz, saturates with distance', () => {
  close(p2108TerrestrialClutterLoss(0.917, 5), 23.1, 0.1);
  close(p2108TerrestrialClutterLoss(0.917, 20), 23.1, 0.1);
  assert.ok(p2108TerrestrialClutterLoss(0.917, 0.25) < 23);
  assert.ok(p2108TerrestrialClutterLoss(0.917, 5, 90) > p2108TerrestrialClutterLoss(0.917, 5, 50));
});

test('analyzeLink applies the environment loss and can skip what-if', () => {
  const distances = Array.from({ length: 51 }, (_, i) => i * 40);
  const elevations = distances.map(() => 0);
  const open = analyzeLink({ distances, elevations, antennaHeightA: 20, antennaHeightB: 20 });
  const urban = analyzeLink({ distances, elevations, antennaHeightA: 20, antennaHeightB: 20, settings: { environment: 'urban' }, whatIf: false, geometry: false });
  close(open.rxPowerDbm - urban.rxPowerDbm, 20, 1e-9);
  assert.equal(urban.clutterLossDb, 20);
  assert.equal(urban.whatIf, undefined);
  assert.equal(urban.geometry, null);
  assert.ok(open.lines.some((l) => l.key === 'clutter'));
});
