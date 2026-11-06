import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { lightWrenchesPhoto } from './fixtures/light-tools.mjs';
import { maskMetrics } from './fixtures/tool-photos.mjs';

const created = [], instances = new Set(), sent = [];
class BrowserWorker {
  constructor(url) {
    created.push(String(url));
    this.inner = new NodeWorker(new URL('./worker-adapter.mjs', import.meta.url), { workerData: { url: String(url) } });
    instances.add(this);
    this.inner.on('message', data => this.onmessage?.({ data }));
    this.inner.on('error', error => this.onerror?.({ message: error.message, error, preventDefault() {} }));
  }
  postMessage(message, transfer) { sent.push(message); this.inner.postMessage(message, transfer); }
  terminate() { return this.inner.terminate(); }
}

test('reflective light tools use actual recognition workers without neural replacement and support cancellation', { timeout: 30000 }, async t => {
  const previousWorker = globalThis.Worker;
  globalThis.Worker = BrowserWorker;
  t.after(async () => {
    await Promise.all([...instances].map(worker => worker.terminate()));
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
  });
  const { recognizeTools } = await import('../dist/recognize.js');
  await t.test('normalized light image and untouched measurement source reach the real classical worker', async () => {
    const image = lightWrenchesPhoto(), source = image.data.slice(), progress = [];
    const result = await recognizeTools(image, { pxPerMm: 2, onProgress: event => progress.push(event) });
    assert.equal(result.enhanced, 'light-background');
    assert.equal(result.quality.status, 'ready', JSON.stringify(result.quality));
    assert.equal(result.contours.length, 2);
    assert.equal(result.neuralModel, null);
    assert.ok(maskMetrics(result.mask, image.truth).iou > .93);
    assert.deepEqual(image.data, source, 'transfer never detaches or edits the caller photograph');
    assert.ok(progress.some(event => event.stage === 'enhance'));
    assert.ok(progress.some(event => event.stage === 'refine'), 'the worker measures the original image');
    assert.ok(created.some(url => url.endsWith('/recognize-worker.js')));
    assert.equal(created.some(url => url.endsWith('/neural-worker.js')), false, 'the light-mask success is not replaced by a coarse neural mask');
    assert.equal(sent[0].options.kind, 'light');
    assert.equal(sent[0].options.source.width, image.width);
    assert.equal(sent[0].options.source.height, image.height);
  });
  await t.test('pre-aborted light work starts no worker', async () => {
    const controller = new AbortController(); controller.abort();
    const count = created.length;
    await assert.rejects(recognizeTools(lightWrenchesPhoto(), { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(created.length, count);
  });
  await t.test('abort while the classical worker is processing rejects and terminates it', async () => {
    const controller = new AbortController(); let started = false;
    await assert.rejects(recognizeTools(lightWrenchesPhoto(), { signal: controller.signal, onProgress: event => {
      if (event.stage === 'background') { started = true; controller.abort(); }
    } }), { name: 'AbortError' });
    assert.equal(started, true, 'abort occurs after the actual worker reports its first stage');
    assert.equal(created.some(url => url.endsWith('/neural-worker.js')), false);
  });
});
