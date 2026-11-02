/**
 * jobs.js - talk to the Web Worker with promises.
 *   const job = runJob('coverage', params, (done, total) => ...);
 *   job.cancel();  await job.promise;
 */
let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../coverage/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, type } = ev.data;
      const job = pending.get(id);
      if (!job) return;
      if (type === 'progress') job.onProgress?.(ev.data.done, ev.data.total);
      else {
        pending.delete(id);
        if (type === 'done') job.resolve(ev.data.result);
        else job.reject(new Error(ev.data.message));
      }
    };
    worker.onerror = (e) => {
      for (const job of pending.values()) job.reject(new Error(e.message || 'worker failed'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

const demBaseUrl = () => new URL(`${import.meta.env.BASE_URL}dem/`, location.href).href;

export function runJob(type, params, onProgress) {
  const id = nextId++;
  const w = getWorker();
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject, onProgress }));
  w.postMessage({ id, type, demBaseUrl: demBaseUrl(), params });
  return {
    promise,
    cancel() {
      w.postMessage({ id, type: 'cancel' });
    },
  };
}
