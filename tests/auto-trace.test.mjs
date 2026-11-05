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

// Inverse-map an analytic open-ended wrench into a photograph. The edge defects
// represent segmentation chatter, not intentional details of the tool.
function noisyWrench(pxPerMm, angle = 0) {
  const size = Math.ceil(140 * pxPerMm), im = fixture(size, size), cosine = Math.cos(angle), sine = Math.sin(angle);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const worldX = (x + .5 - size / 2) / pxPerMm, worldY = (y + .5 - size / 2) / pxPerMm;
    const xx = worldX * cosine + worldY * sine, yy = -worldX * sine + worldY * cosine;
    const headAngle = Math.atan2(yy + 32, xx), radius = 18 + .2 * Math.sin(headAngle * 23) + .12 * Math.sin(headAngle * 47);
    const head = Math.hypot(xx, yy + 32) <= radius && !(Math.abs(xx) < 6 && yy < -30);
    const chatter = .24 * Math.sin(yy * 4.3) + .1 * Math.sin(yy * 9.1);
    const spur = yy > 18 && yy < 18.55 ? .3 : 0;
    const shaft = yy > -16 && yy <= 52 && xx > -4 + chatter && xx < 4 + chatter + spur;
    const cap = Math.hypot(xx, yy - 52) <= 4;
    if (head || shaft || cap) paint(im, x, y, 1, 1, [55, 61, 57]);
  }
  return { im, local: p => {
    const x = (p.x - size / 2) / pxPerMm, y = (p.y - size / 2) / pxPerMm;
    return { x: x * cosine + y * sine, y: -x * sine + y * cosine };
  } };
}

function horizontalCrossings(points, y) {
  const intersections = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) intersections.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
  }
  return intersections.sort((a, b) => a - b);
}

function containsPoint(points, p) { return horizontalCrossings(points, p.y).filter(x => x < p.x).length % 2 === 1; }

function lineRegularity(samples) {
  const n = samples.length, meanX = samples.reduce((sum, p) => sum + p.x, 0) / n, meanY = samples.reduce((sum, p) => sum + p.y, 0) / n;
  const slope = samples.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / samples.reduce((sum, p) => sum + (p.y - meanY) ** 2, 0);
  const residuals = samples.map(p => p.x - meanX - slope * (p.y - meanY)), turns = [];
  for (let i = 1; i < n - 1; i++) {
    const a = samples[i - 1], b = samples[i], c = samples[i + 1];
    const turn = Math.atan2(c.x - b.x, c.y - b.y) - Math.atan2(b.x - a.x, b.y - a.y);
    if (Math.abs(turn) > .02) turns.push(Math.sign(turn)); // Ignore sub-degree tessellation noise.
  }
  return { rms: Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / n), alternations: turns.filter((value, i) => i > 0 && value !== turns[i - 1]).length };
}

function outerArcSamples(points, start) {
  const samples = [], cross = (a, b) => a.x * b.y - a.y * b.x;
  // Equal polar steps inspect curvature independently of the output vertex
  // density. These arcs stay clear of the genuine jaw and neck transitions.
  for (let theta = start; theta <= start + 1.6 + 1e-6; theta += .05) {
    const ray = { x: Math.cos(theta), y: Math.sin(theta) }; let outer = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length], a = { x: p.x, y: p.y + 32 }, edge = { x: q.x - p.x, y: q.y - p.y }, denominator = cross(ray, edge);
      if (Math.abs(denominator) < 1e-9) continue;
      const radius = cross(a, edge) / denominator, along = cross(a, ray) / denominator;
      if (radius > 0 && along >= 0 && along <= 1) outer = Math.max(outer, radius);
    }
    assert.ok(Number.isFinite(outer), 'the head must retain its complete outer arc');
    samples.push({ x: outer * ray.x, y: outer * ray.y });
  }
  return samples;
}

function arcRegularity(samples) {
  const concave = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1], b = samples[i], c = samples[i + 1], ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (turn < -.01) concave.push(-turn);
  }
  return { concaveTurns: concave.length, negativeTurn: concave.reduce((sum, value) => sum + value, 0) };
}

for (const [pxPerMm, angle] of [[3, 0], [4, .37]]) {
  test(`photo contour regularizes wrench chatter while preserving its open jaw (${pxPerMm} px/mm, ${angle} rad)`, async () => {
    const { im, local } = noisyWrench(pxPerMm, angle), result = await autoTraceImage(im, { pxPerMm });
    assert.equal(result.contours.length, 1, JSON.stringify(result.diagnostics));
    assert.equal(result.quality.status, 'ready', JSON.stringify(result.quality));
    const points = result.contours[0].points.map(local), shaftError = [], sides = [[], []];
    for (let y = -8; y <= 43; y += .5) {
      const crossings = horizontalCrossings(points, y);
      assert.equal(crossings.length, 2, `the shaft must stay continuous at ${y} mm`);
      shaftError.push(crossings[0] + 4, crossings[1] - 4);
      sides[0].push({ x: crossings[0], y }); sides[1].push({ x: crossings[1], y });
      assert.ok(Math.abs(crossings[1] - crossings[0] - 8) < .65, `shaft width changed at ${y} mm`);
    }
    const shaftRms = Math.sqrt(shaftError.reduce((sum, e) => sum + e * e, 0) / shaftError.length);
    assert.ok(shaftRms < .18, `straight shaft RMS error ${shaftRms.toFixed(3)} mm`);
    for (const side of sides) {
      const regularity = lineRegularity(side);
      assert.ok(regularity.rms < .035, `shaft must be straight after fitting its own axis: ${regularity.rms.toFixed(3)} mm RMS`);
      assert.ok(regularity.alternations <= 6, `shaft must not retain repeated waves: ${regularity.alternations} significant turn reversals`);
    }
    const arcErrors = points.filter(p => p.y < -20 && Math.abs(p.x) > 9).map(p => Math.abs(Math.hypot(p.x, p.y + 32) - 18));
    const arcRms = Math.sqrt(arcErrors.reduce((sum, e) => sum + e * e, 0) / arcErrors.length);
    assert.ok(arcErrors.length >= 8, 'the head must retain a rounded exterior');
    assert.ok(arcRms < .22, `rounded head RMS error ${arcRms.toFixed(3)} mm`);
    const arcs = [-1.1, Math.PI - .5].map(start => arcRegularity(outerArcSamples(points, start)));
    const concaveTurns = arcs.reduce((sum, arc) => sum + arc.concaveTurns, 0), negativeTurn = arcs.reduce((sum, arc) => sum + arc.negativeTurn, 0);
    assert.ok(concaveTurns <= 2, `a rounded convex head must not alternate between bulges and dents: ${concaveTurns} inward turns`);
    assert.ok(negativeTurn < .06, `the rounded head must not retain angular inward kinks: ${negativeTurn.toFixed(3)} rad in total`);
    assert.equal(containsPoint(points, { x: 0, y: -40 }), false, 'the jaw opening must not be filled');
    assert.equal(containsPoint(points, { x: 0, y: -27 }), true, 'the bottom of the jaw must remain');
    assert.equal(containsPoint(points, { x: 11, y: -40 }), true, 'the jaw arms must remain');
    const width = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
    const length = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
    assert.ok(Math.abs(width - 36) < .7, `head width changed to ${width.toFixed(3)} mm`);
    const expectedLength = 88 + Math.sqrt(18 ** 2 - 6 ** 2); // The open jaw removes the very top of the circle.
    assert.ok(Math.abs(length - expectedLength) < .7, `tool length changed to ${length.toFixed(3)} mm`);
    assert.ok(iou(result.mask, im.truth) > .96, 'regularization must preserve the measured silhouette');
  });
}
