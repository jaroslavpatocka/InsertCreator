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

const {setCatalogSource,filterCatalog,catalogTool}=await import('../dist/catalog-ui.js');
const {setLang}=await import('../dist/i18n.js');
const {setAppUnit}=await import('../dist/units.js');

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const CATEGORIES=[{id:'wrenches',cs:'Klíče',en:'Wrenches'},{id:'pliers',cs:'Kleště',en:'Pliers'},{id:'other',cs:'Ostatní',en:'Other'}];
const items=[
  {id:'wrench-13',category:'wrenches',name:{cs:'Očkoplochý klíč 13 mm',en:'Combination wrench 13 mm'},points:rect(170,32),depth:9,unit:'mm',size:13,tags:['13 mm','DIN 3113'],accuracy:'standard',source:{name:'DIN 3113',license:'CC0',url:'https://example.org'}},
  {id:'wrench-17',category:'wrenches',name:{cs:'Očkoplochý klíč 17 mm',en:'Combination wrench 17 mm'},points:rect(210,38),depth:10,unit:'mm',size:17,tags:['17 mm'],accuracy:'standard',source:{name:'DIN 3113',license:'CC0',url:''}},
  {id:'wrench-half-inch',category:'wrenches',name:{cs:'Očkoplochý klíč 1/2 in',en:'Combination wrench 1/2 in'},points:rect(165,30),depth:8,unit:'in',size:.5,tags:['1/2"','SAE'],accuracy:'typical',source:{name:'Typical',license:'CC-BY-4.0',url:''}},
  {id:'pliers-combi',category:'pliers',name:{cs:'Kombinované kleště',en:'Combination pliers'},points:rect(180,55),depth:14,unit:'mm',tags:['180 mm'],accuracy:'measured',source:{name:'Open dataset',license:'CC-BY-4.0',url:''}}
];
let loads=0;
setCatalogSource(async()=>{loads++;return{categories:CATEGORIES,items};});

// Dynamic so i18n still loads after the language is stored above.
const {seedSample}=await import('./sample-fixture.mjs');
seedSample();
await import('../dist/app.js');

const $=s=>win.document.querySelector(s);
const $$=s=>[...win.document.querySelectorAll(s)];
const click=s=>{const el=typeof s==='string'?$(s):s;assert.ok(el,'Missing '+s);el.click();};
const waitFor=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('Timed out waiting for UI');await new Promise(r=>setTimeout(r,10));}};
const clickOperation=async target=>{click(target);await waitFor(()=>!$('[data-catalog-operation]'));};
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const libraryStore=()=>JSON.parse(localStorage.getItem('suplik-studio-library-v1')||'[]');
const openLibrary=()=>click('#app [data-action="library"]');
const tab=id=>$(`[data-library-folder="${id}"]`);
const ids=()=>$$('[data-catalog-item]').map(el=>el.dataset.catalogItem);
async function openCatalog(){openLibrary();if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));await waitFor(()=>$('.catalog-section')||$('.catalog-empty'));}
async function search(text){const input=$('[data-catalog-search]');input.value=text;input.dispatchEvent(new win.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,170));}

after(()=>{setLang('cs');setAppUnit('mm');setCatalogSource(null);});

test('library modal has accessible folders, catalogue loads lazily and the last folder is remembered',async()=>{
  assert.equal(loads,0,'catalogue must not load on startup');
  openLibrary();
  assert.equal($('[role=tablist]').querySelectorAll('[role=tab]').length,2);
  assert.equal(tab('mine').getAttribute('aria-selected'),'true');
  assert.ok($$('.library-item').length>0,'My tools still lists the user library');
  assert.ok($('[data-capture]'));
  // Keyboard: ArrowRight moves to the catalogue tab.
  tab('mine').dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(tab('catalog').getAttribute('aria-selected'),'true');
  assert.equal(tab('catalog').tabIndex,0);assert.equal(tab('mine').tabIndex,-1);
  await waitFor(()=>$('.catalog-grid'));
  assert.equal(loads,1);
  assert.deepEqual(ids(),items.map(i=>i.id));
  assert.match($('.modal-foot').textContent,/PDF 1:1/);
  click('[data-modal-close]');
  openLibrary();
  assert.equal(tab('catalog').getAttribute('aria-selected'),'true','last folder is remembered');
  await waitFor(()=>$('.catalog-grid'));
  click(tab('mine'));
  assert.ok($$('.library-item').length>0);
  click('[data-modal-close]');
});

test('category chips, system filter and search in Czech and English',async()=>{
  await openCatalog();
  const chips=$$('[data-catalog-category]').map(b=>b.textContent.replace(/\s+/g,' ').trim());
  assert.deepEqual(chips,['Vše 4','Klíče 3','Kleště 1'],'only used categories are shown, with counts');
  click('[data-catalog-category="pliers"]');
  assert.deepEqual(ids(),['pliers-combi']);
  click('[data-catalog-category="all"]');
  click('[data-catalog-system="imperial"]');assert.deepEqual(ids(),['wrench-half-inch']);
  click('[data-catalog-system="metric"]');assert.deepEqual(ids(),['wrench-13','wrench-17','pliers-combi']);
  click('[data-catalog-system="all"]');
  await search('klic 13');assert.deepEqual(ids(),['wrench-13'],'Czech search ignores diacritics');
  await search('combination wrench');assert.deepEqual(ids(),['wrench-13','wrench-17','wrench-half-inch'],'English names are searchable in Czech UI');
  await search('din 3113');assert.deepEqual(ids(),['wrench-13']);
  await search('xyz-nothing');assert.equal(ids().length,0);assert.ok($('.catalog-results .catalog-empty'));
  await search('');assert.equal(ids().length,4);
  // Size badge in the item's own unit and accuracy tooltip with source + license.
  const half=$('[data-catalog-item="wrench-half-inch"]');
  assert.match(half.querySelector('.catalog-meta').textContent,/ in/);
  assert.match($('[data-catalog-item="wrench-13"] .catalog-meta').textContent,/170 × 32 mm/);
  const badge=$('[data-catalog-item="wrench-13"] .accuracy-badge');
  assert.equal(badge.textContent,'podle normy');assert.match(badge.title,/DIN 3113.*CC0/);
  click('[data-modal-close]');
});

test('adding one item creates a drawer tool with the item unit and depth, plus a fresh id',async()=>{
  const before=saved().tools.length;
  await openCatalog();
  await clickOperation('[data-catalog-add="wrench-half-inch"]');
  assert.ok($('.modal')===null,'modal closes after adding');
  const tools=saved().tools;assert.equal(tools.length,before+1);
  const tool=tools.at(-1);
  assert.equal(tool.name,'Očkoplochý klíč 1/2 in');assert.equal(tool.unit,'in');assert.equal(tool.depth,8);
  assert.ok(tool.id&&!items.some(i=>i.id===tool.id));
  assert.ok(Array.isArray(tool.fingerGrips),'automatic finger grips are generated like for captured tools');
  // Undo works exactly as for any other addTools() call.
  click('#app [data-action="undo"]');assert.equal(saved().tools.length,before);
  click('#app [data-action="redo"]');assert.equal(saved().tools.length,before+1);
});

test('multi-select adds a whole set at once',async()=>{
  const before=saved().tools.length;
  await openCatalog();
  const addSelected=()=>$('[data-catalog-add-selected]');
  assert.equal(addSelected().disabled,true);
  for(const id of ['wrench-13','wrench-17']){const box=$(`[data-catalog-select="${id}"]`);box.checked=true;box.dispatchEvent(new win.Event('change',{bubbles:true}));}
  assert.equal(addSelected().disabled,false);assert.match(addSelected().textContent,/\(2\)/);
  // Selection survives filtering.
  click('[data-catalog-category="pliers"]');click('[data-catalog-category="all"]');
  assert.equal($('[data-catalog-select="wrench-17"]').checked,true);
  await clickOperation(addSelected());
  const tools=saved().tools;assert.equal(tools.length,before+2);
  assert.deepEqual(tools.slice(-2).map(t=>[t.name,t.depth,t.unit]),[['Očkoplochý klíč 13 mm',9,'mm'],['Očkoplochý klíč 17 mm',10,'mm']]);
  assert.notEqual(tools.at(-1).id,tools.at(-2).id);
});

test('save to my tools copies the outline into the user library once',async()=>{
  await openCatalog();
  const count=libraryStore().length;
  await clickOperation('[data-catalog-save="pliers-combi"]');
  const lib=libraryStore();assert.equal(lib.length,count+1);
  assert.equal(lib.at(-1).name,'Kombinované kleště');assert.equal(lib.at(-1).unit,'mm');assert.equal(lib.at(-1).depth,14);
  await clickOperation('[data-catalog-save="pliers-combi"]');assert.equal(libraryStore().length,count+1,'no duplicates');
  assert.equal($('#toast').textContent,'Tento obrys už v mých nástrojích je.');
  click(tab('mine'));
  assert.ok($$('.library-item strong').some(s=>s.textContent.startsWith('Kombinované kleště')));
  click('[data-modal-close]');
});

test('English UI labels, localized names and empty catalogue state',async()=>{
  setLang('en');
  try{
    await openCatalog();
    assert.equal(tab('mine').textContent.trim(),'My tools');assert.equal(tab('catalog').textContent.trim(),'Catalogue');
    assert.equal($('.modal-head h2').textContent,'Your tool library');
    assert.deepEqual($$('[data-catalog-category]').map(b=>b.firstChild.textContent.trim()),['All','Wrenches','Pliers']);
    assert.equal($('[data-catalog-item="wrench-13"] .catalog-name').textContent,'Combination wrench 13 mm');
    assert.equal($('[data-catalog-item="wrench-13"] .accuracy-badge').textContent,'per standard');
    assert.match($('[data-catalog-add-selected]').textContent,/Add selected \(0\)/);
    assert.match($('.modal-foot').textContent,/Outlines are nominal/);
    await search('klíč 17');assert.deepEqual(ids(),['wrench-17'],'Czech names are searchable in English UI');
    await search('');
    assert.equal(filterCatalog(items,{query:'pliers'}).length,1);
    assert.equal(catalogTool(items[0]).name,'Combination wrench 13 mm');
    await clickOperation('[data-catalog-add="wrench-13"]');
    assert.equal(saved().tools.at(-1).name,'Combination wrench 13 mm','tool is named in the current language');
    setCatalogSource(()=>({categories:CATEGORIES,items:[]}));
    await openCatalog();
    assert.match($('.catalog-empty').textContent,/catalogue is empty/);
    click('[data-modal-close]');
  }finally{setLang('cs');setAppUnit('mm');setCatalogSource(async()=>({categories:CATEGORIES,items}));}
});

test('the real catalogue module loads lazily through the default source',async()=>{
  setCatalogSource(null);
  try{
    await openCatalog();
    assert.ok($('.catalog-section')||$('.catalog-empty'),'catalogue renders either sections or the empty state');
    assert.ok($('[role=alert]')===null,'loading the real catalogue must not fail');
    click('[data-modal-close]');
  }finally{setCatalogSource(async()=>({categories:CATEGORIES,items}));}
});
