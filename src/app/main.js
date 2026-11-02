/**
 * main.js - the planner page: map, settings, profile chart and result card.
 * All physics lives in src/physics; this file only wires the UI together.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

import { analyzeLink } from '../physics/pathAnalysis.js';
import { terrainProfile } from '../elevation/profile.js';
import { getDem } from './demInstance.js';
import { decodeState, encodeState, DEFAULT_ANTENNA_HEIGHT_M } from './state.js';
import { renderProfile } from './profileChart.js';
import { EXAMPLES } from './examples.js';
import { fmtDb, fmtDbm, fmtDist, fmtTime, fmtSigned, escapeHtml, VERDICT_TEXT } from './format.js';

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ state
let state = decodeState(location.hash);
let lastAnalysis = null;

// ------------------------------------------------------------------ map
const ISRAEL_BOUNDS = L.latLngBounds([29.45, 34.2], [33.35, 35.95]);
const map = L.map('map', { zoomControl: true, minZoom: 6 }).fitBounds(ISRAEL_BOUNDS);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const icon = (label) =>
  L.divIcon({ className: `pin pin-${label.toLowerCase()}`, html: `<span><b>${label}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 30] });

const markers = { a: null, b: null };
const line = L.polyline([], { weight: 4, opacity: 0.85, dashArray: '8 6' }).addTo(map);

function placeMarker(which) {
  const p = state[which];
  if (!p) {
    if (markers[which]) markers[which].remove();
    markers[which] = null;
    return;
  }
  if (!markers[which]) {
    markers[which] = L.marker([p.lat, p.lon], { icon: icon(which.toUpperCase()), draggable: true, autoPan: true })
      .addTo(map)
      .on('drag', (e) => {
        const ll = e.target.getLatLng();
        state[which] = { ...state[which], lat: ll.lat, lon: ll.lng };
        updateLine();
      })
      .on('dragend', () => onChange());
  } else markers[which].setLatLng([p.lat, p.lon]);
}

function updateLine() {
  line.setLatLngs(state.a && state.b ? [[state.a.lat, state.a.lon], [state.b.lat, state.b.lon]] : []);
}

map.on('click', (e) => {
  const p = { lat: e.latlng.lat, lon: e.latlng.lng };
  if (!state.a || (state.a && state.b)) {
    // first click, or start over after both points are placed
    state.a = { ...p, h: Number($('#hA').value) || DEFAULT_ANTENNA_HEIGHT_M };
    state.b = null;
  } else {
    state.b = { ...p, h: Number($('#hB').value) || DEFAULT_ANTENNA_HEIGHT_M };
  }
  onChange();
});

// ------------------------------------------------------------------ forms
function writeForm() {
  for (const input of document.querySelectorAll('#settings [data-key]')) {
    input.value = String(state.settings[input.dataset.key]);
  }
  $('#hA').value = state.a ? state.a.h : $('#hA').value;
  $('#hB').value = state.b ? state.b.h : $('#hB').value;
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
for (const [id, which] of [['#hA', 'a'], ['#hB', 'b']]) {
  $(id).addEventListener('change', () => {
    const h = Math.max(0, Number($(id).value) || 0);
    if (state[which]) state[which].h = h;
    onChange();
  });
}

const examplesSel = $('#examples');
EXAMPLES.forEach((ex, i) => examplesSel.add(new Option(ex.name, String(i))));
examplesSel.addEventListener('change', () => {
  const ex = EXAMPLES[Number(examplesSel.value)];
  examplesSel.value = '';
  if (!ex) return;
  state.a = { ...ex.a };
  state.b = { ...ex.b };
  map.fitBounds(L.latLngBounds([ex.a.lat, ex.a.lon], [ex.b.lat, ex.b.lon]).pad(0.3));
  onChange();
});
$('#swap').addEventListener('click', () => {
  [state.a, state.b] = [state.b, state.a];
  onChange();
});
$('#reset').addEventListener('click', () => {
  state.a = null;
  state.b = null;
  onChange();
});

// ------------------------------------------------------------------ compute
let seq = 0;
let timer = null;

function onChange() {
  placeMarker('a');
  placeMarker('b');
  updateLine();
  writeForm();
  const hash = encodeState(state);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  $('#field-link').href = `./field.html${hash ? `#${hash}` : ''}`;
  $('#map-hint').innerHTML = !state.a ? 'Click the map to place <b>A</b>' : !state.b ? 'Now click to place <b>B</b>' : 'Drag the pins to move them · click again to start over';
  $('#coords').textContent = [state.a && `A ${state.a.lat.toFixed(5)}, ${state.a.lon.toFixed(5)}`, state.b && `B ${state.b.lat.toFixed(5)}, ${state.b.lon.toFixed(5)}`]
    .filter(Boolean)
    .join(' · ');
  clearTimeout(timer);
  timer = setTimeout(compute, 60);
}

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
    $('#result').innerHTML = `<p class="error">Could not compute the link: ${escapeHtml(err.message)}</p>`;
  } finally {
    if (my === seq) $('#result').classList.remove('busy');
  }
}

// ------------------------------------------------------------------ render
function renderEmpty() {
  line.setStyle({ color: '#2563eb' });
  $('#result').className = 'card result empty-card';
  $('#result').innerHTML = `<p>Click two points on the map: <b>A</b> is the transmitter, <b>B</b> the receiver. Or pick one of the <b>Examples</b>.</p>`;
  $('#profile').innerHTML = '<p class="empty">Place two points to see the terrain between them.</p>';
  $('#whatif').innerHTML = '';
  $('#compliance').innerHTML = '';
}

const COLORS = { works: '#16a34a', marginal: '#d97706', fails: '#dc2626' };

function renderAll(r) {
  line.setStyle({ color: COLORS[r.verdict] });
  renderProfile($('#profile'), r);
  renderResult(r);
  renderWhatIf(r);
  $('#compliance').innerHTML = r.compliance.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join('');
}

function renderResult(r) {
  const v = VERDICT_TEXT[r.verdict];
  const g = r.geometry;
  const clearance = g.lineOfSight
    ? g.minFresnelFraction >= 0.6
      ? 'Clear line of sight and ≥ 60% Fresnel clearance'
      : `Line of sight, but terrain enters the Fresnel zone (${Math.round(g.minFresnelFraction * 100)}% clear)`
    : 'Line of sight is blocked by terrain';
  $('#result').className = `card result v-${r.verdict}`;
  $('#result').innerHTML = `
    <div class="verdict"><span class="vi">${v.icon}</span><div><b>${v.title}</b><small>${v.sub}</small></div>
      <div class="margin"><span>${fmtSigned(r.marginDb)}</span><small>dB margin</small></div></div>
    ${r.outsideCoverage ? '<p class="warn">⚠ A point is outside the elevation data (Israel and surroundings); terrain there is treated as sea level.</p>' : ''}
    <table class="kv">
      <tr><th>Distance</th><td>${fmtDist(r.distanceM)}</td></tr>
      <tr><th>Path</th><td>${clearance}</td></tr>
      <tr><th>EIRP</th><td>${fmtDbm(r.eirpDbm)}</td></tr>
      <tr><th>Free-space path loss</th><td>${fmtDb(r.pathLossDb)}</td></tr>
      <tr><th>Obstruction loss</th><td>${fmtDb(r.obstructionLossDb)}${r.diffractionEdges.length ? ` <small>(${r.diffractionEdges.length} edge${r.diffractionEdges.length > 1 ? 's' : ''})</small>` : ''}</td></tr>
      <tr><th>Received power</th><td>${fmtDbm(r.rxPowerDbm)}</td></tr>
      <tr><th>Sensitivity (SF${r.settings.sf}/${r.settings.bandwidthKHz})</th><td>${fmtDbm(r.sensitivityDbm)}</td></tr>
      <tr><th>Link margin</th><td><b>${fmtDb(r.marginDb)}</b></td></tr>
      <tr><th>Expected SNR</th><td>${fmtDb(r.snrDb)}</td></tr>
      <tr><th>Time on air (${r.settings.payloadBytes} B)</th><td>${fmtTime(r.timeOnAirS)}</td></tr>
    </table>
    <details class="statement"><summary>Show the full "bank statement"</summary>
      <table class="kv">${r.lines.map((l) => `<tr><th>${l.label}</th><td>${fmtSigned(l.value)} dB</td></tr>`).join('')}
      <tr class="total"><th>= Received power</th><td>${fmtDbm(r.rxPowerDbm)}</td></tr>
      <tr><th>− Sensitivity</th><td>${fmtDbm(r.sensitivityDbm)}</td></tr>
      <tr class="total"><th>= Margin</th><td>${fmtDb(r.marginDb)}</td></tr></table>
    </details>`;
}

function renderWhatIf(r) {
  const w = r.whatIf;
  const s = r.settings;
  const rows = w.sfTable
    .map(
      (row) => `<tr class="${row.sf === s.sf ? 'cur' : ''} v-${row.verdict}">
        <td>SF${row.sf}</td><td>${fmtDbm(row.sensitivityDbm, 1)}</td><td><b>${fmtSigned(row.marginDb)}</b></td><td>${fmtTime(row.timeOnAirS)}</td>
        <td>${row.sf === s.sf ? '●' : `<button type="button" class="link" data-sf="${row.sf}">use</button>`}</td></tr>`,
    )
    .join('');
  let sfAdvice;
  if (w.firstWorkingSf !== null) {
    sfAdvice = w.firstWorkingSf === s.sf ? `SF${s.sf} is already the fastest SF that works reliably.` : w.firstWorkingSf < s.sf ? `You could use the faster <b>SF${w.firstWorkingSf}</b> and still have ≥ 10 dB margin.` : `Use at least <b>SF${w.firstWorkingSf}</b> for a reliable link.`;
  } else if (w.firstMarginalSf !== null) {
    sfAdvice = `No SF gives a 10 dB reserve; <b>SF${w.firstMarginalSf}</b>+ might work marginally.`;
  } else sfAdvice = 'No spreading factor at this bandwidth closes the link. Change the antennas or the location.';

  let hAdvice;
  if (w.extraHeightBothM === 0) hAdvice = 'Already ≥ 60% of the first Fresnel zone is clear. 👍';
  else {
    const parts = [];
    if (w.extraHeightBothM !== null) parts.push(`raise <b>both</b> antennas to <b>A ${w.antennaHeightBothA.toFixed(1)} m</b> and <b>B ${w.antennaHeightBothB.toFixed(1)} m</b> <button type="button" class="link" data-apply="both">apply</button>`);
    if (w.antennaHeightForAOnlyM !== null) parts.push(`raise only <b>A to ${w.antennaHeightForAOnlyM.toFixed(1)} m</b> <button type="button" class="link" data-apply="a">apply</button>`);
    if (w.antennaHeightForBOnlyM !== null) parts.push(`raise only <b>B to ${w.antennaHeightForBOnlyM.toFixed(1)} m</b> <button type="button" class="link" data-apply="b">apply</button>`);
    hAdvice = parts.length ? `To clear 60% of the Fresnel zone: ${parts.join(', or ')}.` : 'No realistic mast height (< 2 km) clears this path; find a different site or add a relay.';
  }

  $('#whatif').innerHTML = `
    <h3>What if…</h3>
    <p>${sfAdvice}</p>
    <table class="sf"><thead><tr><th>SF</th><th>Sensitivity</th><th>Margin</th><th>Airtime</th><th></th></tr></thead><tbody>${rows}</tbody></table>
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

window.addEventListener('hashchange', () => {
  if (location.hash.slice(1) === encodeState(state)) return;
  state = decodeState(location.hash);
  onChange();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastAnalysis && renderProfile($('#profile'), lastAnalysis), 120);
});

// start
if (state.a && state.b) map.fitBounds(L.latLngBounds([state.a.lat, state.a.lon], [state.b.lat, state.b.lon]).pad(0.3));
onChange();
getDem().catch((e) => console.error('elevation data failed to load', e));

// expose for debugging / automated tests
window.__planner = { get state() { return state; }, get analysis() { return lastAnalysis; } };
