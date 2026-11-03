// Library folders ("Moje nástroje" / "Katalog") and the tool catalogue browser.
// The catalogue data (./catalog/index.js) is imported lazily the first time the Katalog folder opens.
// app.js stays the owner of the project and the user library: it passes callbacks for adding and saving.
import {esc,icon,toast} from './ui.js';
import {t,plural,errorText,getLang} from './i18n.js';
import {unitFor,fmtSize} from './units.js';

const defaultSource=async()=>{const m=await import('./catalog/index.js');return{categories:m.CATEGORIES,items:m.catalogItems()};};
let source=defaultSource,loaded=null;
/** Replace the catalogue source (tests). `fn` returns {categories,items} or a Promise of it; null restores the real catalogue. */
export function setCatalogSource(fn){source=fn||defaultSource;loaded=null;}
async function loadCatalog(){
  if(!loaded)loaded=Promise.resolve().then(source).then(r=>({categories:r?.categories||[],items:(r?.items||[]).filter(i=>i&&Array.isArray(i.points)&&i.points.length>=3)}));
  try{return await loaded;}catch(error){loaded=null;throw error;}
}

// Session state: last opened folder and catalogue filters survive closing the modal.
const state={folder:'mine',category:'all',system:'all',query:'',limit:96};
const PAGE=96;
export const catalogFolder=()=>state.folder;

const localName=item=>typeof item.name==='string'?item.name:(item.name?.[getLang()]||item.name?.cs||item.name?.en||item.id);
const fold=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/,/g,'.');
function box(points){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of points){if(p.x<x0)x0=p.x;if(p.x>x1)x1=p.x;if(p.y<y0)y0=p.y;if(p.y>y1)y1=p.y;}return{x0,y0,width:x1-x0,height:y1-y0};}
const itemUnit=item=>unitFor(item.unit);
const sizeText=item=>{const b=box(item.points),u=itemUnit(item);return fmtSize(b.width,b.height,{unit:u,digits:u==='in'?2:0});};
const ACCURACY={standard:'podle normy',typical:'typický tvar',measured:'změřeno'};
const searchText=new WeakMap();
// Search words: no diacritics, lower case, decimal comma as dot; '1/2' and '3.5' stay whole.
const words=s=>fold(s).replace(/[^a-z0-9./]+/g,' ').split(' ').filter(Boolean);
function haystack(item){
  if(!searchText.has(item)){
    const n=item.name||{},parts=[typeof n==='string'?n:Object.values(n).join(' '),...(item.tags||[]),item.size,item.size!=null?`${item.size} ${item.unit||''}`:'',item.id];
    const text=words(parts.join(' ')).join(' ');
    searchText.set(item,' '+text+' '+text.replace(/(\d) (mm|in)\b/g,'$1$2')+' ');
  }
  return searchText.get(item);
}

/** Tool object (no id; the caller assigns one) created from a catalogue item, named in the current language. */
export function catalogTool(item){
  return{name:localName(item),points:item.points.map(p=>({x:Number(p.x),y:Number(p.y)})),depth:Number(item.depth)||12,...(item.unit==='mm'||item.unit==='in'?{unit:item.unit}:{}),x:0,y:0,rotation:0};
}
/** Small SVG thumbnail in the same style as library thumbnails (long outlines are decimated). */
export function catalogThumb(item){
  const pts=item.points,step=Math.max(1,Math.ceil(pts.length/400)),b=box(pts);
  let d='';for(let i=0;i<pts.length;i+=step)d+=`${i?'L':'M'}${(pts[i].x-b.x0).toFixed(1)},${(pts[i].y-b.y0).toFixed(1)}`;
  return`<svg viewBox="-3 -3 ${(b.width+6).toFixed(1)} ${(b.height+6).toFixed(1)}" aria-hidden="true"><path d="${d}Z" fill="#9fae90" stroke="none"/></svg>`;
}
/** Filter catalogue items by category id, measurement system ('all'|'metric'|'imperial') and a search query (all words must match). */
export function filterCatalog(items,{category='all',system='all',query=''}={}){
  const terms=words(query);
  // Every query word must start a word of the item, so '17' does not match '170' or '3117'.
  return items.filter(item=>(category==='all'||item.category===category)
    &&(system==='all'||(system==='imperial')===(item.unit==='in'))
    &&(!terms.length||(h=>terms.every(w=>h.includes(' '+w)))(haystack(item))));
}

const FOLDERS=[{id:'mine',label:'Moje nástroje',icon:'library'},{id:'catalog',label:'Katalog',icon:'folder'}];

/**
 * Render the folder tabs into an open modal and wire them.
 * opts.mine() → {body,footer} HTML of the user's library (re-evaluated every time the folder is shown).
 * opts.onAdd(tools) adds tools to the current drawer (may throw), opts.onSave(tools) → number of newly saved tools.
 */
export function mountLibraryFolders(modal,{mine,onAdd,onSave}){
  modal.body.innerHTML=`<div class="library-folders" role="tablist" aria-label="${esc(t('Složky knihovny'))}">${FOLDERS.map(f=>`<button type="button" role="tab" class="library-folder" id="library-tab-${f.id}" data-library-folder="${f.id}" aria-controls="library-panel" aria-selected="false" tabindex="-1">${icon(f.icon)}<span>${esc(t(f.label))}</span></button>`).join('')}</div><div id="library-panel" class="library-panel" role="tabpanel"></div>`;
  const tabs=[...modal.body.querySelectorAll('[data-library-folder]')],panel=modal.body.querySelector('#library-panel');
  const selected=new Set();let items=[],categories=[],timer=null,token=0;
  const byId=id=>items.find(i=>i.id===id);

  function show(folder,focus=false){
    state.folder=folder;clearTimeout(timer);token++;
    for(const tab of tabs){const on=tab.dataset.libraryFolder===folder;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;tab.classList.toggle('active',on);if(on&&focus)tab.focus();}
    panel.setAttribute('aria-labelledby','library-tab-'+folder);
    if(folder==='mine'){const view=mine();panel.innerHTML=view.body;modal.footer.innerHTML=view.footer;return;}
    openCatalog();
  }
  tabs.forEach((tab,i)=>{
    tab.onclick=()=>{if(state.folder!==tab.dataset.libraryFolder)show(tab.dataset.libraryFolder);};
    tab.onkeydown=e=>{
      const next={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:tabs.length-1}[e.key];if(next===undefined)return;
      e.preventDefault();show(tabs[(next+tabs.length)%tabs.length].dataset.libraryFolder,true);
    };
  });

  async function openCatalog(){
    const my=++token;
    panel.innerHTML=`<p class="empty-note" role="status">${esc(t('Načítám katalog…'))}</p>`;modal.footer.innerHTML=footerHTML();
    try{({items,categories}=await loadCatalog());}
    catch(error){if(my===token)panel.innerHTML=`<p class="empty-note" role="alert">${esc(t('Katalog se nepodařilo načíst: {error}',{error:errorText(error)}))}</p>`;return;}
    if(my!==token||state.folder!=='catalog'||!panel.isConnected)return;
    if(state.category!=='all'&&!categories.some(c=>c.id===state.category))state.category='all';
    panel.innerHTML=items.length?`<div class="catalog-controls"><label class="catalog-search"><input type="search" data-catalog-search value="${esc(state.query)}" placeholder="${esc(t('Hledat nástroj, velikost nebo normu'))}" aria-label="${esc(t('Hledat v katalogu'))}" autocomplete="off"></label><div class="catalog-system" role="group" aria-label="${esc(t('Měrná soustava'))}">${[['all','Vše'],['metric','Metrické'],['imperial','Palcové']].map(([id,label])=>`<button type="button" data-catalog-system="${id}" aria-pressed="${state.system===id}" class="${state.system===id?'active':''}">${esc(t(label))}</button>`).join('')}</div></div><div class="catalog-chips" role="group" aria-label="${esc(t('Kategorie'))}"></div><div class="catalog-results" aria-live="polite"></div>`
      :`<div class="empty-note catalog-empty">${icon('folder')}<p>${esc(t('Katalog je zatím prázdný. Nástroje můžete přidat vyfocením.'))}</p></div>`;
    modal.footer.innerHTML=footerHTML();
    if(!items.length)return;
    const search=panel.querySelector('[data-catalog-search]');
    search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!panel.isConnected)return;state.query=search.value;state.limit=PAGE;renderResults();},120);};
    search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(timer);state.query=search.value;state.limit=PAGE;renderResults();}};
    renderResults();
  }
  function footerHTML(){
    if(state.folder!=='catalog')return'';
    const n=selected.size;
    return`<span class="footnote catalog-note">${icon('info')} ${esc(t('Obrysy jsou jmenovité. Před tiskem je porovnejte se skutečným nástrojem – vytiskněte zkušební PDF 1:1.'))}</span><span class="catalog-foot-actions"><button type="button" class="btn btn-light" data-catalog-save-selected ${n?'':'disabled'}>${icon('save')}${esc(t('Uložit vybrané'))}</button><button type="button" class="btn btn-primary" data-catalog-add-selected ${n?'':'disabled'}>${icon('plus')}${esc(t('Přidat vybrané ({n})',{n}))}</button></span>`;
  }
  function renderResults(){
    const chips=panel.querySelector('.catalog-chips'),results=panel.querySelector('.catalog-results');if(!chips||!results)return;
    const pool=filterCatalog(items,{system:state.system,query:state.query}),count=id=>id==='all'?pool.length:pool.filter(i=>i.category===id).length;
    const used=categories.filter(c=>items.some(i=>i.category===c.id));
    chips.innerHTML=[{id:'all',cs:'Vše',en:'All'},...used].map(c=>{const n=count(c.id),label=c.id==='all'?t('Vše'):(c[getLang()]||c.cs);return`<button type="button" class="catalog-chip ${state.category===c.id?'active':''} ${n?'':'empty'}" data-catalog-category="${esc(c.id)}" aria-pressed="${state.category===c.id}">${esc(label)} <span>${n}</span></button>`;}).join('');
    const list=filterCatalog(pool,{category:state.category}),shown=list.slice(0,state.limit);
    if(!list.length){results.innerHTML=`<div class="empty-note catalog-empty"><p>${esc(t('Nic jsme nenašli. Zkuste jiný výraz nebo kategorii.'))}</p></div>`;return;}
    results.innerHTML=`<p class="catalog-count">${esc(plural(list.length,['{n} obrys','{n} obrysy','{n} obrysů']))}</p><div class="catalog-grid">${shown.map(itemHTML).join('')}</div>${list.length>shown.length?`<button type="button" class="btn btn-light catalog-more" data-catalog-more>${esc(t('Zobrazit další ({n})',{n:list.length-shown.length}))}</button>`:''}`;
  }
  function itemHTML(item){
    const name=localName(item),acc=ACCURACY[item.accuracy]||ACCURACY.typical,src=item.source||{},on=selected.has(item.id);
    const tip=t('Zdroj: {source} · Licence: {license}',{source:src.name||'—',license:src.license||'—'});
    return`<div class="catalog-item ${on?'selected':''}" data-catalog-item="${esc(item.id)}"><label class="catalog-check"><input type="checkbox" data-catalog-select="${esc(item.id)}" ${on?'checked':''} aria-label="${esc(t('Vybrat {name}',{name}))}"></label><span class="tool-thumb catalog-thumb">${catalogThumb(item)}</span><strong class="catalog-name">${esc(name)}</strong><span class="catalog-meta"><span>${esc(sizeText(item))}</span><span class="accuracy-badge accuracy-${esc(item.accuracy||'typical')}" title="${esc(tip)}" tabindex="0" role="note" aria-label="${esc(t(acc)+' · '+tip)}">${esc(t(acc))}</span></span><span class="catalog-actions"><button type="button" class="btn btn-light" data-catalog-add="${esc(item.id)}" aria-label="${esc(t('Přidat {name} do šuplíku',{name}))}">${icon('plus')}${esc(t('Přidat do šuplíku'))}</button><button type="button" class="icon-btn" data-catalog-save="${esc(item.id)}" title="${esc(t('Uložit do mých nástrojů'))}" aria-label="${esc(t('Uložit {name} do mých nástrojů',{name}))}">${icon('save')}</button></span></div>`;
  }
  const add=list=>{if(!list.length)return;try{onAdd(list.map(catalogTool));selected.clear();}catch(error){toast(errorText(error));}};
  const save=list=>{
    if(!list.length)return;
    try{const n=onSave(list.map(catalogTool));toast(n?plural(n,['{n} obrys uložen do mých nástrojů.','{n} obrysy uloženy do mých nástrojů.','{n} obrysů uloženo do mých nástrojů.']):t('Tento obrys už v mých nástrojích je.'));}
    catch(error){toast(errorText(error));}
  };
  const chosen=()=>[...selected].map(byId).filter(Boolean);
  panel.addEventListener('click',e=>{
    if(state.folder!=='catalog')return;
    const chip=e.target.closest('[data-catalog-category]'),sys=e.target.closest('[data-catalog-system]'),one=e.target.closest('[data-catalog-add]'),keep=e.target.closest('[data-catalog-save]');
    if(chip){state.category=chip.dataset.catalogCategory;state.limit=PAGE;renderResults();[...panel.querySelectorAll("[data-catalog-category]")].find(b=>b.dataset.catalogCategory===state.category)?.focus();return;}
    if(sys){state.system=sys.dataset.catalogSystem;state.limit=PAGE;for(const b of panel.querySelectorAll('[data-catalog-system]')){const on=b===sys;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}renderResults();return;}
    if(e.target.closest('[data-catalog-more]')){state.limit+=PAGE;renderResults();return;}
    if(one){const item=byId(one.dataset.catalogAdd);if(item)add([item]);return;}
    if(keep){const item=byId(keep.dataset.catalogSave);if(item)save([item]);}
  });
  panel.addEventListener('change',e=>{
    const box=e.target.closest('[data-catalog-select]');if(!box)return;
    if(box.checked)selected.add(box.dataset.catalogSelect);else selected.delete(box.dataset.catalogSelect);
    box.closest('.catalog-item')?.classList.toggle('selected',box.checked);modal.footer.innerHTML=footerHTML();
  });
  modal.footer.addEventListener('click',e=>{
    if(state.folder!=='catalog')return;
    if(e.target.closest('[data-catalog-add-selected]'))add(chosen());
    else if(e.target.closest('[data-catalog-save-selected]')){save(chosen());selected.clear();renderResults();modal.footer.innerHTML=footerHTML();}
  });
  show(state.folder);
}
