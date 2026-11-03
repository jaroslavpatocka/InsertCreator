import test from 'node:test';
import assert from 'node:assert/strict';
import { traceImage, detectPaper, rectifyImage, calibrateSegment, polygonArea } from '../dist/trace.js';

function image(width, height, value = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value; data[i * 4 + 3] = 255; }
  return { data, width, height };
}
function rect(im, x, y, w, h, value) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const p = (yy * im.width + xx) * 4; im.data[p] = im.data[p + 1] = im.data[p + 2] = value;
  }
}

test('separates multiple tools, rejects specks, and closes exterior around internal holes', () => {
  const im = image(240, 180);
  rect(im, 20, 20, 35, 110, 25); rect(im, 25, 40, 10, 20, 255);
  rect(im, 110, 35, 85, 27, 65); rect(im, 210, 150, 1, 1, 0);
  const result = traceImage(im);
  assert.equal(result.contours.length, 2);
  assert.ok(result.contours.every(c => c.points.length >= 4 && c.points.length < 20));
  assert.ok(Math.abs(result.contours[0].area - 35 * 110) < 120);
  assert.ok(Math.abs(result.contours[1].width - 85) <= 2);
});

test('omits objects cut off by image border', () => {
  const im = image(120, 120); rect(im, 0, 20, 35, 60, 0); rect(im, 70, 30, 20, 50, 20);
  assert.equal(traceImage(im).contours.length, 1);
});

test('traces bright tools on dark background with inversion', () => {
  const im = image(120, 120, 10); rect(im, 30, 20, 35, 65, 230);
  const result = traceImage(im, { invert: true });
  assert.equal(result.contours.length, 1); assert.ok(result.contours[0].area > 2000);
});

test('uniform photo does not produce fabricated tools', () => {
  assert.equal(traceImage(image(120, 100, 250)).contours.length, 0);
  assert.equal(detectPaper(image(120, 100, 250)), null);
});

test('detects white A4-like sheet against a darker tabletop', () => {
  const im = image(300, 260, 55); rect(im, 70, 20, 140, 220, 245); rect(im, 95, 50, 30, 100, 30);
  const corners = detectPaper(im);
  assert.equal(corners.length, 4);
  assert.ok(Math.abs(corners[0].x - 70) <= 2 && Math.abs(corners[0].y - 20) <= 2);
  assert.ok(polygonArea(corners) > 29000);
});

test('perspective correction maps all four corners and centre', () => {
  const im = image(200, 160, 200);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const p = (y * im.width + x) * 4; im.data[p] = x; im.data[p + 1] = y;
  }
  const corners = [{ x: 25, y: 10 }, { x: 160, y: 30 }, { x: 180, y: 140 }, { x: 10, y: 125 }];
  const result = rectifyImage(im, corners, 100, 80, 100);
  assert.equal(result.imageData.width, 100); assert.equal(result.imageData.height, 80); assert.equal(result.pxPerMm, 1);
  for (const [x, y, p] of [[0, 0, corners[0]], [99, 0, corners[1]], [99, 79, corners[2]], [0, 79, corners[3]]]) {
    const i = (y * 100 + x) * 4;
    assert.ok(Math.abs(result.imageData.data[i] - p.x) <= 1);
    assert.ok(Math.abs(result.imageData.data[i + 1] - p.y) <= 1);
  }
});

test('rejects invalid calibration quadrilaterals and ruler distances', () => {
  const im = image(100, 100);
  assert.throws(() => rectifyImage(im, [{ x: 0, y: 0 }, { x: 90, y: 90 }, { x: 90, y: 0 }, { x: 0, y: 90 }]));
  assert.throws(() => calibrateSegment({ x: 1, y: 1 }, { x: 1, y: 1 }, 100));
  assert.equal(calibrateSegment({ x: 10, y: 30 }, { x: 210, y: 30 }, 100), 2);
});

test('whole photo flow preserves physical dimensions and separates a thin shaft from its neighbour', () => {
  const im = image(420, 440, 65);
  rect(im, 60, 20, 280, 396, 248);
  rect(im, 85, 70, 30, 220, 35);
  rect(im, 220, 80, 10, 160, 90); rect(im, 210, 230, 30, 100, 50);
  const corners = detectPaper(im);
  assert.ok(corners, 'white paper must be calibrated before tracing');
  const calibrated = rectifyImage(im, corners, 210, 297, 594);
  const result = traceImage(calibrated.imageData);
  assert.equal(result.contours.length, 2);
  const dimensions = result.contours.map(c => ({ width: c.width / calibrated.pxPerMm, height: c.height / calibrated.pxPerMm }));
  assert.ok(dimensions.every(d => d.width >= 21 && d.width <= 25));
  assert.ok(dimensions.some(d => d.height >= 163 && d.height <= 168));
  assert.ok(dimensions.some(d => d.height >= 185 && d.height <= 190));
});
