import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { segmentToolInstances } from '../dist/tool-neural.js';
import { recognizeTools } from '../dist/recognize.js';
import { prepareInstanceInput } from '../dist/tool-neural-core.js';

const image = () => ({ width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) });
function workerFixture(run) {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor(url) { this.url = String(url); this.terminated = false; workers.push(this); }
    postMessage(message, transfer) { const cloned = structuredClone(message, { transfer }); run(this, cloned); }
    terminate() { this.terminated = true; }
  };
  return { workers, close() { if (previous === undefined) delete globalThis.Worker; else globalThis.Worker = previous; } };
}
test('instance success releases worker before resolving without detaching the source photograph', async () => {
  const fixture = workerFixture((worker, data) => queueMicrotask(() => worker.onmessage({ data: {
    id: data.id, type: 'result', width: 16, height: 16, instances: [], weakProposals: [],
    prototypes: new Float32Array(32 * 256 * 256), transform: { width: 16, height: 16 }, model: 'fastsam-s'
  } })));
  try { const source = image(), before = source.data.slice(); await segmentToolInstances(source); assert.deepEqual(source.data, before); assert.ok(fixture.workers[0].terminated); }
  finally { fixture.close(); }
});
test('instance cancellation kills inference and leaves caller-owned pixels intact', async () => {
  const fixture = workerFixture(() => {});
  try { const source = image(), controller = new AbortController(), promise = segmentToolInstances(source, { signal: controller.signal }); controller.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.ok(fixture.workers[0].terminated); assert.equal(source.data.byteLength, 1024); }
  finally { fixture.close(); }
});
test('instance timeout terminates the worker and a later result cannot resolve it', async () => {
  const fixture = workerFixture(() => {});
  try { await assert.rejects(segmentToolInstances(image(), { timeoutMs: 10 }), /příliš dlouho/); assert.ok(fixture.workers[0].terminated); }
  finally { fixture.close(); }
});
test('malformed worker geometry is rejected and released', async () => {
  const fixture = workerFixture((worker, message) => queueMicrotask(() => worker.onmessage({ data: { id: message.id, type: 'result', width: 1, height: 1 } })));
  try { await assert.rejects(segmentToolInstances(image()), /platné oblasti/); assert.ok(fixture.workers[0].terminated); }
  finally { fixture.close(); }
});
test('instance pre-abort starts no worker', async () => {
  const fixture = workerFixture(() => {});
  try { const controller = new AbortController(); controller.abort(); await assert.rejects(segmentToolInstances(image(), { signal: controller.signal }), { name: 'AbortError' }); assert.equal(fixture.workers.length, 0); }
  finally { fixture.close(); }
});
test('null worker payload fails immediately and releases resources', async () => {
  const fixture = workerFixture(worker => queueMicrotask(() => worker.onmessage({ data: null })));
  try { await assert.rejects(segmentToolInstances(image()), /platné oblasti/); assert.ok(fixture.workers[0].terminated); }
  finally { fixture.close(); }
});
test('malformed source-worker contours reject without leaving either worker alive', async () => {
  const fixture = workerFixture((worker, message) => queueMicrotask(() => {
    if (worker.url.endsWith('/tool-neural-worker.js')) worker.onmessage({ data: { id: message.id, type: 'error', message: 'Controlled unavailable model' } });
    else worker.onmessage({ data: { result: { width: 16, height: 16, mask: new Uint8Array(256), contours: [null], quality: { status: 'ready', reasons: [] } } } });
  }));
  try { await assert.rejects(recognizeTools(image()), /platné oblasti/); assert.equal(fixture.workers.length, 2); assert.ok(fixture.workers.every(w => w.terminated)); }
  finally { fixture.close(); }
});
test('top-left letterbox keeps a nonzero inverse scale for a valid extreme aspect ratio', () => {
  const source = { width: 65536, height: 16, data: new Uint8ClampedArray(65536 * 16 * 4).fill(255) };
  const { values, transform } = prepareInstanceInput(source);
  assert.equal(transform.resizedHeight, 1); assert.ok(transform.scaleY > 0); assert.ok(values.every(Number.isFinite));
});
test('installed instance model matches the exact retained provenance', () => {
  const metadata = JSON.parse(fs.readFileSync(new URL('../dist/models/FASTSAM-PROVENANCE.json', import.meta.url)));
  const bytes = fs.readFileSync(new URL('../dist/models/fastsam_s.onnx', import.meta.url));
  assert.equal(bytes.length, metadata.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
});
