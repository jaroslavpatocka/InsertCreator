// Shared filter bar of both library folders: kind, several categories at once, collapsible sections, sets in "Moje nástroje".
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
// A legacy library: no category or set fields, so categories come from the names.
const legacy=[['Šroubovák PH2',rect(150,30)],['Očkoplochý klíč 13 mm',rect(170,32)],['Kombinované kleště',rect(180,55)],['Moje záhadná věc',rect(60,60)]].map(([name,points],i)=>({id:'legacy-'+i,name,points,depth:10,x:0,y:0,rotation:0}));
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');localStorage.setItem('suplik-studio-library-v1',JSON.stringify(legacy));
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

const {setCatalogSource,libraryData}=await import('../dist/catalog-ui.js');
const {setLang}=await import('../dist/i18n.js');
await import('../dist/app.js');

const $=s=>win.document.querySelector(s);
const $$=s=>[...win.document.querySelectorAll(s)];
const click=s=>{const el=typeof s==='string'?$(s):s;assert.ok(el,'Missing '+s);el.click();};
const waitFor=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('Timed out waiting for UI');await new Promise(r=>setTimeout(r,10));}};
const tab=id=>$(`[data-library-folder="${id}"]`);
const sectionIds=()=>$$('[data-catalog-section]').map(el=>el.dataset.catalogSection);
const openSections=()=>$$('[data-section-toggle][aria-expanded="true"]').map(el=>el.dataset.sectionToggle);
const setIds=()=>$$('[data-catalog-set]').map(el=>el.dataset.catalogSet);
const toolNames=()=>$$('.library-item strong').map(el=>el.textContent);
const libraryStore=()=>JSON.parse(localStorage.getItem('suplik-studio-library-v1')||'[]');
const chip=id=>`.catalog-chip[data-catalog-category="${id}"]`;
async function open(folder){click('#app [data-action="library"]');if(tab(folder).getAttribute('aria-selected')!=='true')click(tab(folder));await waitFor(()=>$('.catalog-section')||$('.catalog-empty'));}
async function search(text){const input=$('[data-catalog-search]');input.value=text;input.dispatchEvent(new win.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,170));}
const reset=()=>{if($('[data-catalog-reset]'))click('[data-catalog-reset]');};

after(()=>{setLang('cs');setCatalogSource(null);});

test('real catalogue: a compact overview first, then only sets of screwdrivers and sockets',async()=>{
  const m=await import('../dist/catalog/index.js'),wanted=m.catalogSets().filter(s=>['screwdrivers','sockets'].includes(s.category));
  await open('catalog');
  assert.equal($$('.catalog-item').length,0,'an unfiltered long list starts collapsed');
  assert.equal(openSections().length,0);assert.ok(sectionIds().length>=8);
  click('[data-catalog-kind="sets"]');click(chip('screwdrivers'));click(chip('sockets'));
  assert.deepEqual(sectionIds(),['sockets','screwdrivers'],'exactly the two chosen categories');
  assert.deepEqual(openSections(),['sockets','screwdrivers'],'a narrowed list opens by itself');
  assert.deepEqual(setIds().sort(),wanted.map(s=>s.id).sort());
  assert.equal($$('[data-catalog-item]').length,0,'no single outlines');
  assert.equal($(chip('sockets')).getAttribute('aria-pressed'),'true');
  // A second click removes one category, "Vše" removes the rest.
  click(chip('sockets'));assert.deepEqual(sectionIds(),['screwdrivers']);
  click(chip('all'));assert.ok(sectionIds().length>=8);
  reset();assert.equal($('[data-catalog-reset]'),null,'nothing left to clear');
  click('[data-modal-close]');
});

test('sections collapse one by one and all at once; a new filter opens them again',async()=>{
  await open('catalog');
  click('[data-section-toggle="pliers"]');
  assert.deepEqual(openSections(),['pliers']);assert.ok($('[data-catalog-section="pliers"] .catalog-item'));
  assert.equal(win.document.activeElement?.dataset?.sectionToggle,'pliers','focus stays on the toggle');
  click('[data-section-toggle="pliers"]');assert.equal(openSections().length,0);
  click('[data-sections="open"]');assert.equal(openSections().length,sectionIds().length);
  click('[data-sections="closed"]');assert.equal(openSections().length,0);assert.equal($$('.catalog-item').length,0);
  click(chip('pliers'));assert.deepEqual(openSections(),['pliers'],'"Sbalit vše" must not hide a freshly filtered list');
  click('[data-section-toggle="pliers"]');assert.equal(openSections().length,0);
  reset();await search('kleste');assert.ok(openSections().includes('pliers'),'a search result is never hidden');
  reset();click('[data-modal-close]');
});

test('"Zobrazit obsah sad" opens every listed set and "Sbalit vše" closes them',async()=>{
  await open('catalog');
  click('[data-catalog-kind="sets"]');click(chip('pliers'));
  assert.equal($$('.catalog-set-members').length,0);
  click('[data-sets-open="true"]');assert.equal($$('.catalog-set-members').length,setIds().length);
  assert.ok($('[data-sets-open="false"]'));
  click('[data-sections="closed"]');click('[data-sections="open"]');assert.equal($$('.catalog-set-members').length,0);
  reset();click('[data-modal-close]');
});

test('English labels of the filter bar',async()=>{
  setLang('en');
  try{
    await open('catalog');
    assert.deepEqual($$('[data-catalog-kind]').map(b=>b.firstChild.textContent.trim()),['All','Sets','Single tools']);
    assert.equal($('[data-sections="open"]').textContent,'Expand all');assert.equal($('[data-sections="closed"]').textContent,'Collapse all');
    assert.equal($('[data-sets-open]').textContent,'Show set contents');
    click(chip('pliers'));assert.equal($('[data-catalog-reset]').textContent,'Clear filters');
    reset();click('[data-modal-close]');
  }finally{setLang('cs');}
});

test('"Moje nástroje" groups an old library by the tool names, with search and category filters',async()=>{
  await open('mine');
  assert.deepEqual(sectionIds(),['wrenches','screwdrivers','pliers','other']);
  assert.equal($('[data-catalog-kind]'),null,'no sets yet, so no kind filter');
  assert.equal($$('.library-item').length,4,'a short library is open');
  click(chip('screwdrivers'));click(chip('pliers'));assert.equal($$('.library-item').length,2);assert.deepEqual(sectionIds(),['screwdrivers','pliers']);
  reset();await search('sroubovak');assert.equal($$('.library-item').length,1);assert.match(toolNames()[0],/Šroubovák PH2/);
  reset();click('[data-section-toggle="other"]');assert.equal($('[data-catalog-section="other"] .library-item'),null);
  click('[data-section-toggle="other"]');
  click('[data-modal-close]');
});

test('removing a tool keeps the filters of "Moje nástroje" and adding still uses the right tool',async()=>{
  await open('mine');
  click(chip('pliers'));
  const count=libraryStore().length;
  click('[data-section-toggle="pliers"]');click('[data-section-toggle="pliers"]');
  const target=$('[data-catalog-section="pliers"] [data-library-remove]');assert.equal(libraryStore()[Number(target.dataset.libraryRemove)].name,'Kombinované kleště');
  click(target);
  assert.equal(libraryStore().length,count-1);assert.ok($('.modal'),'stays open');
  assert.ok(!sectionIds().includes('pliers'));assert.equal($(chip('pliers')),null);
  assert.equal($('[data-library-folder="mine"]').getAttribute('aria-selected'),'true');
  const add=[...$$('[data-library-add]')].find(b=>libraryStore()[Number(b.dataset.libraryAdd)].name==='Moje záhadná věc');assert.ok(add,'indexes still point at the library');
  click('[data-modal-close]');
});

const moveTo=(name,category)=>{const select=$$('[data-library-category]').find(s=>libraryStore()[Number(s.dataset.libraryCategory)].name===name);assert.ok(select,'Missing category of '+name);select.value=category;select.dispatchEvent(new win.Event('change',{bubbles:true}));};

test('a tool moved to another category stays there and keeps the card focused',async()=>{
  await open('mine');
  const select=$$('[data-library-category]').find(s=>libraryStore()[Number(s.dataset.libraryCategory)].name==='Moje záhadná věc');
  assert.equal(select.querySelector('option[selected]').value,'other','the card shows the current category');
  moveTo('Moje záhadná věc','striking');
  assert.equal(libraryStore().find(t=>t.name==='Moje záhadná věc').category,'striking');
  assert.ok(sectionIds().includes('striking'));assert.ok(!sectionIds().includes('other'));
  assert.ok($('[data-catalog-section="striking"] .library-item'));
  assert.ok(win.document.activeElement?.hasAttribute('data-library-category'),'focus stays on the moved tool');
  assert.equal($('#toast').textContent,'Nástroj přesunut do kategorie Kladiva a průbojníky.');
  click('[data-modal-close]');
  await open('mine');assert.ok(sectionIds().includes('striking'),'the choice survives reopening');
  moveTo('Moje záhadná věc','other');assert.equal(libraryStore().find(t=>t.name==='Moje záhadná věc').category,'other','"Ostatní" is a choice too');
  click('[data-modal-close]');
});

test('a catalogue set saved to "Moje nástroje" is listed as a collapsible set; a shared tool keeps both sets',async()=>{
  const items=[8,10,13].map(s=>({id:'w-'+s,category:'wrenches',name:{cs:`Očkoplochý klíč ${s} mm`,en:`Combination wrench ${s} mm`},points:rect(100+s*5,20+s),depth:9,unit:'mm',size:s,tags:[],accuracy:'standard',source:{name:'x',license:'CC0'}}));
  const sets=[{id:'small',category:'wrenches',name:{cs:'Malá sada',en:'Small set'},items:['w-8','w-10'],unit:'mm',source:{name:'x'}},{id:'big',category:'wrenches',name:{cs:'Velká sada',en:'Big set'},items:['w-8','w-10','w-13'],unit:'mm',source:{name:'x'}}];
  setCatalogSource(async()=>({categories:[{id:'wrenches',cs:'Klíče',en:'Wrenches'}],items,sets}));
  try{
    await open('catalog');click('[data-set-save="small"]');click('[data-set-save="big"]');
    const stored=libraryStore().find(t=>t.name==='Očkoplochý klíč 8 mm');
    assert.deepEqual(stored.setNames,['Malá sada','Velká sada']);assert.equal(stored.category,'wrenches');
    click(tab('mine'));
    const names=()=>$$('[data-library-set]').map(el=>el.querySelector('strong').textContent);
    assert.deepEqual(names(),['Malá sada','Velká sada']);
    const loose=toolNames();assert.ok(!loose.some(n=>n.startsWith('Očkoplochý klíč 8 mm')),'set members are not repeated as loose tools');
    click('[data-library-set-toggle="set:Velká sada"]');
    assert.equal($$('[data-library-set="set:Velká sada"] .library-item').length,3);
    click('[data-catalog-kind="sets"]');assert.ok(!toolNames().some(n=>n.startsWith('Očkoplochý klíč 13')===false&&n.startsWith('Šroubovák')),'only sets');
    click('[data-catalog-kind="items"]');assert.equal($$('[data-library-set]').length,0);assert.ok(toolNames().some(n=>n.startsWith('Očkoplochý klíč 13 mm')));
    click('[data-catalog-kind="all"]');await search('13');
    assert.ok($$('[data-library-set="set:Velká sada"] .library-item').length>0,'search opens the set holding the match');
    reset();click('[data-modal-close]');
  }finally{setCatalogSource(null);}
});

test('moving a tool of a set moves the whole set and leaves other tools alone',async()=>{
  await open('mine');
  click('[data-catalog-kind="items"]');
  moveTo('Očkoplochý klíč 8 mm','measuring');
  const category=name=>libraryStore().find(t=>t.name===name&&(t.setNames||!name.startsWith('Očko'))).category;
  assert.deepEqual([8,10,13].map(s=>category(`Očkoplochý klíč ${s} mm`)),['measuring','measuring','measuring']);
  assert.notEqual(category('Šroubovák PH2'),'measuring');
  assert.equal($('#toast').textContent,'Sada přesunuta do kategorie Měření a značení.');
  click('[data-catalog-kind="all"]');
  assert.equal($$('[data-catalog-section="measuring"] [data-library-set]').length,2);
  reset();click('[data-modal-close]');
});

test('libraryData keeps library indexes and derives sets',()=>{
  const data=libraryData([{name:'Klíč 10',points:rect(9,9),setNames:['A','B']},{name:'Kladivo',points:rect(9,9),category:'striking',unit:'in'}]);
  assert.deepEqual(data.items.map(i=>[i.index,i.category,i.unit]),[[0,'wrenches','mm'],[1,'striking','in']]);
  assert.deepEqual(data.sets.map(s=>[s.name,s.tools.length]),[['A',1],['B',1]]);
});
