/**
 * Field mode: log real measurements, compare them with the planner's
 * prediction, import/export CSV (same format the firmware prints).
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../app/styles.css';

import { analyzeLink } from '../physics/pathAnalysis.js';
import { terrainProfile } from '../elevation/profile.js';
import { getDem } from '../app/demInstance.js';
import { decodeState, encodeState } from '../app/state.js';
import { niceTicks } from '../app/profileChart.js';
import { escapeHtml, fmtSigned } from '../app/format.js';
import { t, initLanguageToggle, onLangChange } from '../i18n/index.js';
import { clutterLoss } from '../physics/clutter.js';
import { csvToRecords, recordsToCsv, CSV_COLUMNS } from './csv.js';
import { recordToLinkInput, linkInputToRecordFields, errorStats, hasPoints, bestFitExtraLoss } from './records.js';

const STORAGE_KEY = 'lora-link-planner.field-tests.v1';
const ENV_KEY = 'lora-link-planner.field-environment.v1';
const $ = (s) => document.querySelector(s);
const form = $('#form');

// ------------------------------------------------------------------ storage
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
let records = load();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    msg(t('field.saveFailed', { msg: e.message }));
  }
}
const msg = (t) => ($('#form-msg').textContent = t);

// ------------------------------------------------------------------ environment (page-wide)
let env = { environment: 'open', clutterLossDb: 0 };
try {
  env = { ...env, ...JSON.parse(localStorage.getItem(ENV_KEY) || '{}') };
} catch {
  /* ignore */
}
function writeEnv() {
  $('#env').value = env.environment;
  $('#clutter').value = String(env.environment === 'custom' ? env.clutterLossDb : clutterLoss(env));
  $('#clutter').disabled = env.environment !== 'custom';
}
function saveEnv() {
  try {
    localStorage.setItem(ENV_KEY, JSON.stringify(env));
  } catch {
    /* ignore */
  }
}
async function recomputeAll() {
  msg(t('field.recomputing'));
  records = await Promise.all(records.map(predict));
  save();
  render();
  msg(t('field.updated'));
}
$('#env').addEventListener('change', () => {
  env.environment = $('#env').value;
  saveEnv();
  writeEnv();
  recomputeAll();
});
$('#clutter').addEventListener('change', () => {
  env.clutterLossDb = Math.max(0, Number($('#clutter').value) || 0);
  saveEnv();
  recomputeAll();
});

// ------------------------------------------------------------------ prediction
async function predict(rec) {
  if (!hasPoints(rec)) return { ...rec, distance_m: null, predicted_rssi_dbm: null, predicted_rssi_open_dbm: null, predicted_snr_db: null, predicted_margin_db: null };
  const { a, b, settings: base } = recordToLinkInput(rec);
  const settings = { ...base, ...env };
  const dem = await getDem();
  const prof = await terrainProfile(dem, a, b);
  const r = analyzeLink({ distances: prof.distances, elevations: prof.elevations, antennaHeightA: a.h, antennaHeightB: b.h, settings });
  const round = (v) => Math.round(v * 10) / 10;
  return {
    ...rec,
    distance_m: Math.round(r.distanceM),
    predicted_rssi_dbm: round(r.rxPowerDbm),
    // the same prediction without any environment loss, for calibration
    predicted_rssi_open_dbm: round(r.rxPowerDbm + r.clutterLossDb),
    predicted_snr_db: round(r.snrDb),
    predicted_margin_db: round(r.marginDb),
  };
}

// ------------------------------------------------------------------ map in the form
const fmap = L.map('fmap').setView([31.6, 35.0], 7);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(fmap);
const pin = (label) => L.divIcon({ className: `pin pin-${label.toLowerCase()}`, html: `<span><b>${label}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 30] });
const fm = { a: null, b: null };
const fline = L.polyline([], { color: '#2563eb', dashArray: '6 5' }).addTo(fmap);

function setPoint(which, lat, lon) {
  form[`${which}_lat`].value = lat.toFixed(5);
  form[`${which}_lon`].value = lon.toFixed(5);
  syncMap();
}
function syncMap() {
  for (const w of ['a', 'b']) {
    const lat = parseFloat(form[`${w}_lat`].value);
    const lon = parseFloat(form[`${w}_lon`].value);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (!fm[w]) {
        fm[w] = L.marker([lat, lon], { icon: pin(w.toUpperCase()), draggable: true })
          .addTo(fmap)
          .on('dragend', (e) => setPoint(w, e.target.getLatLng().lat, e.target.getLatLng().lng));
      } else fm[w].setLatLng([lat, lon]);
    }
  }
  fline.setLatLngs(fm.a && fm.b ? [fm.a.getLatLng(), fm.b.getLatLng()] : []);
}
let nextPoint = 'a';
fmap.on('click', (e) => {
  setPoint(nextPoint, e.latlng.lat, e.latlng.lng);
  nextPoint = nextPoint === 'a' ? 'b' : 'a';
});
for (const k of ['a_lat', 'a_lon', 'b_lat', 'b_lon']) form[k].addEventListener('change', syncMap);

// Prefill from the planner link (same hash format).
function prefillFromHash() {
  if (!location.hash) return;
  const st = decodeState(location.hash);
  const f = linkInputToRecordFields(st);
  for (const [k, v] of Object.entries(f)) if (v !== null && form[k]) form[k].value = String(v);
  syncMap();
  if (st.a && st.b) fmap.fitBounds(L.latLngBounds([st.a.lat, st.a.lon], [st.b.lat, st.b.lon]).pad(0.3));
  $('#planner-link').href = `./index.html${location.hash}`;
}
prefillFromHash();

// ------------------------------------------------------------------ form submit
function formRecord() {
  const fd = new FormData(form);
  const rec = { timestamp: new Date().toISOString() };
  for (const c of CSV_COLUMNS) {
    if (c === 'timestamp') continue;
    const v = fd.get(c);
    if (c === 'notes') rec[c] = String(v ?? '');
    else rec[c] = v === null || v === '' ? null : Number(v);
  }
  return rec;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg(t('field.computing'));
  try {
    const rec = await predict({ ...formRecord(), id: crypto.randomUUID?.() ?? String(Date.now()) });
    records.push(rec);
    save();
    render();
    form.rssi_dbm.value = '';
    form.snr_db.value = '';
    form.packets_lost.value = '';
    form.packets_received.value = '';
    form.notes.value = '';
    msg(t('field.added', { pred: rec.predicted_rssi_dbm, meas: rec.rssi_dbm }));
  } catch (err) {
    msg(t('field.error', { msg: err.message }));
  }
});

// ------------------------------------------------------------------ import / export
$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const rows = csvToRecords(await file.text());
    const fill = formRecord();
    const out = [];
    for (const r of rows) {
      const rec = { ...r, id: crypto.randomUUID?.() ?? `${Date.now()}-${out.length}` };
      if (!hasPoints(rec)) {
        // firmware rows have no coordinates: use the points in the form
        for (const k of ['a_lat', 'a_lon', 'a_height_m', 'b_lat', 'b_lon', 'b_height_m']) if (rec[k] === null || rec[k] === undefined) rec[k] = fill[k];
      }
      if (!rec.timestamp) rec.timestamp = new Date().toISOString();
      out.push(await predict(rec));
    }
    records = records.concat(out);
    save();
    render();
    msg(t('field.imported', { n: out.length }));
  } catch (err) {
    msg(t('field.importFailed', { msg: err.message }));
  }
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([recordsToCsv(records)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lora-field-tests-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#recompute').addEventListener('click', recomputeAll);

$('#clear').addEventListener('click', () => {
  if (!records.length || !confirm(t('field.confirmClear', { n: records.length }))) return;
  records = [];
  save();
  render();
});

$('#table').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-del]');
  if (btn) {
    records = records.filter((r) => r.id !== btn.dataset.del);
    save();
    render();
    return;
  }
  const open = e.target.closest('a[data-open]');
  if (open) {
    const r = records.find((x) => x.id === open.dataset.open);
    if (!r) return;
    e.preventDefault();
    const st = recordToLinkInput(r);
    location.href = `./index.html#${encodeState(st)}`;
  }
});

// ------------------------------------------------------------------ render
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function render() {
  const s = errorStats(records);
  $('#stats').innerHTML = `
    <div><small>${t('field.stat.tests')}</small><b>${records.length}</b></div>
    <div><small>${t('field.stat.bias')}</small><b dir="ltr">${s.rssi.n ? `${fmtSigned(s.rssi.mean)} dB` : '—'}</b></div>
    <div><small>${t('field.stat.rmse')}</small><b dir="ltr">${s.rssi.n ? `${s.rssi.rmse.toFixed(1)} dB` : '—'}</b></div>
    <div><small>${t('field.stat.snrBias')}</small><b dir="ltr">${s.snr.n ? `${fmtSigned(s.snr.mean)} dB` : '—'}</b></div>`;
  renderChart();
  const rows = records
    .map((r, i) => {
      const err = Number.isFinite(r.rssi_dbm) && Number.isFinite(r.predicted_rssi_dbm) ? r.rssi_dbm - r.predicted_rssi_dbm : null;
      const tot = (r.packets_lost ?? 0) + (r.packets_received ?? 0);
      const loss = tot > 0 ? `${((100 * (r.packets_lost ?? 0)) / tot).toFixed(0)}%` : '—';
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml((r.timestamp || '').replace('T', ' ').slice(0, 16))}</td>
        <td>${Number.isFinite(r.distance_m) ? (r.distance_m / 1000).toFixed(2) : '—'}</td>
        <td>SF${r.sf ?? '?'}/${r.bw_khz ?? '?'}</td>
        <td>${fmt(r.predicted_rssi_dbm)}</td>
        <td>${fmt(r.rssi_dbm)}</td>
        <td class="${err === null ? '' : err >= 0 ? 'pos' : 'neg'}">${err === null ? '—' : fmtSigned(err)}</td>
        <td>${fmt(r.predicted_snr_db)}</td>
        <td>${fmt(r.snr_db)}</td>
        <td>${loss}</td>
        <td class="notes">${escapeHtml(r.notes || '')}</td>
        <td>${hasPoints(r) ? `<a href="#" data-open="${escapeHtml(r.id)}" title="${escapeHtml(t('field.openTitle'))}">${t('field.openMap')}</a>` : ''}
            <button type="button" class="link" data-del="${escapeHtml(r.id)}" title="${escapeHtml(t('field.delete'))}">✕</button></td>
      </tr>`;
    })
    .join('');
  const th = (k) => `<th>${t(`field.th.${k}`)}</th>`;
  $('#table').innerHTML = `<thead><tr><th>#</th>${['time', 'km', 'sfbw', 'predRssi', 'measRssi', 'error', 'predSnr', 'measSnr', 'loss'].map(th).join('')}<th class="notes">${t('field.th.notes')}</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="12" style="text-align:center">${t('field.noTests')}</td></tr>`}</tbody>`;
}

/** Scatter plot: prediction error (measured − predicted RSSI) against distance. */
function renderChart() {
  const box = $('#errchart');
  const pts = records.filter((r) => Number.isFinite(r.rssi_dbm) && Number.isFinite(r.predicted_rssi_dbm) && Number.isFinite(r.distance_m));
  if (!pts.length) {
    box.innerHTML = `<p class="empty">${escapeHtml(t('field.chartEmpty'))}</p>`;
    return;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const W = Math.max(300, box.clientWidth);
  const H = 240;
  const m = { l: 48, r: 12, t: 14, b: 34 };
  const errs = pts.map((r) => r.rssi_dbm - r.predicted_rssi_dbm);
  const lim = Math.max(10, ...errs.map((e) => Math.abs(e))) * 1.15;
  const dMax = Math.max(...pts.map((r) => r.distance_m)) / 1000 * 1.08 || 1;
  const x = (km) => m.l + (km / dMax) * (W - m.l - m.r);
  const y = (e) => m.t + (1 - (e + lim) / (2 * lim)) * (H - m.t - m.b);
  const parts = [];
  parts.push(`<rect class="band" x="${m.l}" y="${y(6)}" width="${W - m.l - m.r}" height="${y(-6) - y(6)}"/>`);
  for (const t of niceTicks(-lim, lim, 6)) parts.push(`<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t > 0 ? '+' : ''}${t}</text>`);
  for (const t of niceTicks(0, dMax, 6)) parts.push(`<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${x(t)}" y="${H - m.b + 15}" text-anchor="middle">${t} km</text>`);
  parts.push(`<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`);
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  parts.push(`<line class="mean" x1="${m.l}" x2="${W - m.r}" y1="${y(mean)}" y2="${y(mean)}"/>`);
  pts.forEach((r, i) => {
    const e = errs[i];
    const c = Math.abs(e) <= 6 ? 'var(--good)' : e > 0 ? 'var(--accent)' : 'var(--bad)';
    parts.push(`<circle class="dot" cx="${x(r.distance_m / 1000)}" cy="${y(e)}" r="5" fill="${c}"><title>${escapeHtml(r.notes || `test ${i + 1}`)}: ${fmtSigned(e)} dB at ${(r.distance_m / 1000).toFixed(2)} km</title></circle>`);
  });
  parts.push(`<text x="${m.l + 4}" y="${m.t + 10}" class="axis-label" font-size="11" fill="currentColor">${escapeHtml(t('field.chartBetter'))}</text>`);
  parts.push(`<text x="${m.l + 4}" y="${H - m.b - 6}" class="axis-label" font-size="11" fill="currentColor">${escapeHtml(t('field.chartWorse'))}</text>`);
  box.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(t('field.chartAria'))}"><g class="axis">${parts.join('')}</g></svg>
    <p class="hint">${escapeHtml(t('field.chartHint'))}</p>`;
}

// ------------------------------------------------------------------ calibration
let lastFit = null;
function renderCalibration() {
  const box = $('#cal-result');
  if (!lastFit) {
    box.innerHTML = '';
    return;
  }
  if (lastFit === 'none') {
    box.innerHTML = `<p class="hint">${escapeHtml(t('field.calNeed'))}</p>`;
    return;
  }
  const f = lastFit;
  const plannerHash = `env=custom&cl=${f.lossDb}`;
  box.innerHTML = `<p>${t('field.calResult_html', {
    loss: f.lossDb,
    n: f.n,
    before: f.rmseBeforeDb === null ? '—' : f.rmseBeforeDb.toFixed(1),
    after: f.rmseAfterDb.toFixed(1),
  })}</p>
    <div class="row"><button type="button" class="primary" id="cal-apply">${t('field.calApply')}</button>
    <a href="./index.html#${plannerHash}" id="cal-planner">${t('field.calPlanner')}</a></div>`;
}
$('#calibrate').addEventListener('click', () => {
  lastFit = bestFitExtraLoss(records) ?? 'none';
  renderCalibration();
});
$('#cal-result').addEventListener('click', async (e) => {
  if (e.target.id !== 'cal-apply' || !lastFit || lastFit === 'none') return;
  env = { environment: 'custom', clutterLossDb: lastFit.lossDb };
  saveEnv();
  writeEnv();
  await recomputeAll();
  msg(t('field.calApplied', { loss: env.clutterLossDb }));
  lastFit = bestFitExtraLoss(records);
  renderCalibration();
});

window.addEventListener('resize', () => renderChart());
initLanguageToggle($('#lang'));
onLangChange(() => {
  render();
  renderCalibration();
});
writeEnv();
render();
getDem().catch((e) => msg(t('field.demFailed', { msg: e.message })));
// tests saved by an older version lack the "open" prediction used for calibration
if (records.some((r) => hasPoints(r) && r.predicted_rssi_open_dbm === undefined)) recomputeAll();
window.__field = { get records() { return records; } };
