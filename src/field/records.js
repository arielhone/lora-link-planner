/**
 * records.js - field-test records: mapping to planner inputs and error stats.
 * Pure functions, unit tested in test/field.test.js.
 */
import { DEFAULT_SETTINGS } from '../physics/pathAnalysis.js';

const num = (v, fallback) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));

/** Does the record have both points, so a prediction can be made? */
export function hasPoints(r) {
  return ['a_lat', 'a_lon', 'b_lat', 'b_lon'].every((k) => Number.isFinite(r[k]) && r[k] !== null);
}

/**
 * Field-test record -> the inputs of analyzeLink (minus the terrain profile).
 * Missing radio settings fall back to the planner defaults.
 */
export function recordToLinkInput(r) {
  return {
    a: { lat: r.a_lat, lon: r.a_lon, h: num(r.a_height_m, 2) },
    b: { lat: r.b_lat, lon: r.b_lon, h: num(r.b_height_m, 2) },
    settings: {
      ...DEFAULT_SETTINGS,
      freqMHz: num(r.freq_mhz, DEFAULT_SETTINGS.freqMHz),
      sf: num(r.sf, DEFAULT_SETTINGS.sf),
      bandwidthKHz: num(r.bw_khz, DEFAULT_SETTINGS.bandwidthKHz),
      txPowerDbm: num(r.tx_power_dbm, DEFAULT_SETTINGS.txPowerDbm),
      txGainDbi: num(r.tx_gain_dbi, 0),
      rxGainDbi: num(r.rx_gain_dbi, 0),
      txCableLossDb: num(r.tx_cable_loss_db, 0),
      rxCableLossDb: num(r.rx_cable_loss_db, 0),
    },
  };
}

/** Planner state (points + settings) -> the matching record fields. */
export function linkInputToRecordFields({ a, b, settings }) {
  return {
    a_lat: a?.lat ?? null,
    a_lon: a?.lon ?? null,
    a_height_m: a?.h ?? null,
    b_lat: b?.lat ?? null,
    b_lon: b?.lon ?? null,
    b_height_m: b?.h ?? null,
    freq_mhz: settings.freqMHz,
    sf: settings.sf,
    bw_khz: settings.bandwidthKHz,
    tx_power_dbm: settings.txPowerDbm,
    tx_gain_dbi: settings.txGainDbi,
    rx_gain_dbi: settings.rxGainDbi,
    tx_cable_loss_db: settings.txCableLossDb,
    rx_cable_loss_db: settings.rxCableLossDb,
  };
}

/** Prediction error statistics: measured - predicted (positive = better than predicted). */
export function errorStats(records) {
  const stat = (meas, pred) => {
    const errs = records
      .filter((r) => Number.isFinite(r[meas]) && Number.isFinite(r[pred]))
      .map((r) => r[meas] - r[pred]);
    if (!errs.length) return { n: 0, mean: null, rmse: null, min: null, max: null };
    const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
    const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    return { n: errs.length, mean, rmse, min: Math.min(...errs), max: Math.max(...errs) };
  };
  return { rssi: stat('rssi_dbm', 'predicted_rssi_dbm'), snr: stat('snr_db', 'predicted_snr_db') };
}

/**
 * Environment calibration: the single extra loss L (dB) that best explains
 * the measurements, in the least-squares sense.
 *
 * For each test we know the prediction WITHOUT any clutter loss
 * (predicted_rssi_open_dbm) and the measured RSSI. We look for L minimising
 *     sum( (measured - (open - L))^2 )
 * Setting the derivative to zero gives simply the average shortfall:
 *     L = mean(open - measured)
 * Negative values (the link was better than free space + terrain predicts)
 * are clamped to 0, since "negative clutter" is not physical.
 *
 * @returns {{lossDb:number, n:number, rmseBeforeDb:number|null, rmseAfterDb:number}|null}
 *   null when no test has both a measurement and a prediction.
 */
export function bestFitExtraLoss(records) {
  const usable = records.filter((r) => Number.isFinite(r.rssi_dbm) && Number.isFinite(r.predicted_rssi_open_dbm));
  if (!usable.length) return null;
  const shortfall = usable.map((r) => r.predicted_rssi_open_dbm - r.rssi_dbm);
  const lossDb = Math.max(0, shortfall.reduce((s, x) => s + x, 0) / usable.length);
  const rms = (errs) => Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  const withPred = usable.filter((r) => Number.isFinite(r.predicted_rssi_dbm));
  return {
    lossDb: Math.round(lossDb * 10) / 10,
    n: usable.length,
    rmseBeforeDb: withPred.length ? rms(withPred.map((r) => r.rssi_dbm - r.predicted_rssi_dbm)) : null,
    rmseAfterDb: rms(usable.map((r) => r.rssi_dbm - (r.predicted_rssi_open_dbm - lossDb))),
  };
}
