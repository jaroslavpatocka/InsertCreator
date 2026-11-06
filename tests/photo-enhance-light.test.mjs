import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { readableImage } from '../dist/photo-enhance.js';
import { recognizeTools } from '../dist/recognize.js';
import { lightWrenchesPhoto, onTool, maskAt } from './fixtures/light-tools.mjs';
import { maskMetrics } from './fixtures/tool-photos.mjs';

const pixel = (image, point) => image.data[(Math.floor(point.y) * image.width + Math.floor(point.x)) * 4];
const details = result => JSON.stringify({ quality: result.quality, diagnostics: result.diagnostics });

test('light-background preparation suppresses enclosed glare without changing the source or its layout', () => {
  const image = lightWrenchesPhoto(), original = image.data.slice(), result = readableImage(image);
  assert.equal(result?.name, 'light-background');
  assert.equal(result.image.width, image.width); assert.equal(result.image.height, image.height);
  assert.deepEqual(image.data, original, 'the source photograph remains available for precise measurement');
  for (const tool of image.tools) {
    assert.ok(pixel(result.image, onTool(tool, 0, 1)) < 128, 'white specular streak stays inside its tool');
    assert.ok(pixel(result.image, onTool(tool, 0, -6)) < 128, 'matte silver body stays foreground');
    assert.ok(pixel(result.image, onTool(tool, -110, 0)) > 240, 'the open jaw remains connected to background');
    assert.ok(pixel(result.image, onTool(tool, 100, 0)) > 240, 'the real ring opening is not treated as glare');
  }
  assert.ok(pixel(result.image, { x: 300, y: 205 }) > 240, 'separate tools retain their gap');
});

test('one reflective wrench uses automatic light preparation and keeps its measured jaw and dimensions', async () => {
  const image = lightWrenchesPhoto({ width: 420, height: 280, tools: [{ x: 210, y: 140, angle: .28 }] });
  const result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.enhanced, 'light-background', details(result));
  assert.equal(result.contours.length, 1, details(result));
  assert.equal(result.quality.status, 'ready', details(result));
  const metrics = maskMetrics(result.mask, image.truth);
  assert.ok(metrics.iou > .93, `source-sized silhouette changed: ${JSON.stringify(metrics)}`);
  assert.equal(maskAt(result.mask, image.width, onTool(image.tools[0], -110, 0)), 0, 'the open end is not bridged');
  assert.equal(maskAt(result.mask, image.width, onTool(image.tools[0], 100, 0)), 1, 'outer pocket contour intentionally includes the ring opening');
});

test('rotated silver tools remain separate and preserve their positions on tinted white paper', async () => {
  const image = lightWrenchesPhoto({ background: [249, 248, 245] });
  const result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.enhanced, 'light-background', details(result));
  assert.equal(result.contours.length, image.tools.length, details(result));
  assert.equal(result.quality.status, 'ready', details(result));
  assert.ok(maskMetrics(result.mask, image.truth).iou > .93, details(result));
  for (const tool of image.tools) {
    assert.equal(maskAt(result.mask, image.width, onTool(tool, 0, 1)), 1, 'glare does not split one tool');
    assert.equal(maskAt(result.mask, image.width, onTool(tool, -110, 0)), 0, 'open jaw survives rotation');
  }
  assert.equal(result.mask[205 * image.width + 300], 0, 'no contour spans the empty inter-tool gap');
});

test('a narrow visible gap between rotated tools is retained beside disconnected printed marks', async () => {
  const angle = .2, normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const tools = [-1, 1].map(sign => ({ x: 250 + sign * normal.x * 31, y: 150 + sign * normal.y * 31, angle }));
  const image = lightWrenchesPhoto({ width: 500, height: 300, tools });
  const middle = { x: 250, y: 150, angle };
  const printed = [];
  for (let dx = -30; dx <= 30; dx += 12) {
    const point = onTool(middle, dx, 0); printed.push(point);
    for (let y = Math.floor(point.y); y < Math.floor(point.y) + 3; y++) for (let x = Math.floor(point.x); x < Math.floor(point.x) + 2; x++) {
      image.data.set([70, 70, 70, 255], (y * image.width + x) * 4);
    }
  }
  const result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.enhanced, 'light-background', details(result));
  assert.equal(result.contours.length, 2, details(result));
  assert.equal(result.quality.status, 'ready', details(result));
  assert.ok(maskMetrics(result.mask, image.truth).iou > .93, details(result));
  assert.equal(maskAt(result.mask, image.width, onTool(middle, -100, 0)), 0, 'six-pixel head gap is not closed');
  for (const point of printed) assert.equal(maskAt(result.mask, image.width, point), 0, 'disconnected printing is not joined to a tool');
});

test('a populated light toolkit is not rejected merely for having more than fifteen separate tools', async () => {
  const tools = Array.from({ length: 18 }, (_, i) => ({ x: i % 2 ? 450 : 150, y: 45 + Math.floor(i / 2) * 72, angle: 0 }));
  const image = lightWrenchesPhoto({ width: 600, height: 670, tools });
  const result = await recognizeTools(image, { pxPerMm: 1 });
  assert.equal(result.enhanced, 'light-background', details(result));
  assert.equal(result.contours.length, tools.length, details(result));
  assert.equal(result.quality.status, 'ready', details(result));
  assert.ok(!result.quality.reasons.some(reason => reason.includes('stejnému nástroji')), details(result));
  assert.ok(maskMetrics(result.mask, image.truth).iou > .92, details(result));
});

test('empty white paper and ordinary dark tools do not opt into light-metal preparation', () => {
  const white = lightWrenchesPhoto({ width: 300, height: 240, tools: [] });
  assert.equal(readableImage(white), null, 'a uniform photo cannot fabricate tools');
  const dark = lightWrenchesPhoto({ width: 420, height: 280, tools: [{ x: 210, y: 140, angle: 0 }] });
  for (let p = 0; p < dark.truth.length; p++) if (dark.truth[p]) dark.data.set([45, 48, 50, 255], p * 4);
  assert.equal(readableImage(dark), null, 'the existing dark-on-paper path remains applicable');
});

test('a large photograph keeps source-sized geometry across the bounded preprocessing grid', async () => {
  const angle = .23, normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const tools = [-1, 1].map(sign => ({ x: 800.35 + sign * normal.x * 31, y: 500.15 + sign * normal.y * 31, angle }));
  const image = lightWrenchesPhoto({ width: 1600, height: 1000, tools });
  const original = image.data.slice(), prepared = readableImage(image);
  assert.equal(prepared?.name, 'light-background');
  assert.equal(prepared.image.data.length, image.data.length);
  assert.deepEqual(image.data, original);
  const middle = { x: 800.35, y: 500.15, angle };
  assert.ok(pixel(prepared.image, onTool(middle, -100, 0)) > 240, 'resampling does not bridge the visible six-pixel gap');
  for (const tool of tools) {
    assert.ok(pixel(prepared.image, onTool(tool, -110, 0)) > 240, 'a rotated jaw stays open after downsampling');
    assert.ok(pixel(prepared.image, onTool(tool, 100, 0)) > 240, 'a rotated ring opening is not converted to glare');
  }
  const result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.enhanced, 'light-background', details(result));
  assert.equal(result.quality.status, 'ready', details(result));
  assert.equal(result.contours.length, 2, details(result));
  assert.ok(maskMetrics(result.mask, image.truth).iou > .92, details(result));
  assert.equal(maskAt(result.mask, image.width, onTool(middle, -100, 0)), 0);
});

test('white-on-white geometry with no visible edge remains unrecognized', async () => {
  const image = lightWrenchesPhoto({ width: 320, height: 240, tools: [{ x: 160, y: 120, angle: 0 }] });
  // The truth still contains an object, but the photo contains no evidence of it.
  for (let p = 0; p < image.width * image.height; p++) image.data.set([255, 255, 255, 255], p * 4);
  assert.equal(readableImage(image), null, 'no synthetic outline is inferred from a blank photo');
  const result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.quality.status, 'retake', details(result));
  assert.equal(result.contours.length, 0, details(result));
  assert.equal(result.mask.some(Boolean), false, 'missing image evidence never fabricates an object');
});

test('small reflective wrench heads survive source refinement beside thin shafts', async () => {
  const tools = [.18, .21, .24, .27, .3].map((scale, i) => ({ x: 160.25, y: 35.25 + i * 53, angle: i % 2 ? -.12 : .15, scale }));
  const image = lightWrenchesPhoto({ width: 320, height: 290, tools });
  const result = await recognizeTools(image, { pxPerMm: 1 });
  assert.equal(result.enhanced, 'light-background', details(result));
  assert.equal(result.quality.status, 'ready', details(result));
  assert.equal(result.contours.length, tools.length, details(result));
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i]; let expected = 0, covered = 0;
    for (let p = 0; p < image.toolMasks[i].length; p++) {
      if (!image.toolMasks[i][p]) continue;
      const x = p % image.width + .5 - tool.x, y = Math.floor(p / image.width) + .5 - tool.y;
      const along = (x * Math.cos(tool.angle) + y * Math.sin(tool.angle)) / tool.scale;
      if (along > -82) continue;
      expected++; covered += +!!result.mask[p];
    }
    assert.ok(covered / expected >= .85, `head diameter ${(56 * tool.scale).toFixed(1)}px was cropped: ${covered}/${expected}`);
    assert.equal(maskAt(result.mask, image.width, onTool(tool, 0, 1)), 1, 'thin shaft and enclosed highlight remain connected');
    assert.equal(maskAt(result.mask, image.width, onTool(tool, -110, 0)), 0, 'a resolved small open jaw is retained');
  }
});

test('a pale cast shadow spanning separate silver tools does not merge their silhouettes', async () => {
  const canvas = createCanvas(600, 500), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 500);
  ctx.fillStyle = '#eee'; ctx.fillRect(115, 135, 370, 230);
  ctx.fillStyle = '#bcc0c4'; ctx.fillRect(120, 140, 360, 60); ctx.fillRect(120, 300, 360, 60);
  const image = ctx.getImageData(0, 0, 600, 500), result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.quality.status, 'ready', details(result));
  assert.equal(result.contours.length, 2, details(result));
  assert.equal(result.mask[250 * image.width + 300], 0, 'the shared shadow remains background');
  assert.equal(result.mask[170 * image.width + 300], 1);
  assert.equal(result.mask[330 * image.width + 300], 1);
});

test('a broad soft shadow does not expand the measured silver tool boundary', async () => {
  const canvas = createCanvas(600, 500), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 500);
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 40;
  ctx.shadowOffsetX = 12; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#bcc0c4'; ctx.fillRect(180, 180, 240, 100);
  const image = ctx.getImageData(0, 0, 600, 500), result = await recognizeTools(image, { pxPerMm: 2 });
  assert.equal(result.quality.status, 'ready', details(result));
  assert.equal(result.contours.length, 1, details(result));
  const bounds = result.contours[0].points.reduce((box, p) => ({
    x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y)
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  for (const [key, expected] of Object.entries({ x0: 180, y0: 180, x1: 420, y1: 280 })) {
    assert.ok(Math.abs(bounds[key] - expected) <= 2, `soft shadow displaced ${key}: ${JSON.stringify(bounds)}`);
  }
  assert.equal(result.mask[300 * image.width + 300], 0, 'the cast shadow below the tool is outside its pocket');
});

test('an open reflective band cannot confidently turn one broken shaft into two tools', async () => {
  const canvas = createCanvas(600, 400), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 400);
  ctx.fillStyle = '#bcc0c4'; ctx.fillRect(100, 170, 400, 40);
  ctx.fillStyle = '#fff'; ctx.fillRect(298, 170, 4, 40);
  const image = ctx.getImageData(0, 0, 600, 400), result = await recognizeTools(image, { pxPerMm: 2 });
  assert.notEqual(result.quality.status, 'ready', details(result));
  assert.equal(result.mask[190 * image.width + 300], 0, 'an externally connected reflection is not filled by guessing a bridge');
});

test('full-resolution background connectivity vetoes false enclosed glare caused by grid aliasing', () => {
  const canvas = createCanvas(1600, 1600), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1600, 1600);
  ctx.fillStyle = '#bcbfc2'; ctx.fillRect(200, 200, 600, 400);
  // A one-pixel route connects this narrow opening to the background. It is
  // intentionally below the analysis-grid pixel size but visible in the source.
  ctx.fillStyle = '#fff'; ctx.fillRect(200, 350, 201, 1); ctx.fillRect(400, 348, 60, 6);
  const image = ctx.getImageData(0, 0, 1600, 1600), original = image.data.slice();
  const prepared = readableImage(image), actual = prepared?.image ?? image;
  assert.deepEqual(image.data, original, 'connectivity analysis does not edit the measurement source');
  for (let x = 200; x <= 400; x++) assert.ok(pixel(actual, { x, y: 350 }) > 240, `open channel was filled at ${x},350`);
  for (let y = 348; y < 354; y++) for (let x = 400; x < 460; x++) {
    assert.ok(pixel(actual, { x, y }) > 240, `real open slit was mistaken for enclosed glare at ${x},${y}`);
  }
});
