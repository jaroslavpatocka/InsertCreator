import { t, getLang, errorText, fmtNum, onLangChange } from './i18n.js';
import { esc, icon } from './ui.js';
import { unit, inputValue, parseLength, fmtLen, fmtSize, onUnitChange } from './units.js';
import { CATEGORIES } from './tool-categories.js';
import {DEFAULT_POCKET_MARGIN,validatePocketMargin,optionalPocketMargin} from './pocket-margin.js';
import {normalizePocketWall,validatePocketWall,pocketWallOffset} from './pocket-wall.js';

// Pocket wall profile of one tool. `pocketWall` holds the last valid {type,value}
// (mm or degrees); `pocketWallText` keeps the typed draft and `pocketWallUnit` its unit.
const WALL_TYPES = ['vertical', 'draft', 'chamfer', 'roundTop', 'roundBottom'];
const WALL_DEFAULTS = { draft: 5, chamfer: 1, roundTop: 1.5, roundBottom: 1 };
const wallName = type => type === 'draft' ? t('Šikmá stěna') : type === 'chamfer' ? t('Zkosená horní hrana') : type === 'roundTop' ? t('Zaoblená horní hrana') : type === 'roundBottom' ? t('Zaoblené dno') : t('Kolmá');
const wallValueLabel = type => type === 'draft' ? t('Úhel od svislice') : type === 'chamfer' ? t('Šířka zkosení') : t('Poloměr zaoblení');
const wallNote = type => type === 'draft' ? t('Kapsa se směrem nahoru rozšiřuje.') : type === 'chamfer' ? t('Horní hrana kapsy se zkosí pod úhlem 45°.') : type === 'roundTop' ? t('Horní hrana kapsy se zaoblí.') : type === 'roundBottom' ? t('Dno se zmenší o poloměr zaoblení, spodní hrana nástroje proto nemusí ležet rovně.') : t('Stěna kapsy je svislá po celé hloubce.');
const validDepth = depth => Number.isFinite(depth) && depth > 0 ? depth : null;
const wallMax = depth => Math.min(20, validDepth(depth) ?? 20);
const angle = value => `${fmtNum(value, 2)}°`;
function parseWallValue(type, raw, rawUnit = unit()) {
  if (type !== 'draft') return parseLength(raw, rawUnit);
  const text = String(raw ?? '').trim().replace(/\s*°$/, '').replace(',', '.');
  return text && /^\d*\.?\d+$|^\d+\.$/.test(text) ? Number(text) : NaN;
}
/** null for a valid profile, otherwise a localized message in the current unit. */
function wallMessage(type, value, depth) {
  if (type === 'draft') {
    if (!(Number.isFinite(value) && value >= .5 - 1e-9 && value <= 45 + 1e-9)) return t('Úhel stěny kapsy musí být od {min}° do {max}°.', { min: fmtNum(.5), max: fmtNum(45) });
  } else if (!(Number.isFinite(value) && value >= .2 - 1e-9 && value <= wallMax(depth) + 1e-9)) {
    return t('Rozměr tvaru stěny kapsy musí být od {min} do {max}.', { min: fmtLen(.2), max: fmtLen(wallMax(depth)) });
  }
  try { validatePocketWall({ type, value }, validDepth(depth) ?? 20); return null; } catch (error) { return errorText(error); }
}
/** Schematic cross-section: pocket on the left, insert material on the right. */
function wallProfilePath(wall, depth) {
  const d = validDepth(depth) ?? 10, scale = 24 / d, top = 8, floor = 32, x0 = 26;
  let shape = null; try { shape = normalizePocketWall(wall); } catch {}
  const points = [];
  for (let i = 0; i <= 32; i++) {
    const h = d * (1 - i / 32);
    let offset = 0; try { offset = shape ? pocketWallOffset(shape, d, h) : 0; } catch {}
    points.push(`${Math.max(6, Math.min(56, x0 + offset * scale)).toFixed(2)} ${(floor - h * scale).toFixed(2)}`);
  }
  return `M60 ${top}L${points.join('L')}L4 ${floor}L4 36L60 36Z`;
}

/** Optional, sequential review of the live capture drafts. Geometry changes only on Apply. */
export function mountCaptureGuide({
  host, items, getDepth = () => '', getMaxDepth = () => 99,
  getPocketMargin = () => DEFAULT_POCKET_MARGIN,
  getDimensions = () => null, onSelect = () => {}, onUpdate = () => {},
  onResize = () => {}, onFinish = () => {}, onError = () => {}, onModeChange = () => {}
}) {
  let current = 0, active = false, started = false, complete = false, busy = false, resizing = false, destroyed = false;
  const dimensionDrafts = new Map(), wallMemory = new Map(), disclosureState = new Map();
  const find = selector => host.querySelector(selector);
  const item = () => items[current];
  const blocked = () => busy || resizing || destroyed;
  const dimensions = index => {
    try {
      const measured = getDimensions(index);
      return measured && Number.isFinite(measured.length) && Number.isFinite(measured.width) ? measured : null;
    } catch { return null; }
  };
  const rawDepth = index => String(items[index]?.depth ?? '').trim() || String(getDepth());

  function report(message = '', focus) {
    const error = find('#capture-guide-error');
    if (error) { error.textContent = message; error.hidden = !message; }
    for (const selector of ['#capture-guide-depth', '#capture-guide-margin', '#capture-guide-wall-value']) {
      const field = find(selector);
      if (message && focus === selector) field?.setAttribute('aria-invalid', 'true'); else field?.removeAttribute('aria-invalid');
    }
    onError(message);
    if (message && focus) {
      const field = find(focus);
      // A validation problem must remain reachable even when its settings are folded.
      for (let section = field?.parentElement; section && section !== host; section = section.parentElement) {
        if (section.tagName === 'DETAILS') section.open = true;
      }
      field?.focus();
    }
  }

  function update(patch) {
    Object.assign(item(), patch);
    complete = false;
    onUpdate(current, patch);
  }

  function syncBusy() {
    host.querySelectorAll('button,input,select').forEach(control => {if(!control.closest('.capture-contour-palette'))control.disabled = blocked();});
    const previous = find('#capture-guide-prev');
    if (previous) previous.disabled = blocked() || current === 0;
    host.setAttribute('aria-busy', String(busy || resizing));
  }

  function dimensionDraft() {
    if (!dimensionDrafts.has(current)) {
      const measured = dimensions(current);
      if (!measured) return null;
      const length = inputValue(measured.length), width = inputValue(measured.width);
      dimensionDrafts.set(current, { length, width, baseLength: length, baseWidth: width, dirty: false });
    }
    return dimensionDrafts.get(current);
  }

  const wallOf = index => { try { return normalizePocketWall(items[index]?.pocketWall); } catch { return items[index]?.pocketWall ?? null; } };
  /** Value shown in the field: the typed draft, or the stored value in the current unit. */
  function wallDisplay(index) {
    const it = items[index], wall = wallOf(index);
    if (!wall) return '';
    const raw = it.pocketWallText;
    if (typeof raw === 'string') {
      const same = wall.type === 'draft' || !it.pocketWallUnit || it.pocketWallUnit === unit();
      if (same || !Number.isFinite(parseWallValue(wall.type, raw, it.pocketWallUnit))) return raw;
    }
    return wall.type === 'draft' ? String(Math.round(wall.value * 100) / 100) : inputValue(wall.value, { digits: 6 });
  }
  function wallProblem(index) {
    const it = items[index], wall = it?.pocketWall;
    if (wall == null) return null;
    let type;
    try { type = normalizePocketWall(wall)?.type; } catch (error) { return errorText(error); }
    if (!type) return null;
    const raw = it.pocketWallText, value = typeof raw === 'string' ? parseWallValue(type, raw, it.pocketWallUnit || unit()) : wall.value;
    return wallMessage(type, value, parseLength(rawDepth(index)));
  }
  const keepFocused = (selector, value) => { const field = find(selector); if (field && field !== host.ownerDocument.activeElement) field.value = value; };
  function syncWall(setValue = keepFocused) {
    const wall = wallOf(current), type = wall?.type || 'vertical', depth = parseLength(rawDepth(current));
    setValue('#capture-guide-wall-type', type);
    find('[data-guide-wall-value]').hidden = type === 'vertical';
    if (type !== 'vertical') {
      find('[data-guide-wall-label]').textContent = wallValueLabel(type);
      find('[data-guide-wall-unit]').textContent = type === 'draft' ? '°' : unit();
      setValue('#capture-guide-wall-value', wallDisplay(current));
    }
    const range = type === 'vertical' ? '' : ' ' + t('Povolený rozsah {min} až {max}.', type === 'draft' ? { min: angle(.5), max: angle(45) } : { min: fmtLen(.2), max: fmtLen(wallMax(depth)) });
    find('[data-guide-wall-hint]').textContent = wallNote(type) + range;
    const profile = find('[data-guide-wall-profile]');
    profile.setAttribute('aria-label', t('Řez stěnou kapsy: {shape}', { shape: wallName(type) }));
    profile.querySelector('path').setAttribute('d', wallProfilePath(wall, depth));
  }

  function syncCurrent(forceDimensions = false) {
    if (!active || !item()) return;
    const setValue = (selector, value, force = false) => {
      const field = find(selector);
      if (field && (force || field !== host.ownerDocument.activeElement)) field.value = value;
    };
    setValue('#capture-guide-name', item().name ?? '');
    setValue('#capture-guide-depth', item().depth ?? '');
    setValue('#capture-guide-category', item().category ?? '');
    setValue('#capture-guide-size-label', item().sizeLabel ?? '');
    setValue('#capture-guide-margin',item().pocketMarginText??(item().pocketMargin==null?'':inputValue(item().pocketMargin,{digits:6})));
    find('#capture-guide-margin').placeholder=inputValue(getPocketMargin(),{digits:6});
    find('[data-guide-margin-hint]').textContent=t('Prázdné pole převezme vůli modulu {margin}. Nula vytvoří kapsu bez přídavku.',{margin:fmtLen(getPocketMargin())});
    syncWall(setValue);
    find('#capture-guide-include').checked = !!item().checked;
    find('#capture-guide-depth').placeholder = String(getDepth());
    find('[data-guide-excluded]').hidden = !!item().checked;
    const inherited = parseLength(getDepth());
    find('[data-guide-depth-hint]').textContent = t('Prázdné pole převezme společnou hloubku {depth}. Nejvýše {max}.', { depth: Number.isFinite(inherited) ? fmtLen(inherited) : String(getDepth()), max: fmtLen(getMaxDepth()) });
    const depth = parseLength(rawDepth(current)), rawMargin = item().pocketMarginText;
    const margin = typeof rawMargin === 'string' && rawMargin.trim() ? parseLength(rawMargin) : item().pocketMargin ?? getPocketMargin();
    find('[data-guide-pocket-summary]').textContent = t('Hloubka {depth} · vůle {margin}', { depth: Number.isFinite(depth) ? fmtLen(depth) : '—', margin: Number.isFinite(margin) ? fmtLen(margin) : '—' });
    find('[data-guide-label-summary]').textContent = item().sizeLabel || t('Automaticky podle názvu');
    const measured = dimensions(current), draft = dimensionDraft();
    const section = find('[data-guide-dimensions]');
    section.hidden = !measured;
    if (measured && draft) {
      find('[data-guide-measured]').textContent = fmtSize(measured.length, measured.width);
      setValue('#capture-guide-length', draft.length, forceDimensions);
      setValue('#capture-guide-width', draft.width, forceDimensions);
      find('[data-guide-dimensions-pending]').hidden = !draft.dirty;
    }
    syncBusy();
  }

  function open(index = current) {
    if (blocked() || !items.length || !Number.isInteger(index)) return;
    current = Math.max(0, Math.min(items.length - 1, index));
    active = true; started = true;
    onModeChange(true);
    render();
    onSelect(current);
    find('#capture-guide-name')?.focus({ preventScroll: true });
    host.scrollIntoView?.({ block: 'nearest' });
  }

  function leave() {
    if (blocked()) return;
    active = false;
    report();
    onModeChange(false);
    render();
    find('#capture-guide-start')?.focus({ preventScroll: true });
  }

  function issue(index) {
    if (!items[index].checked) return null;
    const depth = parseLength(rawDepth(index)), max = getMaxDepth();
    if (!Number.isFinite(depth) || depth < .5 || depth > max + 1e-9) {
      return { message: t('Hloubka kapsy musí být od {min} do {max}.', { min: fmtLen(.5), max: fmtLen(max) }), focus: '#capture-guide-depth' };
    }
    try{
      const draft=items[index].pocketMarginText;
      if(typeof draft==='string'&&draft.trim())validatePocketMargin(parseLength(draft));
      else optionalPocketMargin(items[index].pocketMargin);
    }catch(error){return{message:errorText(error),focus:'#capture-guide-margin'};}
    const wallIssue = wallProblem(index);
    if (wallIssue) return { message: wallIssue, focus: '#capture-guide-wall-value' };
    if (dimensionDrafts.get(index)?.dirty) {
      return { message: t('Změnu rozměrů nejdřív potvrďte nebo vraťte původní rozměry.'), focus: '#capture-guide-resize' };
    }
    return null;
  }

  function check(indices) {
    for (const index of indices) {
      const invalid = issue(index);
      if (!invalid) continue;
      if (!active || current !== index) open(index);
      const details = find('[data-guide-dimensions]');
      if (invalid.focus === '#capture-guide-resize' && details) details.open = true;
      report(invalid.message, invalid.focus);
      return false;
    }
    report();
    return true;
  }

  function next() {
    if (blocked() || !check([current])) return;
    if (current < items.length - 1) { open(current + 1); return; }
    if (!check(items.map((_, index) => index))) return;
    complete = true;
    leave();
    onFinish();
  }

  async function applyDimensions() {
    if (blocked()) return;
    const draft = dimensionDraft();
    if (!draft) return;
    if (!draft.dirty) { report(); return; }
    const changes = {};
    if (draft.length !== draft.baseLength) changes.length = parseLength(draft.length);
    if (draft.width !== draft.baseWidth) changes.width = parseLength(draft.width);
    if (!Object.values(changes).every(value => Number.isFinite(value) && value >= 2 && value <= 3000)) {
      report(t('Rozměry nástroje musí být od {min} do {max}.', { min: fmtLen(2), max: fmtLen(3000) }), '#capture-guide-length');
      return;
    }
    const index = current;
    let resizeFailed = false;
    resizing = true; syncBusy();
    try {
      await onResize(index, changes);
      if (destroyed) return;
      dimensionDrafts.delete(index); complete = false;
      report(); syncCurrent(true); onSelect(current);
    } catch (error) {
      resizeFailed = true;
      if (!destroyed) report(errorText(error) || t('Rozměry se nepodařilo upravit.'));
    } finally {
      resizing = false;
      if (!destroyed) {
        syncBusy();
        if (resizeFailed) find('#capture-guide-length')?.focus({ preventScroll: true });
      }
    }
  }

  function render() {
    if (destroyed) return;
    for (const section of host.querySelectorAll('[data-guide-section]')) disclosureState.set(section.dataset.guideSection, section.open);
    host.hidden = !items.length;
    host.classList.add('capture-guide');
    host.classList.toggle('is-open', active);
    host.dataset.captureGuideOpen = String(active);
    if (!active) {
      host.innerHTML = `<section class="capture-guide-entry ${complete ? 'is-complete' : ''}"><div class="capture-guide-entry-heading"><strong>${complete ? t('Nástroje zkontrolovány') : t('Zkontrolovat nástroje postupně')}</strong><span class="capture-guide-badge">${complete ? icon('check') : t('Doporučeno')}</span></div><p>${complete ? t('Vybráno: {selected} / {total}. Nástroje můžete přidat do šuplíku nebo je znovu projít.', { selected: items.filter(tool => tool.checked).length, total: items.length }) : t('Větší náhled a údaje jednoho nástroje na jednom místě. K seznamu se můžete kdykoli vrátit.')}</p><button type="button" class="btn btn-soft" id="capture-guide-start">${icon(complete ? 'check' : 'edit')}${complete ? t('Projít znovu') : started ? t('Pokračovat v kontrole') : t('Spustit průvodce')}</button></section>`;
      find('#capture-guide-start').onclick = () => open(complete ? 0 : current);
      syncBusy();
      return;
    }
    const last = current === items.length - 1;
    host.innerHTML = `<section class="capture-guide-panel" data-guide-index="${current}" aria-label="${esc(t('Kontrola nástroje'))}"><div class="capture-guide-header"><output id="capture-guide-progress" role="status">${t('Nástroj {n} z {total}', { n: current + 1, total: items.length })}</output><button type="button" class="section-link" id="capture-guide-list">${t('Zpět na seznam')}</button></div><progress class="capture-guide-progress" max="${items.length}" value="${current + 1}" aria-label="${esc(t('Průběh kontroly nástrojů'))}"></progress><div class="capture-guide-preview"><canvas id="capture-guide-preview" width="480" height="280" role="img" aria-label="${esc(t('Detail nástroje {n}', { n: current + 1 }))}"></canvas></div><label class="capture-guide-include"><input type="checkbox" id="capture-guide-include">${t('Přidat tento nástroj')}</label><p class="capture-guide-excluded" data-guide-excluded hidden>${t('Tento nástroj se nepřidá.')}</p><label class="capture-guide-field"><span>${t('Název nástroje')}</span><input type="text" id="capture-guide-name" maxlength="80" autocomplete="off"></label><details class="capture-guide-options ui-disclosure" data-guide-section="pocket"><summary><span class="disclosure-title">${t('Hloubka, vůle a stěny kapsy')}<small data-guide-pocket-summary></small></span></summary><div class="capture-guide-options-body ui-disclosure-body"><label class="capture-guide-field"><span>${t('Hloubka kapsy')}</span><div class="capture-guide-input-unit"><input type="text" id="capture-guide-depth" inputmode="decimal" autocomplete="off" spellcheck="false"><em>${unit()}</em></div></label><p class="capture-guide-note" data-guide-depth-hint></p><label class="capture-guide-field"><span>${t('Vlastní vůle této kapsy')}</span><div class="capture-guide-input-unit"><input type="text" id="capture-guide-margin" inputmode="decimal" autocomplete="off" spellcheck="false"><em>${unit()}</em></div></label><p class="capture-guide-note" data-guide-margin-hint></p><div class="capture-guide-wall" data-guide-wall><div class="capture-guide-wall-row"><label class="capture-guide-field"><span>${t('Tvar stěny kapsy')}</span><select id="capture-guide-wall-type" aria-describedby="capture-guide-wall-hint">${WALL_TYPES.map(type => `<option value="${type}">${esc(wallName(type))}</option>`).join('')}</select></label><svg class="capture-guide-wall-profile" data-guide-wall-profile viewBox="0 0 64 40" role="img" focusable="false"><path class="capture-guide-wall-material" d=""/></svg></div><label class="capture-guide-field" data-guide-wall-value hidden><span data-guide-wall-label></span><div class="capture-guide-input-unit"><input type="text" id="capture-guide-wall-value" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="capture-guide-wall-hint"><em data-guide-wall-unit></em></div></label><p class="capture-guide-note" id="capture-guide-wall-hint" data-guide-wall-hint></p></div></div></details><details class="capture-guide-options ui-disclosure" data-guide-section="labels"><summary><span class="disclosure-title">${t('Označení a kategorie')}<small data-guide-label-summary></small></span></summary><div class="capture-guide-options-body ui-disclosure-body"><label class="capture-guide-field"><span>${t('Označení velikosti')}</span><input type="text" id="capture-guide-size-label" maxlength="24" placeholder="${esc(t('Např. 13 mm, PH2 nebo T25'))}" autocomplete="off"></label><label class="capture-guide-field"><span>${t('Kategorie nástroje')}</span><select id="capture-guide-category"><option value="">${t('Automaticky podle názvu')}</option>${CATEGORIES.map(category => `<option value="${category.id}">${esc(category[getLang()])}</option>`).join('')}</select></label></div></details><details class="capture-guide-dimensions ui-disclosure" data-guide-dimensions data-guide-section="dimensions"><summary><span class="disclosure-title">${t('Upravit naměřené rozměry')} <span data-guide-measured></span></span></summary><p class="capture-guide-note">${t('Délka a šířka obrysu. Velikost klíče patří do označení velikosti.')}</p><div class="capture-guide-fields"><label class="capture-guide-field"><span>${t('Délka nástroje')} · ${unit()}</span><input type="text" id="capture-guide-length" inputmode="decimal" autocomplete="off" spellcheck="false"></label><label class="capture-guide-field"><span>${t('Šířka nástroje')} · ${unit()}</span><input type="text" id="capture-guide-width" inputmode="decimal" autocomplete="off" spellcheck="false"></label></div><p class="capture-guide-note capture-guide-pending" data-guide-dimensions-pending hidden>${t('Změna rozměrů zatím není potvrzená.')}</p><div class="capture-guide-dimension-actions"><button type="button" class="btn btn-soft" id="capture-guide-resize">${t('Použít rozměry')}</button><button type="button" class="section-link" id="capture-guide-dimensions-reset">${t('Vrátit rozměry')}</button></div></details><p class="form-error" id="capture-guide-error" role="alert" hidden></p><div class="capture-guide-navigation"><button type="button" class="btn btn-light" id="capture-guide-prev">${t('Předchozí')}</button><button type="button" class="btn btn-primary" id="capture-guide-next">${last ? t('Dokončit kontrolu') : t('Další nástroj')}${icon(last ? 'check' : 'chevron')}</button></div><button type="button" class="section-link capture-guide-skip" id="capture-guide-skip">${t('Vynechat tento nástroj')}</button></section>`;
    for (const section of host.querySelectorAll('[data-guide-section]')) section.open = disclosureState.get(section.dataset.guideSection) ?? false;
    find('#capture-guide-name').oninput = event => { update({ name: event.target.value.slice(0, 80) }); report(); };
    find('#capture-guide-depth').oninput = event => { update({ depth: event.target.value }); report(); syncCurrent(); };
    find('#capture-guide-margin').oninput=event=>{
      const raw=event.target.value;
      try{
        const margin=raw.trim()?validatePocketMargin(parseLength(raw)):undefined;
        update({pocketMarginText:raw,pocketMargin:margin});report();
      }catch(error){update({pocketMarginText:raw});report(errorText(error),'#capture-guide-margin');}
      syncCurrent();
    };
    find('#capture-guide-wall-type').onchange = event => {
      const type = event.target.value, previous = wallOf(current);
      if (previous && !wallProblem(current)) wallMemory.set(`${current}:${previous.type}`, previous.value);
      if (!WALL_TYPES.includes(type) || type === 'vertical') update({ pocketWall: null, pocketWallText: undefined, pocketWallUnit: undefined });
      else {
        let value = wallMemory.get(`${current}:${type}`) ?? WALL_DEFAULTS[type];
        const depth = validDepth(parseLength(rawDepth(current)));
        if (type !== 'draft' && depth) value = Math.max(.2, Math.min(value, depth));
        update({ pocketWall: { type, value }, pocketWallText: undefined, pocketWallUnit: undefined });
      }
      report(); syncWall((selector, value) => { const field = find(selector); if (field) field.value = value; });
    };
    find('#capture-guide-wall-value').oninput = event => {
      const raw = event.target.value, type = wallOf(current)?.type;
      if (!type) return;
      const value = parseWallValue(type, raw), message = wallMessage(type, value, parseLength(rawDepth(current)));
      if (message) { update({ pocketWallText: raw, pocketWallUnit: unit() }); report(message, '#capture-guide-wall-value'); return; }
      update({ pocketWall: { type, value }, pocketWallText: raw, pocketWallUnit: unit() }); report();
      find('[data-guide-wall-profile] path').setAttribute('d', wallProfilePath(item().pocketWall, parseLength(rawDepth(current))));
    };
    find('#capture-guide-size-label').oninput = event => { update({ sizeLabel: event.target.value.slice(0, 24) }); report(); syncCurrent(); };
    find('#capture-guide-category').onchange = event => { update({ category: event.target.value }); report(); };
    find('#capture-guide-include').onchange = event => { update({ checked: event.target.checked }); report(); syncCurrent(); };
    for (const field of ['length', 'width']) find(`#capture-guide-${field}`).oninput = event => {
      const draft = dimensionDraft(); if (!draft) return;
      draft[field] = event.target.value;
      draft.dirty = draft.length !== draft.baseLength || draft.width !== draft.baseWidth;
      find('[data-guide-dimensions-pending]').hidden = !draft.dirty; report();
    };
    find('#capture-guide-resize').onclick = applyDimensions;
    find('#capture-guide-dimensions-reset').onclick = () => { dimensionDrafts.delete(current); report(); syncCurrent(true); };
    find('#capture-guide-list').onclick = leave;
    find('#capture-guide-prev').onclick = () => { if (!blocked() && current > 0) { report(); open(current - 1); } };
    find('#capture-guide-next').onclick = next;
    find('#capture-guide-skip').onclick = () => { if (!blocked()) { update({ checked: false }); next(); } };
    syncCurrent();
  }

  // Labels, units and ranges follow a language or unit switch; typed drafts are kept.
  const relabel = () => { if (!destroyed && !blocked()) { render(); if (active) onSelect(current); } };
  const unsubscribe = [onLangChange(relabel), onUnitChange(relabel)];

  render();
  return {
    open,
    refresh({geometryChanged=false,index=current}={}) {
      if (destroyed) return;
      if(geometryChanged&&!dimensionDrafts.get(index)?.dirty)dimensionDrafts.delete(index);
      if (active) { syncCurrent(); onSelect(current); } else render();
    },
    setBusy(value) { busy = !!value; if (!destroyed) syncBusy(); },
    validate() { return !blocked() && (!started || check(items.map((_, index) => index))); },
    destroy() {
      destroyed = true; dimensionDrafts.clear(); wallMemory.clear(); disclosureState.clear(); unsubscribe.forEach(stop => stop()); host.replaceChildren();
      host.classList.remove('is-open'); host.removeAttribute('data-capture-guide-open');
    }
  };
}
