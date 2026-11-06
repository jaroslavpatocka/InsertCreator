import { t, getLang, errorText } from './i18n.js';
import { esc, icon } from './ui.js';
import { unit, inputValue, parseLength, fmtLen, fmtSize } from './units.js';
import { CATEGORIES } from './tool-categories.js';
import {DEFAULT_POCKET_MARGIN,validatePocketMargin,optionalPocketMargin} from './pocket-margin.js';

/** Optional, sequential review of the live capture drafts. Geometry changes only on Apply. */
export function mountCaptureGuide({
  host, items, getDepth = () => '', getMaxDepth = () => 99,
  getPocketMargin = () => DEFAULT_POCKET_MARGIN,
  getDimensions = () => null, onSelect = () => {}, onUpdate = () => {},
  onResize = () => {}, onFinish = () => {}, onError = () => {}, onModeChange = () => {}
}) {
  let current = 0, active = false, started = false, complete = false, busy = false, resizing = false, destroyed = false;
  const dimensionDrafts = new Map();
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
    const field = find('#capture-guide-depth');
    field?.removeAttribute('aria-invalid');
    find('#capture-guide-margin')?.removeAttribute('aria-invalid');
    if (message && focus === '#capture-guide-depth') field?.setAttribute('aria-invalid', 'true');
    if (message && focus === '#capture-guide-margin') find('#capture-guide-margin')?.setAttribute('aria-invalid','true');
    onError(message);
    if (message && focus) find(focus)?.focus({ preventScroll: true });
  }

  function update(patch) {
    Object.assign(item(), patch);
    complete = false;
    onUpdate(current, patch);
  }

  function syncBusy() {
    host.querySelectorAll('button,input,select').forEach(control => control.disabled = blocked());
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
    find('#capture-guide-include').checked = !!item().checked;
    find('#capture-guide-depth').placeholder = String(getDepth());
    find('[data-guide-excluded]').hidden = !!item().checked;
    const inherited = parseLength(getDepth());
    find('[data-guide-depth-hint]').textContent = t('Prázdné pole převezme společnou hloubku {depth}. Nejvýše {max}.', { depth: Number.isFinite(inherited) ? fmtLen(inherited) : String(getDepth()), max: fmtLen(getMaxDepth()) });
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
    host.innerHTML = `<section class="capture-guide-panel" data-guide-index="${current}" aria-label="${esc(t('Kontrola nástroje'))}"><div class="capture-guide-header"><output id="capture-guide-progress" role="status">${t('Nástroj {n} z {total}', { n: current + 1, total: items.length })}</output><button type="button" class="section-link" id="capture-guide-list">${t('Zpět na seznam')}</button></div><progress class="capture-guide-progress" max="${items.length}" value="${current + 1}" aria-label="${esc(t('Průběh kontroly nástrojů'))}"></progress><div class="capture-guide-preview"><canvas id="capture-guide-preview" width="480" height="280" role="img" aria-label="${esc(t('Detail nástroje {n}', { n: current + 1 }))}"></canvas></div><label class="capture-guide-include"><input type="checkbox" id="capture-guide-include">${t('Přidat tento nástroj')}</label><p class="capture-guide-excluded" data-guide-excluded hidden>${t('Tento nástroj se nepřidá.')}</p><label class="capture-guide-field"><span>${t('Název nástroje')}</span><input type="text" id="capture-guide-name" maxlength="80" autocomplete="off"></label><div class="capture-guide-fields"><label class="capture-guide-field"><span>${t('Hloubka kapsy')}</span><div class="capture-guide-input-unit"><input type="text" id="capture-guide-depth" inputmode="decimal" autocomplete="off" spellcheck="false"><em>${unit()}</em></div></label><label class="capture-guide-field"><span>${t('Označení velikosti')}</span><input type="text" id="capture-guide-size-label" maxlength="24" placeholder="${esc(t('Např. 13 mm, PH2 nebo T25'))}" autocomplete="off"></label></div><p class="capture-guide-note" data-guide-depth-hint></p><label class="capture-guide-field"><span>${t('Vlastní vůle této kapsy')}</span><div class="capture-guide-input-unit"><input type="text" id="capture-guide-margin" inputmode="decimal" autocomplete="off" spellcheck="false"><em>${unit()}</em></div></label><p class="capture-guide-note" data-guide-margin-hint></p><label class="capture-guide-field"><span>${t('Kategorie nástroje')}</span><select id="capture-guide-category"><option value="">${t('Automaticky podle názvu')}</option>${CATEGORIES.map(category => `<option value="${category.id}">${esc(category[getLang()])}</option>`).join('')}</select></label><details class="capture-guide-dimensions" data-guide-dimensions><summary>${t('Upravit naměřené rozměry')} <span data-guide-measured></span></summary><p class="capture-guide-note">${t('Délka a šířka obrysu. Velikost klíče patří do označení velikosti.')}</p><div class="capture-guide-fields"><label class="capture-guide-field"><span>${t('Délka nástroje')} · ${unit()}</span><input type="text" id="capture-guide-length" inputmode="decimal" autocomplete="off" spellcheck="false"></label><label class="capture-guide-field"><span>${t('Šířka nástroje')} · ${unit()}</span><input type="text" id="capture-guide-width" inputmode="decimal" autocomplete="off" spellcheck="false"></label></div><p class="capture-guide-note capture-guide-pending" data-guide-dimensions-pending hidden>${t('Změna rozměrů zatím není potvrzená.')}</p><div class="capture-guide-dimension-actions"><button type="button" class="btn btn-soft" id="capture-guide-resize">${t('Použít rozměry')}</button><button type="button" class="section-link" id="capture-guide-dimensions-reset">${t('Vrátit rozměry')}</button></div></details><p class="form-error" id="capture-guide-error" role="alert" hidden></p><div class="capture-guide-navigation"><button type="button" class="btn btn-light" id="capture-guide-prev">${t('Předchozí')}</button><button type="button" class="btn btn-primary" id="capture-guide-next">${last ? t('Dokončit kontrolu') : t('Další nástroj')}${icon(last ? 'check' : 'chevron')}</button></div><button type="button" class="section-link capture-guide-skip" id="capture-guide-skip">${t('Vynechat tento nástroj')}</button></section>`;
    find('#capture-guide-name').oninput = event => { update({ name: event.target.value.slice(0, 80) }); report(); };
    find('#capture-guide-depth').oninput = event => { update({ depth: event.target.value }); report(); };
    find('#capture-guide-margin').oninput=event=>{
      const raw=event.target.value;
      try{
        const margin=raw.trim()?validatePocketMargin(parseLength(raw)):undefined;
        update({pocketMarginText:raw,pocketMargin:margin});report();
      }catch(error){update({pocketMarginText:raw});report(errorText(error),'#capture-guide-margin');}
    };
    find('#capture-guide-size-label').oninput = event => { update({ sizeLabel: event.target.value.slice(0, 24) }); report(); };
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
      destroyed = true; dimensionDrafts.clear(); host.replaceChildren();
      host.classList.remove('is-open'); host.removeAttribute('data-capture-guide-open');
    }
  };
}
