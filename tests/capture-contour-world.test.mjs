import test from 'node:test';
import assert from 'node:assert/strict';
import { getCaptureEditModel, applyCaptureEdit, resetCaptureEdit, moveContourNode, curveContourNode, insertContourNode, flattenContour } from '../dist/capture-contour-edit.js';
import { capturePhotoGeometry, captureToolPoints, captureItemDimensions, resizeCaptureItem, toolFromCaptureItem } from '../dist/capture-tools.js';
import { transformedPoints, exportSTL, validateLayout } from '../dist/geometry.js';
import { blankProject, validateProject } from '../dist/model.js';
import { addPhotoModule } from '../dist/photo-module.js';
import { validatePrintMesh, trianglesVolume } from '../dist/print-geometry.js';
import { setAppUnit, getAppUnit } from '../dist/units.js';

const close = (actual, expected, message = 'coordinate') => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const box = points => points.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const center = points => { const b = box(points); return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; };
const sameBoundaryVertices = (actual, expected) => {
  assert.equal(actual.length, expected.length, 'manual straight segments retain all intended vertices');
  for (const p of expected) assert.ok(actual.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-7), `missing fixed world vertex ${JSON.stringify(p)}`);
};
const localShape = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 15, y: 30 }, { x: 15, y: 60 }, { x: 0, y: 60 }];
function draft(scale = 2, { shape = localShape, origin = { x: 125, y: 225 } } = {}) {
  const points = shape.map(p => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale })), b = box(points);
  return { name: 'Ruční klíč', depth: '8', checked: false, category: 'wrenches', sizeLabel: '13 mm', pocketMargin: 0,
    info: { minX: b.x0, minY: b.y0, width: (b.x1 - b.x0) / scale, height: (b.y1 - b.y0) / scale, center: center(points) },
    pocketShape: 'measured', contour: { points } };
}
const imported = (item, scale) => toolFromCaptureItem(item, { scale, depth: 8, id: 'manual-photo-tool', preservePosition: true });
const nearestNode = (model, point) => model.nodes.reduce((best, p, i) => Math.hypot(p.x - point.x, p.y - point.y) < Math.hypot(model.nodes[best].x - point.x, model.nodes[best].y - point.y) ? i : best, 0);
function moveFirstCorner(item, scale, dx = -8, dy = -5) {
  const model = getCaptureEditModel(item, scale), index = nearestNode(model, { x: 0, y: 0 }), node = model.nodes[index];
  const next = moveContourNode(model, index, { x: node.x + dx, y: node.y + dy });
  applyCaptureEdit(item, scale, next); return next;
}

test('one-sided manual movement preserves every untouched photo/world vertex even when the local minimum changes', () => {
  const item = draft(), before = structuredClone(item), expected = before.contour.points.map(p => ({ ...p }));
  expected[0].x -= 16; expected[0].y -= 10;
  const model = getCaptureEditModel(item, 2), opening = structuredClone(model), index = nearestNode(model, { x: 0, y: 0 });
  const next = moveContourNode(model, index, { x: -8, y: -5 });
  assert.deepEqual(model, opening, 'dragging works on an independent editor draft');
  applyCaptureEdit(item, 2, next);
  sameBoundaryVertices(capturePhotoGeometry(item, 2).points, expected);
  sameBoundaryVertices(transformedPoints(imported(item, 2)), expected.map(p => ({ x: p.x / 2, y: p.y / 2 })));
  assert.deepEqual(item.contour, before.contour, 'the recognized contour remains available for reset');
  for (const key of ['name', 'depth', 'checked', 'category', 'sizeLabel', 'pocketMargin', 'info']) assert.deepEqual(item[key], before[key], key);
  next.nodes[index].x = -999; next.origin.x = -999;
  sameBoundaryVertices(capturePhotoGeometry(item, 2).points, expected);
  const tool = imported(item, 2), restored = validateProject({ ...blankProject(), tools: [tool] }).tools[0];
  sameBoundaryVertices(transformedPoints(restored), transformedPoints(tool));
});

test('numeric resizing before a manual correction freezes the resized photo frame rather than recentering the edit', () => {
  const item = draft(2, {shape:[{x:0,y:0},{x:30,y:0},{x:30,y:60},{x:0,y:60}]}), raw = structuredClone(item.contour);
  resizeCaptureItem(item, 2, { length: 80 });
  const opening = capturePhotoGeometry(item, 2).points, model = getCaptureEditModel(item, 2);
  const index = model.nodes.findIndex(p => p.x === Math.min(...model.nodes.map(q => q.x)));
  assert.ok(index >= 0);
  const node = model.nodes[index], expected = opening.map(p => ({ ...p }));
  const moved = { x: model.origin.x + node.x * 2, y: model.origin.y + node.y * 2 };
  const target = expected.find(p => Math.hypot(p.x - moved.x, p.y - moved.y) < 1e-7);
  assert.ok(target); target.x -= 10; target.y -= 6;
  applyCaptureEdit(item, 2, moveContourNode(model, index, { x: node.x - 5, y: node.y - 3 }));
  sameBoundaryVertices(capturePhotoGeometry(item, 2).points, expected);
  sameBoundaryVertices(transformedPoints(imported(item, 2)), expected.map(p => ({ x: p.x / 2, y: p.y / 2 })));
  assert.deepEqual(item.contour, raw);
});

test('numeric resizing after manual changes retains their current photo centre and invalidates stale curve handles', () => {
  const item = draft(2, { shape: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 60 }, { x: 0, y: 60 }] });
  const inserted=insertContourNode(getCaptureEditModel(item,2),{x:15,y:0}),curved=curveContourNode(inserted.model,inserted.index);
  applyCaptureEdit(item, 2, moveContourNode(curved, inserted.index, { x: 15, y: -3 }));
  const previous = center(capturePhotoGeometry(item, 2).points), dimensions = captureItemDimensions(item, 2);
  resizeCaptureItem(item, 2, { length: dimensions.length * 1.2 });
  const current = center(capturePhotoGeometry(item, 2).points);
  close(current.x, previous.x, 'resized edited photo X centre'); close(current.y, previous.y, 'resized edited photo Y centre');
  assert.equal(item.contourEdit, undefined, 'flattened numeric resize cannot retain stale old Bézier control points');
  const reopened = getCaptureEditModel(item, 2);
  assert.ok(reopened.nodes.every(node => !node.in && !node.out));
  sameBoundaryVertices(transformedPoints(imported(item, 2)), capturePhotoGeometry(item, 2).points.map(p => ({ x: p.x / 2, y: p.y / 2 })));
});

test('reset returns exactly to recognized photo geometry and preserves capture metadata', () => {
  const item = draft(), before = structuredClone(item);
  moveFirstCorner(item, 2); resetCaptureEdit(item);
  sameBoundaryVertices(capturePhotoGeometry(item, 2).points, before.contour.points);
  assert.equal(item.editedPoints, undefined); assert.equal(item.contourEditOrigin, undefined); assert.equal(item.contourEdit, undefined);
  for (const key of ['name', 'depth', 'checked', 'category', 'sizeLabel', 'pocketMargin', 'info', 'contour']) assert.deepEqual(item[key], before[key], key);
});

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
const boundaryDistance = (p, points) => Math.min(...points.map((a, i) => segmentDistance(p, a, points[(i + 1) % points.length])));
function cubic(a, b, t) {
  const p1 = a.out || a, p2 = b.in || b, u = 1 - t;
  return { x: u ** 3 * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * b.x,
    y: u ** 3 * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * b.y };
}

test('Bézier subdivision follows the drawn curve within physical tolerance and import uses that same polygon', () => {
  const item = draft(2, { shape: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 60 }, { x: 0, y: 60 }] });
  const model = curveContourNode(getCaptureEditModel(item, 2), 0), flat = flattenContour(model.nodes);
  assert.ok(flat.length > model.nodes.length, 'the curved corner is represented by actual segments');
  for (let edge = 0; edge < model.nodes.length; edge++) for (let t = 0; t <= 1; t += .01) {
    assert.ok(boundaryDistance(cubic(model.nodes[edge], model.nodes[(edge + 1) % model.nodes.length], t), flat) <= .050001, 'manufacturing polygon follows the actual cubic within .05 mm');
  }
  const inserted = insertContourNode(model, cubic(model.nodes[0], model.nodes[1], .4)).model;
  const afterSplit = flattenContour(inserted.nodes);
  for (let edge = 0; edge < model.nodes.length; edge++) for (let t = 0; t <= 1; t += .02) {
    assert.ok(boundaryDistance(cubic(model.nodes[edge], model.nodes[(edge + 1) % model.nodes.length], t), afterSplit) <= .050001, 'adding an editor node leaves the curve in place');
  }
  applyCaptureEdit(item, 2, model);
  assert.equal(item.pocketShape, 'measured', 'manual points are not subsequently overridden by a functional fit');
  sameBoundaryVertices(capturePhotoGeometry(item, 2).points, flat.map(p => ({ x: model.origin.x + p.x * 2, y: model.origin.y + p.y * 2 })));
  assert.equal(captureToolPoints(item, 2).length, flat.length);
  sameBoundaryVertices(transformedPoints(imported(item, 2)), capturePhotoGeometry(item, 2).points.map(p => ({ x: p.x / 2, y: p.y / 2 })));
});

test('display units and photo resolution never rescale manual millimetres', () => {
  const previous = getAppUnit(), results = [];
  try {
    for (const scale of [2, 5]) for (const unit of ['mm', 'in']) {
      setAppUnit(unit, { save: false });
      const item = draft(scale, { origin: { x: 50 * scale, y: 80 * scale } });
      moveFirstCorner(item, scale); results.push(transformedPoints(imported(item, scale)));
    }
    for (const result of results.slice(1)) sameBoundaryVertices(result, results[0]);
  } finally { setAppUnit(previous, { save: false }); }
});

test('invalid crossing edits are atomic and cannot corrupt the existing valid manufacturing draft', () => {
  const item = draft(); moveFirstCorner(item, 2); const before = structuredClone(item);
  const invalid = { ...getCaptureEditModel(item, 2), nodes: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }, { x: 40, y: 0 }, { x: 50, y: 20 }] };
  assert.throws(() => applyCaptureEdit(item, 2, invalid)); assert.deepEqual(item, before);
  for (const scale of [0, -1, NaN, Infinity]) { assert.throws(() => getCaptureEditModel(item, scale)); assert.deepEqual(item, before); }
});

test('a manually curved capture survives JSON and produces a closed positive-volume manufacturing mesh', () => {
  const item = draft(2, { shape: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 60 }, { x: 0, y: 60 }] });
  applyCaptureEdit(item, 2, curveContourNode(getCaptureEditModel(item, 2), 0));
  const tool = imported(item, 2), added = addPhotoModule({ ...blankProject(), width: 252, height: 210, limitToBed: false }, [tool]);
  assert.deepEqual(validateLayout(added.project), []);
  const restored = validateProject(JSON.parse(JSON.stringify(added.project))), before = structuredClone(restored);
  sameBoundaryVertices(restored.tools[0].points, added.project.tools[0].points);
  const bytes = exportSTL(restored, { moduleId: added.moduleId }), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(80, true);
  assert.equal(bytes.length, 84 + count * 50);
  const triangles = Array.from({ length: count }, (_, i) => Array.from({ length: 3 }, (_, vertex) => Array.from({ length: 3 }, (_, axis) => view.getFloat32(84 + i * 50 + 12 + vertex * 12 + axis * 4, true))));
  assert.doesNotThrow(() => validatePrintMesh(triangles)); assert.ok(trianglesVolume(triangles) > 0);
  assert.deepEqual(restored, before, 'manufacturing remains read-only');
});
