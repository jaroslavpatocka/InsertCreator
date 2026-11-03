import test from 'node:test';
import assert from 'node:assert/strict';
import { autoTraceImage } from '../dist/auto-trace.js';

function fixture(width, height, background = () => [246, 247, 243]) {
  const data = new Uint8ClampedArray(width * height * 4), truth = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = (y * width + x) * 4, color = background(x, y); data[p] = color[0]; data[p + 1] = color[1]; data[p + 2] = color[2]; data[p + 3] = 255; }
  return { width, height, data, truth };
}
function paint(im, x, y, w, h, rgb, object = true) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const p = yy * im.width + xx, color = typeof rgb === 'function' ? rgb(xx, yy) : rgb; for (let k = 0; k < 3; k++) im.data[p * 4 + k] = color[k]; if (object) im.truth[p] = 1; }
}
function iou(a, b) { let union = 0, intersection = 0; for (let i = 0; i < a.length; i++) { union += +(a[i] || b[i]); intersection += +(a[i] && b[i]); } return union ? intersection / union : 0; }

test('automatic mode recovers two full tools under a smooth lighting gradient', async () => {
  const im = fixture(500, 400, (x, y) => { const light = 205 + x * .07 + y * .025; return [light, light + 2, light - 1]; });
  paint(im, 65, 55, 35, 260, [55, 60, 57]);
  paint(im, 305, 60, 13, 165, [185, 190, 187]); paint(im, 287, 215, 49, 105, [186, 56, 32]);
  const result = await autoTraceImage(im, { pxPerMm: 2 });
  assert.equal(result.contours.length, 2);
  assert.ok(iou(result.mask, im.truth) > .93, JSON.stringify(result.diagnostics));
  assert.equal(result.quality.status, 'ready', JSON.stringify(result.quality));
});

test('soft neutral shadow is not accepted as an expanded tool silhouette', async () => {
  const im = fixture(440, 400);
  for (let y = 35; y < 355; y++) for (let x = 100; x < 265; x++) { const distance = Math.hypot(Math.max(0, 158 - x, x - 197), Math.max(0, 75 - y, y - 310)), drop = 38 * Math.exp(-distance * distance / 450); const p = (y * im.width + x) * 4; for (let k = 0; k < 3; k++) im.data[p + k] -= drop; }
  paint(im, 145, 65, 35, 250, [70, 75, 69]);
  const result = await autoTraceImage(im, { pxPerMm: 2 });
  assert.equal(result.contours.length, 1);
  assert.ok(iou(result.mask, im.truth) > .9, JSON.stringify(result.diagnostics));
});

test('enclosed pixel edges recover bright metal interior instead of fragmenting it', async () => {
  const im = fixture(420, 360, () => [248, 248, 248]);
  paint(im, 120, 55, 65, 240, [92, 94, 93]);
  paint(im, 123, 58, 59, 234, [248, 248, 248]);
  const result = await autoTraceImage(im, { pxPerMm: 2 });
  assert.equal(result.contours.length, 1);
  assert.ok(iou(result.mask, im.truth) > .93, JSON.stringify(result.diagnostics));
});

test('a uniform photograph cannot fabricate a tool', async () => {
  const im = fixture(260, 220);
  const result = await autoTraceImage(im);
  assert.equal(result.contours.length, 0); assert.equal(result.quality.status, 'retake'); assert.equal(result.quality.score0to1, 0);
});

test('pure illumination gradient and broad soft shadows do not become confidently accepted tools', async () => {
  const im = fixture(320, 280, (x, y) => { const drop = 35 * Math.exp(-((x - 145) ** 2 + (y - 145) ** 2) / 3000), light = 218 + x * .08 - drop; return [light, light, light]; });
  const result = await autoTraceImage(im);
  assert.equal(result.quality.status, 'retake', JSON.stringify(result.diagnostics));
});

test('transparent background composites onto paper and alpha-zero RGB does not invent foreground', async () => {
  const im = fixture(250, 250, () => [0, 0, 0]);
  for (let i = 0; i < im.width * im.height; i++) im.data[i * 4 + 3] = 0;
  paint(im, 80, 35, 35, 170, [45, 55, 45]);
  for (let y = 35; y < 205; y++) for (let x = 80; x < 115; x++) im.data[(y * im.width + x) * 4 + 3] = 255;
  const result = await autoTraceImage(im);
  assert.equal(result.contours.length, 1); assert.ok(iou(result.mask, im.truth) > .94);
});

test('neural prior remains an optional identity cue and does not coarsen stronger image edges', async () => {
  const im = fixture(360, 320); paint(im, 105, 45, 42, 220, [60, 65, 60]);
  const probability = new Float32Array(im.width * im.height).fill(.01);
  for (let y = 35; y < 275; y++) for (let x = 95; x < 157; x++) probability[y * im.width + x] = .9;
  const result = await autoTraceImage(im, { pxPerMm: 2, probability });
  assert.equal(result.contours.length, 1); assert.ok(iou(result.mask, im.truth) > .93, JSON.stringify(result.diagnostics));
  assert.notEqual(result.method, 'neural-prior');
});

test('invalid model masks and invalid images fail clearly', async () => {
  await assert.rejects(() => autoTraceImage(fixture(100, 100), { probability: new Float32Array(20) }), /rozměr/);
  await assert.rejects(() => autoTraceImage({ width: 100, height: 100, data: [] }), /platná/);
});

test('a reflective gap cannot confidently split a shaft and handle into two tools', async () => {
  const im = fixture(330, 330);
  paint(im, 145, 35, 12, 150, [80, 84, 80]); paint(im, 128, 191, 46, 85, [135, 40, 28]);
  const result = await autoTraceImage(im, { pxPerMm: 2 });
  assert.equal(result.contours.length, 2);
  assert.equal(result.quality.status, 'review', JSON.stringify(result.quality));
  assert.ok(result.quality.reasons.some(reason => reason.includes('stejnému nástroji')));
});

test('a valid tool cannot conceal another tool cut off by the calibrated paper edge', async () => {
  const im = fixture(330, 330);
  paint(im, 50, 35, 30, 230, [40, 45, 40]); paint(im, 0, 90, 20, 130, [50, 55, 50]);
  const result = await autoTraceImage(im, { pxPerMm: 2 });
  assert.equal(result.contours.length, 1);
  assert.equal(result.quality.status, 'review', JSON.stringify(result.quality));
  assert.ok(result.quality.reasons.some(reason => reason.includes('okraji papíru')));
});
