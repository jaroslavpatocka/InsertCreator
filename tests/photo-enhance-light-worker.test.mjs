import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { lightWrenchesPhoto } from './fixtures/light-tools.mjs';
import { maskMetrics } from './fixtures/tool-photos.mjs';
import { renderCase, cases } from './fixtures/color-tools.mjs';

const created = [], instances = new Set(), sent = [];
class BrowserWorker {
  constructor(url) {
    this.url = String(url);
    created.push(String(url));
    this.inner = new NodeWorker(new URL('./worker-adapter.mjs', import.meta.url), { workerData: { url: String(url) } });
    instances.add(this);
    this.inner.on('message', data => this.onmessage?.({ data }));
    this.inner.on('error', error => this.onerror?.({ message: error.message, error, preventDefault() {} }));
  }
  postMessage(message, transfer) { sent.push({url: this.url, message}); this.inner.postMessage(message, transfer); }
  terminate() { instances.delete(this); return this.inner.terminate(); }
}

test('reflective light tools retain measured boundaries with actual instance inference and cancellation', { timeout: 120000 }, async t => {
  const previousWorker = globalThis.Worker;
  globalThis.Worker = BrowserWorker;
  t.after(async () => {
    await Promise.all([...instances].map(worker => worker.terminate()));
    if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;
  });
  const { recognizeTools } = await import('../dist/recognize.js');
  await t.test('untouched measurement source reaches the real contour worker', async () => {
    const image = lightWrenchesPhoto(), source = image.data.slice(), progress = [];
    const result = await recognizeTools(image, { pxPerMm: 2, onProgress: event => progress.push(event) });
    assert.equal(result.quality.status, 'ready', JSON.stringify(result.quality));
    assert.equal(result.contours.length, 2);
    assert.equal(result.neuralModel, 'fastsam-s');
    assert.equal(result.neuralUnavailable, false);
    assert.ok(maskMetrics(result.mask, image.truth).iou > .93);
    assert.deepEqual(image.data, source, 'transfer never detaches or edits the caller photograph');
    assert.ok(created.some(url => url.endsWith('/recognize-worker.js')));
    assert.ok(created.some(url => url.endsWith('/tool-neural-worker.js')), 'light photographs receive real instance inference');
    assert.ok(progress.some(event => event.phase === 'inference'), 'the model actually runs');
    const fractions = progress.map(event => event.progress).filter(Number.isFinite);
    assert.ok(fractions.length > 2, 'recognition reports finite progress throughout its phases');
    assert.ok(fractions.every((fraction, index) => fraction >= 0 && fraction <= 1 && (!index || fraction >= fractions[index - 1])), 'progress never moves backwards when inference hands off to contour measurement');
    assert.equal(fractions.at(-1), 1, 'completed recognition ends at full progress');
    const physical = sent.find(row => row.url.endsWith('/recognize-worker.js')).message;
    assert.equal(physical.image.width, image.width);
    assert.equal(physical.image.height, image.height);
    assert.equal(physical.options.pxPerMm, 2);
    assert.equal(instances.size, 0, 'NN heap and contour worker released before using the result');
  });
  await t.test('pre-aborted light work starts no worker', async () => {
    const controller = new AbortController(); controller.abort();
    const count = created.length;
    await assert.rejects(recognizeTools(lightWrenchesPhoto(), { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(created.length, count);
  });
  await t.test('a long unobservable connector on a dark plain mat stays reviewable in an actual worker', async () => {
    const image = renderCase(cases.find(item => item.id === 'charcoal-missing-connector')), original = image.data.slice();
    const result = await recognizeTools(image, { kind: 'reference', pxPerMm: 2 });
    assert.equal(result.quality.status, 'review', JSON.stringify(result.quality));
    assert.equal(result.contours.length, 4, 'only the four visible parts may be traced');
    assert.equal(result.mask[371 * image.width + 360], 0, 'the invisible connector cannot be filled by inference');
    assert.deepEqual(image.data, original);
  });
  await t.test('abort while instance inference is processing rejects and terminates it', async () => {
    const createdBefore = created.length;
    const controller = new AbortController(); let started = false;
    await assert.rejects(recognizeTools(lightWrenchesPhoto(), { signal: controller.signal, onProgress: event => {
      if (event.phase === 'inference') { started = true; controller.abort(); }
    } }), { name: 'AbortError' });
    assert.equal(started, true, 'abort occurs when the actual worker reports inference');
    assert.equal(created.slice(createdBefore).some(url => url.endsWith('/recognize-worker.js')), false, 'aborting inference starts no contour work');
    assert.equal(instances.size, 0, 'abort releases every worker');
  });
});
