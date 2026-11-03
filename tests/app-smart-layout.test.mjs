import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {validateProject} from '../dist/model.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {screwdriverProject} from './fixtures/smart-tools.mjs';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

const workers=new Set(),created=[],realResults=[],held=[];let nextMode='normal';
class BrowserWorker{
  constructor(url){
    this.mode=nextMode;nextMode='normal';this.terminated=false;created.push(this);
    this.url=String(url);
    // A failed module load exercises the real Worker error path, not a fake result.
    const target=this.mode==='load-error'?new URL('./missing-smart-backend.mjs',import.meta.url):url;
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(target)}});workers.add(this);
    this.inner.on('message',data=>{
      if(data.type==='result')realResults.push(data.result);
      if(this.mode==='hold-result'&&data.type==='result'){
        // Preserve a real optimizer response already queued before cancellation.
        const handler=this.onmessage;held.push(()=>handler?.({data}));
      }else this.onmessage?.({data});
    });
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){this.terminated=true;workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
function fixture(id,seed,options){return validateProject({...screwdriverProject(seed,options),id,name:id});}
// Central shaft grips let narrow handles fit a single 42 mm cell. Wider handles keep this
// lifecycle fixture a genuine area-saving shared arrangement, rather than forcing pointless merging.
const sharedProject=fixture('smart-normal',41,{slanted:false});
sharedProject.tools=sharedProject.tools.map(tool=>{
  const next={...tool,points:tool.points.map(p=>({...p,x:p.x*1.5})),x:0,y:0,moduleId:null};
  next.fingerGrips=automaticFingerGrips(next);return next;
});
sharedProject.modules=[];Object.assign(sharedProject,autoArrange(sharedProject));
const protectedProject=fixture('smart-protected',47);
protectedProject.modules[0].locked=true;
protectedProject.tools.filter(t=>t.moduleId===protectedProject.modules[0].id).forEach(t=>t.locked=true);
protectedProject.modules[1].sizeMode='manual';
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([fixture('smart-english',57),sharedProject,fixture('smart-cancel',43),fixture('smart-stale',44),fixture('smart-failure',45),protectedProject,fixture('smart-limited',53,{count:25,width:1260,height:1260}),fixture('smart-partial',42,{width:210,height:210})]));
localStorage.setItem('suplik-studio-current',JSON.stringify('smart-normal'));
localStorage.setItem('suplik-studio-smart-mode',JSON.stringify('compact'));
localStorage.setItem('suplik-studio-lang',JSON.stringify('cs'));
localStorage.setItem('suplik-studio-unit',JSON.stringify('mm'));
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const serialized=()=>localStorage.getItem('suplik-studio-projects-v1');
const history=()=>({undo:$('#app [data-action=undo]').disabled,redo:$('#app [data-action=redo]').disabled});
const logical=p=>{const result=structuredClone(p);delete result.updatedAt;return result;};
const area=p=>p.modules.reduce((sum,m)=>sum+(m.width-.5)*(m.height-.5),0);
const memberships=p=>p.modules.filter(m=>m.grouped).map(m=>({id:m.id,tools:p.tools.filter(t=>t.moduleId===m.id).map(t=>t.id).sort()})).sort((a,b)=>a.id.localeCompare(b.id));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label,timeout=20000){const started=performance.now();while(!predicate()){if(performance.now()-started>timeout)throw Error(label+'; '+($('#modal-root').textContent||$('#toast').textContent));await pause(5);}}
function open(id){if($('[data-smart-close]'))click('[data-smart-close]');action('projects');click(`[data-open="${id}"]`);}
function start(){
  const snapshot=serialized(),undo=history();action('smart-layout');
  assert.ok($('[data-smart-progress]'),'progress must be visible immediately');assert.ok($('[data-smart-cancel]'));
  assert.equal(serialized(),snapshot,'starting a computation must not save anything');assert.deepEqual(history(),undo);
  return{snapshot,undo};
}
async function completed(){await waitFor(()=>$('[data-smart-close]'),'real smart worker did not finish');}
function unchanged({snapshot,undo}){assert.equal(serialized(),snapshot);assert.deepEqual(history(),undo);}
function sameToolGeometry(before,after){
  for(const tool of before.tools){const next=after.tools.find(t=>t.id===tool.id);assert.ok(next);for(const key of ['points','depth','fingerGrips','name'])assert.deepEqual(next[key],tool[key]);}
}
await import('../dist/app.js');

test('smart layout UI uses real workers and applies only valid, reversible results',{timeout:120000},async t=>{
  t.after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;await win.happyDOM.close();});
  await t.test('an actual improvement is one undo, persists shared groups, survives normal Auto and can be split',async()=>{
    open('smart-normal');const before=saved(),count=realResults.length;start();await completed();
    assert.ok(realResults.length>count,'the bundled optimizer must really run in the worker');
    assert.ok(created.at(-1).url.endsWith('/smart-layout-worker.js'));assert.ok(realResults.at(-1).stats.savedPercent>0);
    const optimized=saved();assert.ok(area(optimized)<area(before));assert.ok(optimized.modules.some(m=>m.grouped));assert.deepEqual(validateLayout(optimized),[]);sameToolGeometry(before,optimized);
    assert.match($('.smart-layout-result').textContent,/Úspora plochy/);click('[data-smart-close]');
    action('undo');assert.deepEqual(logical(saved()),logical(before));assert.equal(history().undo,true,'the whole optimization is exactly one undo step');
    action('redo');assert.deepEqual(logical(saved()),logical(optimized));
    action('auto');assert.deepEqual(memberships(saved()),memberships(optimized));sameToolGeometry(optimized,saved());assert.deepEqual(validateLayout(saved()),[]);

    // Import the saved JSON through the public file-input route, including model normalization.
    const persisted=saved(),file=new win.File([JSON.stringify({schemaVersion:1,project:persisted})],'smart-project.json',{type:'application/json'}),input=$('#project-file');
    Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new win.Event('change'));
    await waitFor(()=>saved().id!==persisted.id,'portable grouped project was not imported');
    assert.deepEqual(memberships(saved()),memberships(persisted));action('auto');assert.deepEqual(memberships(saved()),memberships(persisted));
    const group=saved().modules.find(m=>m.grouped&&saved().tools.filter(t=>t.moduleId===m.id).length>1),members=saved().tools.filter(t=>t.moduleId===group.id);
    click(`[data-select="${members[0].id}"]`);action('lock');const locked=serialized(),lockedHistory=history();action('split-module');
    assert.equal(serialized(),locked,'a locked group must not be split');assert.deepEqual(history(),lockedHistory);action('undo');
    const joined=saved();action('split-module');
    assert.ok(!saved().modules.some(m=>m.id===group.id));assert.equal(new Set(members.map(t=>saved().tools.find(n=>n.id===t.id).moduleId)).size,members.length);sameToolGeometry(joined,saved());assert.deepEqual(validateLayout(saved()),[]);
    action('undo');assert.deepEqual(logical(saved()),logical(joined));assert.ok(saved().modules.find(m=>m.id===group.id).grouped);
  });

  await t.test('cancelling an active real worker leaves data and undo untouched',async()=>{
    open('smart-cancel');const count=created.length,snapshot=start();
    await waitFor(()=>created.length>count,'the real worker must start before cancellation');click('[data-smart-cancel]');
    await waitFor(()=>!$('[data-smart-progress]'),'cancelled progress must close');await pause(20);
    assert.equal(created.at(-1).terminated,true);unchanged(snapshot);
  });

  await t.test('a real completed response queued before cancellation cannot resurrect stale data',async()=>{
    open('smart-stale');nextMode='hold-result';const snapshot=start();
    await waitFor(()=>held.length>0,'the optimizer did not produce a genuine delayed result');assert.ok($('[data-smart-progress]'));unchanged(snapshot);
    click('[data-smart-cancel]');while(held.length)held.shift()();await pause(20);
    unchanged(snapshot);assert.equal($('#modal-root').children.length,0,'a stale result must not reopen a completed dialog');
  });

  await t.test('a real worker module failure is shown without saving or creating an undo entry',async()=>{
    open('smart-failure');nextMode='load-error';const snapshot=start();await completed();
    assert.match($('.smart-layout-result').textContent,/nepodařilo/);unchanged(snapshot);assert.equal(created.at(-1).terminated,true);click('[data-smart-close]');
    assert.equal($('#app [data-action=smart-layout]').disabled,false,'the action remains usable after a worker failure');
  });

  await t.test('real optimization preserves locked modules and manual dimensions and group geometry',async()=>{
    open('smart-protected');const before=saved(),locked=before.modules.find(m=>m.locked),manual=before.modules.find(m=>m.sizeMode==='manual'),count=realResults.length;
    start();await completed();assert.ok(realResults.length>count);assert.doesNotMatch($('.smart-layout-result').textContent,/nepodařilo/);
    const after=saved();assert.deepEqual(after.modules.find(m=>m.id===locked.id),locked);
    for(const tool of before.tools.filter(t=>t.moduleId===locked.id))assert.deepEqual(after.tools.find(t=>t.id===tool.id),tool);
    const resized=after.modules.find(m=>m.id===manual.id);assert.equal(resized.width,manual.width);assert.equal(resized.height,manual.height);assert.equal(resized.sizeMode,'manual');
    for(const tool of before.tools.filter(t=>t.moduleId===manual.id)){
      const next=after.tools.find(t=>t.id===tool.id);assert.equal(next.moduleId,manual.id);assert.equal(next.rotation,tool.rotation);
      assert.ok(Math.abs((next.x-resized.x)-(tool.x-manual.x))<.001);assert.ok(Math.abs((next.y-resized.y)-(tool.y-manual.y))<.001);
    }
    sameToolGeometry(before,after);assert.deepEqual(validateLayout(after),[]);
  });

  await t.test('the real bounded-search limit explains the unchanged result without saving it',async()=>{
    open('smart-limited');const count=realResults.length,snapshot=start();await completed();
    assert.ok(realResults.length>count);assert.equal(realResults.at(-1).stats.changed,false);
    assert.match($('.smart-layout-result').textContent,/příliš velká|rychlé vnoření/,'the user must see the actual search limit rather than a generic failure');
    unchanged(snapshot);assert.equal(saved().tools.length,25);
  });

  await t.test('a partial improvement places more tools even when its physical module area increases',async()=>{
    open('smart-partial');const before=saved();
    const placed=p=>{
      const modules=p.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=p.width+1e-6&&m.y+m.height<=p.height+1e-6),ids=new Set(modules.map(m=>m.id));
      return{modules,tools:p.tools.filter(t=>ids.has(t.moduleId))};
    };
    const originalPlaced=placed(before);assert.equal(originalPlaced.tools.length,1);
    start();await completed();const after=saved(),newPlaced=placed(after);
    assert.ok(newPlaced.tools.length>originalPlaced.tools.length,'the real improvement must be applied rather than rejected for its remaining outside module; '+$('.modal-body').textContent);
    assert.ok(newPlaced.tools.length<after.tools.length,'this fixture must exercise a partial result with an unplaced remainder');
    assert.ok(area(after)>area(before),'placing more tools takes priority over a smaller module area');
    for(const tool of originalPlaced.tools)assert.ok(newPlaced.tools.some(t=>t.id===tool.id),'a formerly placed tool must never be lost');
    assert.equal(after.tools.length,before.tools.length);sameToolGeometry(before,after);
    assert.deepEqual(validateLayout({...after,modules:newPlaced.modules,tools:newPlaced.tools}),[],'every actually placed pocket and module must be valid');
    assert.match($('.smart-layout-result').textContent,new RegExp(`${originalPlaced.tools.length} → ${newPlaced.tools.length}`));assert.match($('.smart-layout-result').textContent,/Plocha modulů vzrostla/);assert.doesNotMatch($('.smart-layout-result h3').textContent,/Úspora/);
    click('[data-smart-close]');action('undo');assert.deepEqual(logical(saved()),logical(before));assert.equal(history().undo,true,'the whole partial improvement must be one reversible edit');
  });

  await t.test('English smart layout reports square inches while preserving every metric tool and module setting',async()=>{
    open('smart-english');const before=saved();
    click('[data-action="set-lang"][data-value="en"]');click('[data-action="set-unit"][data-value="in"]');
    assert.equal($('#app [data-action=smart-layout]').textContent.trim(),'Smart layout');
    start();await completed();const after=saved(),text=$('.smart-layout-result').textContent;
    assert.match(text,/Area saved:/);assert.match(text,/Outer module footprints:/);assert.match(text,/in²/);assert.doesNotMatch(text,/mm²|Úspora|Umístěné/);
    const displayed=(area(before)/645.16).toLocaleString('en-US',{maximumFractionDigits:2});assert.ok(text.includes(displayed),'the displayed area must actually convert mm² to in²');
    sameToolGeometry(before,after);assert.deepEqual(validateLayout(after),[]);
    for(const original of before.tools)assert.equal(after.tools.find(t=>t.id===original.id).unit,original.unit);
    assert.ok(after.modules.every(m=>m.unit==='mm'),'source module unit overrides survive regrouping');
    click('[data-smart-close]');action('undo');assert.deepEqual(logical(saved()),logical(before));
  });
});
