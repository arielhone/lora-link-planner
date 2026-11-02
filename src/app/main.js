/**
 * main.js - the planner page: map, settings, A-B link view, coverage map
 * and relay planner. All physics lives in src/physics; heavy jobs run in a
 * Web Worker (src/coverage/worker.js); this file only wires the UI together.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

import { analyzeLink } from '../physics/pathAnalysis.js';
import { terrainProfile } from '../elevation/profile.js';
import { distance } from '../elevation/geo.js';
import { getDem } from './demInstance.js';
import { decodeState, encodeState, DEFAULT_ANTENNA_HEIGHT_M } from './state.js';
import { renderProfile } from './profileChart.js';
import { EXAMPLES } from './examples.js';
import { fmtDb, fmtDbm, fmtDist, fmtTime, fmtSigned, escapeHtml } from './format.js';
import { runJob } from './jobs.js';
import { autoCellSize, cellAt, coveragePixels, summarizeCoverage, classifyMargin } from '../coverage/grid.js';
import { t, getLang, initLanguageToggle, onLangChange } from '../i18n/index.js';

const $ = (sel) => document.querySelector(sel);
const COLORS = { works: '#16a34a', marginal: '#d97706', fails: '#dc2626' };

// ------------------------------------------------------------------ state
let state = decodeState(location.hash);
let lastAnalysis = null;
/** Relay search result for the original A-B pair, and which hop is shown. */
let relay = null; // { base: {a, b}, settingsKey, result, viewing: null | {i, hop} }
let relayJob = null;
/** Last coverage result and the inputs it was computed with. */
let coverage = null; // { key, grid, margins, summary }
let coverageJob = null;

// ------------------------------------------------------------------ map
const ISRAEL_BOUNDS = L.latLngBounds([29.45, 34.2], [33.35, 35.95]);
const map = L.map('map', { zoomControl: true, minZoom: 6 }).fitBounds(ISRAEL_BOUNDS);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const icon = (label, cls = label.toLowerCase()) =>
  L.divIcon({ className: `pin pin-${cls}`, html: `<span><b>${label}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 30] });

const markers = { a: null, b: null };
const line = L.polyline([], { weight: 4, opacity: 0.85, dashArray: '8 6' }).addTo(map);
const relayLayer = L.layerGroup().addTo(map);
const coverageLayer = L.layerGroup().addTo(map);

function labelFor(which) {
  if (state.mode === 'coverage') return 'TX';
  if (relay?.viewing) {
    const r = `R${relay.viewing.i + 1}`;
    if (relay.viewing.hop === 1) return which === 'a' ? 'A' : r;
    return which === 'a' ? r : 'B';
  }
  return which.toUpperCase();
}

function placeMarker(which) {
  const p = state[which];
  const visible = p && !(state.mode === 'coverage' && which === 'b');
  if (!visible) {
    if (markers[which]) markers[which].remove();
    markers[which] = null;
    return;
  }
  const label = labelFor(which);
  const cls = label === 'TX' ? 'a' : label.startsWith('R') ? 'r' : label.toLowerCase();
  if (!markers[which]) {
    markers[which] = L.marker([p.lat, p.lon], { icon: icon(label, cls), draggable: true, autoPan: true })
      .addTo(map)
      .on('drag', (e) => {
        const ll = e.target.getLatLng();
        state[which] = { ...state[which], lat: ll.lat, lon: ll.lng };
        updateLine();
      })
      .on('dragend', () => {
        leaveRelayView();
        onChange();
      });
  } else markers[which].setLatLng([p.lat, p.lon]);
  markers[which].setIcon(icon(label, cls));
}

function updateLine() {
  const show = state.mode === 'link' && state.a && state.b;
  line.setLatLngs(show ? [[state.a.lat, state.a.lon], [state.b.lat, state.b.lon]] : []);
}

map.on('click', (e) => {
  const p = { lat: e.latlng.lat, lon: e.latlng.lng };
  if (state.mode === 'coverage') {
    // click on a computed cell -> open that path in the link view
    const hit = coverage && coverage.key === coverageKey() ? cellAt(coverage.grid, p.lat, p.lon) : null;
    if (hit && Number.isFinite(coverage.margins[hit.index])) {
      state.b = { lat: hit.lat, lon: hit.lon, h: state.coverage.rxHeightM };
      setMode('link');
      return;
    }
    state.a = { ...p, h: Number($('#cov-txh').value) || DEFAULT_ANTENNA_HEIGHT_M };
    onChange();
    return;
  }
  leaveRelayView();
  if (!state.a || (state.a && state.b)) {
    // first click, or start over after both points are placed
    state.a = { ...p, h: Number($('#hA').value) || DEFAULT_ANTENNA_HEIGHT_M };
    state.b = null;
  } else {
    state.b = { ...p, h: Number($('#hB').value) || DEFAULT_ANTENNA_HEIGHT_M };
  }
  onChange();
});

map.on('mousemove', (e) => {
  if (state.mode !== 'coverage' || !coverage || coverage.key !== coverageKey()) return;
  const hit = cellAt(coverage.grid, e.latlng.lat, e.latlng.lng);
  const m = hit ? coverage.margins[hit.index] : NaN;
  $('#map-hint').textContent = Number.isFinite(m)
    ? t('map.hintCell', { margin: fmtSigned(m), dist: fmtDist(distance(state.a, hit)) })
    : t('map.hintCells');
});

// ------------------------------------------------------------------ forms
function writeForm() {
  for (const input of document.querySelectorAll('#settings [data-key]')) {
    input.value = String(state.settings[input.dataset.key]);
  }
  $('#settings [data-key="clutterLossDb"]').disabled = state.settings.environment !== 'custom';
  if (state.a) $('#hA').value = state.a.h;
  if (state.b) $('#hB').value = state.b.h;
  if (state.a) $('#cov-txh').value = state.a.h;
  $('#cov-rxh').value = state.coverage.rxHeightM;
  $('#cov-radius').value = String(state.coverage.radiusKm);
  $('#cov-res').value = state.coverage.resolution;
}

for (const input of document.querySelectorAll('#settings [data-key]')) {
  input.addEventListener('change', () => {
    const key = input.dataset.key;
    const v = input.type === 'number' || /^\d+$/.test(input.value) ? Number(input.value) : input.value;
    if (typeof v === 'number' && !Number.isFinite(v)) return;
    state.settings[key] = v;
    onChange();
  });
}
for (const [id, which] of [['#hA', 'a'], ['#hB', 'b'], ['#cov-txh', 'a']]) {
  $(id).addEventListener('change', () => {
    const h = Math.max(0, Number($(id).value) || 0);
    if (state[which]) state[which].h = h;
    leaveRelayView();
    onChange();
  });
}
$('#cov-rxh').addEventListener('change', () => {
  state.coverage.rxHeightM = Math.max(0, Number($('#cov-rxh').value) || 0);
  onChange();
});
$('#cov-radius').addEventListener('change', () => {
  state.coverage.radiusKm = Number($('#cov-radius').value);
  onChange();
});
$('#cov-res').addEventListener('change', () => {
  state.coverage.resolution = $('#cov-res').value;
  onChange();
});

const examplesSel = $('#examples');
function fillExamples() {
  examplesSel.length = 1;
  examplesSel.options[0].textContent = t('map.examples');
  EXAMPLES.forEach((ex, i) => examplesSel.add(new Option(ex.name[getLang()] ?? ex.name.en, String(i))));
}
fillExamples();
examplesSel.addEventListener('change', () => {
  const ex = EXAMPLES[Number(examplesSel.value)];
  examplesSel.value = '';
  if (!ex) return;
  leaveRelayView();
  state.a = { ...ex.a };
  state.b = { ...ex.b };
  map.fitBounds(L.latLngBounds([ex.a.lat, ex.a.lon], [ex.b.lat, ex.b.lon]).pad(0.3));
  onChange();
});
$('#swap').addEventListener('click', () => {
  leaveRelayView();
  [state.a, state.b] = [state.b, state.a];
  onChange();
});
$('#reset').addEventListener('click', () => {
  leaveRelayView();
  state.a = null;
  state.b = null;
  onChange();
});

for (const tab of document.querySelectorAll('.tabs [data-mode]')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

function setMode(mode) {
  if (state.mode === mode) return;
  leaveRelayView();
  state.mode = mode;
  if (mode === 'coverage' && state.a) map.setView([state.a.lat, state.a.lon], Math.min(map.getZoom(), 11));
  if (mode === 'link' && state.a && state.b) map.fitBounds(L.latLngBounds([state.a.lat, state.a.lon], [state.b.lat, state.b.lon]).pad(0.3));
  onChange();
  // the map container changed size (profile row shown/hidden)
  setTimeout(() => map.invalidateSize(), 50);
}

// ------------------------------------------------------------------ change handling
let seq = 0;
let timer = null;

function onChange() {
  document.body.dataset.mode = state.mode;
  for (const tab of document.querySelectorAll('.tabs [data-mode]')) tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  placeMarker('a');
  placeMarker('b');
  updateLine();
  writeForm();
  // the URL always describes the original A-B pair, not a relay hop being inspected
  const urlState = relay?.viewing ? { ...state, a: relay.base.a, b: relay.base.b } : state;
  const hash = encodeState(urlState);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  $('#field-link').href = `./field.html${hash ? `#${hash}` : ''}`;
  renderHint();
  renderCompliancePlaceholder();
  if (state.mode === 'coverage') {
    renderCoveragePanel();
    drawCoverage();
    relayLayer.clearLayers();
    return;
  }
  coverageLayer.clearLayers();
  $('#map-legend').hidden = true;
  $('#coords').textContent = [state.a && `A ${state.a.lat.toFixed(5)}, ${state.a.lon.toFixed(5)}`, state.b && `B ${state.b.lat.toFixed(5)}, ${state.b.lon.toFixed(5)}`]
    .filter(Boolean)
    .join(' · ');
  if (relay && !relay.viewing && relay.settingsKey !== relayKey()) clearRelay();
  drawRelayMarkers();
  clearTimeout(timer);
  timer = setTimeout(compute, 60);
}

function renderHint() {
  const hint = $('#map-hint');
  if (state.mode === 'coverage') {
    if (!state.a) hint.innerHTML = t('map.hintTx_html');
    else if (coverage && coverage.key === coverageKey()) hint.textContent = t('map.hintCells');
    else hint.textContent = t('map.hintRun');
    return;
  }
  hint.innerHTML = !state.a ? t('map.hintA_html') : !state.b ? t('map.hintB_html') : escapeHtml(t('map.hintDone'));
}

function renderCompliancePlaceholder() {
  if (state.mode === 'coverage' || !lastAnalysis) $('#compliance').innerHTML = '';
}

// ------------------------------------------------------------------ link view
async function compute() {
  const my = ++seq;
  if (!state.a || !state.b) {
    lastAnalysis = null;
    renderEmpty();
    return;
  }
  $('#result').classList.add('busy');
  try {
    const dem = await getDem();
    const outside = [state.a, state.b].filter((p) => !dem.covers(p.lat, p.lon));
    const prof = await terrainProfile(dem, state.a, state.b);
    if (my !== seq) return; // a newer request superseded this one
    const analysis = analyzeLink({
      distances: prof.distances,
      elevations: prof.elevations,
      antennaHeightA: state.a.h,
      antennaHeightB: state.b.h,
      settings: state.settings,
    });
    analysis.outsideCoverage = outside.length > 0;
    lastAnalysis = analysis;
    renderAll(analysis);
  } catch (err) {
    console.error(err);
    $('#result').innerHTML = `<p class="error">${escapeHtml(t('result.error', { msg: err.message }))}</p>`;
  } finally {
    if (my === seq) $('#result').classList.remove('busy');
  }
}

function renderEmpty() {
  line.setStyle({ color: '#2563eb' });
  $('#result').className = 'card result empty-card';
  $('#result').innerHTML = `<p>${t('result.intro_html')}</p>`;
  $('#profile').innerHTML = `<p class="empty">${escapeHtml(t('profile.empty'))}</p>`;
  $('#whatif').innerHTML = '';
  $('#compliance').innerHTML = '';
  $('#relay').hidden = true;
  renderRelayBanner();
}

function renderAll(r) {
  line.setStyle({ color: COLORS[r.verdict] });
  renderProfile($('#profile'), r);
  renderResult(r);
  renderWhatIf(r);
  renderRelayPanel(r);
  renderRelayBanner();
  const warn = [];
  if (r.settings.freqMHz < 917 || r.settings.freqMHz > 920) warn.push(t('compliance.freq', { f: r.settings.freqMHz }));
  if (r.eirpDbm > 14 + 1e-9) warn.push(t('compliance.eirp', { eirp: r.eirpDbm.toFixed(1) }));
  $('#compliance').innerHTML = warn.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join('');
}

function renderResult(r) {
  const g = r.geometry;
  const clearance = g.lineOfSight
    ? g.minFresnelFraction >= 0.6
      ? t('result.path.clear')
      : t('result.path.fresnel', { pct: Math.round(g.minFresnelFraction * 100) })
    : t('result.path.blocked');
  const icons = { works: '✅', marginal: '⚠️', fails: '❌' };
  const edges = r.diffractionEdges.length;
  $('#result').className = `card result v-${r.verdict}`;
  $('#result').innerHTML = `
    <div class="verdict"><span class="vi">${icons[r.verdict]}</span><div><b>${t(`verdict.${r.verdict}`)}</b><small>${t(`verdict.${r.verdict}.sub`)}</small></div>
      <div class="margin"><span dir="ltr">${fmtSigned(r.marginDb)}</span><small>${t('result.dbMargin')}</small></div></div>
    ${r.outsideCoverage ? `<p class="warn">${escapeHtml(t('result.outside'))}</p>` : ''}
    <table class="kv">
      <tr><th>${t('result.distance')}</th><td>${fmtDist(r.distanceM)}</td></tr>
      <tr><th>${t('result.path')}</th><td>${clearance}</td></tr>
      <tr><th>${t('result.eirp')}</th><td>${fmtDbm(r.eirpDbm)}</td></tr>
      <tr><th>${t('result.fspl')}</th><td>${fmtDb(r.pathLossDb)}</td></tr>
      <tr><th>${t('result.obstruction')}</th><td>${fmtDb(r.obstructionLossDb)}${edges ? ` <small>${edges > 1 ? t('result.edges', { n: edges }) : t('result.edge')}</small>` : ''}</td></tr>
      ${r.clutterLossDb ? `<tr><th>${t('result.clutter')}</th><td>${fmtDb(r.clutterLossDb)}</td></tr>` : ''}
      <tr><th>${t('result.rx')}</th><td>${fmtDbm(r.rxPowerDbm)}</td></tr>
      <tr><th>${t('result.sensitivity', { sf: r.settings.sf, bw: r.settings.bandwidthKHz })}</th><td>${fmtDbm(r.sensitivityDbm)}</td></tr>
      <tr><th>${t('result.margin')}</th><td><b>${fmtDb(r.marginDb)}</b></td></tr>
      <tr><th>${t('result.snr')}</th><td>${fmtDb(r.snrDb)}</td></tr>
      <tr><th>${t('result.toa', { bytes: r.settings.payloadBytes })}</th><td>${fmtTime(r.timeOnAirS)}</td></tr>
    </table>
    <details class="statement"><summary>${t('result.statement')}</summary>
      <table class="kv">${r.lines
        .filter((l) => l.key !== 'clutter' || l.value !== 0)
        .map((l) => `<tr><th>${t(`line.${l.key}`)}</th><td>${fmtSigned(l.value)} dB</td></tr>`)
        .join('')}
      <tr class="total"><th>${t('result.eqRx')}</th><td>${fmtDbm(r.rxPowerDbm)}</td></tr>
      <tr><th>${t('result.minusSens')}</th><td>${fmtDbm(r.sensitivityDbm)}</td></tr>
      <tr class="total"><th>${t('result.eqMargin')}</th><td>${fmtDb(r.marginDb)}</td></tr></table>
    </details>`;
}

function renderWhatIf(r) {
  const w = r.whatIf;
  const s = r.settings;
  const rows = w.sfTable
    .map(
      (row) => `<tr class="${row.sf === s.sf ? 'cur' : ''} v-${row.verdict}">
        <td>SF${row.sf}</td><td>${fmtDbm(row.sensitivityDbm, 1)}</td><td><b>${fmtSigned(row.marginDb)}</b></td><td>${fmtTime(row.timeOnAirS)}</td>
        <td>${row.sf === s.sf ? '●' : `<button type="button" class="link" data-sf="${row.sf}">${t('whatif.use')}</button>`}</td></tr>`,
    )
    .join('');
  let sfAdvice;
  if (w.firstWorkingSf !== null) {
    sfAdvice =
      w.firstWorkingSf === s.sf
        ? escapeHtml(t('whatif.sfAlready', { sf: s.sf }))
        : w.firstWorkingSf < s.sf
          ? t('whatif.sfFaster_html', { sf: w.firstWorkingSf })
          : t('whatif.sfAtLeast_html', { sf: w.firstWorkingSf });
  } else if (w.firstMarginalSf !== null) {
    sfAdvice = t('whatif.sfMarginal_html', { sf: w.firstMarginalSf });
  } else sfAdvice = escapeHtml(t('whatif.sfNone'));

  let hAdvice;
  const apply = (which) => ` <button type="button" class="link" data-apply="${which}">${t('whatif.apply')}</button>`;
  if (w.extraHeightBothM === 0) hAdvice = escapeHtml(t('whatif.clear'));
  else {
    const parts = [];
    if (w.extraHeightBothM !== null) parts.push(t('whatif.both_html', { a: w.antennaHeightBothA.toFixed(1), b: w.antennaHeightBothB.toFixed(1) }) + apply('both'));
    if (w.antennaHeightForAOnlyM !== null) parts.push(t('whatif.onlyA_html', { a: w.antennaHeightForAOnlyM.toFixed(1) }) + apply('a'));
    if (w.antennaHeightForBOnlyM !== null) parts.push(t('whatif.onlyB_html', { b: w.antennaHeightForBOnlyM.toFixed(1) }) + apply('b'));
    hAdvice = parts.length ? `${escapeHtml(t('whatif.heightsIntro'))}${parts.join(t('whatif.or'))}.` : escapeHtml(t('whatif.noHeight'));
  }

  $('#whatif').innerHTML = `
    <h3>${t('whatif.title')}</h3>
    <p>${sfAdvice}</p>
    <table class="sf"><thead><tr><th>${t('whatif.sf')}</th><th>${t('whatif.sens')}</th><th>${t('whatif.margin')}</th><th>${t('whatif.airtime')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p>${hAdvice}</p>`;
}

$('#whatif').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !lastAnalysis) return;
  if (btn.dataset.sf) {
    state.settings.sf = Number(btn.dataset.sf);
  } else if (btn.dataset.apply) {
    const w = lastAnalysis.whatIf;
    if (btn.dataset.apply === 'both') {
      state.a.h = w.antennaHeightBothA;
      state.b.h = w.antennaHeightBothB;
    } else if (btn.dataset.apply === 'a') state.a.h = w.antennaHeightForAOnlyM;
    else state.b.h = w.antennaHeightForBOnlyM;
  }
  onChange();
});

// ------------------------------------------------------------------ relay planner
/** Everything a relay result depends on (points + radio settings + relay height). */
const relayKey = () => JSON.stringify([relay?.base ?? [state.a, state.b], state.settings, state.relayHeightM]);

function clearRelay() {
  relayJob?.cancel();
  relayJob = null;
  relay = null;
  relayLayer.clearLayers();
}

function leaveRelayView() {
  if (relay?.viewing) {
    state.a = { ...relay.base.a };
    state.b = { ...relay.base.b };
  }
  clearRelay();
}

function renderRelayPanel(r) {
  const panel = $('#relay');
  // only offer a relay for the original pair when the direct link is not reliable
  if (relay?.viewing || (r.verdict === 'works' && !relay)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  let body = '';
  if (relayJob) body = `<p class="hint">${escapeHtml(t('relay.searching'))}</p>`;
  else if (relay?.result) {
    const res = relay.result;
    const hopCell = (h) => `<bdi dir="ltr"><span class="m v-${h.verdict}">${fmtSigned(h.marginDb)} dB</span> <small>${fmtDist(h.distanceM)}</small></bdi>`;
    body = `<p>${escapeHtml(res.found ? t('relay.found') : t('relay.none'))}</p>
      <ol class="relays">${res.candidates
        .map(
          (c, i) => `<li><div>${t('relay.cand_html', { i: i + 1, ground: c.ground.toFixed(0) })}</div>
          <div class="hops"><span><bdi dir="ltr">${t('relay.hop1', { i: i + 1 })}</bdi>: ${hopCell(c.hop1)} <button type="button" class="link" data-hop="1" data-i="${i}">${t('relay.inspect')}</button></span>
          <span><bdi dir="ltr">${t('relay.hop2', { i: i + 1 })}</bdi>: ${hopCell(c.hop2)} <button type="button" class="link" data-hop="2" data-i="${i}">${t('relay.inspect')}</button></span></div></li>`,
        )
        .join('')}</ol>
      <p class="hint">${escapeHtml(t('relay.searched', { n: res.searched }))}</p>`;
  }
  panel.innerHTML = `<h3>${t('relay.title')}</h3>
    <p class="hint">${escapeHtml(t('relay.intro'))}</p>
    <div class="row">
      <label class="inline"><span>${t('relay.height')}</span><input id="relay-h" type="number" min="0" max="500" step="0.5" value="${state.relayHeightM}" /></label>
      <button type="button" class="primary" id="relay-find" ${relayJob ? 'disabled' : ''}>${t('relay.find')}</button>
    </div>${body}`;
}

$('#relay').addEventListener('change', (e) => {
  if (e.target.id !== 'relay-h') return;
  state.relayHeightM = Math.max(0, Number(e.target.value) || 0);
  onChange();
});

$('#relay').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'relay-find') {
    clearRelay();
    const base = { a: { ...state.a }, b: { ...state.b } };
    relay = { base, settingsKey: null, result: null, viewing: null };
    relay.settingsKey = relayKey();
    const job = runJob('relay', { a: base.a, b: base.b, settings: state.settings, relayHeightM: state.relayHeightM });
    relayJob = job;
    if (lastAnalysis) renderRelayPanel(lastAnalysis);
    try {
      const result = await job.promise;
      if (relayJob !== job) return;
      relay.result = result;
      relayJob = null;
      drawRelayMarkers();
      if (lastAnalysis) renderRelayPanel(lastAnalysis);
      const pts = [base.a, base.b, ...result.candidates].map((p) => [p.lat, p.lon]);
      map.fitBounds(L.latLngBounds(pts).pad(0.2));
    } catch (err) {
      if (relayJob !== job) return;
      relayJob = null;
      $('#relay').insertAdjacentHTML('beforeend', `<p class="error">${escapeHtml(err.message)}</p>`);
    }
  } else if (btn.dataset.hop) inspectHop(Number(btn.dataset.i), Number(btn.dataset.hop));
});

function inspectHop(i, hop) {
  if (!relay?.result) return;
  const c = relay.result.candidates[i];
  const r = { lat: c.lat, lon: c.lon, h: c.h };
  relay.viewing = { i, hop };
  if (hop === 1) {
    state.a = { ...relay.base.a };
    state.b = r;
  } else {
    state.a = r;
    state.b = { ...relay.base.b };
  }
  onChange();
}

function renderRelayBanner() {
  const banner = $('#relay-banner');
  if (!relay?.viewing) {
    banner.hidden = true;
    return;
  }
  const { i, hop } = relay.viewing;
  const name = hop === 1 ? t('relay.hop1', { i: i + 1 }) : t('relay.hop2', { i: i + 1 });
  banner.hidden = false;
  banner.innerHTML = `<span>${t('relay.viewing_html', { hop: `<bdi dir="ltr">${name}</bdi>`, i: i + 1 })}</span>
    <button type="button" id="relay-back">${t('relay.back')}</button>`;
}

$('#relay-banner').addEventListener('click', (e) => {
  if (e.target.id !== 'relay-back' || !relay) return;
  const saved = relay;
  state.a = { ...saved.base.a };
  state.b = { ...saved.base.b };
  saved.viewing = null;
  relay = saved;
  onChange();
});

function drawRelayMarkers() {
  relayLayer.clearLayers();
  if (!relay?.result || state.mode !== 'link') return;
  const { base } = relay;
  relay.result.candidates.forEach((c, i) => {
    const v = c.minMarginDb >= 10 ? 'works' : c.minMarginDb >= 0 ? 'marginal' : 'fails';
    const shown = relay.viewing && relay.viewing.i === i;
    if (!shown) {
      L.marker([c.lat, c.lon], { icon: icon(`R${i + 1}`, `r v-${v}`), title: `R${i + 1}` })
        .addTo(relayLayer)
        .on('click', () => inspectHop(i, c.hop1.marginDb <= c.hop2.marginDb ? 1 : 2));
    }
    for (const [from, to, h] of [[base.a, c, c.hop1], [c, base.b, c.hop2]]) {
      L.polyline([[from.lat, from.lon], [to.lat, to.lon]], { color: COLORS[h.verdict], weight: 2, opacity: shown ? 0 : 0.7, dashArray: '2 6' }).addTo(relayLayer);
    }
  });
  if (relay.viewing) {
    // keep the original endpoint that is not part of the shown hop visible
    const other = relay.viewing.hop === 1 ? base.b : base.a;
    L.marker([other.lat, other.lon], { icon: icon(relay.viewing.hop === 1 ? 'B' : 'A', 'ghost'), interactive: false }).addTo(relayLayer);
  }
}

// ------------------------------------------------------------------ coverage map
const coverageParams = () => ({
  tx: state.a,
  radiusM: state.coverage.radiusKm * 1000,
  cellM: autoCellSize(state.coverage.radiusKm * 1000, state.coverage.resolution === 'fine' ? 161 : 81),
  rxHeightM: state.coverage.rxHeightM,
  settings: state.settings,
});
const coverageKey = () => (state.a ? JSON.stringify(coverageParams()) : null);

function renderCoveragePanel() {
  $('#cov-tx').textContent = state.a ? `${t('cov.tx')}: ${state.a.lat.toFixed(5)}, ${state.a.lon.toFixed(5)}` : t('cov.txNone');
  $('#cov-run').disabled = !state.a || !!coverageJob;
  $('#cov-cancel').hidden = !coverageJob;
  const fresh = coverage && coverage.key === coverageKey();
  if (coverage && !fresh && !coverageJob) $('#cov-status').textContent = t('cov.stale');
  else if (!coverageJob && fresh) $('#cov-status').textContent = '';
  if (coverage) {
    const s = coverage.summary;
    $('#cov-summary').innerHTML = t('cov.summary_html', {
      works: s.pctWorks.toFixed(0),
      marginal: s.pctMarginal.toFixed(0),
      fails: s.pctFails.toFixed(0),
      cells: s.total,
      size: coverage.grid.cellM,
    });
  } else $('#cov-summary').innerHTML = '';
}

function drawCoverage() {
  coverageLayer.clearLayers();
  $('#map-legend').hidden = !coverage;
  if (!coverage) return;
  const g = coverage.grid;
  const canvas = document.createElement('canvas');
  canvas.width = g.n;
  canvas.height = g.n;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(coveragePixels(g, coverage.margins), g.n, g.n), 0, 0);
  const fresh = coverage.key === coverageKey();
  L.imageOverlay(canvas.toDataURL(), [[g.south, g.west], [g.north, g.east]], { opacity: fresh ? 1 : 0.45, className: 'coverage-img', interactive: false }).addTo(coverageLayer);
  L.circle([g.center.lat, g.center.lon], { radius: g.radiusM, color: '#1e293b', weight: 1, fill: false, dashArray: '4 4', interactive: false }).addTo(coverageLayer);
}

$('#cov-run').addEventListener('click', async () => {
  if (!state.a || coverageJob) return;
  const params = coverageParams();
  const key = coverageKey();
  const bar = $('#cov-progress');
  bar.hidden = false;
  bar.querySelector('.bar').style.width = '0%';
  bar.querySelector('span').textContent = '';
  $('#cov-status').textContent = '';
  const job = runJob('coverage', params, (done, total) => {
    bar.querySelector('.bar').style.width = `${((100 * done) / total).toFixed(1)}%`;
    bar.querySelector('span').textContent = t('cov.progress', { done, total });
  });
  coverageJob = job;
  renderCoveragePanel();
  try {
    const { grid, margins } = await job.promise;
    coverage = { key, grid, margins, summary: summarizeCoverage(margins) };
    // on phones the button is below the map: bring the result into view
    if (window.matchMedia('(max-width: 860px)').matches) $('.map-wrap').scrollIntoView({ behavior: 'smooth' });
    window.__planner.coverageDone = (window.__planner.coverageDone || 0) + 1;
  } catch (err) {
    $('#cov-status').textContent = err.message === 'cancelled' ? t('cov.cancelled') : t('result.error', { msg: err.message });
  } finally {
    coverageJob = null;
    bar.hidden = true;
    if (state.mode === 'coverage') onChange();
  }
});
$('#cov-cancel').addEventListener('click', () => coverageJob?.cancel());

// ------------------------------------------------------------------ misc
window.addEventListener('hashchange', () => {
  if (location.hash.slice(1) === encodeState(state)) return;
  clearRelay();
  state = decodeState(location.hash);
  onChange();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastAnalysis && state.mode === 'link' && renderProfile($('#profile'), lastAnalysis), 120);
});

initLanguageToggle($('#lang'));
onLangChange(() => {
  fillExamples();
  onChange();
  if (lastAnalysis && state.mode === 'link') renderAll(lastAnalysis);
});

// start
if (state.mode === 'link' && state.a && state.b) map.fitBounds(L.latLngBounds([state.a.lat, state.a.lon], [state.b.lat, state.b.lon]).pad(0.3));
if (state.mode === 'coverage' && state.a) map.setView([state.a.lat, state.a.lon], 11);
onChange();
getDem().catch((e) => console.error('elevation data failed to load', e));

// expose for debugging / automated tests
window.__planner = {
  get state() { return state; },
  get analysis() { return lastAnalysis; },
  get coverage() { return coverage; },
  get relay() { return relay; },
  map,
};
