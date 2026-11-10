import { recognizeToolRegions } from './tool-recognition.js';
import {recognizeClassical} from './recognize-classical.js';
import {traceAlphaPhoto} from './photo-alpha.js';
import { segmentToolInstances } from './tool-neural.js';
import { validateInstanceImage } from './tool-neural-core.js';

const aborted = () => new DOMException('Rozpoznávání bylo zrušeno.', 'AbortError');

function measureRegions(image, options, signal) {
  if (signal?.aborted) return Promise.reject(aborted());
  if (typeof Worker !== 'function') return Promise.resolve((options.engine==='classical'?recognizeClassical:recognizeToolRegions)(image,{...options,signal}));
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
    const cancel = () => finish(aborted());
    try {
      worker = new Worker(new URL('./recognize-worker.js', import.meta.url), { type: 'module', name: 'tool-regions' });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      timer = setTimeout(() => finish(new Error('Rozpoznávání trvalo příliš dlouho. Zkuste menší snímek nebo novější zařízení.')), 120000);
      worker.onmessage = ({ data }) => {
        if (finished) return;
        if (!data || typeof data !== 'object') { finish(new Error('Rozpoznávání nevrátilo platné oblasti nástrojů.')); return; }
        if (data.progress) { try { options.onProgress?.(data.progress); } catch {} }
        else if (data.error) finish(new Error(data.error));
        else if (data.result) {
          const r = data.result;
          if (r.width !== image.width || r.height !== image.height || !(r.mask instanceof Uint8Array) || r.mask.length !== image.width * image.height || !Array.isArray(r.contours) || !r.contours.every(c => c && Array.isArray(c.points) && c.points.length >= 3 && c.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) || !r.quality || !['ready', 'review', 'retake'].includes(r.quality.status) || !Array.isArray(r.quality.reasons)) {
            finish(new Error('Rozpoznávání nevrátilo platné oblasti nástrojů.')); return;
          }
          finish(null, r);
        } else finish(new Error('Rozpoznávání nevrátilo platné oblasti nástrojů.'));
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error('Automatické rozpoznávání se nepodařilo spustit. Obnovte aplikaci a zkuste to znovu.')); };
      worker.onmessageerror = () => finish(new Error('Masku rozpoznaných nástrojů se nepodařilo předat. Zkuste snímek znovu.'));
      const pixels = new Uint8ClampedArray(image.data);
      const { onProgress, ...workerOptions } = options;
      const transfer = [pixels.buffer];
      // Only inference-owned buffers move; the user's source photograph stays intact.
      if (workerOptions.prototypes) transfer.push(workerOptions.prototypes.buffer);
      for (const instance of workerOptions.instances || []) {
        if (instance.mask?.data) transfer.push(instance.mask.data.buffer);
        if (instance.probability?.data) transfer.push(instance.probability.data.buffer);
      }
      worker.postMessage({ image: { width: image.width, height: image.height, data: pixels }, options: workerOptions }, [...new Set(transfer)]);
    } catch (error) { finish(error); }
  });
}

/** Source-coordinate physical objects. Calibration, editing and pocket fitting remain downstream. */
export async function recognizeTools(image, { pxPerMm = 1, kind = 'paper', signal, onProgress, useNeural = true } = {}) {
  // Native server masks are independent of the legacy browser NN's 16MP cap.
  // Validate before touching bytes, then let genuine alpha bypass that NN.
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<2||image.height<2||image.width*image.height>64000000||!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||image.data.length!==image.width*image.height*4)throw new Error('Obrázek nemá platná pixelová data.');
  if (signal?.aborted) throw aborted();
  const alpha=traceAlphaPhoto(image,{signal});if(alpha){try{onProgress?.({stage:'done',progress:1,message:'Používám průhlednost obrázku…'});}catch{}if(signal?.aborted)throw aborted();return alpha;}
  validateInstanceImage(image);
  let completed = 0;
  const progress = event => {
    if (signal?.aborted) return;
    if (Number.isFinite(event.progress)) { completed = Math.max(completed, Math.min(1, Math.max(0, event.progress))); event = { ...event, progress: completed }; }
    try { onProgress?.(useNeural?event:{...event,phase:'classical'}); } catch {}
  };
  const hasWorker = typeof Worker === 'function';
  let neural = null, neuralUnavailable = useNeural&&!hasWorker;
  const neuralAttempted=useNeural&&hasWorker;
  if (neuralAttempted) {
    try { neural = await segmentToolInstances(image, { signal, onProgress: progress }); }
    catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw aborted();
      neuralUnavailable = true;
    }
  }
  if (signal?.aborted) throw aborted();
  progress({ stage: 'refine', progress: neuralAttempted ? .91 : .05, message: 'Skládám části nástrojů a měřím jejich obrysy…' });
  const result = await measureRegions(image, {
    pxPerMm, kind, engine:useNeural?'physical':'classical', onProgress: event => progress({ ...event, progress: (neuralAttempted ? .91 : .05) + (neuralAttempted ? .08 : .94) * Math.max(0, Math.min(1, event.progress || 0)) }),
    ...(neural ? { instances: neural.instances, weakProposals: neural.weakProposals, prototypes: neural.prototypes, transform: neural.transform } : {})
  }, signal);
  if (signal?.aborted) throw aborted();
  result.engine=useNeural?'physical':'classical';result.neuralDisabled=!useNeural;
  result.neuralModel = neural?.model || null;
  result.neuralUnavailable = neuralUnavailable;
  if(!useNeural&&kind==='reference'&&result.quality.status!=='retake'){
    result.quality.status='review';result.requiresReview=true;
    result.quality.reasons=['Návrh z běžné fotografie zkontrolujte podle originálu. Stíny, odlesky a nejasné hrany lze opravit výběrem.',...result.quality.reasons];
  }
  if (!hasWorker) result.diagnostics = { ...result.diagnostics, neuralSkipped: 'worker-unavailable' };
  if (hasWorker && neuralUnavailable && result.quality.status !== 'retake') {
    result.requiresReview = true;
    result.quality.status = 'review';
    result.quality.reasons = ['Lokální neuronové rozpoznávání nebylo dostupné. Zkontrolujte úplnost a oddělení nástrojů podle fotografie.', ...result.quality.reasons];
  }
  progress({ stage: 'done', progress: 1, message: result.quality.status === 'ready' ? 'Obrysy jsou připravené.' : 'Zkontrolujte nalezené obrysy podle fotografie.' });
  return result;
}
