// Library folders ("Moje nástroje" / "Katalog") and the tool catalogue browser.
// The catalogue data (./catalog/index.js) is imported lazily the first time the Katalog folder opens.
// app.js stays the owner of the project and the user library: it passes callbacks for adding and saving.
import {esc,icon,toast} from './ui.js';
import {t,plural,errorText,getLang,fmtNum,i18nError} from './i18n.js';
import {unitFor,fmtSize,fmtLen,inputValue,parseLength} from './units.js';
import {scaleTool} from './set-module.js';
import {automaticFingerGrips,validateFingerGrips} from './finger-grip.js';
import {CATEGORIES,toolCategory} from './tool-categories.js';
import {loadingMarkup,updateLoading} from './loading-ui.js';

const defaultSource=async()=>{const m=await import('./catalog/index.js');return{categories:m.CATEGORIES,items:m.catalogItems(),sets:typeof m.catalogSets==='function'?m.catalogSets():[]};};
let source=defaultSource,loaded=null;
/** Replace the catalogue source (tests). `fn` returns {categories,items,sets?} or a Promise of it; null restores the real catalogue. */
export function setCatalogSource(fn){source=fn||defaultSource;loaded=null;}
const validItem=i=>i&&Array.isArray(i.points)&&i.points.length>=3;
/** Normalise a catalogue source: drop invalid items and sets whose members cannot be resolved (by `tools` or by `items` ids). */
function normalizeCatalog(r){
  const items=(r?.items||[]).filter(validItem),byId=new Map(items.map(i=>[i.id,i])),seen=new Set(),sets=[];
  for(const set of r?.sets||[]){
    if(!set||!set.id||seen.has(set.id))continue;
    const tools=Array.isArray(set.tools)&&set.tools.length?set.tools:(Array.isArray(set.items)?set.items.map(id=>byId.get(id)):[]);
    if(!tools.length||!tools.every(validItem))continue;
    seen.add(set.id);sets.push({...set,tools});
  }
  return{categories:r?.categories||[],items,sets};
}
async function loadCatalog(){
  if(!loaded)loaded=Promise.resolve().then(source).then(normalizeCatalog);
  const attempt=loaded;
  try{return await attempt;}catch(error){if(loaded===attempt)loaded=null;throw error;}
}

// Session state: the last opened folder and each folder's filters survive closing the modal.
// layout: how "Přidat sadu" places a set – 'group' = one module for the whole set (default), 'each' = one module per tool.
// A view: kind 'all'|'sets'|'items', any number of categories (none = all), open = sections the user toggled.
const newView=()=>({kind:'all',categories:new Set(),system:'all',query:'',open:new Map(),limits:new Map()});
const views={mine:newView(),catalog:newView()};
const state={folder:'mine',layout:'group',arrangement:'ordered',order:'asc'};
const setPreferences=new Map();
const preferences=set=>({...state,...setPreferences.get(set.id)});
const PAGE=96,SET_THUMB_MAX=8,AUTO_OPEN=30;
export const catalogFolder=()=>state.folder;
/** Session choice of the set layout: 'group' (one module per set, default) or 'each' (one module per tool). */
export const setLayout=()=>state.layout;

const localName=item=>typeof item.name==='string'?item.name:(item.name?.[getLang()]||item.name?.cs||item.name?.en||item.id);
const localText=v=>v==null?'':typeof v==='string'?v:(v[getLang()]||v.cs||v.en||'');
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
  const name=localName(item),code=name.match(/\b(PH|PZ|TX|T)\s*(\d+)\b/i),nonMetricCode=code&&/^(PH|PZ)$/i.test(code[1]);
  const tool={name,points:item.points.map(p=>({x:Number(p.x),y:Number(p.y)})),depth:Number(item.depth)||12,...(item.unit==='mm'||item.unit==='in'?{unit:item.unit}:{}),...(code?{sizeLabel:code[1].toUpperCase()+code[2]}:{}),...(item.category?{category:item.category}:{}),...(!nonMetricCode&&typeof item.size==='number'&&Number.isFinite(item.size)&&item.size>0&&item.size<=3000&&['mm','in'].includes(item.unit)?{nominalSize:{value:item.size,unit:item.unit}}:{}),x:0,y:0,rotation:0};
  tool.fingerGrips=Object.hasOwn(item,'fingerGrips')?validateFingerGrips(item.fingerGrips):automaticFingerGrips({...tool,id:item.id});
  return tool;
}
// ---- Scale ("Měřítko") ----
export const SCALE_MIN=.2,SCALE_MAX=5;
/** Longest bounding-box side (mm) over the given catalogue items / tools. */
export function longestSide(list){return Math.max(0,...list.map(i=>{const b=box(i.points);return Math.max(b.width,b.height);}));}
/**
 * Scale factor from a scale setting. spec = {mode:'percent'|'length', text}; an empty/missing spec means 1.
 * 'percent': "110", "110 %", "92,5". 'length': target length of the longest tool, in any unit (parseLength, default `unit`).
 * Throws a translated error when the text is invalid or the factor is outside 20–500 %.
 */
export function scaleFactor(spec,list,unit){
  const text=String(spec?.text??'').trim();if(!spec||!text)return 1;
  let f;
  if(spec.mode==='length'){const target=parseLength(text,unit),cur=longestSide(list);f=cur>0&&target>0?target/cur:NaN;}
  else{const m=text.replace(/\s*%$/,'').replace(',','.');f=/^\d+(\.\d+)?$|^\.\d+$/.test(m)?Number(m)/100:NaN;}
  if(!Number.isFinite(f))throw i18nError('Zadejte platné měřítko, například 110 % nebo délku 200 mm.');
  if(f<SCALE_MIN-1e-9||f>SCALE_MAX+1e-9)throw i18nError('Měřítko musí být od {min} do {max} %.',{min:SCALE_MIN*100,max:SCALE_MAX*100});
  return f;
}
const pct=f=>fmtNum(Math.round(f*1000)/10,1)+' %';

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

// ---- Tool sets ("Sady nářadí") ----
const setText=new WeakMap();
// A set is found by its own name/description/tags (both languages) and by the names and sizes of its tools.
function setHaystack(set){
  if(!setText.has(set)){
    const v=x=>x==null?'':typeof x==='string'?x:Object.values(x).join(' ');
    const text=words([v(set.name),v(set.description),...(set.tags||[]),set.id].join(' ')).join(' ');
    setText.set(set,' '+text+' '+text.replace(/(\d) (mm|in)\b/g,'$1$2')+' '+[...new Set(set.tools)].map(haystack).join(' ')+' ');
  }
  return setText.get(set);
}
/** Filter sets by content category ('all'|'sets' = every set), measurement system and query (every word must start a word of the set or of one of its tools). */
export function filterSets(sets,{category='all',system='all',query=''}={}){
  const terms=words(query);
  return sets.filter(set=>(category==='all'||category==='sets'||set.category===category)
    &&(system==='all'||(system==='imperial')===(set.unit==='in'))
    &&(!terms.length||(h=>terms.every(w=>h.includes(' '+w)))(setHaystack(set))));
}
// Inch sizes as fractions (0.5 → 1/2, 1.25 → 1 1/4), otherwise a localised number.
function fmtNominal(v,unit){
  if(unit!=='in')return fmtNum(v,1);
  const whole=Math.floor(v+1e-9),f=v-whole;if(f<1e-6)return String(whole);
  for(const d of [2,4,8,16,32,64]){const n=Math.round(f*d);if(n&&Math.abs(n/d-f)<1e-6)return(whole?whole+' ':'')+n+'/'+d;}
  return fmtNum(v,3);
}
/** Nominal size range of a set, e.g. "6–32 mm" (null when its tools have no distinct nominal sizes). */
export function setSizeRange(set){
  const unit=set.unit==='in'?'in':'mm',sizes=set.tools.map(i=>Number(i.size)).filter(Number.isFinite);
  if(sizes.length<2)return null;
  const lo=Math.min(...sizes),hi=Math.max(...sizes);
  return lo===hi?null:`${fmtNominal(lo,unit)}–${fmtNominal(hi,unit)} ${unit}`;
}
const setAccuracy=set=>{const a=set.tools.map(i=>i.accuracy||'typical');return a.every(x=>x===a[0])&&ACCURACY[a[0]]?a[0]:'typical';};
/** Composite thumbnail: up to `max` tool outlines standing upright side by side, at their true relative size. */
export function setThumb(set,max=SET_THUMB_MAX){
  const parts=set.tools.slice(0,max).map(item=>{const b=box(item.points),rot=b.width>b.height;return{pts:item.points,b,rot,w:rot?b.height:b.width,h:rot?b.width:b.height};});
  const H=Math.max(...parts.map(p=>p.h)),gap=Math.max(2,Math.max(...parts.map(p=>p.w))*.25);
  let x=0,d='';
  for(const p of parts){
    const step=Math.max(1,Math.ceil(p.pts.length/160)),dy=H-p.h;
    for(let i=0;i<p.pts.length;i+=step){const q=p.pts[i],u=q.x-p.b.x0,v=q.y-p.b.y0,px=x+(p.rot?v:u),py=dy+(p.rot?u:v);d+=`${i?'L':'M'}${px.toFixed(1)},${py.toFixed(1)}`;}
    d+='Z';x+=p.w+gap;
  }
  const W=Math.max(1,x-gap),pad=Math.max(W,H)*.03;
  return`<svg viewBox="${(-pad).toFixed(1)} ${(-pad).toFixed(1)} ${(W+2*pad).toFixed(1)} ${(H+2*pad).toFixed(1)}" aria-hidden="true"><path d="${d}" fill="#9fae90" stroke="none"/></svg>`;
}

/** The user's library in the shape the filter bar browses. Sets come from tool.setNames, so a tool may be listed in several sets. */
export function libraryData(tools){
  const items=tools.map((tool,index)=>({id:'mine'+index,tool,index,name:tool.name,category:toolCategory(tool),unit:tool.unit==='in'?'in':'mm',setNames:tool.setNames||[],tags:[tool.sizeLabel,...(tool.setNames||[])].filter(Boolean)}));
  const groups=new Map();
  for(const item of items)for(const name of item.setNames){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(item);}
  return{items,sets:[...groups].map(([name,members])=>({id:'set:'+name,name,tools:members,category:members[0].category,unit:members[0].unit}))};
}

const FOLDERS=[{id:'mine',label:'Moje nástroje',icon:'library'},{id:'catalog',label:'Katalog',icon:'folder'}];

/**
 * Render the folder tabs into an open modal and wire them.
 * opts.mine() → {tools,card(tool,index),empty,footer}: the user's library, the HTML of one tool, of the empty library and of the footer (re-evaluated every time the folder is shown).
 * opts.onAdd(tools,addOpts) adds tools to the current drawer (may throw); a whole set is passed in ONE call (one undo step, one arrangement).
 *   addOpts.set={name,unit} marks the tools as one catalogue set (registered as a project tool set);
 *   addOpts.group={name,unit} asks for ONE module holding the whole set (the default layout of "Přidat sadu").
 * Tools are already scaled when the user set a scale ("Upravit měřítko").
 * opts.onSave(tools) → number of newly saved tools.
 * Returns {refresh()}, which redraws "Moje nástroje" after the library changed, keeping its filters.
 */
export function mountLibraryFolders(modal,{mine,onAdd,onSave}){
  modal.body.innerHTML=`<div class="library-folders" role="tablist" aria-label="${esc(t('Složky knihovny'))}">${FOLDERS.map(f=>`<button type="button" role="tab" class="library-folder" id="library-tab-${f.id}" data-library-folder="${f.id}" aria-controls="library-panel" aria-selected="false" tabindex="-1">${icon(f.icon)}<span>${esc(t(f.label))}</span></button>`).join('')}</div><div id="library-panel" class="library-panel" role="tabpanel"></div>`;
  const tabs=[...modal.body.querySelectorAll('[data-library-folder]')],panel=modal.body.querySelector('#library-panel');
  const selected=new Set(),selectedSets=new Set(),unticked=new Map(),setOpen={mine:new Map(),catalog:new Map()}; // set contents, like member ticks, last for one opening
  const scales=new Map(),scaleOpen=new Set(); // key 's:<set id>' | 'i:<item id>' → {mode:'percent'|'length',text}
  let items=[],categories=[],sets=[],timer=null,loadingTimer=null,token=0,library=null,sections=new Map(),autoOpen=false,catalogLoading=false,operation=null;
  const byId=id=>items.find(i=>i.id===id),setById=id=>sets.find(s=>s.id===id);
  const checkedTools=set=>{const off=unticked.get(set.id);return off?set.tools.filter((_,i)=>!off.has(i)):set.tools;};
  const setCard=id=>[...panel.querySelectorAll('[data-catalog-set]')].find(el=>el.dataset.catalogSet===id);

  function show(folder,focus=false){
    state.folder=folder;clearTimeout(timer);clearTimeout(loadingTimer);token++;catalogLoading=false;
    operation?.finish();
    for(const tab of tabs){const on=tab.dataset.libraryFolder===folder;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;tab.classList.toggle('active',on);if(on&&focus)tab.focus();}
    panel.setAttribute('aria-labelledby','library-tab-'+folder);
    if(folder==='mine'){
      const view=mine();library={...libraryData(view.tools),card:view.card};modal.footer.innerHTML=view.footer;
      panel.innerHTML=library.items.length?browserHTML('Hledat ve svých nástrojích','Hledat ve svých nástrojích'):view.empty;
      if(library.items.length)openBrowser();
      return;
    }
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
    const current=()=>my===token&&state.folder==='catalog'&&panel.isConnected;
    catalogLoading=true;
    panel.innerHTML=loadingMarkup({title:t('Načítám katalog…'),message:t('Připravuji nástroje a sady pro výběr.')});modal.footer.innerHTML=footerHTML();
    loadingTimer=setTimeout(()=>{if(current())updateLoading(panel,{message:t('Načítání trvá déle než obvykle'),detail:t('Katalog se stále načítá. Můžete přejít do svých nástrojů a vrátit se později.')});},8000);
    loadingTimer?.unref?.();
    let catalog;
    try{catalog=await loadCatalog();}
    catch(error){
      if(current()){
        catalogLoading=false;
        panel.innerHTML=`<div class="empty-note"><p role="alert">${esc(t('Katalog se nepodařilo načíst: {error}',{error:errorText(error)}))}</p><button type="button" class="btn btn-light" data-catalog-retry>${esc(t('Zkusit znovu'))}</button></div>`;
        modal.footer.innerHTML=footerHTML();
      }
      return;
    }finally{if(my===token){clearTimeout(loadingTimer);loadingTimer=null;}}
    if(!current())return;
    ({items,categories,sets}=catalog);catalogLoading=false;
    panel.innerHTML=items.length?browserHTML(sets.length?'Hledat nástroj, sadu, velikost nebo normu':'Hledat nástroj, velikost nebo normu','Hledat v katalogu')
      :`<div class="empty-note catalog-empty">${icon('folder')}<p>${esc(t('Katalog je zatím prázdný. Nástroje můžete přidat vyfocením.'))}</p></div>`;
    modal.footer.innerHTML=footerHTML();
    if(items.length)openBrowser();
  }
  const browserHTML=(placeholder,label)=>`<div class="catalog-controls"><label class="catalog-search"><input type="search" data-catalog-search value="${esc(views[state.folder].query)}" placeholder="${esc(t(placeholder))}" aria-label="${esc(t(label))}" autocomplete="off"></label><div class="catalog-toggles"></div></div><div class="catalog-chips" role="group" aria-label="${esc(t('Kategorie'))}"></div><div class="catalog-results" aria-live="polite"></div>`;
  function openBrowser(){
    const search=panel.querySelector('[data-catalog-search]'),apply=()=>{if(operation){operation.afterFilter=apply;return;}const view=views[state.folder];view.query=search.value;if(state.folder==='mine')setOpen.mine.clear();narrowed(view);renderBrowser();};
    search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(panel.isConnected)apply();},120);};
    search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(timer);apply();}};
    renderBrowser();
  }
  const selectedCount=()=>selected.size+[...selectedSets].map(setById).filter(Boolean).reduce((n,s)=>n+checkedTools(s).length,0);
  function footerHTML(){
    if(state.folder!=='catalog')return'';
    const n=selectedCount();
    return`<span class="footnote catalog-note">${icon('info')} ${esc(t('Obrysy jsou jmenovité. Před tiskem je porovnejte se skutečným nástrojem – vytiskněte zkušební PDF 1:1.'))}</span><span class="catalog-foot-actions"><button type="button" class="btn btn-light" data-catalog-save-selected ${n&&!catalogLoading?'':'disabled'}>${icon('save')}${esc(t('Uložit vybrané'))}</button><button type="button" class="btn btn-primary" data-catalog-add-selected ${n&&!catalogLoading?'':'disabled'}>${icon('plus')}${esc(t('Přidat vybrané ({n})',{n}))}</button></span>`;
  }
  // Changing what is shown starts from the default open state again, so a narrowed list is never hidden by an earlier "Sbalit vše".
  const narrowed=view=>{view.open.clear();view.limits.clear();};
  const browsed=()=>state.folder==='mine'?{...library,categories:CATEGORIES}:{items,sets,categories};
  const setIsOpen=set=>{const open=setOpen[state.folder];return open.has(set.id)?open.get(set.id):state.folder==='mine'&&!!views.mine.query.trim();};
  const sectionIsOpen=key=>{const open=views[state.folder].open;return open.has(key)?open.get(key):autoOpen;};
  const countText=(setCount,itemCount)=>[setCount?plural(setCount,['{n} sada','{n} sady','{n} sad']):'',itemCount?plural(itemCount,['{n} obrys','{n} obrysy','{n} obrysů']):''].filter(Boolean).join(' · ');
  // Filter bar and results of the open folder. Both folders browse the same shape: {items,sets,categories}.
  function renderBrowser(){
    const view=views[state.folder],toggles=panel.querySelector('.catalog-toggles'),chips=panel.querySelector('.catalog-chips'),results=panel.querySelector('.catalog-results');if(!toggles||!chips||!results)return;
    const data=browsed(),hasSets=data.sets.length>0,kind=hasSets?view.kind:'all',order=data.categories.map(c=>c.id);
    const key=x=>order.includes(x.category)?x.category:'other',rank=id=>{const i=order.indexOf(id);return i<0?1e3:i;};
    const label=id=>{const c=data.categories.find(x=>x.id===id);return c?(c[getLang()]||c.cs):t('Ostatní');};
    const used=[...new Set([...data.sets,...data.items].map(key))].sort((a,b)=>rank(a)-rank(b));
    for(const id of view.categories)if(!used.includes(id))view.categories.delete(id);
    const filter={system:view.system,query:view.query},setPool=filterSets(data.sets,filter),itemPool=filterCatalog(data.items,filter);
    // A library tool of a set is listed inside that set, so "Vše" must not repeat it as a loose tool.
    const cards=k=>({sets:k==='items'?[]:setPool,items:k==='sets'?[]:k==='all'&&state.folder==='mine'?itemPool.filter(i=>!i.setNames.length):itemPool});
    const inScope=x=>!view.categories.size||view.categories.has(key(x));
    const current=cards(kind),listed=[...current.sets,...current.items],kindCount=k=>{const c=cards(k);return c.sets.filter(inScope).length+c.items.filter(inScope).length;};
    const segment=(attr,active,list)=>list.map(([id,text])=>`<button type="button" ${attr}="${id}" aria-pressed="${active===id}" class="${active===id?'active':''}">${text}</button>`).join('');
    toggles.innerHTML=(hasSets?`<div class="catalog-system catalog-kind" role="group" aria-label="${esc(t('Zobrazit'))}">${segment('data-catalog-kind',kind,[['all','Vše'],['sets','Sady'],['items','Jednotlivé']].map(([id,text])=>[id,`${esc(t(text))} <span>${kindCount(id)}</span>`]))}</div>`:'')
      +`<div class="catalog-system" role="group" aria-label="${esc(t('Měrná soustava'))}">${segment('data-catalog-system',view.system,[['all','Vše'],['metric','Metrické'],['imperial','Palcové']].map(([id,text])=>[id,esc(t(text))]))}</div>`;
    chips.innerHTML=[{id:'all',text:t('Vše'),n:listed.length,on:!view.categories.size},...used.map(id=>({id,text:label(id),n:listed.filter(x=>key(x)===id).length,on:view.categories.has(id)}))].map(c=>`<button type="button" class="catalog-chip ${c.on?'active':''} ${c.n?'':'empty'}" data-catalog-category="${esc(c.id)}" aria-pressed="${c.on}">${esc(c.text)} <span>${c.n}</span></button>`).join('');
    const shownSets=current.sets.filter(inScope),shownItems=current.items.filter(inScope),filtered=!!view.query.trim()||view.categories.size>0||view.system!=='all'||kind!=='all';
    const reset=filtered?`<button type="button" class="section-link" data-catalog-reset>${esc(t('Zrušit filtry'))}</button>`:'';
    sections=new Map(used.map(id=>[id,{label:label(id),sets:shownSets.filter(x=>key(x)===id),items:shownItems.filter(x=>key(x)===id)}]).filter(([,s])=>s.sets.length||s.items.length));
    if(!sections.size){results.innerHTML=`<div class="empty-note catalog-empty"><p>${esc(t('Nic jsme nenašli. Zkuste jiný výraz nebo kategorii.'))}</p>${reset}</div>`;return;}
    // Unfiltered long lists start as a compact overview; anything the user narrowed down opens by itself.
    autoOpen=!!view.query.trim()||view.categories.size>0||kind!=='all'||shownSets.length+shownItems.length<=AUTO_OPEN;
    const anySetOpen=shownSets.some(setIsOpen);
    results.innerHTML=`<div class="catalog-bar"><p class="catalog-count">${esc(countText(shownSets.length,shownItems.length))}</p><span class="catalog-bar-actions">${reset}${shownSets.length?`<button type="button" class="section-link" data-sets-open="${!anySetOpen}">${esc(t(anySetOpen?'Skrýt obsah sad':'Zobrazit obsah sad'))}</button>`:''}<button type="button" class="section-link" data-sections="open">${esc(t('Rozbalit vše'))}</button><button type="button" class="section-link" data-sections="closed">${esc(t('Sbalit vše'))}</button></span></div>`+[...sections.keys()].map(sectionHTML).join('');
  }
  const sectionDom=key=>'catalog-section-'+String(key).replace(/[^a-zA-Z0-9_-]/g,'_');
  function sectionHTML(key){
    const section=sections.get(key),open=sectionIsOpen(key),mineFolder=state.folder==='mine',k=esc(key);
    const limit=views[state.folder].limits.get(key)||PAGE,shown=section.items.slice(0,limit),hidden=section.items.length-shown.length;
    const setsHTML=section.sets.length?(mineFolder?`<div class="library-sets">${section.sets.map(librarySetHTML).join('')}</div>`:`<div class="catalog-grid catalog-set-grid">${section.sets.map(setHTML).join('')}</div>`):'';
    const itemsHTML=shown.length?(mineFolder?`<div class="library-grid">${shown.map(libraryCard).join('')}</div>`:`<div class="catalog-grid">${shown.map(itemHTML).join('')}</div>`):'';
    const body=open?`<div class="catalog-section-body" id="${sectionDom(key)}">${setsHTML}${itemsHTML}${hidden>0?`<button type="button" class="btn btn-light catalog-more" data-catalog-more="${k}">${esc(t('Zobrazit další ({n})',{n:hidden}))}</button>`:''}</div>`:'';
    return`<section class="catalog-section" data-catalog-section="${k}"><h3><button type="button" class="catalog-section-toggle" data-section-toggle="${k}" aria-expanded="${open}" aria-controls="${sectionDom(key)}">${icon('chevron')}<span class="catalog-section-title">${esc(section.label)}</span><span class="catalog-section-count">${esc(countText(section.sets.length,section.items.length))}</span></button></h3>${body}</section>`;
  }
  const libraryCard=item=>library.card(item.tool,item.index);
  function librarySetHTML(set){
    const open=setIsOpen(set),id=esc(set.id);
    return`<div class="library-set" data-library-set="${id}"><button type="button" class="library-set-toggle" data-library-set-toggle="${id}" aria-expanded="${open}">${icon('chevron')}<strong>${esc(set.name)}</strong><span>${esc(plural(set.tools.length,['{n} kus','{n} kusy','{n} kusů']))}</span></button>${open?`<div class="library-grid">${set.tools.map(libraryCard).join('')}</div>`:''}</div>`;
  }
  const byData=(attr,value)=>[...panel.querySelectorAll(`[${attr}]`)].find(el=>el.getAttribute(attr)===value);
  // Replace one element of the results without a full redraw, and keep the focus on its toggle.
  function redraw(el,html,attr,value){el.outerHTML=html;byData(attr,value)?.focus();}
  // Filter bar and section clicks, shared by both folders. Returns true when the click was handled here.
  function browserClick(e){
    const view=views[state.folder],el=e.target.closest('[data-catalog-category],[data-catalog-kind],[data-catalog-system],[data-catalog-reset],[data-catalog-more],[data-section-toggle],[data-sections],[data-sets-open],[data-library-set-toggle]');if(!el)return false;
    const ds=el.dataset;
    if(ds.sectionToggle!=null){const key=ds.sectionToggle;view.open.set(key,!sectionIsOpen(key));redraw(byData('data-catalog-section',key),sectionHTML(key),'data-section-toggle',key);return true;}
    if(ds.librarySetToggle!=null){const id=ds.librarySetToggle,set=library.sets.find(s=>s.id===id);setOpen.mine.set(id,!setIsOpen(set));redraw(byData('data-library-set',id),librarySetHTML(set),'data-library-set-toggle',id);return true;}
    if(ds.catalogMore!=null){const key=ds.catalogMore;view.limits.set(key,(view.limits.get(key)||PAGE)+PAGE);byData('data-catalog-section',key).outerHTML=sectionHTML(key);return true;}
    const allSets=()=>[...sections.values()].flatMap(s=>s.sets);
    if(ds.sections!=null){const open=ds.sections==='open';for(const key of sections.keys())view.open.set(key,open);if(!open)for(const set of allSets())setOpen[state.folder].set(set.id,false);renderBrowser();byData('data-sections',ds.sections)?.focus();return true;}
    if(ds.setsOpen!=null){const open=ds.setsOpen==='true';for(const set of allSets())setOpen[state.folder].set(set.id,open);if(open)for(const [key,s] of sections)if(s.sets.length)view.open.set(key,true);renderBrowser();panel.querySelector('[data-sets-open]')?.focus();return true;}
    if(ds.catalogReset!=null){view.kind='all';view.categories.clear();view.system='all';view.query='';narrowed(view);const search=panel.querySelector('[data-catalog-search]');if(search)search.value='';renderBrowser();search?.focus();return true;}
    const attr=['data-catalog-category','data-catalog-kind','data-catalog-system'].find(a=>el.hasAttribute(a)),value=el.getAttribute(attr);
    if(ds.catalogSystem!=null)view.system=value;
    else{
      if(ds.catalogKind!=null)view.kind=value;
      else if(value==='all')view.categories.clear();
      else if(view.categories.has(value))view.categories.delete(value);
      else view.categories.add(value);
      narrowed(view);
    }
    renderBrowser();byData(attr,value)?.focus();return true;
  }
  // Scale target of a key: the tools it scales (a set: its ticked members) and its default length unit.
  function scaleTarget(key){
    if(key.startsWith('s:')){const set=setById(key.slice(2));if(!set)return null;const list=checkedTools(set);return{list:list.length?list:set.tools,unit:unitFor(set.unit),set:true};}
    const item=byId(key.slice(2));return item?{list:[item],unit:itemUnit(item),set:false}:null;
  }
  const lenValue=(mm,u)=>inputValue(mm,{unit:u,digits:u==='in'?2:1});
  function scaleState(key){
    const target=scaleTarget(key);if(!target)return null;
    const spec=scales.get(key),cur=longestSide(target.list);let f=1,error='';
    try{f=scaleFactor(spec,target.list,target.unit);}catch(e){error=errorText(e);}
    const preview=error||t(target.set?'Nejdelší nástroj: {from} → {to}':'Délka: {from} → {to}',{from:fmtLen(cur,{unit:target.unit}),to:fmtLen(cur*f,{unit:target.unit})});
    return{...target,spec,cur,f,error,preview,badge:!error&&Math.abs(f-1)>1e-9?pct(f):''};
  }
  function scaleHTML(key){
    const st=scaleState(key);if(!st)return'';
    const k=esc(key),pctText=st.spec?.mode==='percent'?st.spec.text:st.error?'':String(Math.round(st.f*1000)/10),lenText=st.spec?.mode==='length'?st.spec.text:st.error?'':lenValue(st.cur*st.f,st.unit);
    const lenLabel=t(st.set?'Délka nejdelšího nástroje':'Délka nástroje');
    return`<details class="catalog-scale" data-scale="${k}" ${scaleOpen.has(key)?'open':''}><summary>${esc(t('Upravit měřítko'))}<b data-scale-badge>${esc(st.badge)}</b></summary><div class="catalog-scale-body"><label><span>${esc(t('Měřítko'))}</span><span class="catalog-scale-input"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-scale-pct value="${esc(pctText)}" aria-label="${esc(t('Měřítko v procentech'))}"><em>%</em></span></label><label><span>${esc(lenLabel)}</span><span class="catalog-scale-input"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-scale-len value="${esc(lenText)}" aria-label="${esc(lenLabel+' ('+st.unit+')')}"><em>${esc(st.unit)}</em></span></label><small class="catalog-scale-preview ${st.error?'invalid':''}" data-scale-preview aria-live="polite">${esc(st.preview)}</small></div></details>`;
  }
  // Refresh preview/badge (and the other field) of one scale control after typing or a member change.
  function refreshScale(details,edited){
    const st=scaleState(details.dataset.scale);if(!st)return;
    const p=details.querySelector('[data-scale-preview]');p.textContent=st.preview;p.classList.toggle('invalid',!!st.error);
    details.querySelector('[data-scale-badge]').textContent=st.badge;
    if(st.error)return;
    if(edited!=='pct')details.querySelector('[data-scale-pct]').value=String(Math.round(st.f*1000)/10);
    if(edited!=='len')details.querySelector('[data-scale-len]').value=lenValue(st.cur*st.f,st.unit);
  }
  const LAYOUTS=[['group','Jeden modul pro celou sadu'],['each','Samostatný modul pro každý nástroj']];
  const layoutHTML=set=>{
    if(set.tools.length<2)return '';const p=preferences(set);
    return `<div class="catalog-storage-options"><label class="catalog-set-layout"><span>${esc(t('Rozložení'))}</span><select data-set-layout="${esc(set.id)}" aria-label="${esc(t('Rozložení sady {name}',{name:localName(set)}))}">${LAYOUTS.map(([id,label])=>`<option value="${id}" ${p.layout===id?'selected':''}>${esc(t(label))}</option>`).join('')}</select></label><label class="catalog-set-layout"><span>${esc(t('Uložení nástrojů'))}</span><select data-set-arrangement="${esc(set.id)}" ${p.layout==='each'?'disabled':''}><option value="ordered" ${p.arrangement==='ordered'?'selected':''}>${esc(t('Přehledně podle velikosti'))}</option><option value="compact" ${p.arrangement==='compact'?'selected':''}>${esc(t('Úsporně proti sobě'))}</option></select></label><label class="catalog-set-layout"><span>${esc(t('Pořadí velikostí'))}</span><select data-set-order="${esc(set.id)}"><option value="asc" ${p.order==='asc'?'selected':''}>${esc(t('Od nejmenšího po největší'))}</option><option value="desc" ${p.order==='desc'?'selected':''}>${esc(t('Od největšího po nejmenší'))}</option></select></label></div>`;
  };
  function itemHTML(item){
    const name=localName(item),acc=ACCURACY[item.accuracy]||ACCURACY.typical,src=item.source||{},on=selected.has(item.id);
    const tip=t('Zdroj: {source} · Licence: {license}',{source:src.name||'—',license:src.license||'—'});
    return`<div class="catalog-item ${on?'selected':''}" data-catalog-item="${esc(item.id)}"><label class="catalog-check"><input type="checkbox" data-catalog-select="${esc(item.id)}" ${on?'checked':''} aria-label="${esc(t('Vybrat {name}',{name}))}"></label><span class="tool-thumb catalog-thumb">${catalogThumb(item)}</span><strong class="catalog-name">${esc(name)}</strong><span class="catalog-meta"><span>${esc(sizeText(item))}</span><span class="accuracy-badge accuracy-${esc(item.accuracy||'typical')}" title="${esc(tip)}" tabindex="0" role="note" aria-label="${esc(t(acc)+' · '+tip)}">${esc(t(acc))}</span></span>${scaleHTML('i:'+item.id)}<span class="catalog-actions"><button type="button" class="btn btn-light" data-catalog-add="${esc(item.id)}" aria-label="${esc(t('Přidat {name} do šuplíku',{name}))}">${icon('plus')}${esc(t('Přidat do šuplíku'))}</button><button type="button" class="icon-btn" data-catalog-save="${esc(item.id)}" title="${esc(t('Uložit do mých nástrojů'))}" aria-label="${esc(t('Uložit {name} do mých nástrojů',{name}))}">${icon('save')}</button></span></div>`;
  }
  const domId=id=>'catalog-set-'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_');
  function addLabel(set){const n=checkedTools(set).length;return n===set.tools.length?t('Přidat sadu'):t('Přidat vybrané ze sady ({n})',{n});}
  const addAria=(set,n)=>t('Přidat sadu {name} do šuplíku',{name:localName(set)})+(n<set.tools.length?` (${n}/${set.tools.length})`:'');
  function setHTML(set){
    const id=set.id,name=localName(set),open=setIsOpen(set),on=selectedSets.has(id),n=checkedTools(set).length,total=set.tools.length;
    const acc=setAccuracy(set),src=set.source||{},desc=localText(set.description),range=desc?null:setSizeRange(set),unit=set.unit==='in'?'in':'mm';
    const tip=[t('Složení podle: {source}',{source:src.name||'—'}),localText(src.note)].filter(Boolean).join(' · ');
    const more=total>SET_THUMB_MAX?`<span class="catalog-set-more">+${total-SET_THUMB_MAX}</span>`:'';
    return`<div class="catalog-item catalog-set ${open?'expanded':''} ${on?'selected':''}" data-catalog-set="${esc(id)}"><label class="catalog-check"><input type="checkbox" data-catalog-select-set="${esc(id)}" ${on?'checked':''} aria-label="${esc(t('Vybrat sadu {name}',{name}))}"></label>`
      +`<span class="tool-thumb catalog-thumb catalog-set-thumb">${setThumb(set)}${more}</span><strong class="catalog-name">${esc(name)}</strong>${desc?`<span class="catalog-set-desc">${esc(desc)}</span>`:''}`
      +`<span class="catalog-meta">${/\(\d+\s*(?:ks|pcs)\.?\)/i.test(name)?'':`<span class="catalog-set-count">${esc(plural(total,['{n} kus','{n} kusy','{n} kusů']))}</span>`}${range?`<span class="catalog-set-range">${esc(range)}</span>`:''}<span class="unit-badge">${unit}</span><span class="accuracy-badge accuracy-${acc}" title="${esc(tip)}" tabindex="0" role="note" aria-label="${esc(t(ACCURACY[acc])+' · '+tip)}">${esc(t(ACCURACY[acc]))}</span></span>`
      +`<button type="button" class="catalog-set-toggle" data-set-toggle="${esc(id)}" aria-expanded="${open}" aria-controls="${domId(id)}">${icon('chevron')}<span>${esc(t(open?'Skrýt obsah':'Zobrazit obsah'))}</span><small data-set-picked>${n<total?esc(t('{n} z {total} vybráno',{n,total})):''}</small></button>`
      +(open?membersHTML(set):'')
      +`<div class="catalog-set-options">${set.tools.length>1?`<details class="ui-disclosure catalog-layout"><summary>${esc(t('Rozložení sady'))}</summary><div class="ui-disclosure-body">${layoutHTML(set)}</div></details>`:''}${scaleHTML('s:'+set.id)}</div>`
      +`<span class="catalog-actions"><button type="button" class="btn btn-light" data-set-add="${esc(id)}" ${n?'':'disabled'} aria-label="${esc(addAria(set,n))}">${icon('plus')}<span data-set-add-label>${esc(addLabel(set))}</span></button><button type="button" class="icon-btn" data-set-save="${esc(id)}" ${n?'':'disabled'} title="${esc(t('Uložit sadu do mých nástrojů'))}" aria-label="${esc(t('Uložit sadu {name} do mých nástrojů',{name}))}">${icon('save')}</button></span></div>`;
  }
  function membersHTML(set){
    const off=unticked.get(set.id)||new Set(),id=esc(set.id);
    return`<div class="catalog-set-members" id="${domId(set.id)}"><div class="catalog-set-bulk"><button type="button" class="section-link" data-set-all="${id}">${esc(t('Vybrat vše'))}</button><button type="button" class="section-link" data-set-none="${id}">${esc(t('Zrušit výběr'))}</button></div><ul>${set.tools.map((m,i)=>`<li><label><input type="checkbox" data-set-member="${id}" data-index="${i}" ${off.has(i)?'':'checked'}><span>${esc(localName(m))}</span><small>${esc(sizeText(m))}</small></label></li>`).join('')}</ul></div>`;
  }
  // Refresh the add button, counters and footer of one set card without re-rendering (keeps focus in the member list).
  function updateSet(set){
    modal.footer.innerHTML=footerHTML();
    const card=setCard(set.id);if(!card)return;
    const n=checkedTools(set).length,total=set.tools.length;
    const btn=card.querySelector('[data-set-add]'),keep=card.querySelector('[data-set-save]');
    btn.disabled=!n;keep.disabled=!n;btn.querySelector('[data-set-add-label]').textContent=addLabel(set);btn.setAttribute('aria-label',addAria(set,n));
    card.querySelector('[data-set-picked]').textContent=n<total?t('{n} z {total} vybráno',{n,total}):'';
    const off=unticked.get(set.id)||new Set();for(const box of card.querySelectorAll('[data-set-member]'))box.checked=!off.has(Number(box.dataset.index));
    const sc=card.querySelector('[data-scale]');if(sc)refreshScale(sc);
  }
  // Catalogue items → tools, scaled by the scale set for `key` (throws a translated error for an invalid scale).
  const scaledTools=(list,key)=>{const target=scaleTarget(key),f=scaleFactor(scales.get(key),target?.list||list,target?.unit);return list.map(i=>{const tool=catalogTool(i);return f===1?tool:scaleTool(tool,f);});};
  const itemTools=item=>scaledTools([item],'i:'+item.id);
  const setTools=set=>scaledTools(checkedTools(set),'s:'+set.id).map(tool=>({...tool,setNames:[localName(set)]}));
  // Render the status and allow a paint before contour scaling / packing can occupy the main thread.
  // Tabs and the close button stay available: leaving the view cancels work that has not started.
  const paint=()=>new Promise(resolve=>{
    const frame=globalThis.requestAnimationFrame||((callback)=>setTimeout(callback,0));
    frame(()=>setTimeout(resolve,0));
  });
  async function runOperation(title,message,run){
    if(operation||catalogLoading||state.folder!=='catalog'||!panel.isConnected)return;
    const my=token,indicator=document.createElement('div');indicator.dataset.catalogOperation='';
    indicator.innerHTML=loadingMarkup({title:t(title),message:t(message),compact:true});panel.prepend(indicator);
    const controls=[...panel.querySelectorAll('button,input,select'),...modal.footer.querySelectorAll('button')].map(el=>[el,el.disabled]);
    for(const [el] of controls)el.disabled=true;
    const current=()=>my===token&&state.folder==='catalog'&&panel.isConnected;
    const task={finish:()=>{
      for(const [el,disabled] of controls)el.disabled=disabled;
      indicator.remove();if(operation===task){operation=null;const after=task.afterFilter;task.afterFilter=null;if(current())after?.();}
    }};operation=task;
    try{await paint();if(current()&&operation===task)await run(current);}
    catch(error){if(current())toast(errorText(error));}
    finally{task.finish();}
  }
  // `make` builds the tool list lazily, so an invalid scale only shows a toast and adds nothing.
  const add=(make,opts={})=>runOperation('Přidávám nástroje do šuplíku…','Připravuji obrysy a jejich rozložení.',async current=>{
    const list=make();if(!list.length)return;
    await onAdd(list,opts);if(current()){selected.clear();selectedSets.clear();}
  });
  const save=(make,already='Tento obrys už v mých nástrojích je.',after)=>runOperation('Ukládám nástroje…','Ukládám obrysy do vaší knihovny.',async current=>{
    const list=make();if(!list.length)return;
    const n=await onSave(list);if(!current())return;
    toast(n?plural(n,['{n} obrys uložen do mých nástrojů.','{n} obrysy uloženy do mých nástrojů.','{n} obrysů uloženo do mých nástrojů.']):t(already));after?.();
  });
  const chosen=()=>[...[...selected].map(byId).filter(Boolean).flatMap(itemTools),...[...selectedSets].map(setById).filter(Boolean).flatMap(setTools)];
  // Build the complete batch before calling onAdd, so one invalid scale cannot add a partial selection.
  // Ranges refer to this flattened list; each set keeps its own scale, members and editable layout.
  const addChosen=()=>{
    const opts={collections:[]};
    return add(()=>{
      const tools=[...selected].map(byId).filter(Boolean).flatMap(itemTools);
      for(const set of [...selectedSets].map(setById).filter(Boolean)){
        const members=setTools(set),start=tools.length;
        tools.push(...members);
        const p=preferences(set);
        if(members.length>1)opts.collections.push({start,count:members.length,name:localName(set),unit:set.unit==='in'?'in':'mm',layout:p.layout==='group'?'shared':'auto',arrangement:p.layout==='each'?'ordered':p.arrangement,order:p.order});
      }
      return tools;
    },opts);
  };
  // set: the added tools become one project tool set; group: ONE module for them (default layout).
  const setAddOpts=(set,n)=>{const p=preferences(set),info={name:localName(set),unit:set.unit==='in'?'in':'mm',arrangement:p.layout==='each'?'ordered':p.arrangement,order:p.order};return n>1?{set:{...info,layout:p.layout==='group'?'shared':'auto'},...(p.layout==='group'?{group:info}:{})}:{};};
  panel.addEventListener('click',e=>{
    if(operation||catalogLoading)return;
    if(browserClick(e)||state.folder!=='catalog')return;
    if(e.target.closest('[data-catalog-retry]')){openCatalog();return;}
    const summary=e.target.closest('.catalog-scale > summary');
    if(summary){const d=summary.parentElement,key=d.dataset.scale;if(d.open)scaleOpen.delete(key);else scaleOpen.add(key);return;}
    const one=e.target.closest('[data-catalog-add]'),keep=e.target.closest('[data-catalog-save]');
    if(one){const item=byId(one.dataset.catalogAdd);if(item)add(()=>itemTools(item));return;}
    if(keep){const item=byId(keep.dataset.catalogSave);if(item)save(()=>itemTools(item));return;}
    const btn=e.target.closest('[data-set-add],[data-set-save],[data-set-toggle],[data-set-all],[data-set-none]');if(!btn)return;
    const ds=btn.dataset,set=setById(ds.setAdd??ds.setSave??ds.setToggle??ds.setAll??ds.setNone);if(!set)return;
    if(ds.setAdd!=null)add(()=>setTools(set),setAddOpts(set,checkedTools(set).length));
    else if(ds.setSave!=null)save(()=>setTools(set),'Všechny obrysy této sady už v mých nástrojích jsou.');
    else if(ds.setToggle!=null){
      setOpen.catalog.set(set.id,!setIsOpen(set));
      const card=setCard(set.id);if(card){card.outerHTML=setHTML(set);setCard(set.id)?.querySelector('[data-set-toggle]')?.focus();}
    }else{if(ds.setAll!=null)unticked.delete(set.id);else unticked.set(set.id,new Set(set.tools.map((_,i)=>i)));updateSet(set);}
  });
  panel.addEventListener('input',e=>{
    if(operation||catalogLoading)return;
    const field=e.target.closest('[data-scale-pct],[data-scale-len]');if(!field)return;
    const details=field.closest('[data-scale]'),pctField=field.hasAttribute('data-scale-pct');
    scales.set(details.dataset.scale,{mode:pctField?'percent':'length',text:field.value});
    refreshScale(details,pctField?'pct':'len');
  });
  panel.addEventListener('change',e=>{
    if(operation||catalogLoading)return;
    const layout=e.target.closest('[data-set-layout],[data-set-arrangement],[data-set-order]');
    if(layout){
      const key=layout.hasAttribute('data-set-layout')?'layout':layout.hasAttribute('data-set-arrangement')?'arrangement':'order',id=layout.dataset.setLayout||layout.dataset.setArrangement||layout.dataset.setOrder;
      const value=key==='layout'?(layout.value==='each'?'each':'group'):key==='arrangement'?(layout.value==='compact'?'compact':'ordered'):(layout.value==='desc'?'desc':'asc');
      setPreferences.set(id,{...setPreferences.get(id),[key]:value});state[key]=value;
      for(const select of panel.querySelectorAll('[data-set-layout],[data-set-arrangement],[data-set-order]')){
        const item=setById(select.dataset.setLayout||select.dataset.setArrangement||select.dataset.setOrder);if(!item)continue;const p=preferences(item);
        select.value=select.hasAttribute('data-set-layout')?p.layout:select.hasAttribute('data-set-arrangement')?p.arrangement:p.order;
        if(select.hasAttribute('data-set-arrangement'))select.disabled=p.layout==='each';
      }return;
    }
    if(e.target.closest('[data-scale-pct],[data-scale-len]'))return;
    const member=e.target.closest('[data-set-member]');
    if(member){
      const set=setById(member.dataset.setMember);if(!set)return;
      const off=unticked.get(set.id)||new Set(),i=Number(member.dataset.index);
      if(member.checked)off.delete(i);else off.add(i);
      if(off.size)unticked.set(set.id,off);else unticked.delete(set.id);
      updateSet(set);return;
    }
    const whole=e.target.closest('[data-catalog-select-set]');
    if(whole){
      if(whole.checked)selectedSets.add(whole.dataset.catalogSelectSet);else selectedSets.delete(whole.dataset.catalogSelectSet);
      whole.closest('.catalog-set')?.classList.toggle('selected',whole.checked);modal.footer.innerHTML=footerHTML();return;
    }
    const box=e.target.closest('[data-catalog-select]');if(!box)return;
    if(box.checked)selected.add(box.dataset.catalogSelect);else selected.delete(box.dataset.catalogSelect);
    box.closest('.catalog-item')?.classList.toggle('selected',box.checked);modal.footer.innerHTML=footerHTML();
  });
  modal.footer.addEventListener('click',e=>{
    if(state.folder!=='catalog'||operation||catalogLoading)return;
    if(e.target.closest('[data-catalog-add-selected]'))addChosen();
    else if(e.target.closest('[data-catalog-save-selected]'))save(chosen,undefined,()=>{selected.clear();selectedSets.clear();renderBrowser();modal.footer.innerHTML=footerHTML();});
  });
  show(state.folder);
  return{refresh:()=>{if(state.folder==='mine')show('mine');}};
}
