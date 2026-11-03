// Tool sets ("Sady nářadí") in the Katalog folder: chip, grouping, search, add/save whole sets, member selection.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

const {setCatalogSource,filterSets,setSizeRange,setThumb}=await import('../dist/catalog-ui.js');
const {setLang}=await import('../dist/i18n.js');
const {setAppUnit}=await import('../dist/units.js');
const {validateLayout}=await import('../dist/geometry.js');

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const CATEGORIES=[{id:'wrenches',cs:'Klíče',en:'Wrenches'},{id:'hex-keys',cs:'Imbusy a torxy',en:'Hex & Torx keys'},{id:'sockets',cs:'Nástrčné hlavice a bity',en:'Sockets & bits'},{id:'pliers',cs:'Kleště',en:'Pliers'}];
const SETS_CATEGORY={id:'sets',cs:'Sady nářadí',en:'Tool sets'};
const wrench=s=>({id:'wrench-'+s,category:'wrenches',name:{cs:`Očkoplochý klíč ${s} mm`,en:`Combination wrench ${s} mm`},points:rect(80+s*8,12+s*1.6),depth:6+s/4,unit:'mm',size:s,tags:[s+' mm','DIN 3113'],accuracy:'standard',source:{name:'DIN 3113',license:'CC0'}});
const hex=s=>({id:'hex-'+s,category:'hex-keys',name:{cs:`Imbusový klíč ${s} mm`,en:`Hex key ${s} mm`},points:rect(50+s*10,10+s*3),depth:6,unit:'mm',size:s,tags:[s+' mm'],accuracy:'typical',source:{name:'Typical',license:'CC0'}});
const socket=s=>({id:'socket-'+s,category:'sockets',name:{cs:`Nástrčná hlavice ${s} mm`,en:`Socket ${s} mm`},points:rect(22+s,22+s),depth:20,unit:'mm',size:s,tags:[s+' mm'],accuracy:'standard',source:{name:'ISO 2725',license:'CC0'}});
const half={id:'wrench-half-inch',category:'wrenches',name:{cs:'Očkoplochý klíč 1/2 in',en:'Combination wrench 1/2 in'},points:rect(165,30),depth:8,unit:'in',size:.5,tags:['1/2"','SAE'],accuracy:'standard',source:{name:'ASME',license:'CC0'}};
const threeQ={...half,id:'wrench-3-4-inch',name:{cs:'Očkoplochý klíč 3/4 in',en:'Combination wrench 3/4 in'},size:.75,tags:['3/4"','SAE']};
const pliers={id:'pliers-combi',category:'pliers',name:{cs:'Kombinované kleště',en:'Combination pliers'},points:rect(180,55),depth:14,unit:'mm',accuracy:'measured',source:{name:'Open dataset',license:'CC-BY-4.0'}};
const socketSizes=[8,9,10,11,12,13,14,15,16,17,19];
const items=[...[8,10,13,17].map(wrench),half,threeQ,...[2,3,4].map(hex),...socketSizes.map(socket),pliers];
const sets=[
  // Sets as in catalog/sets.js (ids only, resolved by the UI) …
  {id:'wrench-set-8-17',category:'wrenches',name:{cs:'Sada očkoplochých klíčů 8–17 mm',en:'Combination wrench set 8–17 mm'},items:['wrench-8','wrench-10','wrench-13','wrench-17'],unit:'mm',tags:['DIN 3113'],source:{name:'Typické dílenské sady',note:{cs:'4 nejčastější velikosti',en:'4 most common sizes'}}},
  {id:'sae-wrench-set',category:'wrenches',name:{cs:'Sada klíčů SAE',en:'SAE wrench set'},items:['wrench-half-inch','wrench-3-4-inch'],unit:'in',tags:['SAE'],source:{name:'ASME'}},
  {id:'socket-set',category:'sockets',name:{cs:'Sada nástrčných hlavic 1/2"',en:'1/2" socket set'},items:socketSizes.map(s=>'socket-'+s),unit:'mm',tags:['1/2"'],source:{name:'Typical'}},
  // … and resolved like catalogSets() (with `tools`).
  {id:'hex-set',category:'hex-keys',name:{cs:'Sada imbusů',en:'Hex key set'},description:{cs:'Imbusy 2–4 mm v držáku',en:'Hex keys 2–4 mm in a holder'},items:['hex-2','hex-3','hex-4'],tools:[2,3,4].map(s=>items.find(i=>i.id==='hex-'+s)),unit:'mm',tags:['inbus','allen'],source:{name:'Typical'}},
  {id:'broken-set',category:'wrenches',name:{cs:'Neúplná sada',en:'Incomplete set'},items:['wrench-8','missing-id'],unit:'mm'}
];
const source=async()=>({categories:CATEGORIES,items,sets,setsCategory:SETS_CATEGORY});
setCatalogSource(source);

// Explicit print bed: these scenarios are not about the bed (see the bed tests in catalog-set-options.test.mjs).
const seedProject=async()=>{const {createDemoProject}=await import('../dist/geometry.js'),{validateProject}=await import('../dist/model.js');const p=validateProject({...createDemoProject(),id:'test-drawer',limitToBed:false});localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([p]));localStorage.setItem('suplik-studio-current',JSON.stringify(p.id));};
await seedProject();
await import('../dist/app.js');

const $=s=>win.document.querySelector(s);
const $$=s=>[...win.document.querySelectorAll(s)];
const click=s=>{const el=typeof s==='string'?$(s):s;assert.ok(el,'Missing '+s);el.click();};
const waitFor=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('Timed out waiting for UI');await new Promise(r=>setTimeout(r,10));}};
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const libraryStore=()=>JSON.parse(localStorage.getItem('suplik-studio-library-v1')||'[]');
const tab=id=>$(`[data-library-folder="${id}"]`);
const setIds=()=>$$('[data-catalog-set]').map(el=>el.dataset.catalogSet);
const itemIds=()=>$$('[data-catalog-item]').map(el=>el.dataset.catalogItem);
const card=id=>$(`[data-catalog-set="${id}"]`);
const chipText=()=>$$('[data-catalog-category]').filter(b=>b.classList.contains('catalog-chip')).map(b=>b.textContent.replace(/\s+/g,' ').trim());
async function openCatalog(){click('#app [data-action="library"]');if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));await waitFor(()=>$('.catalog-grid')||$('.catalog-empty'));}
async function search(text){const input=$('[data-catalog-search]');input.value=text;input.dispatchEvent(new win.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,170));}
const chooseCategory=id=>click(`.catalog-chip[data-catalog-category="${id}"]`);
const untick=(setId,index)=>{const box=$(`[data-set-member="${setId}"][data-index="${index}"]`);box.checked=false;box.dispatchEvent(new win.Event('change',{bubbles:true}));};
const undoCount=()=>{let n=0;const undo=()=>$('#app [data-action="undo"]');while(undo()&&!undo().disabled&&n<100){undo().click();n++;}return n;};
const placedInDrawer=(p,t)=>{const m=p.modules.find(m=>m.id===t.moduleId);return !!m&&m.x>=-.001&&m.y>=-.001&&m.x+m.width<=p.width+.001&&m.y+m.height<=p.height+.001;};

after(()=>{setLang('cs');setAppUnit('mm');setCatalogSource(null);});

test('"Sady nářadí" is the first chip and groups sets under the categories of their contents',async()=>{
  await openCatalog();
  assert.deepEqual(chipText(),['Sady nářadí 4','Vše 21','Klíče 6','Imbusy a torxy 3','Nástrčné hlavice a bity 11','Kleště 1'],'sets chip first, incomplete set dropped');
  assert.ok($('.catalog-chip').classList.contains('catalog-chip-sets'));
  chooseCategory('sets');
  assert.equal($('.catalog-chip[data-catalog-category="sets"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual($$('[data-catalog-set-group]').map(g=>g.dataset.catalogSetGroup),['wrenches','hex-keys','sockets'],'groups follow CATEGORIES order');
  assert.deepEqual($$('.catalog-set-group > .catalog-group-title').map(h=>h.textContent.replace(/\s+/g,' ').trim()),['Klíče 2','Imbusy a torxy 1','Nástrčné hlavice a bity 1']);
  assert.deepEqual(setIds(),['wrench-set-8-17','sae-wrench-set','hex-set','socket-set']);
  assert.equal(itemIds().length,0,'single outlines are not mixed into the sets view');
  assert.match($('.catalog-count').textContent,/4 sady/);
  // Card content: pieces, range, unit, accuracy summary, source tooltip.
  const w=card('wrench-set-8-17');
  assert.equal(w.querySelector('.catalog-name').textContent,'Sada očkoplochých klíčů 8–17 mm');
  assert.equal(w.querySelector('.catalog-set-count').textContent,'4 kusy');
  assert.equal(w.querySelector('.catalog-set-range').textContent,'8–17 mm');
  assert.equal(w.querySelector('.unit-badge').textContent,'mm');
  assert.equal(w.querySelector('.accuracy-badge').textContent,'podle normy');
  assert.match(w.querySelector('.accuracy-badge').title,/Typické dílenské sady · 4 nejčastější velikosti/);
  assert.equal(w.querySelectorAll('.catalog-set-thumb path').length,1);
  assert.equal(w.querySelector('.catalog-set-more'),null);
  assert.equal(card('hex-set').querySelector('.accuracy-badge').textContent,'typický tvar','mixed/typical members → typical shape');
  assert.equal(card('hex-set').querySelector('.catalog-set-desc').textContent,'Imbusy 2–4 mm v držáku');
  assert.equal(card('socket-set').querySelector('.catalog-set-more').textContent,'+3','thumbnail shows at most 8 outlines');
  assert.equal(card('sae-wrench-set').querySelector('.catalog-set-range').textContent,'1/2–3/4 in');
  assert.equal(card('sae-wrench-set').querySelector('.unit-badge').textContent,'in');
  assert.equal(card('wrench-set-8-17').querySelector('[data-set-add]').textContent.trim(),'Přidat sadu');
  click('[data-modal-close]');
});

test('search and measurement filter apply to sets; matching sets are surfaced above single outlines',async()=>{
  await openCatalog();
  chooseCategory('sets');
  await search('sada klicu');assert.deepEqual(setIds(),['wrench-set-8-17','sae-wrench-set'],'by set name without diacritics');
  await search('17');assert.deepEqual(setIds(),['wrench-set-8-17','socket-set'],'by the size of a contained tool');
  await search('hex keys');assert.deepEqual(setIds(),['hex-set'],'English name/description in Czech UI');
  await search('allen');assert.deepEqual(setIds(),['hex-set'],'by tag');
  await search('nic-takoveho');assert.equal(setIds().length,0);assert.ok($('.catalog-results .catalog-empty'));
  await search('');
  click('[data-catalog-system="imperial"]');assert.deepEqual(setIds(),['sae-wrench-set']);
  assert.match($('.catalog-chip[data-catalog-category="sets"]').textContent,/1/);
  click('[data-catalog-system="metric"]');assert.ok(!setIds().includes('sae-wrench-set'));
  click('[data-catalog-system="all"]');
  // "Vše": a short "Sady" row above the outlines with a link to all sets.
  chooseCategory('all');
  assert.ok($('.catalog-sets-preview'));assert.equal(setIds().length,3,'preview shows a few sets');
  assert.equal(itemIds().length,21);
  click('.catalog-sets-preview [data-catalog-category="sets"]');
  assert.equal(setIds().length,4);
  chooseCategory('all');
  await search('13');
  assert.deepEqual(setIds(),['wrench-set-8-17','socket-set'],'search in Vše shows matching sets too');
  assert.deepEqual(itemIds(),['wrench-13','socket-13']);
  // A content category shows its own sets above its outlines.
  await search('');chooseCategory('hex-keys');
  assert.deepEqual(setIds(),['hex-set']);assert.deepEqual(itemIds(),['hex-2','hex-3','hex-4']);
  // Sets exist although no single outline matches.
  chooseCategory('all');await search('sada');
  assert.equal(itemIds().length,0);assert.ok(setIds().length>0);assert.ok($('.catalog-results > .catalog-empty')===null);
  await search('');
  click('[data-modal-close]');
});

test('"Přidat sadu" adds every tool of the set in one step (one undo, one arrangement)',async()=>{
  const previous=saved(),before=previous.tools.length;
  await openCatalog();chooseCategory('sets');
  click('[data-set-add="wrench-set-8-17"]');
  const needsFit=!!$('.modal');
  if(needsFit){
    assert.equal($('#modal-title').textContent,'Sada se do šuplíku nevešla');
    assert.ok($('[data-fit="grow"]')&&$('[data-fit="new"]')&&$('[data-fit="keep"]'),'oversize set offers an explicit choice');
    assert.equal($('[data-fit="grow"]').disabled,false,'the proposed enlargement is available');
    click('[data-fit="grow"]');
  }
  assert.ok($('.modal')===null,'modal closes after adding');
  const tools=saved().tools;assert.equal(tools.length,before+4);
  const added=tools.slice(-4),byName=(a,b)=>a[0].localeCompare(b[0],'cs',{numeric:true});
  assert.deepEqual(added.map(t=>[t.name,t.unit,t.depth]).sort(byName),[8,10,13,17].map(s=>[`Očkoplochý klíč ${s} mm`,'mm',6+s/4]));
  // Default layout: the whole set is ONE grouped module.
  const mods=new Set(added.map(t=>t.moduleId));assert.equal(mods.size,1,'one module for the whole set');
  assert.equal(saved().modules.find(m=>m.id===[...mods][0])?.grouped,true);
  assert.equal(new Set(added.map(t=>t.id)).size,4);assert.ok(added.every(t=>!items.some(i=>i.id===t.id)));
  assert.ok(added.every(t=>placedInDrawer(saved(),t)),'all four members have a module inside the drawer');
  assert.deepEqual(validateLayout(saved()),[],'the accepted placement is ready for manufacturing');
  assert.match($('#toast').textContent,needsFit?/Šuplík zvětšen na/:/jeden modul/);
  const accepted=saved();
  click('#app [data-action="undo"]');assert.equal(saved().tools.length,before,'one undo removes the whole set');
  assert.deepEqual(saved().modules,previous.modules);assert.deepEqual([saved().width,saved().height,saved().limitToBed],[previous.width,previous.height,previous.limitToBed],'undo includes the accepted enlargement');
  click('#app [data-action="redo"]');assert.equal(saved().tools.length,before+4);
  assert.deepEqual(saved().modules,accepted.modules);assert.deepEqual([saved().width,saved().height,saved().limitToBed],[accepted.width,accepted.height,accepted.limitToBed]);
});

test('unticked members are left out; the add button counts the selection',async()=>{
  const before=saved().tools.length;
  await openCatalog();chooseCategory('sets');
  const toggle=$('[data-set-toggle="wrench-set-8-17"]');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(toggle.textContent.trim(),'Zobrazit obsah');
  click(toggle);
  const open=$('[data-set-toggle="wrench-set-8-17"]');
  assert.equal(open.getAttribute('aria-expanded'),'true');assert.match(open.textContent,/Skrýt obsah/);
  assert.ok(card('wrench-set-8-17').classList.contains('expanded'));
  const boxes=$$('[data-set-member="wrench-set-8-17"]');
  assert.equal(boxes.length,4);assert.ok(boxes.every(b=>b.checked),'all members checked by default');
  untick('wrench-set-8-17',0);untick('wrench-set-8-17',2);
  const addBtn=$('[data-set-add="wrench-set-8-17"]');
  assert.equal(addBtn.textContent.trim(),'Přidat vybrané ze sady (2)');
  assert.match(open.textContent,/2 z 4 vybráno/);
  // Select none disables the button, select all restores it.
  click('[data-set-none="wrench-set-8-17"]');assert.equal(addBtn.disabled,true);
  assert.ok($$('[data-set-member="wrench-set-8-17"]').every(b=>!b.checked));
  click('[data-set-all="wrench-set-8-17"]');assert.equal(addBtn.disabled,false);assert.equal(addBtn.textContent.trim(),'Přidat sadu');
  untick('wrench-set-8-17',0);untick('wrench-set-8-17',2);
  // Re-rendering (filter change) keeps the expanded state and the selection.
  click('[data-catalog-system="metric"]');
  assert.equal($('[data-set-member="wrench-set-8-17"][data-index="0"]').checked,false);
  assert.equal($('[data-set-member="wrench-set-8-17"][data-index="1"]').checked,true);
  click('[data-catalog-system="all"]');
  click('[data-set-add="wrench-set-8-17"]');
  const tools=saved().tools;assert.equal(tools.length,before+2);
  assert.deepEqual(tools.slice(-2).map(t=>t.name).sort(),['Očkoplochý klíč 10 mm','Očkoplochý klíč 17 mm']);
  click('#app [data-action="undo"]');assert.equal(saved().tools.length,before);
});

test('a whole set can be saved to my tools without duplicates',async()=>{
  await openCatalog();chooseCategory('sets');
  const count=libraryStore().length;
  click('[data-set-save="hex-set"]');
  const lib=libraryStore();assert.equal(lib.length,count+3);
  assert.deepEqual(lib.slice(-3).map(t=>t.name),['Imbusový klíč 2 mm','Imbusový klíč 3 mm','Imbusový klíč 4 mm']);
  assert.match($('#toast').textContent,/3 obrysy uloženy/);
  click('[data-set-save="hex-set"]');assert.equal(libraryStore().length,count+3);
  assert.equal($('#toast').textContent,'Všechny obrysy této sady už v mých nástrojích jsou.');
  click('[data-modal-close]');
});

test('whole sets can be multi-selected together with single outlines',async()=>{
  const before=saved().tools.length;
  await openCatalog();chooseCategory('sets');
  const pick=sel=>{const b=$(sel);b.checked=true;b.dispatchEvent(new win.Event('change',{bubbles:true}));};
  pick('[data-catalog-select-set="hex-set"]');
  assert.ok(card('hex-set').classList.contains('selected'));
  assert.match($('[data-catalog-add-selected]').textContent,/\(3\)/);
  chooseCategory('pliers');pick('[data-catalog-select="pliers-combi"]');
  assert.match($('[data-catalog-add-selected]').textContent,/\(4\)/);
  click('[data-catalog-add-selected]');
  assert.equal(saved().tools.length,before+4);
  click('#app [data-action="undo"]');assert.equal(saved().tools.length,before,'one undo step');
});

test('a large set that does not fit keeps every tool and the app reports what is unplaced',async()=>{
  const big=Array.from({length:30},(_,i)=>({id:'bar-'+i,category:'wrenches',name:{cs:`Tyč ${i}`,en:`Bar ${i}`},points:rect(380,60),depth:10,unit:'mm',size:i+1,accuracy:'typical',source:{name:'Test'}}));
  setCatalogSource(async()=>({categories:CATEGORIES,items:big,sets:[{id:'big-set',category:'wrenches',name:{cs:'Velká sada',en:'Big set'},items:big.map(b=>b.id),unit:'mm'}]}));
  try{
    const before=saved().tools.length,oldIds=new Set(saved().tools.map(t=>t.id));
    await openCatalog();chooseCategory('sets');
    click('[data-set-add="big-set"]');
    const p=saved();assert.equal(p.tools.length,before+30,'nothing is dropped');
    const added=p.tools.filter(t=>!oldIds.has(t.id)),unplaced=added.filter(t=>!placedInDrawer(p,t)).length;
    assert.ok(unplaced>0,'the default drawer cannot hold 30 large bars');
    const own=p.modules.filter(m=>added.some(t=>t.moduleId===m.id));
    assert.equal(own.length,1,'the full set remains together in a parked module');
    assert.equal(own[0].grouped,true);assert.ok(added.every(t=>t.moduleId===own[0].id));
    assert.deepEqual(validateLayout({...p,tools:added,modules:own,width:Math.max(p.width,own[0].x+own[0].width),height:Math.max(p.height,own[0].y+own[0].height),limitToBed:false}),[],'the parked module retains valid pockets and walls');
    assert.equal($('#modal-title').textContent,'Sada se do šuplíku nevešla');
    assert.ok($('[data-fit="grow"]')&&$('[data-fit="new"]')&&$('[data-fit="keep"]'),'app reports missing space with an explicit choice');
    assert.match($('.modal-body').textContent,/Velká sada/);
    click('[data-fit="keep"]');
    assert.equal($('.modal'),null);assert.match($('#toast').textContent,/zůstaly mimo šuplík/);
    assert.equal(saved().tools.filter(t=>!oldIds.has(t.id)).length,30,'keeping the parked module preserves every tool');
    click('#app [data-action="undo"]');assert.equal(saved().tools.length,before);
    assert.ok(!saved().modules.some(m=>m.id===own[0].id),'one undo removes the parked group');
  }finally{setCatalogSource(source);}
});

test('English labels for the sets view',async()=>{
  setLang('en');
  try{
    await openCatalog();
    assert.equal(chipText()[0],'Tool sets 4');
    chooseCategory('sets');
    assert.equal($('.catalog-set-group .catalog-group-title').firstChild.textContent.trim(),'Wrenches');
    assert.match($('.catalog-count').textContent,/4 sets/);
    const w=card('wrench-set-8-17');
    assert.equal(w.querySelector('.catalog-name').textContent,'Combination wrench set 8–17 mm');
    assert.equal(w.querySelector('.catalog-set-count').textContent,'4 pieces');
    assert.equal(w.querySelector('.accuracy-badge').textContent,'per standard');
    assert.match(w.querySelector('.accuracy-badge').title,/Composition based on: Typické dílenské sady · 4 most common sizes/);
    assert.equal(w.querySelector('[data-set-add]').textContent.trim(),'Add set');
    assert.equal(w.querySelector('[data-set-toggle]').textContent.trim(),'Show contents');
    assert.equal(w.querySelector('[data-set-save]').title,'Save set to my tools');
    assert.equal(card('hex-set').querySelector('.catalog-set-desc').textContent,'Hex keys 2–4 mm in a holder');
    click('[data-set-toggle="hex-set"]');untick('hex-set',1);
    assert.equal($('[data-set-add="hex-set"]').textContent.trim(),'Add selected from set (2)');
    assert.match($('[data-set-toggle="hex-set"]').textContent,/2 of 3 selected/);
    await search('sada imbusu');assert.deepEqual(setIds(),['hex-set'],'Czech set names are searchable in English UI');
    await search('');
    const before=saved().tools.length;
    click('[data-set-add="hex-set"]');
    assert.deepEqual(saved().tools.slice(before).map(t=>t.name),['Hex key 2 mm','Hex key 4 mm'],'tools are named in the current language');
  }finally{setLang('cs');setAppUnit('mm');}
});

test('pure helpers: filterSets, setSizeRange and setThumb',()=>{
  const resolved=sets.slice(0,4).map(s=>({...s,tools:s.tools||s.items.map(id=>items.find(i=>i.id===id))}));
  assert.deepEqual(filterSets(resolved,{category:'sockets'}).map(s=>s.id),['socket-set']);
  assert.deepEqual(filterSets(resolved,{system:'imperial'}).map(s=>s.id),['sae-wrench-set']);
  assert.deepEqual(filterSets(resolved,{query:'1/2'}).map(s=>s.id),['sae-wrench-set','socket-set']);
  assert.equal(setSizeRange(resolved[0]),'8–17 mm');
  assert.equal(setSizeRange({unit:'mm',tools:[pliers]}),null);
  const svg=setThumb(resolved[2]);assert.match(svg,/^<svg viewBox="[-\d. ]+"/);assert.equal((svg.match(/M/g)||[]).length,8);
});

test('real set data loads through catalogSets() and the default source without errors',async()=>{
  const m=await import('../dist/catalog/index.js');
  const real=m.catalogSets();
  assert.ok(Array.isArray(real));
  assert.equal(m.SETS_CATEGORY.id,'sets');
  const cats=new Set(m.CATEGORIES.map(c=>c.id));
  for(const set of real){
    assert.ok(set.id&&set.name?.cs&&set.name?.en,'set has id and both names: '+set.id);
    assert.ok(cats.has(set.category),'set category is a catalogue category: '+set.id);
    assert.equal(set.tools.length,set.items.length);
    assert.ok(setThumb(set).startsWith('<svg'));
  }
  assert.equal(filterSets(real,{}).length,real.length);
  setCatalogSource(null);
  try{
    await openCatalog();
    assert.ok($('[role=alert]')===null,'loading the real catalogue must not fail');
    if(real.length){
      assert.match(chipText()[0],/^Sady nářadí \d+/);
      chooseCategory('sets');assert.equal(setIds().length,real.length);
    }
    click('[data-modal-close]');
  }finally{setCatalogSource(source);}
});
