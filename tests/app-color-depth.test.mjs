// Existing projects can retain a full-depth pocket before a coloured floor is enabled.
// The editor must offer an explicit, reversible height fix rather than changing the tool.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';
import {setCatalogSource} from '../dist/catalog-ui.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='webgl2'?gl:null;};

const posted=[];
globalThis.Worker=class{
  constructor(url){this.url=String(url);}
  postMessage(data){
    posted.push({url:this.url,data});
    if(!this.url.endsWith('/mesh-worker.js'))return;
    queueMicrotask(()=>{
      if(this.terminated)return;
      try{
        const batch=Object.hasOwn(data,'batch')?data.batch:previewBatch(data.project);
        const result=data.type==='plan'?{batch}:{...moduleMesh(data.project,data.moduleId,batch),joints:batch?.jointPlan?.joints.length||0,unjoined:batch?.jointPlan?.unjoined.length||0};
        this.onmessage?.({data:{id:data.id,result}});
      }catch(error){this.onmessage?.({data:{id:data.id,error:{message:error.message,i18n:error.i18n||null}}});}
    });
  }
  terminate(){this.terminated=true;}
};

const fixture={...blankProject(),id:'deep-colour-floor',name:'Barevné dno',width:252,height:168,insertHeight:20,base:2.4,printMode:'light',bottomMode:'plain',sizeLabels:false,multiMaterial:{enabled:true,floor:true,text:false,floorThickness:.6},
  modules:[{id:'m',name:'Modul klíče',x:0,y:0,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'deep',name:'Očkoplochý klíč 27 mm',moduleId:'m',points:[{x:0,y:0},{x:25,y:0},{x:25,y:18},{x:0,y:18}],x:20,y:20,rotation:0,depth:17.6,fingerGrips:[]}]};
const overLimit={...structuredClone(fixture),id:'height-over-limit',name:'Přes limit výšky',insertHeight:100,multiMaterial:{...fixture.multiMaterial,floorThickness:2},tools:fixture.tools.map(tool=>({...tool,depth:97.6}))};
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([fixture,overLimit]));localStorage.setItem('suplik-studio-current',JSON.stringify(fixture.id));
await import('../dist/app.js');
after(()=>{setCatalogSource(null);win.happyDOM.abort();});

const $=selector=>win.document.querySelector(selector);
const click=selector=>{const node=$(selector);assert.ok(node,`Missing ${selector}`);node.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===fixture.id);
const stable=project=>{const {updatedAt,...rest}=project;return rest;};
async function until(predicate,description){
  const start=performance.now();
  while(!predicate()){
    if(performance.now()-start>3000)assert.fail(description+': '+$('[data-preview-state]')?.textContent);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
}

test('an existing too-deep coloured pocket has an explicit one-undo height fix and then a complete 3D model',async()=>{
  const before=saved();assert.equal($('[data-action="undo"]').disabled,true);
  action('3d');
  await until(()=>$('[data-preview-state][data-preview-busy="false"]'),'the invalid model should display its recovery action');
  assert.deepEqual(stable(saved()),stable(before),'opening 3D must not silently change saved geometry');
  assert.equal($('#board-svg').getAttribute('aria-hidden'),'true');
  const fix=$('[data-preview-state] [data-action="fit-pocket-height"]');assert.ok(fix,'the depth error offers a height repair');
  assert.match(fix.textContent,/20[,.]6/);
  fix.click();
  await until(()=>$('#board-svg').dataset.meshReady==='1/1','the corrected coloured model should finish');
  const after=saved(),expected={...stable(before),insertHeight:20.6};
  assert.deepEqual(stable(after),expected,'the repair preserves pocket depth, floor thickness, contours and placements');
  assert.equal($('#board-svg').hasAttribute('aria-hidden'),false);assert.equal($('[data-preview-state]').hidden,true);
  assert.ok(posted.some(job=>job.data.type==='mesh'&&job.data.project.insertHeight===20.6),'the repaired dimensions reach mesh generation');
  action('undo');
  assert.deepEqual(stable(saved()),stable(before));assert.equal($('[data-action="undo"]').disabled,true,'the repair creates one history entry');
  action('2d');
});

test('the export colour controls offer the same explicit correction without changing the project on open',async()=>{
  const before=saved();action('export');
  assert.deepEqual(stable(saved()),stable(before),'opening manufacturing settings is read-only');
  const fix=$('.modal [data-action="fit-pocket-height"]');assert.ok(fix,'the floor settings expose the required height');
  fix.click();
  assert.equal(saved().insertHeight,20.6);assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().multiMaterial,before.multiMaterial);
  click('[data-modal-close]');await until(()=>!$('[data-action="undo"]').disabled,'closing export should refresh the editor history controls');action('undo');
  assert.deepEqual(stable(saved()),stable(before));assert.equal($('[data-action="undo"]').disabled,true);
});

test('single and bulk pocket depth fields reserve the enabled floor inlay',()=>{
  click('[data-select="deep"]');
  const input=$('[data-field="depth"][data-scope="tool"]');assert.ok(input);assert.equal(Number(input.dataset.max),17);
  const before=saved();input.value='17.6';input.dispatchEvent(new win.Event('change',{bubbles:true}));
  assert.deepEqual(stable(saved()),stable(before),'the too-deep value cannot add a history entry');
  action('select-all-tools');action('bulk-depth');
  const bulk=$('.modal [data-field="bulkDepth"]');assert.ok(bulk);assert.equal(Number(bulk.dataset.max),17);
  click('[data-modal-close]');action('select-no-tools');
});

test('a floor requiring more than the maximum insert height cannot offer an invalid height repair',async()=>{
  click('[data-drawer-open="height-over-limit"]');action('3d');
  await until(()=>$('[data-preview-state][data-preview-busy="false"]'),'an over-limit inlay must finish with an actionable error');
  assert.equal($('[data-preview-state] [data-action="fit-pocket-height"]'),null,'the editor must not propose a height above its 100 mm project limit');
  assert.ok($('[data-preview-state] [data-action="retry-preview"]'));
  const stored=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===overLimit.id);
  assert.equal(stored.insertHeight,100);assert.equal(stored.tools[0].depth,97.6);assert.equal(stored.multiMaterial.floorThickness,2);
});

test('a newly added catalogue tool reserves the floor without rewriting existing pocket depths',async()=>{
  action('2d');click('[data-drawer-open="deep-colour-floor"]');
  const before=saved(),item={id:'deep-catalog-key',category:'wrenches',name:{cs:'Hluboký katalogový klíč',en:'Deep catalogue wrench'},points:fixture.tools[0].points,depth:40,unit:'mm',accuracy:'standard',source:{name:'Test',license:'CC0'}};
  setCatalogSource(async()=>({categories:[{id:'wrenches',cs:'Klíče',en:'Wrenches'}],items:[item],sets:[],setsCategory:{id:'sets',cs:'Sady nářadí',en:'Tool sets'}}));
  action('library');
  const catalog=$('[data-library-folder="catalog"]');assert.ok(catalog);if(catalog.getAttribute('aria-selected')!=='true')catalog.click();
  await until(()=>$('[data-catalog-add="deep-catalog-key"]'),'the fixture catalogue item should be available');
  click('[data-catalog-add="deep-catalog-key"]');
  await until(()=>saved().tools.length>before.tools.length,'the catalogue insertion should finish after showing its loading state');
  const after=saved(),oldIds=new Set(before.tools.map(tool=>tool.id)),added=after.tools.filter(tool=>!oldIds.has(tool.id));
  assert.equal(added.length,1);assert.equal(added[0].depth,17,'new pockets keep room for the 0.6 mm floor inlay');
  assert.equal(after.tools.find(tool=>tool.id==='deep').depth,17.6,'existing user pockets remain unchanged');
  assert.equal(after.insertHeight,20);assert.deepEqual(after.multiMaterial,before.multiMaterial);
  if($('[data-modal-close]'))click('[data-modal-close]');
});
