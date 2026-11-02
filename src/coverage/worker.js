/**
 * worker.js - Web Worker for the heavy jobs (coverage map, relay search),
 * so the page never freezes. Messages:
 *
 *   in : { id, type: 'coverage', demBaseUrl, params }      -> progress..., done
 *   in : { id, type: 'relay',    demBaseUrl, params }      -> done
 *   in : { id, type: 'cancel' }
 *   out: { id, type: 'progress', done, total }
 *   out: { id, type: 'done', result }
 *   out: { id, type: 'error', message }
 */
import { loadBrowserDem } from '../elevation/dem.js';
import { computeCoverage } from './compute.js';
import { findRelays, relaySearchBox } from '../relay/relay.js';

let demPromise = null;
const cancelled = new Set();

function getDem(baseUrl) {
  if (!demPromise) demPromise = loadBrowserDem(baseUrl).catch((e) => ((demPromise = null), Promise.reject(e)));
  return demPromise;
}

self.onmessage = async (ev) => {
  const { id, type, demBaseUrl, params } = ev.data;
  if (type === 'cancel') {
    cancelled.add(id);
    return;
  }
  try {
    const dem = await getDem(demBaseUrl);
    if (type === 'coverage') {
      const { grid, margins } = await computeCoverage(
        dem,
        params,
        (done, total) => self.postMessage({ id, type: 'progress', done, total }),
        () => cancelled.has(id),
      );
      // the cell list is large and the page can rebuild it; send the geometry only
      const { cells, ...geom } = grid;
      self.postMessage({ id, type: 'done', result: { grid: { ...geom, cellCount: cells.length }, margins } }, [margins.buffer]);
    } else if (type === 'relay') {
      const box = relaySearchBox(params.a, params.b);
      await dem.ensureBox(box.south, box.west, box.north, box.east);
      self.postMessage({ id, type: 'done', result: findRelays(dem, params) });
    } else {
      throw new Error(`unknown job type ${type}`);
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e.message });
  } finally {
    cancelled.delete(id);
  }
};
