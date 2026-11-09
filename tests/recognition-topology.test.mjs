import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { repairNativeProposalTopology, originalNativeWeakOwner } from '../dist/recognition-topology.js';
import { geometry, roiRLE, traceRLE, polygonRLE, dilateRLE } from '../dist/recognition-foreground.js';

function fixture(gap, angle) {
  const width = 640, height = 400, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const masks = [new Uint8Array(width * height), new Uint8Array(width * height)];
  const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const transform = (u, v) => ({ x: 320 + u * cosine - v * sine, y: 200 + u * sine + v * cosine });
  const material = [], priorGap = Math.max(1, gap / 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - 320, dy = y + .5 - 200, u = dx * cosine + dy * sine, v = -dx * sine + dy * cosine;
    if (Math.abs(u) >= 180 || Math.abs(v) >= 15) continue;
    if (!(gap && Math.abs(u) < gap / 2)) {
      data.set(u < 0 ? [195, 40, 55, 255] : [30, 65, 185, 255], (y * width + x) * 4);
      material.push({ x: x + .5, y: y + .5 });
    }
    if (u <= -priorGap) masks[0][y * width + x] = 1;
    if (u >= priorGap) masks[1][y * width + x] = 1;
  }
  // Both physically separate and connected controls deliberately receive the
  // same learned identity. Source evidence must still veto every real gap.
  const assemblies = masks.map(data => ({
    ...traceRLE(roiRLE({ x: 0, y: 0, width, height, data }, width, height), width, height, 0)[0],
    seedParts: ['generic-proposal-id']
  }));
  return { image: { width, height, data }, assemblies, material, transform };
}

function inside(point, points) {
  let odd = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) odd = !odd;
  }
  return odd;
}
function near(point, points, tolerance) {
  if (inside(point, points)) return true;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) return true;
  }
  return false;
}

for (const angle of [0, 37]) for (const gap of [0, 2, 6, 20]) {
  test(`native topology preserves source bodies and ${gap}px gaps at ${angle} degrees`, () => {
    const { image, assemblies, material, transform } = fixture(gap, angle);
    const before = createHash('sha256').update(image.data).digest('hex');
    const result = repairNativeProposalTopology(image, assemblies);
    assert.equal(result.assemblies.length, gap ? 2 : 1, 'source physical identities');
    assert.equal(createHash('sha256').update(image.data).digest('hex'), before, 'original RGBA is immutable');
    const left = result.assemblies.findIndex(c => inside(transform(-100, 0), c.points));
    const right = result.assemblies.findIndex(c => inside(transform(100, 0), c.points));
    assert.ok(left >= 0 && right >= 0, 'both original bodies are retained');
    assert.equal(left === right, !gap, 'one complete outline only for connected material');
    const retained = material.filter(p => result.assemblies.some(c => near(p, c.points, 2))).length;
    assert.ok(retained / material.length >= .99, 'whole visible material within two source pixels');
    if (gap) for (let v = -8; v <= 8; v += 2) {
      assert.equal(result.assemblies.some(c => inside(transform(0, v), c.points)), false, 'observed background gap stays open');
    }
  });
}

test('a missing shared NN identity cannot be invented from a source contact', () => {
  const { image, assemblies } = fixture(0, 0);
  assemblies[1].seedParts = ['independent-proposal-id'];
  assert.equal(repairNativeProposalTopology(image, assemblies).assemblies.length, 2);
});

test('repair preserves original weak ownership instead of creating new admissibility', () => {
  const { image, assemblies } = fixture(0, 0), result = repairNativeProposalTopology(image, assemblies);
  assert.equal(result.assemblies.length, 1);
  const merged = result.assemblies[0], owner = { ...geometry({ maskRLE: polygonRLE(merged.points, image.width, image.height) }, image.width, image.height), seed: merged };
  const rectangle = points => geometry({ maskRLE: polygonRLE(points, image.width, image.height) }, image.width, image.height);
  const both = rectangle([{ x: 310, y: 195 }, { x: 330, y: 195 }, { x: 330, y: 205 }, { x: 310, y: 205 }]);
  assert.equal(originalNativeWeakOwner(result, dilateRLE(both, image.width, image.height, 3), owner), null, 'a previously ambiguous weak bridge stays rejected');
  const one = rectangle([{ x: 280, y: 195 }, { x: 290, y: 195 }, { x: 290, y: 205 }, { x: 280, y: 205 }]);
  const selected = originalNativeWeakOwner(result, dilateRLE(one, image.width, image.height, 3), owner);
  assert.ok(selected, 'a previously independent weak attachment remains available');
  assert.ok(selected.area < owner.area, 'classification uses its original body and RGB context');
});

test('a cancelled topology operation aborts before inspecting source pixels', () => {
  const { image, assemblies } = fixture(0, 0), controller = new AbortController();
  controller.abort();
  assert.throws(() => repairNativeProposalTopology(image, assemblies, { signal: controller.signal }), { name: 'AbortError' });
});
