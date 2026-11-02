/**
 * i18n - tiny translation helper (no library).
 *
 *   t('result.distance')               -> "Distance" / "מרחק"
 *   t('cov.progress', {done, total})   -> placeholders {done} {total}
 *   applyTranslations(document)        -> fills [data-i18n], [data-i18n-html],
 *                                         [data-i18n-attr="title:key;aria-label:key"]
 *
 * Language: saved choice (localStorage) > browser language > English.
 * Hebrew switches the page to right-to-left.
 */
import { STRINGS } from './strings.js';

export const LANGUAGES = { en: { dir: 'ltr' }, he: { dir: 'rtl' } };
const STORAGE_KEY = 'lora-link-planner.lang';

/** Choose the initial language. Pure, testable. */
export function detectLanguage(saved, navigatorLanguages = []) {
  if (saved && LANGUAGES[saved]) return saved;
  for (const l of navigatorLanguages) {
    const code = String(l).toLowerCase().split('-')[0];
    if (code === 'iw') return 'he'; // legacy code for Hebrew
    if (LANGUAGES[code]) return code;
  }
  return 'en';
}

function readSaved() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let lang = typeof navigator === 'undefined' ? 'en' : detectLanguage(readSaved(), navigator.languages || [navigator.language]);
const listeners = new Set();

export const getLang = () => lang;

/** Translate a key; falls back to English, then to the key itself. */
export function t(key, params) {
  let s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
  return s;
}

/** Switch language, update the document and notify listeners. */
export function setLang(next) {
  if (!LANGUAGES[next]) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode: fine, just not remembered */
  }
  applyTranslations(document);
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
}

export function applyTranslations(root) {
  if (root.documentElement) {
    root.documentElement.lang = lang;
    root.documentElement.dir = LANGUAGES[lang].dir;
  }
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

/** Wire a language toggle button (shows the *other* language's name). */
export function initLanguageToggle(button) {
  applyTranslations(document);
  button.addEventListener('click', () => setLang(lang === 'he' ? 'en' : 'he'));
}
