/**
 * state.js - the app state and how it is stored in the URL hash, so a link
 * can be shared:  #a=lat,lon,h&b=lat,lon,h&f=917.3&p=14&sf=9 ...
 * Pure functions (no DOM), unit tested in test/state.test.js.
 */
import { DEFAULT_SETTINGS } from '../physics/pathAnalysis.js';

export const DEFAULT_ANTENNA_HEIGHT_M = 2;

/** Short URL keys for every setting. */
const KEYS = {
  freqMHz: 'f',
  txPowerDbm: 'p',
  txGainDbi: 'gt',
  rxGainDbi: 'gr',
  txCableLossDb: 'lt',
  rxCableLossDb: 'lr',
  sf: 'sf',
  bandwidthKHz: 'bw',
  payloadBytes: 'pl',
  codingRate: 'cr',
  chip: 'chip',
  diffraction: 'dm',
  environment: 'env',
  clutterLossDb: 'cl',
};

const STRING_SETTINGS = new Set(['chip', 'diffraction', 'environment']);
const ALLOWED = {
  sf: [7, 8, 9, 10, 11, 12],
  bandwidthKHz: [125, 250, 500],
  codingRate: [1, 2, 3, 4],
  chip: ['sx1262', 'sx1276'],
  diffraction: ['deygout', 'single', 'none'],
  environment: ['open', 'suburban', 'urban', 'custom'],
};

/** Coverage-map defaults (radius km, receiver height m, resolution). */
export const DEFAULT_COVERAGE = { radiusKm: 10, rxHeightM: 2, resolution: 'normal' };
export const COVERAGE_RADII_KM = [5, 10, 15, 20, 30];
export const DEFAULT_RELAY_HEIGHT_M = 5;

/** A fresh default state. */
export function defaultState() {
  return {
    mode: 'link', // 'link' | 'coverage'
    a: null, // in coverage mode, A is the transmitter
    b: null,
    settings: { ...DEFAULT_SETTINGS },
    coverage: { ...DEFAULT_COVERAGE },
    relayHeightM: DEFAULT_RELAY_HEIGHT_M,
  };
}

const round = (x, n) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

function encodePoint(p) {
  return `${round(p.lat, 5)},${round(p.lon, 5)},${round(p.h, 1)}`;
}

function decodePoint(s) {
  if (!s) return null;
  const [lat, lon, h] = s.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, h: Number.isFinite(h) && h >= 0 ? h : DEFAULT_ANTENNA_HEIGHT_M };
}

/**
 * State -> URL hash (without the leading '#'). Settings equal to the
 * defaults are left out to keep links short.
 */
export function encodeState(state) {
  const parts = [];
  if (state.mode === 'coverage') parts.push('m=cov');
  if (state.a) parts.push(`a=${encodePoint(state.a)}`);
  if (state.b) parts.push(`b=${encodePoint(state.b)}`);
  for (const [name, key] of Object.entries(KEYS)) {
    const v = state.settings[name];
    if (v === undefined || v === DEFAULT_SETTINGS[name]) continue;
    parts.push(`${key}=${encodeURIComponent(String(v))}`);
  }
  const cov = state.coverage || DEFAULT_COVERAGE;
  if (cov.radiusKm !== DEFAULT_COVERAGE.radiusKm) parts.push(`cr=${cov.radiusKm}`);
  if (cov.rxHeightM !== DEFAULT_COVERAGE.rxHeightM) parts.push(`crx=${round(cov.rxHeightM, 1)}`);
  if (cov.resolution !== DEFAULT_COVERAGE.resolution) parts.push(`cres=${cov.resolution}`);
  if (state.relayHeightM !== undefined && state.relayHeightM !== DEFAULT_RELAY_HEIGHT_M) parts.push(`rh=${round(state.relayHeightM, 1)}`);
  return parts.join('&');
}

/**
 * URL hash -> state. Unknown or invalid values fall back to defaults,
 * so a hand-edited or truncated link never breaks the app.
 */
export function decodeState(hash) {
  const state = defaultState();
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  state.a = decodePoint(params.get('a'));
  state.b = decodePoint(params.get('b'));
  for (const [name, key] of Object.entries(KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    let v = STRING_SETTINGS.has(name) ? raw : Number(raw);
    if (!STRING_SETTINGS.has(name) && !Number.isFinite(v)) continue;
    if (ALLOWED[name] && !ALLOWED[name].includes(v)) continue;
    state.settings[name] = v;
  }
  if (!(state.settings.clutterLossDb >= 0)) state.settings.clutterLossDb = 0;
  state.mode = params.get('m') === 'cov' ? 'coverage' : 'link';
  const cr = Number(params.get('cr'));
  if (COVERAGE_RADII_KM.includes(cr)) state.coverage.radiusKm = cr;
  const crx = Number(params.get('crx'));
  if (params.has('crx') && Number.isFinite(crx) && crx >= 0 && crx <= 500) state.coverage.rxHeightM = crx;
  if (['normal', 'fine'].includes(params.get('cres'))) state.coverage.resolution = params.get('cres');
  const rh = Number(params.get('rh'));
  if (params.has('rh') && Number.isFinite(rh) && rh >= 0 && rh <= 500) state.relayHeightM = rh;
  return state;
}
