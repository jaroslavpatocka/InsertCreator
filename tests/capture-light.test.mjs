import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { lightWrenchesPhoto } from './fixtures/light-tools.mjs';

const win = new Window({ url: 'http://localhost:5173' });
win.document.write((await fs.readFile(new URL('../dist/index.html', import.meta.url), 'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
for (const key of ['window', 'document', 'localStorage', 'Image', 'ResizeObserver', 'HTMLElement']) globalThis[key] = key === 'window' ? win : win[key];
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
globalThis.ImageData = ImageData;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
const canvases = new WeakMap();
function actual(element) {
  if (!canvases.has(element)) canvases.set(element, createCanvas(element.width || 300, element.height || 150));
  const canvas = canvases.get(element);
  if (canvas.width !== element.width) canvas.width = element.width;
  if (canvas.height !== element.height) canvas.height = element.height;
  return canvas;
}
win.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== '2d') return null;
  const ctx = actual(this).getContext('2d');
  return new Proxy(ctx, { get: (target, key) => key === 'drawImage'
    ? ((source, ...args) => target.drawImage(source instanceof win.HTMLCanvasElement ? actual(source) : source, ...args))
    : typeof target[key] === 'function' ? target[key].bind(target) : target[key],
  set: (target, key, value) => (target[key] = value, true) });
};

const source = lightWrenchesPhoto();
// Only the OS decoder is substituted: capture receives actual fixture pixels,
// then executes its unmodified calibration, recognition, review and import.
globalThis.createImageBitmap = async () => {
  const canvas = createCanvas(source.width, source.height);
  canvas.getContext('2d').putImageData(new ImageData(source.data.slice(), source.width, source.height), 0, 0);
  return canvas;
};
delete globalThis.Worker;
const { openCapture } = await import('../dist/capture.js');
const { setLang } = await import('../dist/i18n.js');
const { setAppUnit } = await import('../dist/units.js');
const $ = selector => win.document.querySelector(selector);
const click = selector => { const element = $(selector); assert.ok(element, selector); element.click(); };
const changed = (selector, value) => {
  const element = $(selector); assert.ok(element, selector);
  if (element.type === 'checkbox') element.checked = value; else element.value = value;
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
};
async function waitFor(fn, message) {
  const started = performance.now();
  while (!fn()) {
    if (performance.now() - started > 12000) throw Error(`Timed out: ${message}; ${$('.modal-body')?.textContent}`);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function rulerPoint(index, x, y) {
  click(`[data-ruler-point="${index}"]`);
  const canvas = $('#calibration-canvas');
  canvas.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: index + 1, isPrimary: true, clientX: x, clientY: y }));
  canvas.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerId: index + 1, isPrimary: true, clientX: x, clientY: y }));
}

test('uploaded white-background silver tools reach an enabled capture list and can be added in both languages', { timeout: 30000 }, async t => {
  t.after(async () => { delete globalThis.createImageBitmap; setLang('cs', { save: false }); await win.happyDOM.close(); });
  setAppUnit('mm', { save: false });
  for (const lang of ['cs', 'en']) await t.test(lang, async () => {
    setLang(lang, { save: false }); let added, options;
    const modal = openCapture({ onAdd: (tools, opts) => { added = tools; options = opts; } });
    try {
      changed('#photo-reference', 'ruler');
      const input = $('#gallery-file');
      Object.defineProperty(input, 'files', { configurable: true, value: [new win.File(['fixture'], 'silver-wrenches.png', { type: 'image/png' })] });
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
      await waitFor(() => $('#calibration-canvas'), 'ruler calibration after file decode');
      rulerPoint(0, 60, 370); rulerPoint(1, 540, 370);
      $('#ruler-distance').value = '200';
      $('#ruler-distance').dispatchEvent(new win.Event('input', { bubbles: true }));
      click('#capture-continue');
      await waitFor(() => $('#trace-items [data-item="1"]'), 'two actual recognized tool rows');
      assert.equal(win.document.querySelectorAll('#trace-items input[type="checkbox"]').length, 2);
      assert.equal($('#capture-add').disabled, false, 'ready quality enables the actual capture UI');
      assert.ok($('.recognition-status').classList.contains('ready'));
      const tip = $('[data-photo-enhanced]')?.textContent;
      assert.ok(tip, 'the automatic light preparation is explained');
      assert.match(tip, lang === 'cs' ? /světlé pozadí.*vnitřní odlesky/ : /light background.*internal glare/);
      assert.doesNotMatch(tip, /tmavé vložky|dark insert/);
      changed('#capture-pocket-shape', 'measured');
      changed('#capture-layout', 'photo');
      changed('[data-item="1"]', false);
      click('#capture-add');
      await waitFor(() => added, 'selected tools added');
      assert.equal(added.length, 1, 'selection from the real contour list controls the import');
      assert.equal(options.layout, 'photo');
      assert.ok(added[0].points.length > 10);
      assert.ok(added[0].points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
      const width = Math.max(...added[0].points.map(p => p.x)) - Math.min(...added[0].points.map(p => p.x));
      const height = Math.max(...added[0].points.map(p => p.y)) - Math.min(...added[0].points.map(p => p.y));
      assert.ok(Math.max(width, height) > 95 && Math.max(width, height) < 110, `the calibrated 250px wrench keeps its physical length: ${width} x ${height}mm`);
      await waitFor(() => !$('#trace-canvas'), 'capture closes after import');
    } finally { modal.close(); }
  });
});
