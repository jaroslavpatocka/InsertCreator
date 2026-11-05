import test from 'node:test';
import assert from 'node:assert/strict';
import { regularizeContour } from '../dist/contour-smoothing.js';

function noisyCircle(radius = 30, count = 720) {
  return Array.from({ length: count }, (_, i) => {
    const angle = i * Math.PI * 2 / count, r = radius + .65 * Math.sin(angle * 31) + .2 * Math.sin(angle * 67);
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
}
function radialMoment(points, moment) {
  let total = 0, perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    for (let j = 0; j < 20; j++) { const t = (j + .5) / 20; total += moment(Math.hypot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) * length / 20; }
    perimeter += length;
  }
  return total / perimeter;
}
const rmsRadius = (points, radius) => Math.sqrt(radialMoment(points, r => (r - radius) ** 2));
const meanRadius = points => radialMoment(points, r => r);
function sampledPolygon(vertices, noise = 0, step = .4) {
  return vertices.flatMap((a, edge) => {
    const b = vertices[(edge + 1) % vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.ceil(length / step);
    return Array.from({ length: count }, (_, i) => {
      const t = i / count, fade = Math.min(1, Math.max(0, Math.min(t, 1 - t) * length - 2) / 2), wobble = noise * Math.sin(i * 2.3) * fade;
      return { x: a.x + (b.x - a.x) * t - (b.y - a.y) / length * wobble, y: a.y + (b.y - a.y) * t + (b.x - a.x) / length * wobble };
    });
  });
}
function pointDistance(p, ring) {
  return Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }));
}
function inside(p, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

test('reduces high frequency radial chatter without shrinking round heads', () => {
  const original = noisyCircle(), result = regularizeContour(original, 1);
  assert.ok(rmsRadius(result, 30) < rmsRadius(original, 30) * .5);
  assert.ok(Math.abs(meanRadius(result) - 30) < .08);
  assert.ok(original.every(p => pointDistance(p, result) <= 1.001));
  assert.ok(result.every(p => pointDistance(p, original) <= 1.001));
  assert.ok(result.length < 120, 'manufacturing contour does not retain dense working samples');
});

test('reconstructs regular straight sides and keeps measured corners', () => {
  const corners = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 100 }, { x: 0, y: 100 }], original = sampledPolygon(corners, .6);
  const result = regularizeContour(original, 1);
  assert.equal(result.length, 4);
  for (const p of corners) assert.ok(result.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8));
});

test('keeps a narrow open jaw and the shaft material separate', () => {
  const jaw = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 20 }, { x: 8, y: 20 }, { x: 8, y: 80 }, { x: 4, y: 80 }, { x: 4, y: 20 }, { x: 0, y: 20 }];
  const result = regularizeContour(sampledPolygon(jaw, .12), .5);
  assert.equal(inside({ x: 6, y: 3 }, result), false, 'jaw opening stays empty');
  assert.equal(inside({ x: 6, y: 12 }, result), true, 'head bridge remains');
  assert.equal(inside({ x: 6, y: 50 }, result), true, 'thin shaft remains');
  assert.equal(inside({ x: 3, y: 50 }, result), false);
  assert.ok(jaw.every(p => pointDistance(p, result) <= .501), 'small concave corners stay inside the cleanup budget');
});

test('uses physical scale and rotation rather than axis aligned coordinate snapping', () => {
  const original = noisyCircle(), angle = .731, scale = 3.7;
  const transform = p => ({ x: 50 + scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)), y: -20 + scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)) });
  const result = regularizeContour(original, 1).map(transform), transformed = regularizeContour(original.map(transform), scale);
  assert.equal(result.length, transformed.length);
  assert.ok(result.every((p, i) => Math.hypot(p.x - transformed[i].x, p.y - transformed[i].y) < 1e-7));
});

test('zero tolerance returns an independent measured outline', () => {
  const original = noisyCircle(), snapshot = structuredClone(original), result = regularizeContour(original, 0);
  assert.deepEqual(result, original); result[0].x = 1000; assert.deepEqual(original, snapshot);
});

test('closed seam and winding do not determine the recovered shape', () => {
  const original = noisyCircle(), baseline = regularizeContour(original, 1);
  const shifted = regularizeContour([...original.slice(137), ...original.slice(0, 137)], 1), reversed = regularizeContour([...original].reverse(), 1);
  for (const result of [shifted, reversed]) {
    assert.ok(result.every(p => pointDistance(p, baseline) <= .22));
    assert.ok(baseline.every(p => pointDistance(p, result) <= .22));
  }
});

test('removes an isolated narrow spur inside the measured error budget', () => {
  const original = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 45 }, { x: 12.8, y: 45.2 }, { x: 12, y: 45.4 }, { x: 12, y: 100 }, { x: 0, y: 100 }];
  const result = regularizeContour(original, 1);
  assert.equal(result.length, 4);
  assert.ok(result.every(p => p.x <= 12 && p.x >= 0));
  assert.ok(original.every(p => pointDistance(p, result) <= 1));
});

test('fitting a clean circular head does not introduce a curvature shrink bias', () => {
  for (const radius of [2, 10, 50]) {
    const original = Array.from({ length: 720 }, (_, i) => ({ x: radius * Math.cos(i * Math.PI / 360), y: radius * Math.sin(i * Math.PI / 360) }));
    const result = regularizeContour(original, .5);
    assert.ok(Math.abs(meanRadius(result) - radius) < .04, `round head radius ${radius} is preserved`);
    assert.ok(result.every(p => Math.abs(Math.hypot(p.x, p.y) - radius) < .005));
  }
});

for (const radius of [4, 10]) test(`fits long straight sides through ${radius} mm rounded ends without sharp corner anchors`, () => {
  const original = [];
  for (let i = 0; i < 80; i++) { const a = Math.PI + i * Math.PI / 80; original.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) }); }
  for (let i = 0; i < 400; i++) original.push({ x: radius + .2 * Math.sin(i * 1.9), y: i / 5 });
  for (let i = 0; i < 80; i++) { const a = i * Math.PI / 80; original.push({ x: radius * Math.cos(a), y: 80 + radius * Math.sin(a) }); }
  for (let i = 0; i < 400; i++) original.push({ x: -radius + .2 * Math.sin(i * 1.9), y: 80 - i / 5 });
  const result = regularizeContour(original, .5);
  for (const side of [-1, 1]) {
    const points = result.filter(p => p.x * side > 0 && p.y > 10 && p.y < 70);
    assert.ok(points.length <= 2, 'a straight side is represented by a fitted segment');
  }
  assert.ok(original.every(p => pointDistance(p, result) <= .501));
});

test('rejects self crossing input and bounds work on pathological segmentation', () => {
  const crossed = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }];
  assert.deepEqual(regularizeContour(crossed, .5), crossed);
  const huge = noisyCircle(500, 50000), start = performance.now(), result = regularizeContour(huge, .01);
  assert.deepEqual(result, huge); assert.ok(performance.now() - start < 1500);
});

test('a metre-long tool with rounded ends keeps contour fitting interactive', () => {
  const points = [], radius = 10, length = 1000;
  for (let i = 0; i < 100; i++) { const a = Math.PI + i * Math.PI / 100; points.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) }); }
  for (let i = 0; i < 1000; i++) points.push({ x: radius + .2 * Math.sin(i * 1.7), y: i });
  for (let i = 0; i < 100; i++) { const a = i * Math.PI / 100; points.push({ x: radius * Math.cos(a), y: length + radius * Math.sin(a) }); }
  for (let i = 0; i < 1000; i++) points.push({ x: -radius + .2 * Math.sin(i * 1.7), y: length - i });
  const start = performance.now(), result = regularizeContour(points, .5), elapsed = performance.now() - start;
  assert.ok(elapsed < 1500, `bounded line fitting took ${elapsed.toFixed(0)} ms`);
  assert.ok(result.length < 200, 'the supported straight sides are fitted rather than skipped');
});
