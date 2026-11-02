import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS } from '../src/i18n/strings.js';
import { detectLanguage, t } from '../src/i18n/index.js';

test('every English key has a Hebrew translation and vice versa', () => {
  const en = Object.keys(STRINGS.en);
  const he = Object.keys(STRINGS.he);
  assert.deepEqual(en.filter((k) => !(k in STRINGS.he)), []);
  assert.deepEqual(he.filter((k) => !(k in STRINGS.en)), []);
});

test('placeholders match between languages', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(STRINGS.en)) assert.equal(ph(STRINGS.he[k]), ph(STRINGS.en[k]), k);
});

test('language detection', () => {
  assert.equal(detectLanguage(null, ['he-IL', 'en-US']), 'he');
  assert.equal(detectLanguage(null, ['iw']), 'he');
  assert.equal(detectLanguage(null, ['fr-FR', 'en-GB']), 'en');
  assert.equal(detectLanguage(null, ['fr-FR']), 'en');
  assert.equal(detectLanguage('en', ['he-IL']), 'en');
  assert.equal(detectLanguage('xx', ['he']), 'he');
});

test('t() fills placeholders and falls back to the key', () => {
  assert.equal(t('cov.progress', { done: 5, total: 10 }), 'Computing… 5 / 10 cells');
  assert.equal(t('no.such.key'), 'no.such.key');
});
