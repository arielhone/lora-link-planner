export const fmtDb = (v, digits = 1) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(digits)} dB`;
export const fmtDbm = (v, digits = 1) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(digits)} dBm`;
export const fmtSigned = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
export const fmtTime = (s) => (s >= 1 ? `${s.toFixed(2)} s` : `${(s * 1000).toFixed(1)} ms`);
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const VERDICT_TEXT = {
  works: { title: 'Link works', icon: '✅', sub: 'Plenty of reserve (≥ 10 dB margin).' },
  marginal: { title: 'Marginal', icon: '⚠️', sub: 'Should get through sometimes; expect lost packets (0–10 dB margin).' },
  fails: { title: 'Link fails', icon: '❌', sub: 'The signal arrives weaker than the receiver can hear.' },
};
