import { validateInstanceImage } from './tool-neural-core.js';

const abortError = () => new DOMException('Rozpoznávání bylo zrušeno.', 'AbortError');

/** One inference per disposable worker. The source photo always stays owned by its caller. */
export function segmentToolInstances(image, { signal, onProgress, timeoutMs = 90000 } = {}) {
  try { validateInstanceImage(image); } catch (error) { return Promise.reject(error); }
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker !== 'function') return Promise.reject(new Error('Tento prohlížeč nepodporuje lokální rozpoznávání. Použijte aktuální Chrome, Edge, Firefox nebo Safari.'));
  return new Promise((resolve, reject) => {
    let worker, timer, finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker?.terminate();
      error ? reject(error) : resolve(result);
    };
    const cancel = () => finish(abortError());
    try {
      worker = new Worker(new URL('./tool-neural-worker.js', import.meta.url), { type: 'module', name: 'tool-instances' });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      timer = setTimeout(() => finish(new Error('Rozpoznávání trvalo příliš dlouho. Zkuste menší snímek nebo novější zařízení.')), timeoutMs);
      worker.onmessage = ({ data }) => {
        if (finished) return;
        if (!data || typeof data !== 'object') { finish(new Error('Rozpoznávání nevrátilo platné oblasti nástrojů.')); return; }
        if (data.id !== 1) return;
        if (data.type === 'progress') {
          try { onProgress?.({ phase: data.phase, stage: data.phase, progress: data.progress, message: data.message }); } catch {}
        } else if (data.type === 'error') finish(new Error(data.message));
        else if (data.type === 'result') {
          if (data.width !== image.width || data.height !== image.height || !Array.isArray(data.instances) || !Array.isArray(data.weakProposals) || !(data.prototypes instanceof Float32Array) || data.prototypes.length !== 32 * 256 * 256 || !data.transform || data.transform.width !== image.width || data.transform.height !== image.height) {
            finish(new Error('Rozpoznávání nevrátilo platné oblasti nástrojů.')); return;
          }
          finish(null, data);
        } else finish(new Error('Rozpoznávání nevrátilo platné oblasti nástrojů.'));
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error('Lokální rozpoznávání se nepodařilo spustit. Obnovte stránku a zkuste snímek znovu.')); };
      worker.onmessageerror = () => finish(new Error('Masku rozpoznaných nástrojů se nepodařilo předat. Zkuste snímek znovu.'));
      const pixels = new Uint8ClampedArray(image.data);
      worker.postMessage({ id: 1, width: image.width, height: image.height, buffer: pixels.buffer }, [pixels.buffer]);
    } catch (error) { finish(error); }
  });
}
