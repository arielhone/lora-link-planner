import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState, defaultState } from '../src/app/state.js';
import { parseCsv, csvToRecords, recordsToCsv, CSV_COLUMNS } from '../src/field/csv.js';

test('URL hash round trip', () => {
  const s = defaultState();
  s.a = { lat: 32.68661234, lon: 35.35, h: 2 };
  s.b = { lat: 32.7, lon: 35.43, h: 12.5 };
  s.settings.sf = 12;
  s.settings.bandwidthKHz = 250;
  s.settings.chip = 'sx1276';
  s.settings.txGainDbi = 3;
  const hash = encodeState(s);
  assert.match(hash, /^a=32\.68661,35\.35,2&b=32\.7,35\.43,12\.5/);
  assert.ok(!/(^|&)f=/.test(hash), 'defaults are omitted');
  const d = decodeState('#' + hash);
  assert.deepEqual(d.b, s.b);
  assert.equal(d.a.lat, 32.68661);
  assert.equal(d.settings.sf, 12);
  assert.equal(d.settings.bandwidthKHz, 250);
  assert.equal(d.settings.chip, 'sx1276');
  assert.equal(d.settings.txGainDbi, 3);
  assert.equal(d.settings.freqMHz, 917.3);
});

test('invalid hash values fall back to defaults', () => {
  const d = decodeState('a=foo&b=91,0,1&sf=13&bw=300&chip=evil&f=abc');
  assert.equal(d.a, null);
  assert.equal(d.b, null);
  assert.equal(d.settings.sf, 9);
  assert.equal(d.settings.bandwidthKHz, 125);
  assert.equal(d.settings.chip, 'sx1262');
  assert.equal(d.settings.freqMHz, 917.3);
  assert.equal(decodeState('a=32,35').a.h, 2);
});

test('CSV parser handles quotes, commas, newlines and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","he said ""hi"""\n2,"multi\nline",\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'he said "hi"'], ['2', 'multi\nline', '']]);
});

test('CSV records round trip, comments ignored, empty numbers are null', () => {
  const recs = [{ timestamp: '2026-11-02T10:00:00Z', a_lat: 32.1, a_lon: 34.8, rssi_dbm: -110, snr_db: -3.5, sf: 9, notes: 'roof, windy' }];
  const csv = recordsToCsv(recs);
  const back = csvToRecords('# comment from firmware\n' + csv);
  assert.equal(back.length, 1);
  assert.equal(back[0].rssi_dbm, -110);
  assert.equal(back[0].notes, 'roof, windy');
  assert.equal(back[0].b_lat, null);
  assert.ok(!('predicted_rssi_dbm' in back[0]));
});

test('CSV import requires rssi column', () => {
  assert.throws(() => csvToRecords('foo,bar\n1,2\n'), /rssi_dbm/);
  assert.equal(CSV_COLUMNS[0], 'timestamp');
});

test('CSV import skips repeated header lines (firmware output)', () => {
  const header = CSV_COLUMNS.join(',');
  const row = '120,,,2,,,2,917.3,9,125,14,0.0,0.0,0.0,0.0,-102.5,5.75,19,1,seq 0-19';
  const recs = csvToRecords(`# boot\n${header}\n${row}\n${header}\n${row}\n`);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].packets_lost, 1);
  assert.equal(recs[1].a_lat, null);
  assert.equal(recs[1].a_height_m, 2);
});

test('coverage mode, environment and relay height survive the URL', () => {
  const s = defaultState();
  s.mode = 'coverage';
  s.a = { lat: 32.76, lon: 35.02, h: 10 };
  s.coverage = { radiusKm: 30, rxHeightM: 1.5, resolution: 'fine' };
  s.settings.environment = 'custom';
  s.settings.clutterLossDb = 7.5;
  s.relayHeightM = 12;
  const d = decodeState(encodeState(s));
  assert.equal(d.mode, 'coverage');
  assert.deepEqual(d.coverage, s.coverage);
  assert.equal(d.settings.environment, 'custom');
  assert.equal(d.settings.clutterLossDb, 7.5);
  assert.equal(d.relayHeightM, 12);
  const bad = decodeState('m=x&cr=7&crx=-1&cres=ultra&env=space&rh=abc');
  assert.equal(bad.mode, 'link');
  assert.equal(bad.coverage.radiusKm, 10);
  assert.equal(bad.coverage.rxHeightM, 2);
  assert.equal(bad.coverage.resolution, 'normal');
  assert.equal(bad.settings.environment, 'open');
  assert.equal(bad.relayHeightM, 5);
});
