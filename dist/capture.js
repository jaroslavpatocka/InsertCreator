import { detectPaper, rectifyImage, traceImage, calibrateSegment } from './trace.js';
import { icon, esc, openModal } from './ui.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const fmt = n => Number(n.toFixed(1)).toLocaleString('cs-CZ');
const uid = () => globalThis.crypto?.randomUUID?.() || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function canvasFromImage(image) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0); return canvas;
}

/** A real raster sample: two silhouettes are processed by the same photo pipeline. */
function samplePhoto() {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 900;
  const c = canvas.getContext('2d');
  c.fillStyle = '#747b72'; c.fillRect(0, 0, 1000, 900);
  for (let y = 0; y < 900; y += 90) { c.strokeStyle = '#6d746b'; c.beginPath(); c.moveTo(0, y); c.lineTo(1000, y); c.stroke(); }
  c.shadowColor = '#26301f66'; c.shadowBlur = 18; c.shadowOffsetY = 6;
  c.fillStyle = '#fcfcf9'; c.fillRect(240, 75, 500, 707); c.shadowColor = 'transparent';
  // Open-end wrench, including its internal ring. Only the exterior is traced.
  c.fillStyle = '#414b43'; c.beginPath();
  c.moveTo(335, 170); c.lineTo(358, 135); c.lineTo(382, 132); c.lineTo(369, 170); c.lineTo(394, 187);
  c.lineTo(424, 161); c.lineTo(423, 191); c.lineTo(397, 221); c.lineTo(384, 222);
  c.lineTo(377, 533); c.bezierCurveTo(410, 554, 405, 597, 373, 612);
  c.bezierCurveTo(330, 630, 298, 589, 319, 553); c.lineTo(337, 530); c.lineTo(346, 218);
  c.lineTo(326, 200); c.closePath(); c.fill();
  c.fillStyle = '#fcfcf9'; c.beginPath(); c.arc(358, 575, 15, 0, Math.PI * 2); c.fill();
  // Screwdriver: steel shaft and a high-contrast handle, connected in one mask.
  c.fillStyle = '#6c736b'; c.beginPath(); c.moveTo(574, 250); c.lineTo(587, 250); c.lineTo(590, 268); c.lineTo(587, 454); c.lineTo(574, 454); c.lineTo(571, 268); c.closePath(); c.fill();
  c.fillStyle = '#b34e31'; c.beginPath(); c.moveTo(558, 445); c.lineTo(603, 445); c.lineTo(608, 466); c.lineTo(605, 586);
  c.bezierCurveTo(600, 613, 560, 613, 555, 586); c.lineTo(552, 466); c.closePath(); c.fill();
  return c.getImageData(0, 0, canvas.width, canvas.height);
}

function isInside(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function contourInfo(contour, scale) {
  const xs = contour.points.map(p => p.x), ys = contour.points.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: (maxX - minX) / scale, height: (maxY - minY) / scale, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
}

export function openCapture({ onAdd, toast = () => {} }) {
  let closed = false, timer, generation = 0, canvasObserver;
  const state = { step: 0, image: null, imageCanvas: null, corners: [], ruler: [], mode: 'portrait', rulerMm: 100, activePoint: 0, detected: false, busy: false, work: null, scale: 1, items: [], result: null, threshold: null, smoothing: 1.3, invert: false, showMask: false, error: '' };
  const modal = openModal({ title: 'Přidat nástroje z fotky', subtitle: 'Fotka → měřítko → čistá kontura. Vše se zpracuje ve vašem zařízení.', body: '', footer: '', wide: true, onClose: () => { closed = true; generation++; clearTimeout(timer); canvasObserver?.disconnect(); } });
  const steps = () => `<div class="capture-steps" aria-label="Postup"><span class="${state.step === 0 ? 'active' : 'done'}">1 · Fotografie</span><span class="${state.step === 1 ? 'active' : state.step > 1 ? 'done' : ''}">2 · Měřítko</span><span class="${state.step === 2 ? 'active' : ''}">3 · Kontury</span></div>`;
  const errorHTML = () => `<div id="capture-error" role="alert" ${state.error ? '' : 'hidden'} class="form-error">${esc(state.error)}</div>`;
  const setError = message => { state.error = message; const box = modal.body.querySelector('#capture-error'); if (box) { box.textContent = message; box.hidden = !message; } };
  const setBusy = busy => {
    state.busy = busy;
    modal.footer.querySelectorAll('button').forEach(b => b.disabled = busy);
    modal.body.querySelector('.busy-cover')?.remove();
    if (busy) { const cover = document.createElement('div'); cover.className = 'busy-cover'; cover.innerHTML = '<div style="text-align:center"><span class="spinner" aria-hidden="true"></span><p>Zpracovávám fotografii…</p></div>'; modal.body.querySelector('.capture-canvas, .upload-zone')?.append(cover); }
    if (!busy && state.step === 2) updateAddButton();
  };

  async function loadFile(file) {
    if (!file || state.busy) return;
    setError('');
    if (file.size > 20 * 1024 * 1024) { setError('Fotografie je větší než 20 MB. Zmenšete ji nebo vyberte menší soubor.'); return; }
    if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type)) { setError('Tento prohlížeč neumí přečíst HEIC. Vyberte JPG, PNG nebo WebP; v telefonu lze fotku uložit či sdílet jako JPG.'); return; }
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|avif|bmp)$/i.test(file.name)) { setError('Vyberte fotografii ve formátu JPG, PNG nebo WebP.'); return; }
    setBusy(true); await frame(); await frame();
    let bitmap, url;
    try {
      try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { url = URL.createObjectURL(file); bitmap = new Image(); bitmap.src = url; await bitmap.decode(); }
      if (closed) return;
      const w = bitmap.width || bitmap.naturalWidth, h = bitmap.height || bitmap.naturalHeight;
      if (!(w >= 100 && h >= 100)) throw new Error('Fotografie je příliš malá. Použijte obrázek s rozlišením alespoň 100 × 100 pixelů.');
      const scale = Math.min(1, 1400 / Math.max(w, h)), canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      beginCalibration(context.getImageData(0, 0, canvas.width, canvas.height));
    } catch (error) { setError(error.message || 'Fotografii se nepodařilo otevřít. Zkuste JPG nebo PNG.'); toast('Fotografii se nepodařilo načíst.'); }
    finally { bitmap?.close?.(); if (url) URL.revokeObjectURL(url); if (!closed) setBusy(false); }
  }

  function beginCalibration(image) {
    state.image = image; state.imageCanvas = canvasFromImage(image); state.step = 1; state.error = ''; state.mode = 'portrait'; state.activePoint = 0;
    const detected = detectPaper(image); state.detected = !!detected;
    state.corners = detected || [{ x: image.width * .1, y: image.height * .1 }, { x: image.width * .9, y: image.height * .1 }, { x: image.width * .9, y: image.height * .9 }, { x: image.width * .1, y: image.height * .9 }];
    state.ruler = [{ x: image.width * .3, y: image.height * .65 }, { x: image.width * .7, y: image.height * .65 }];
    render();
  }

  function renderUpload() {
    modal.body.innerHTML = steps() + `<div class="upload-zone" style="position:relative" tabindex="0" role="button" aria-label="Vybrat nebo přetáhnout fotografii"><div class="upload-symbol">${icon('camera')}</div><strong>Každý nástroj začíná fotkou.</strong><p>Položte nástroje na světlý papír, přidejte měřítko a vyfoťte je kolmo shora.</p><div class="upload-buttons"><button class="btn btn-primary" id="camera-pick">${icon('camera')} Vyfotit</button><button class="btn btn-light" id="gallery-pick">${icon('upload')} Vybrat fotku</button></div><small style="color:#92a086;margin-top:15px;font-size:10px">JPG, PNG, WebP · nejvýše 20 MB · přetažení také funguje</small></div><input type="file" accept="image/*" capture="environment" id="camera-file" hidden><input type="file" accept="image/*" id="gallery-file" hidden>${errorHTML()}<div class="capture-note"><div><b>01 / Dejte fotce měřítko</b>Celý list A4 musí být vidět. U pravítka později označíte dvě značky.</div><div><b>02 / Nechte nástroje odděleně</b>Mezi nástroji ponechte mezeru. Rovnoměrné světlo omezí stíny.</div><div><b>03 / Zkontrolujte výsledek</b>Odlesky a výška nástroje ovlivňují přesnost. Před výrobou ověřte rozměry.</div></div><button class="sample-button" id="sample-scan">Nejdřív si to vyzkoušet na ukázkové fotografii</button>`;
    modal.footer.innerHTML = '<span class="footnote">Fotografie zůstávají ve vašem prohlížeči.</span><button class="btn btn-light" id="capture-cancel">Zavřít</button>';
    const zone = modal.body.querySelector('.upload-zone');
    const pick = selector => modal.body.querySelector(selector).click();
    modal.body.querySelector('#camera-pick').onclick = e => { e.stopPropagation(); pick('#camera-file'); };
    modal.body.querySelector('#gallery-pick').onclick = e => { e.stopPropagation(); pick('#gallery-file'); };
    zone.onclick = () => pick('#gallery-file');
    zone.onkeydown = e => { if (e.target === zone && ['Enter', ' '].includes(e.key)) { e.preventDefault(); pick('#gallery-file'); } };
    for (const input of modal.body.querySelectorAll('input[type=file]')) input.onchange = () => loadFile(input.files[0]);
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragover'); loadFile(e.dataTransfer.files[0]); };
    modal.body.querySelector('#sample-scan').onclick = async () => { if (state.busy) return; setBusy(true); await frame(); await frame(); if (!closed) { beginCalibration(samplePhoto()); setBusy(false); } };
    modal.footer.querySelector('#capture-cancel').onclick = modal.close;
  }

  function renderCalibration() {
    modal.body.innerHTML = steps() + `<div class="capture-grid"><div class="capture-canvas"><canvas id="calibration-canvas" tabindex="0" role="img" aria-label="Označení měřítka. Tažením přesuňte očíslované body. Klávesy 1 až 4 vyberou bod, šipky jej posunou."></canvas></div><div class="capture-sidebar"><label class="field"><span>Měřítko ve fotografii</span><select id="calibration-mode"><option value="portrait">A4 na výšku · 210 × 297 mm</option><option value="landscape">A4 na šířku · 297 × 210 mm</option><option value="ruler">Pravítko / známá vzdálenost</option></select></label><label class="field" id="ruler-distance-field" ${state.mode === 'ruler' ? '' : 'hidden'}><span>Vzdálenost mezi body 1 a 2</span><div class="input-wrap"><input id="ruler-distance" type="number" min="1" max="5000" step="1" value="${state.rulerMm}" inputmode="decimal"><em>mm</em></div></label><p id="calibration-instruction" class="full-span"></p><div class="tip full-span" style="font-size:10px"><span>Body přetáhněte na skutečné rohy papíru. Celý nástroj musí ležet uvnitř. U pravítka použijte dvě vzdálené značky a foťte kolmo; tato metoda neopravuje perspektivu.</span></div><button class="btn btn-soft block-button full-span" id="reset-calibration" style="margin-top:15px">Obnovit označení</button>${errorHTML()}</div></div>`;
    modal.footer.innerHTML = '<button class="btn btn-light" id="capture-back">Zpět</button><span class="footnote">Přesnost začíná správným měřítkem.</span><button class="btn btn-primary" id="capture-continue">Načíst kontury →</button>';
    const select = modal.body.querySelector('#calibration-mode'); select.value = state.mode;
    const updateInstructions = () => {
      const rulerField = modal.body.querySelector('#ruler-distance-field');
      rulerField.hidden = state.mode !== 'ruler'; rulerField.style.display = state.mode === 'ruler' ? 'block' : 'none';
      modal.body.querySelector('#calibration-instruction').textContent = state.mode === 'ruler' ? 'Přesuňte body 1 a 2 přesně na dvě značky pravítka. Zadejte skutečnou vzdálenost mezi nimi; pravítko potom ve výběru kontur odškrtněte.' : state.detected ? 'Papír je předběžně rozpoznaný. Zkontrolujte všechny čtyři rohy a případně je přetáhněte. Podle nich se opraví perspektiva.' : 'Papír nebyl spolehlivě rozpoznán. Přetáhněte body 1–4 na jeho rohy: levý horní, pravý horní, pravý dolní a levý dolní.';
      drawCalibration();
    };
    select.onchange = () => { state.mode = select.value; state.activePoint = 0; setError(''); updateInstructions(); };
    modal.body.querySelector('#ruler-distance').oninput = e => { state.rulerMm = Number(e.target.value); };
    modal.body.querySelector('#reset-calibration').onclick = () => {
      const im = state.image;
      if (state.mode === 'ruler') state.ruler = [{ x: im.width * .3, y: im.height * .65 }, { x: im.width * .7, y: im.height * .65 }];
      else state.corners = detectPaper(im) || [{ x: im.width * .1, y: im.height * .1 }, { x: im.width * .9, y: im.height * .1 }, { x: im.width * .9, y: im.height * .9 }, { x: im.width * .1, y: im.height * .9 }];
      setError(''); drawCalibration();
    };
    const canvas = modal.body.querySelector('#calibration-canvas'); canvas.width = state.image.width; canvas.height = state.image.height;
    let dragging = false;
    const position = e => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(canvas.width - 1, (e.clientX - r.left) * canvas.width / r.width)), y: Math.max(0, Math.min(canvas.height - 1, (e.clientY - r.top) * canvas.height / r.height)) }; };
    canvas.onpointerdown = e => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault(); canvas.focus(); const p = position(e), points = state.mode === 'ruler' ? state.ruler : state.corners;
      state.activePoint = points.map((v, i) => ({ i, d: Math.hypot(p.x - v.x, p.y - v.y) })).sort((a, b) => a.d - b.d)[0].i;
      points[state.activePoint] = p; dragging = true; canvas.setPointerCapture(e.pointerId); drawCalibration();
    };
    canvas.onpointermove = e => { if (!dragging) return; const points = state.mode === 'ruler' ? state.ruler : state.corners; points[state.activePoint] = position(e); drawCalibration(); };
    canvas.onpointerup = e => { dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
    canvas.onpointercancel = () => { dragging = false; };
    canvas.onkeydown = e => {
      const points = state.mode === 'ruler' ? state.ruler : state.corners;
      if (/^[1-4]$/.test(e.key) && +e.key <= points.length) state.activePoint = +e.key - 1;
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); const p = points[state.activePoint], d = e.shiftKey ? 10 : 1;
        p.x = Math.max(0, Math.min(canvas.width - 1, p.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0)));
        p.y = Math.max(0, Math.min(canvas.height - 1, p.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0)));
      } else return;
      drawCalibration();
    };
    modal.footer.querySelector('#capture-back').onclick = () => { state.step = 0; state.error = ''; render(); };
    modal.footer.querySelector('#capture-continue').onclick = async () => {
      if (state.busy) return;
      setError(''); setBusy(true); await frame(); await frame();
      try {
        if (closed) return;
        if (state.mode === 'ruler') { state.scale = calibrateSegment(state.ruler[0], state.ruler[1], state.rulerMm); state.work = state.image; }
        else { const { imageData, pxPerMm } = rectifyImage(state.image, state.corners, state.mode === 'portrait' ? 210 : 297, state.mode === 'portrait' ? 297 : 210, 1100); state.work = imageData; state.scale = pxPerMm; }
        state.threshold = null; state.invert = false; state.smoothing = 1.3; state.showMask = false; state.items = [];
        computeTrace(); state.step = 2; state.busy = false; render();
      } catch (error) { setError(error.message || 'Měřítko se nepodařilo určit. Zkontrolujte označené body.'); }
      finally { if (!closed) setBusy(false); }
    };
    updateInstructions();
  }

  function drawCalibration() {
    const canvas = modal.body.querySelector('#calibration-canvas'); if (!canvas) return;
    const c = canvas.getContext('2d'), points = state.mode === 'ruler' ? state.ruler : state.corners;
    c.clearRect(0, 0, canvas.width, canvas.height); c.drawImage(state.imageCanvas, 0, 0);
    const scale = canvas.width / Math.max(250, canvas.clientWidth || 550), radius = 12 * scale;
    c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    if (points.length === 4) { c.closePath(); c.fillStyle = '#f1b94d15'; c.fill(); }
    c.strokeStyle = '#efb649'; c.lineWidth = 2 * scale; c.setLineDash([6 * scale, 4 * scale]); c.stroke(); c.setLineDash([]);
    points.forEach((p, i) => {
      c.beginPath(); c.arc(p.x, p.y, radius, 0, Math.PI * 2); c.fillStyle = state.activePoint === i ? '#efb649' : '#fff'; c.fill();
      c.strokeStyle = '#81602b'; c.lineWidth = 1.5 * scale; c.stroke(); c.fillStyle = '#483c26'; c.font = `bold ${11 * scale}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), p.x, p.y + scale);
    });
  }

  function computeTrace() {
    const previous = state.items, used = new Set();
    state.result = traceImage(state.work, { threshold: state.threshold, invert: state.invert, smoothing: state.smoothing, minArea: .0007 });
    state.items = state.result.contours.map((contour, index) => {
      const info = contourInfo(contour, state.scale);
      let match = null, best = Math.max(state.work.width, state.work.height) * .15;
      for (let i = 0; i < previous.length; i++) if (!used.has(i)) { const d = Math.hypot(previous[i].info.center.x - info.center.x, previous[i].info.center.y - info.center.y); if (d < best) { best = d; match = i; } }
      if (match !== null) used.add(match);
      return { contour, info, checked: match !== null ? previous[match].checked : true, name: match !== null ? previous[match].name : `Nástroj ${index + 1}` };
    }).filter(item => item.info.width >= 2 && item.info.height >= 2);
  }

  function renderTrace() {
    modal.body.innerHTML = steps() + `<div class="capture-grid"><div class="capture-canvas"><canvas id="trace-canvas" role="img" aria-label="Rozpoznané kontury. Kliknutím na obrys jej vyberete nebo vyřadíte."></canvas></div><div class="capture-sidebar"><div class="full-span"><h3>Jasné hrany. Vlastní kontrola.</h3><p>Vyberte jen nástroje. Pravítko, stíny a další nalezené objekty odškrtněte. Název můžete přepsat.</p></div><div class="field"><label class="range-label" for="trace-threshold">Kontrastní práh <output id="threshold-value">${state.result.threshold}</output></label><input type="range" id="trace-threshold" min="0" max="255" value="${state.result.threshold}"><button id="trace-auto" class="section-link">Automatické nastavení</button></div><div class="field"><label class="range-label" for="trace-smoothing">Vyhlazení <output id="smoothing-value">${fmt(state.smoothing)}</output></label><input type="range" id="trace-smoothing" min="0" max="4" step="0.1" value="${state.smoothing}"></div><label class="check-row"><input id="trace-invert" type="checkbox" ${state.invert ? 'checked' : ''}> Světlý nástroj na tmavém</label><label class="check-row"><input id="trace-mask" type="checkbox" ${state.showMask ? 'checked' : ''}> Kontrastní maska</label><div class="full-span" style="display:flex;justify-content:space-between;margin-top:5px"><button class="section-link" id="trace-select-all">Vybrat vše</button><button class="section-link" id="trace-select-none">Zrušit výběr</button></div><div id="trace-items" class="trace-items full-span"></div><p id="trace-summary" class="full-span"></p>${errorHTML()}<p class="muted-note full-span">Zobrazené rozměry jsou bez vůle kapsy. Hloubku a vůli nastavíte v editoru. Pokud kontura nesedí, upravte práh nebo po přidání její body.</p></div></div>`;
    modal.footer.innerHTML = '<button class="btn btn-light" id="capture-back">← Měřítko</button><span class="footnote">Před výrobou ověřte skutečný rozměr nástroje.</span><button class="btn btn-primary" id="capture-add">Přidat do šuplíku</button>';
    const canvas = modal.body.querySelector('#trace-canvas'); canvas.width = state.work.width; canvas.height = state.work.height;
    canvas.onclick = e => { if (state.busy) return; const r = canvas.getBoundingClientRect(), point = { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; const item = [...state.items].reverse().find(item => isInside(point, item.contour.points)); if (item) { item.checked = !item.checked; updateTraceResult(); } };
    const threshold = modal.body.querySelector('#trace-threshold');
    threshold.oninput = () => { state.threshold = Number(threshold.value); modal.body.querySelector('#threshold-value').textContent = threshold.value; scheduleTrace(); };
    const smoothing = modal.body.querySelector('#trace-smoothing');
    smoothing.oninput = () => { state.smoothing = Number(smoothing.value); modal.body.querySelector('#smoothing-value').textContent = fmt(state.smoothing); scheduleTrace(); };
    modal.body.querySelector('#trace-auto').onclick = () => { state.threshold = null; scheduleTrace(0); };
    modal.body.querySelector('#trace-invert').onchange = e => { state.invert = e.target.checked; scheduleTrace(0); };
    modal.body.querySelector('#trace-mask').onchange = e => { state.showMask = e.target.checked; drawTrace(); };
    modal.body.querySelector('#trace-select-all').onclick = () => { state.items.forEach(item => item.checked = true); updateTraceResult(); };
    modal.body.querySelector('#trace-select-none').onclick = () => { state.items.forEach(item => item.checked = false); updateTraceResult(); };
    const list = modal.body.querySelector('#trace-items');
    list.onchange = e => { const i = Number(e.target.dataset.item); if (e.target.matches('input[type=checkbox]') && state.items[i]) { state.items[i].checked = e.target.checked; drawTrace(); updateAddButton(); updateSummary(); } };
    list.oninput = e => { const i = Number(e.target.dataset.name); if (e.target.matches('input[type=text]') && state.items[i]) state.items[i].name = e.target.value.slice(0, 80); };
    modal.footer.querySelector('#capture-back').onclick = () => { clearTimeout(timer); generation++; state.step = 1; state.error = ''; state.busy = false; render(); };
    modal.footer.querySelector('#capture-add').onclick = async () => {
      if (state.busy) return;
      const selected = state.items.filter(item => item.checked);
      if (!selected.length) return;
      if (selected.length > 300) { setError('Najednou lze přidat nejvýše 300 nástrojů. Zrušte výběr nechtěných obrysů.'); return; }
      if (selected.some(item => item.info.width > 3000 || item.info.height > 3000)) { setError('Některý obrys přesahuje 3 metry. Vraťte se k měřítku a ověřte rozměry referenčních bodů.'); return; }
      if (selected.some(item => item.contour.points.length > 6000)) { setError('Některá kontura je příliš detailní. Zvyšte vyhlazení, aby měla nejvýše 6000 bodů, nebo pořiďte čistší fotografii.'); return; }
      const tools = selected.map(item => ({ id: uid(), name: item.name.trim() || 'Nástroj', points: item.contour.points.map(p => ({ x: +(Math.max(0, p.x - item.info.minX) / state.scale).toFixed(4), y: +(Math.max(0, p.y - item.info.minY) / state.scale).toFixed(4) })), depth: 12, x: 0, y: 0, rotation: 0, locked: false, moduleId: null }));
      setBusy(true);
      try { await onAdd(tools); modal.close(); }
      catch (error) { setError(error.message || 'Nástroje se nepodařilo přidat.'); setBusy(false); }
    };
    updateTraceResult();
  }

  function scheduleTrace(delay = 120) {
    clearTimeout(timer); const current = ++generation;
    // Disable adding immediately, so the downloaded contour always matches the controls.
    state.busy = true; updateAddButton();
    timer = setTimeout(async () => {
      if (closed || state.step !== 2 || current !== generation) return;
      setBusy(true); setError(''); await frame(); await frame();
      if (closed || state.step !== 2 || current !== generation) return;
      try { computeTrace(); updateTraceResult(); const slider = modal.body.querySelector('#trace-threshold'); slider.value = state.result.threshold; modal.body.querySelector('#threshold-value').textContent = state.result.threshold; }
      catch (error) { setError(error.message || 'Konturu se nepodařilo načíst. Zkuste jinou fotografii.'); }
      finally { if (!closed && current === generation) setBusy(false); }
    }, delay);
  }

  function updateAddButton() {
    const button = modal.footer.querySelector('#capture-add'); if (!button) return;
    const count = state.items.filter(item => item.checked).length;
    button.disabled = state.busy || count === 0;
    button.textContent = count ? `Přidat do šuplíku (${count})` : 'Vyberte alespoň jeden nástroj';
  }
  function updateSummary() {
    const summary = modal.body.querySelector('#trace-summary'); if (!summary) return;
    const count = state.items.filter(item => item.checked).length;
    summary.textContent = state.items.length ? `Vybráno ${count} z ${state.items.length} obrysů · měřítko ${fmt(state.scale)} px/mm` : 'Žádný obrys nebyl nalezen. Zkuste posunout kontrastní práh. Nástroje se nesmějí dotýkat okraje ani sebe navzájem.';
  }
  function updateTraceResult() {
    const list = modal.body.querySelector('#trace-items'); if (!list) return;
    list.innerHTML = state.items.map((item, i) => `<div class="trace-item"><input type="checkbox" data-item="${i}" ${item.checked ? 'checked' : ''} aria-label="Vybrat ${esc(item.name)}"><input type="text" data-name="${i}" aria-label="Název nástroje ${i + 1}" value="${esc(item.name)}" maxlength="80" style="width:100%;min-width:55px;background:transparent;border:0;border-bottom:1px solid #e0e5d8;font:inherit;padding:5px 2px;color:#58684d"><span style="white-space:nowrap">${fmt(item.info.width)} × ${fmt(item.info.height)} mm</span></div>`).join('');
    updateSummary(); updateAddButton(); drawTrace();
  }
  function drawTrace() {
    const canvas = modal.body.querySelector('#trace-canvas'); if (!canvas || !state.result) return;
    const c = canvas.getContext('2d');
    if (state.showMask) {
      const rgba = new Uint8ClampedArray(state.work.width * state.work.height * 4);
      for (let i = 0; i < state.result.mask.length; i++) { const value = state.result.mask[i] ? 44 : 249; rgba[i * 4] = value; rgba[i * 4 + 1] = value; rgba[i * 4 + 2] = value; rgba[i * 4 + 3] = 255; }
      c.putImageData(new ImageData(rgba, state.work.width, state.work.height), 0, 0);
    } else c.putImageData(state.work, 0, 0);
    const scale = canvas.width / Math.max(250, canvas.clientWidth || 550);
    state.items.forEach((item, i) => {
      c.beginPath(); item.contour.points.forEach((p, j) => j ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
      c.fillStyle = item.checked ? '#efb74e30' : '#ffffff60'; c.fill(); c.strokeStyle = item.checked ? '#f1b640' : '#9caa97'; c.lineWidth = (item.checked ? 2 : 1) * scale; c.stroke();
      const p = item.info.center; c.fillStyle = item.checked ? '#efb74e' : '#e3e8df'; c.beginPath(); c.arc(p.x, p.y, 10 * scale, 0, Math.PI * 2); c.fill(); c.fillStyle = '#384830'; c.font = `bold ${10 * scale}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), p.x, p.y + .5 * scale);
    });
  }

  function render() {
    if (closed) return;
    canvasObserver?.disconnect();
    if (state.step === 0) renderUpload(); else if (state.step === 1) renderCalibration(); else renderTrace();
    const canvas = modal.body.querySelector('canvas');
    if (canvas && typeof ResizeObserver === 'function') {
      canvasObserver = new ResizeObserver(() => { if (!closed) state.step === 1 ? drawCalibration() : drawTrace(); });
      canvasObserver.observe(canvas);
    }
  }
  render();
  return modal;
}
