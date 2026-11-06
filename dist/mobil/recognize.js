import { autoTraceImage } from './auto-trace.js';
import { segmentNeural } from './neural.js';
import { readableImage } from './photo-enhance.js';
import { recoverDarkTools } from './photo-recovery.js';
import { i18nError } from './i18n.js';
// Progress messages and worker errors are Czech source text; capture.js translates them with t()/errorText().

const aborted = () => new DOMException('Rozpoznávání bylo zrušeno.', 'AbortError');
function classical(image, options, signal) {
  if (signal?.aborted) return Promise.reject(aborted());
  if (typeof Worker !== 'function') return autoTraceImage(image, options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./recognize-worker.js', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const cancel = () => finish(aborted());
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.progress) options.onProgress?.(data.progress);
      else if (data.error) finish(new Error(data.error));
      else finish(null, data.result);
    };
    worker.onerror = () => finish(i18nError('Automatické rozpoznávání se nepodařilo spustit. Obnovte aplikaci a zkuste to znovu.'));
    const pixels = new Uint8ClampedArray(image.data);
    const probability = options.probability ? new Float32Array(options.probability) : null;
    const source = options.source ? { width: options.source.width, height: options.source.height, data: new Uint8ClampedArray(options.source.data) } : null;
    worker.postMessage({ image: { width: image.width, height: image.height, data: pixels }, options: { pxPerMm: options.pxPerMm, kind: options.kind, probability, source } }, [pixels.buffer, ...(probability ? [probability.buffer] : []), ...(source ? [source.data.buffer] : [])]);
  });
}

/** No user thresholds or hand-drawn corrections: learned foreground + measured RGB edges. */
export async function recognizeTools(image, { pxPerMm = 1, kind = 'paper', signal, onProgress } = {}) {
  if (signal?.aborted) throw aborted();
  const progress = event => { if (!signal?.aborted) onProgress?.(event); };
  // Light tools on a dark insert would be traced as one dark object, whatever its score, so this comes first.
  const readable = readableImage(image);
  if (readable) {
    progress({ stage: 'enhance', progress: .05, message: 'Upravuji fotku, aby byly nástroje čitelné…' });
    const light = readable.name === 'light-background';
    const recovered = light ? readable.image : recoverDarkTools(image, readable.image);
    const result = await classical(recovered, { pxPerMm, kind: light ? 'light' : 'tray', source: image, onProgress: progress }, signal);
    if (signal?.aborted) throw aborted();
    if (result.quality.status !== 'retake' && result.contours.length >= (light ? 1 : 2)) {
      result.enhanced = readable.name; result.neuralModel = null;
      progress({ stage: 'done', progress: 1, message: result.quality.status === 'ready' ? 'Obrysy jsou připravené.' : 'Fotka potřebuje lepší podmínky.' });
      return result;
    }
  }
  progress({ stage: 'recognition', progress: .05, message: 'Odděluji nástroje od papíru…' });
  const [base, neural] = await Promise.allSettled([
    // With a worker this pass is normally replaced by the neural one below, so it skips the measuring.
    classical(image, { pxPerMm, kind, source: typeof Worker === 'function' ? null : image, onProgress: progress }, signal),
    typeof Worker === 'function' ? segmentNeural(image, { onProgress: progress, signal }) : Promise.resolve(null)
  ]);
  if (signal?.aborted) throw aborted();
  let result;
  if (neural.status === 'fulfilled' && neural.value?.probability) {
    progress({ stage: 'refine', progress: .86, message: 'Zpřesňuji skutečné hrany a odstraňuji stíny…' });
    result = await classical(image, { pxPerMm, kind, probability: neural.value.probability, source: image, onProgress: progress }, signal);
    result.neuralModel = neural.value.model;
  } else if (base.status === 'fulfilled') {
    result = typeof Worker === 'function' ? await classical(image, { pxPerMm, kind, source: image, onProgress: progress }, signal) : base.value;
    result.neuralModel = null;
    result.neuralUnavailable = neural.status === 'rejected';
  } else throw base.reason || i18nError('Fotografii se nepodařilo zpracovat.');
  progress({ stage: 'done', progress: 1, message: result.quality.status === 'ready' ? 'Obrysy jsou připravené.' : 'Fotka potřebuje lepší podmínky.' });
  return result;
}
