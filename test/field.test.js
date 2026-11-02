import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordToLinkInput, linkInputToRecordFields, errorStats, hasPoints } from '../src/field/records.js';
import { DEFAULT_SETTINGS } from '../src/physics/pathAnalysis.js';

test('record <-> link input round trip', () => {
  const input = {
    a: { lat: 32.1, lon: 34.8, h: 3 },
    b: { lat: 32.2, lon: 34.9, h: 10 },
    settings: { ...DEFAULT_SETTINGS, sf: 12, txGainDbi: 2 },
  };
  const rec = linkInputToRecordFields(input);
  assert.equal(rec.sf, 12);
  assert.ok(hasPoints(rec));
  const back = recordToLinkInput(rec);
  assert.deepEqual(back.a, input.a);
  assert.equal(back.settings.sf, 12);
  assert.equal(back.settings.txGainDbi, 2);
});

test('missing settings fall back to defaults; missing points detected', () => {
  const r = recordToLinkInput({ a_lat: 32, a_lon: 35, b_lat: 32.1, b_lon: 35, sf: null });
  assert.equal(r.settings.sf, DEFAULT_SETTINGS.sf);
  assert.equal(r.a.h, 2);
  assert.equal(hasPoints({ a_lat: 32, a_lon: 35, b_lat: null, b_lon: 35 }), false);
});

test('error statistics', () => {
  const s = errorStats([
    { rssi_dbm: -100, predicted_rssi_dbm: -104, snr_db: 5, predicted_snr_db: 3 },
    { rssi_dbm: -120, predicted_rssi_dbm: -118 },
    { rssi_dbm: -90 }, // no prediction: ignored
  ]);
  assert.equal(s.rssi.n, 2);
  assert.equal(s.rssi.mean, 1); // (+4 - 2) / 2
  assert.equal(s.rssi.rmse, Math.sqrt((16 + 4) / 2));
  assert.equal(s.snr.n, 1);
  assert.equal(errorStats([]).rssi.mean, null);
});

import { bestFitExtraLoss } from '../src/field/records.js';

test('best-fit extra loss is the mean shortfall, and reduces the RMS error', () => {
  const recs = [
    { rssi_dbm: -110, predicted_rssi_open_dbm: -98, predicted_rssi_dbm: -98 }, // 12 dB worse
    { rssi_dbm: -120, predicted_rssi_open_dbm: -112, predicted_rssi_dbm: -112 }, // 8 dB worse
    { rssi_dbm: -100 }, // no prediction: ignored
  ];
  const fit = bestFitExtraLoss(recs);
  assert.equal(fit.lossDb, 10);
  assert.equal(fit.n, 2);
  assert.equal(fit.rmseAfterDb, 2);
  assert.ok(fit.rmseBeforeDb > fit.rmseAfterDb);
});

test('best-fit extra loss is never negative; null without data', () => {
  assert.equal(bestFitExtraLoss([{ rssi_dbm: -90, predicted_rssi_open_dbm: -100 }]).lossDb, 0);
  assert.equal(bestFitExtraLoss([]), null);
  assert.equal(bestFitExtraLoss([{ rssi_dbm: -90 }]), null);
});
