import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {createDemoProject,autoArrange,validateLayout} from '../dist/geometry.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {findToolSets,setCoherence} from '../dist/tool-sets.js';
import {screwdriverProject} from './fixtures/smart-tools.mjs';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const workers=new Set(),created=[],held=[];let holdNext=false;
class BrowserWorker{
  constructor(url){const layout=String(url).endsWith('/smart-layout-worker.js');this.hold=layout&&holdNext;if(layout){holdNext=false;created.push(this);}this.sent=[];this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>{if(this.hold&&data.type==='result'){const handler=this.onmessage;held.push(()=>handler?.({data}));}else this.onmessage?.({data});});
    this.inner.on('error',error=>this.onerror?.({error,message:error.message,preventDefault(){}}));this.inner.on('messageerror',error=>this.onmessageerror?.({error}));this.inner.on('exit',()=>workers.delete(this));}
  postMessage(message){this.sent.push(message);this.inner.postMessage(message);}
  terminate(){this.terminated=true;workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
const blobURLs=new Map(),downloads=[];URL.createObjectURL=blob=>{const url=`blob:http://localhost/sets-${blobURLs.size}`;blobURLs.set(url,blob);return url;};URL.revokeObjectURL=url=>blobURLs.delete(url);
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobURLs.get(this.href)});};
function dissimilar(id){
  const demo=createDemoProject(),tools=['tool-pliers','tool-hex','tool-caliper'].map(id=>{const t={...structuredClone(demo.tools.find(t=>t.id===id)),locked:false,moduleId:null,x:0,y:0,rotation:0};t.fingerGrips=automaticFingerGrips(t);return t;});
  const p={...blankProject(),id,name:id,width:630,height:420,bedWidth:500,bedHeight:500,printMode:'solid',tools};return validateProject({...p,...autoArrange(p)});
}
const projects=[dissimilar('sets-manual'),dissimilar('sets-members'),validateProject({...screwdriverProject(63,{bed:500}),id:'sets-suggested'}),validateProject({...screwdriverProject(64,{bed:500}),id:'sets-cancel'}),validateProject({...screwdriverProject(65,{bed:500}),id:'sets-stale'}),validateProject({...screwdriverProject(66,{bed:220}),id:'sets-unavailable'})];
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current',JSON.stringify('sets-manual'));
const $=selector=>win.document.querySelector(selector),click=selector=>{const el=$(selector);assert.ok(el,'Missing '+selector);el.click();},action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current'))),serialized=()=>localStorage.getItem('suplik-studio-projects-v1');
const logical=p=>{const copy=structuredClone(p);delete copy.updatedAt;return copy;},history=()=>({undo:$('#app [data-action=undo]').disabled,redo:$('#app [data-action=redo]').disabled});
const change=(selector,value)=>{const el=$(selector);assert.ok(el,'Missing '+selector);if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label,timeout=30000){const start=performance.now();while(!fn()){if(performance.now()-start>timeout)throw Error(label+'; '+($('#modal-root').textContent||$('#toast').textContent));await pause(5);}}
function open(id){if($('[data-smart-close]'))click('[data-smart-close]');if($('[data-tool-sets-close]'))click('[data-tool-sets-close]');action('projects');click(`[data-open="${id}"]`);}
function fillSet(name,ids,layout){change('[data-field=setName]',name);change('[data-set-layout]',layout);for(const el of win.document.querySelectorAll('[data-set-tool]')){el.checked=ids.includes(el.dataset.setTool);el.dispatchEvent(new win.Event('change',{bubbles:true}));}click('[data-set-save]');assert.ok($('[data-tool-sets-close]'),'The set must save without a validation error');}
function createSet(name,ids,layout='auto'){action('tool-sets');click('[data-new-set]');fillSet(name,ids,layout);const set=saved().toolSets.find(s=>s.name===name);click('[data-tool-sets-close]');return set;}
function assertGeometry(before,after){assert.deepEqual(after.tools.map(t=>({id:t.id,points:t.points,depth:t.depth,fingerGrips:t.fingerGrips})),before.tools.map(t=>({id:t.id,points:t.points,depth:t.depth,fingerGrips:t.fingerGrips})));}
async function optimize(){action('smart-layout');click('[data-smart-default]');assert.ok($('[data-smart-progress]'),'Progress must appear before work starts');await waitFor(()=>$('[data-smart-close]'),'The real set worker must finish');}
localStorage.setItem('suplik-studio-lang',JSON.stringify('cs'));
localStorage.setItem('suplik-studio-unit',JSON.stringify('mm'));
await import('../dist/app.js');

test('project tool sets are editable, reversible and respected by real worker layouts',{timeout:120000},async t=>{
  t.after(async()=>{await Promise.all([...workers].map(w=>w.terminate()));delete globalThis.Worker;await win.happyDOM.close();});
  await t.test('manual dissimilar tools form exact uniform and whole shared sets without changing raw shapes',async()=>{
    open('sets-manual');assert.equal(JSON.parse(localStorage.getItem('suplik-studio-smart-mode')),'sets');
    const before=saved(),ids=before.tools.map(t=>t.id);assert.ok(!findToolSets(before).sets.some(s=>s.source==='suggested'&&ids.every(id=>s.toolIds.includes(id))),'This manual set deliberately combines different profiles');
    click(`[data-select="${ids[0]}"]`);action('tool-set-current');assert.ok($(`[data-set-tool="${ids[0]}"]`).checked);
    fillSet('Moje různorodé nástroje',ids,'uniform');const metadata=saved();assert.deepEqual(metadata.tools,before.tools);assert.deepEqual(metadata.modules,before.modules);click('[data-tool-sets-close]');
    const set=metadata.toolSets[0];assert.equal(set.layout,'uniform');await optimize();assert.equal(created.at(-1).sent[0].mode,'sets');
    const uniform=saved(),modules=ids.map(id=>uniform.modules.find(m=>m.id===uniform.tools.find(t=>t.id===id).moduleId));
    assert.equal(new Set(modules.map(m=>m.id)).size,ids.length);assert.equal(new Set(modules.map(m=>`${m.width}x${m.height}`)).size,1);assert.ok(modules.every(m=>m.setId===set.id&&m.setLayout==='uniform'));
    assert.ok(setCoherence(uniform,findToolSets(uniform).sets).satisfied.includes(set.id));assert.match($('.smart-layout-result').textContent,/Sady sjednoceny/);assert.deepEqual(validateLayout(uniform),[]);assertGeometry(before,uniform);click('[data-smart-close]');
    action('undo');assert.deepEqual(logical(saved()),logical(metadata));action('redo');assert.deepEqual(logical(saved()),logical(uniform));
    action('tool-sets');click(`[data-set-edit="${set.id}"]`);fillSet('Společná ruční sada',ids,'shared');const sharedMetadata=saved();click('[data-tool-sets-close]');await optimize();
    const shared=saved(),module=shared.modules.find(m=>m.id===shared.tools.find(t=>t.id===ids[0]).moduleId);
    assert.ok(ids.every(id=>shared.tools.find(t=>t.id===id).moduleId===module.id));assert.ok(module.grouped);assert.equal(module.setLayout,'shared');assert.equal(module.setId,set.id);assertGeometry(before,shared);assert.deepEqual(validateLayout(shared),[]);click('[data-smart-close]');
    action('undo');assert.deepEqual(logical(saved()),logical(sharedMetadata));action('redo');
    const count=downloads.length;action('save-project');await waitFor(()=>downloads.length>count,'Set JSON backup');const json=await downloads.at(-1).blob.text();assert.deepEqual(JSON.parse(json).project.toolSets,shared.toolSets);
    const input=$('#project-file');Object.defineProperty(input,'files',{value:[new win.File([json],'sets.json',{type:'application/json'})],configurable:true});input.dispatchEvent(new win.Event('change'));await waitFor(()=>saved().id!==shared.id,'Import set JSON');delete input.files;
    assert.deepEqual(saved().toolSets,shared.toolSets);await optimize();assert.ok(setCoherence(saved(),findToolSets(saved()).sets).satisfied.includes(set.id));click('[data-smart-close]');
  });
  await t.test('membership moves, renames and deletion are metadata edits and duplicated tools are unassigned',()=>{
    open('sets-members');const before=saved(),ids=before.tools.map(t=>t.id),a=createSet('Sada A',ids.slice(0,2)),b=createSet('Sada B',ids.slice(1));
    assert.deepEqual(saved().toolSets.find(s=>s.id===a.id).toolIds,[ids[0]]);assert.deepEqual(saved().toolSets.find(s=>s.id===b.id).toolIds,ids.slice(1));assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);
    action('tool-sets');click(`[data-set-edit="${a.id}"]`);fillSet('Přejmenovaná sada', [ids[0]],'auto');click('[data-tool-sets-close]');assert.equal(saved().toolSets.find(s=>s.id===a.id).name,'Přejmenovaná sada');action('undo');assert.equal(saved().toolSets.find(s=>s.id===a.id).name,'Sada A');
    action('tool-sets');click(`[data-set-delete="${a.id}"]`);click('[data-tool-sets-close]');assert.ok(!saved().toolSets.some(s=>s.id===a.id));assert.deepEqual(saved().tools,before.tools);action('undo');assert.ok(saved().toolSets.some(s=>s.id===a.id));
    click(`[data-select="${ids[1]}"]`);action('delete');assert.deepEqual(saved().toolSets.find(s=>s.id===b.id).toolIds,[ids[2]],'Single-member sets remain, deleted IDs do not');action('undo');
    click(`[data-select="${ids[0]}"]`);action('duplicate');const copy=saved().tools.at(-1);assert.notEqual(copy.id,ids[0]);assert.ok(saved().toolSets.every(s=>!s.toolIds.includes(copy.id)));action('undo');assert.deepEqual(saved().tools,before.tools);
  });
  await t.test('similarity suggestions require review and global layout mode survives reopening',()=>{
    open('sets-suggested');const snapshot=serialized();action('tool-sets');assert.equal(serialized(),snapshot);const proposal=$('[data-suggested-set]');assert.ok(proposal);assert.ok(!saved().toolSets);
    proposal.querySelector('[data-set-adopt]').click();assert.equal(serialized(),snapshot,'Reviewing a suggestion must not store it');const selected=[...win.document.querySelectorAll('[data-set-tool]:checked')].map(el=>el.dataset.setTool);assert.ok(selected.length>=2);
    fillSet('Převzaté šroubováky',selected.slice(0,-1),'uniform');assert.equal(saved().toolSets[0].name,'Převzaté šroubováky');assert.deepEqual(saved().toolSets[0].toolIds,selected.slice(0,-1));
    const metadata=serialized();change('[data-smart-mode]','compact');assert.equal(JSON.parse(localStorage.getItem('suplik-studio-smart-mode')),'compact');click('[data-tool-sets-close]');action('tool-sets');assert.equal($('[data-smart-mode]').value,'compact');assert.equal(serialized(),metadata);
    change('[data-smart-mode]','sets');click('[data-tool-sets-close]');assert.equal(JSON.parse(localStorage.getItem('suplik-studio-smart-mode')),'sets');
  });
  await t.test('an oversized whole shared set is arranged without changing its saved printer settings',async()=>{
    open('sets-unavailable');const ids=saved().tools.map(t=>t.id);createSet('Celá sada na malé tiskárně',ids,'shared');const snapshot=serialized(),before=logical(saved()),undo=history();
    await optimize();assert.notEqual(serialized(),snapshot);assert.equal(saved().modules.length,1);assert.ok(saved().modules[0].grouped);assert.deepEqual(validateLayout(saved()),[]);
    assert.deepEqual([saved().limitToBed,saved().bedWidth,saved().bedHeight],[true,220,220]);
    assert.doesNotMatch($('.smart-layout-result').textContent,/tiskovou plochu|stejné moduly/);click('[data-smart-close]');
    action('undo');assert.deepEqual(logical(saved()),before);assert.equal(history().undo,undo.undo);
  });
  await t.test('cancellation and a real stale sets response cannot overwrite user edits',async()=>{
    open('sets-cancel');let snapshot=serialized(),undo=history(),count=created.length;action('smart-layout');click('[data-smart-default]');assert.ok($('[data-smart-progress]'));await waitFor(()=>created.length>count,'Start a real sets worker');click('[data-smart-cancel]');assert.ok(created.at(-1).terminated);assert.equal(serialized(),snapshot);assert.deepEqual(history(),undo);
    open('sets-stale');holdNext=true;const heldCount=held.length;action('smart-layout');click('[data-smart-default]');await waitFor(()=>held.length>heldCount,'Hold a real sets optimization result');
    const originalWidth=saved().width;change('#app [data-field=width]',originalWidth+42);snapshot=serialized();undo=history();held.pop()();await waitFor(()=>$('[data-smart-close]'),'Reject stale set result');assert.match($('.smart-layout-result').textContent,/během výpočtu změnila/);assert.equal(serialized(),snapshot);assert.deepEqual(history(),undo);click('[data-smart-close]');action('undo');assert.equal(saved().width,originalWidth);
  });
  await t.test('English set controls keep user names intact and report aligned layouts in square inches',async()=>{
    open('sets-members');click('[data-action="set-lang"][data-value="en"]');click('[data-action="set-unit"][data-value="in"]');
    action('tool-sets');assert.match($('#modal-root').textContent,/My sets/);assert.match($('#modal-root').textContent,/Shape suggestions/);assert.doesNotMatch($('#modal-root').textContent,/\$\{tr\(/);
    click('[data-new-set]');assert.match($('#modal-root').textContent,/Set name/);assert.match($('#modal-root').textContent,/Set members/);assert.doesNotMatch($('#modal-root').textContent,/Název sady|Členové sady/);
    const ids=saved().tools.map(t=>t.id);fillSet('Sady nástrojů',ids,'uniform');
    assert.ok([...win.document.querySelectorAll('.tool-set-card h4')].some(el=>el.textContent==='Sady nástrojů'),'a user name matching a translation key must stay untouched');
    change('[data-smart-mode]','sets');click('[data-tool-sets-close]');const before=saved();await optimize();
    const after=saved(),text=$('.smart-layout-result').textContent;assert.match(text,/Tool sets aligned/);assert.match(text,/Aligned sets:/);assert.match(text,/in²/);assert.doesNotMatch(text,/Sady sjednoceny|mm²|\$\{tr\(/);
    assertGeometry(before,after);assert.deepEqual(after.toolSets,before.toolSets);assert.deepEqual(validateLayout(after),[]);
  });
});
