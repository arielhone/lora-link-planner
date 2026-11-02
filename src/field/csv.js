/**
 * csv.js - the field-test CSV format, shared by the web app and the firmware.
 *
 * One row = one field test (or, from the firmware, one summary of N packets).
 * Columns may come in any order; unknown columns are ignored on import.
 * Lines starting with '#' are comments (the firmware prints per-packet
 * details that way).
 */

export const CSV_COLUMNS = [
  'timestamp',
  'a_lat',
  'a_lon',
  'a_height_m',
  'b_lat',
  'b_lon',
  'b_height_m',
  'freq_mhz',
  'sf',
  'bw_khz',
  'tx_power_dbm',
  'tx_gain_dbi',
  'rx_gain_dbi',
  'tx_cable_loss_db',
  'rx_cable_loss_db',
  'rssi_dbm',
  'snr_db',
  'packets_received',
  'packets_lost',
  'notes',
];

/** Extra columns written on export (ignored on import). */
export const EXPORT_EXTRA_COLUMNS = ['distance_m', 'predicted_rssi_dbm', 'predicted_snr_db', 'predicted_margin_db'];

/** Parse CSV text into an array of rows (arrays of strings). RFC 4180 quoting. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRow();
    else if (ch !== '\r') field += ch;
    i++;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

function escape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const NUMERIC = new Set(CSV_COLUMNS.filter((c) => c !== 'timestamp' && c !== 'notes'));

/**
 * CSV text -> field-test records (plain objects keyed by column name).
 * Numeric columns become numbers, or null when empty.
 */
export function csvToRecords(text) {
  const rows = parseCsv(text).filter((r) => !(r[0] || '').trimStart().startsWith('#'));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('rssi_dbm')) throw new Error('CSV header must contain at least an "rssi_dbm" column');
  return rows.slice(1).map((r) => {
    const rec = {};
    header.forEach((h, idx) => {
      if (!CSV_COLUMNS.includes(h)) return;
      const raw = (r[idx] ?? '').trim();
      if (NUMERIC.has(h)) {
        const n = raw === '' ? null : Number(raw);
        rec[h] = Number.isFinite(n) ? n : null;
      } else rec[h] = raw;
    });
    return rec;
  });
}

/** Field-test records -> CSV text (with header). */
export function recordsToCsv(records, columns = [...CSV_COLUMNS, ...EXPORT_EXTRA_COLUMNS]) {
  const lines = [columns.join(',')];
  for (const r of records) lines.push(columns.map((c) => escape(r[c])).join(','));
  return lines.join('\n') + '\n';
}
