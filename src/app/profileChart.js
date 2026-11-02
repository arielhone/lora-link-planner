/**
 * profileChart.js - draws the terrain profile as an SVG:
 * ground (with earth curvature added), the straight line of sight between the
 * antennas, the first Fresnel zone as a shaded ellipse, and the points where
 * the terrain blocks the line (red) or intrudes into 60% of the Fresnel zone
 * (orange). Diffraction edges used by the loss model are labelled.
 */
const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** "Nice" tick values covering [min, max] with roughly `count` ticks. */
export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * @param {HTMLElement} container
 * @param {object} analysis result of analyzeLink()
 */
export function renderProfile(container, analysis) {
  container.innerHTML = '';
  const pts = analysis.geometry.points;
  const W = Math.max(280, container.clientWidth);
  const H = Math.max(170, container.clientHeight);
  const m = { l: 52, r: 14, t: 22, b: 30 };
  const D = analysis.distanceM;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of pts) {
    yMin = Math.min(yMin, p.terrain, p.los - p.r1);
    yMax = Math.max(yMax, p.terrain, p.los + p.r1);
  }
  const pad = (yMax - yMin) * 0.08 || 10;
  yMin -= pad;
  yMax += pad;

  const x = (d) => m.l + (d / D) * (W - m.l - m.r);
  const y = (h) => m.t + (1 - (h - yMin) / (yMax - yMin)) * (H - m.t - m.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Terrain profile between A and B' }, container);

  // grid + axes
  const g = el('g', { class: 'axis' }, svg);
  const km = D >= 2000;
  for (const t of niceTicks(0, km ? D / 1000 : D, Math.max(3, Math.floor(W / 90)))) {
    const xx = x(km ? t * 1000 : t);
    el('line', { x1: xx, x2: xx, y1: m.t, y2: H - m.b, class: 'grid' }, g);
    el('text', { x: xx, y: H - m.b + 16, 'text-anchor': 'middle' }, g).textContent = km ? `${t} km` : `${t} m`;
  }
  for (const t of niceTicks(yMin, yMax, Math.max(3, Math.floor(H / 45)))) {
    const yy = y(t);
    el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'grid' }, g);
    el('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }, g).textContent = `${t} m`;
  }

  // Fresnel zone (ellipse-like band around the LOS)
  const upper = pts.map((p) => `${x(p.d)},${y(p.los + p.r1)}`);
  const lower = pts.map((p) => `${x(p.d)},${y(p.los - p.r1)}`).reverse();
  el('polygon', { points: [...upper, ...lower].join(' '), class: 'fresnel' }, svg);
  // 60% clearance line (dashed) under the LOS
  el('polyline', { points: pts.map((p) => `${x(p.d)},${y(p.los - 0.6 * p.r1)}`).join(' '), class: 'fresnel60' }, svg);

  // terrain (ground + earth bulge)
  const terr = pts.map((p) => `${x(p.d)},${y(p.terrain)}`);
  el('polygon', { points: `${x(0)},${H - m.b} ${terr.join(' ')} ${x(D)},${H - m.b}`, class: 'terrain' }, svg);

  // coloured runs along the terrain outline: ok / intrudes Fresnel / blocks LOS.
  // Each segment takes the worse class of its two end points.
  const rank = (p) => (p.blocksLos ? 2 : p.inFresnel ? 1 : 0);
  const names = ['ok', 'intrude', 'block'];
  const drawRun = (s0, e0, c) => {
    const run = pts.slice(s0, e0 + 1).map((p) => `${x(p.d)},${y(p.terrain)}`);
    el('polyline', { points: run.join(' '), class: `outline ${names[c]}` }, svg);
  };
  let start = 0;
  let cur = Math.max(rank(pts[0]), rank(pts[1]));
  for (let i = 1; i < pts.length - 1; i++) {
    const c = Math.max(rank(pts[i]), rank(pts[i + 1]));
    if (c !== cur) {
      drawRun(start, i, cur);
      start = i;
      cur = c;
    }
  }
  drawRun(start, pts.length - 1, cur);

  // line of sight
  el('line', { x1: x(0), y1: y(pts[0].los), x2: x(D), y2: y(pts.at(-1).los), class: 'los' }, svg);

  // antennas
  for (const [p, label] of [[pts[0], 'A'], [pts.at(-1), 'B']]) {
    el('line', { x1: x(p.d), x2: x(p.d), y1: y(p.terrain), y2: y(p.los), class: 'mast' }, svg);
    el('circle', { cx: x(p.d), cy: y(p.los), r: 4, class: 'ant' }, svg);
    const tx = el('text', { x: x(p.d) + (label === 'A' ? 7 : -7), y: y(p.los) - 6, 'text-anchor': label === 'A' ? 'start' : 'end', class: 'antlabel' }, svg);
    tx.textContent = label;
  }

  // diffraction edges with their loss. Biggest loss first; skip a label when
  // it would overlap one already drawn (edges on one hill are often close).
  const placed = [];
  for (const e of [...analysis.diffractionEdges].sort((p, q) => q.loss - p.loss)) {
    const p = pts[e.index];
    if (!p) continue;
    const ex = x(p.d);
    el('circle', { cx: ex, cy: y(p.terrain), r: 4.5, class: 'edge' }, svg);
    if (placed.some((px) => Math.abs(px - ex) < 58)) continue;
    placed.push(ex);
    const t = el('text', { x: ex, y: Math.max(m.t - 6, y(p.terrain) - 9), 'text-anchor': 'middle', class: 'edgelabel' }, svg);
    t.textContent = `−${e.loss.toFixed(1)} dB`;
  }

  // hover read-out
  const cursor = el('line', { y1: m.t, y2: H - m.b, class: 'cursor', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  container.appendChild(tip);
  const overlay = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const d = Math.min(D, Math.max(0, ((px - m.l) / (W - m.l - m.r)) * D));
    const i = Math.round((d / D) * (pts.length - 1));
    const p = pts[i];
    cursor.setAttribute('x1', x(p.d));
    cursor.setAttribute('x2', x(p.d));
    cursor.setAttribute('visibility', 'visible');
    const frac = Number.isFinite(p.fresnelFraction) ? `${Math.round(p.fresnelFraction * 100)}% of F1` : '—';
    tip.innerHTML =
      `<b>${(p.d / 1000).toFixed(2)} km</b><br>ground ${p.ground.toFixed(0)} m (+${p.bulge.toFixed(1)} m curve)` +
      `<br>clearance ${p.clearance.toFixed(1)} m (${frac})<br>Fresnel radius ${p.r1.toFixed(1)} m`;
    tip.hidden = false;
    const left = (x(p.d) / W) * rect.width;
    tip.style.left = `${Math.min(rect.width - 170, Math.max(0, left + 10))}px`;
  };
  overlay.addEventListener('pointermove', move);
  overlay.addEventListener('pointerdown', move);
  overlay.addEventListener('pointerleave', () => {
    cursor.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}
