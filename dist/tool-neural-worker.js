import { INSTANCE_SIZE, prepareInstanceInput, readInstanceDetections, decodeInstanceMask } from './tool-neural-core.js';

const notify = (id, phase, progress, message) => self.postMessage({ id, type: 'progress', phase, progress, message });
let busy = false;
self.onmessage = async ({ data: { id, width, height, buffer } }) => {
  if (busy) return;
  busy = true;
  let session, input, outputs;
  try {
    notify(id, 'loading', .02, 'Načítám rozpoznávání…');
    const ort = await import('./vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.simd = true;
    const response = await fetch(new URL('./models/fastsam_s.onnx', import.meta.url), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Model rozpoznávání se nepodařilo načíst. Zkontrolujte připojení a zkuste snímek znovu.');
    notify(id, 'loading', .12, 'Připravuji lokální neuronovou síť…');
    session = await ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    notify(id, 'preprocess', .2, 'Připravuji fotografii pro rozpoznávání…');
    const { values, transform } = prepareInstanceInput({ width, height, data: new Uint8ClampedArray(buffer) });
    input = new ort.Tensor('float32', values, [1, 3, INSTANCE_SIZE, INSTANCE_SIZE]);
    notify(id, 'inference', .3, 'Rozpoznávám nástroje přímo v zařízení…');
    outputs = await session.run({ [session.inputNames[0]]: input });
    const detections = outputs[session.outputNames[0]], prototypeOutput = outputs[session.outputNames[1]];
    const proposals = readInstanceDetections(detections.data, detections.dims, transform, { confidence: .25, nmsIoU: .7 });
    const baseIds = new Set(proposals.map(row => row.id));
    const weakProposals = readInstanceDetections(detections.data, detections.dims, transform, { confidence: .05, nmsIoU: .7 }).filter(row => !baseIds.has(row.id));
    const prototypes = new Float32Array(prototypeOutput.data);
    const instances = [];
    for (const [i, proposal] of proposals.entries()) {
      notify(id, 'postprocess', .65 + .25 * i / Math.max(1, proposals.length), 'Odděluji jednotlivé části nástrojů…');
      instances.push(decodeInstanceMask(proposal, prototypes, prototypeOutput.dims, transform));
    }
    // Dispose the inference session before handing compact proposals to the geometry worker.
    input.dispose?.(); input = null;
    for (const tensor of Object.values(outputs)) tensor.dispose?.(); outputs = null;
    await session.release(); session = null;
    const transfer = [prototypes.buffer];
    for (const instance of instances) { transfer.push(instance.mask.data.buffer); if (instance.probability) transfer.push(instance.probability.data.buffer); }
    self.postMessage({ id, type: 'result', width, height, model: 'fastsam-s', instances, weakProposals, prototypes, transform }, transfer);
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || 'Rozpoznávání se nepodařilo dokončit.' });
  } finally {
    input?.dispose?.();
    if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose?.();
    if (session) await session.release().catch(() => {});
  }
};
