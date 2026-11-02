import { loadBrowserDem } from '../elevation/dem.js';

let demPromise = null;

/** The shared elevation model, loaded once per page. */
export function getDem() {
  if (!demPromise) {
    demPromise = loadBrowserDem(`${import.meta.env.BASE_URL}dem/`).catch((e) => {
      demPromise = null;
      throw e;
    });
  }
  return demPromise;
}
