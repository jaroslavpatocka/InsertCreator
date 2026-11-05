import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {simpleOutline} from '../dist/finger-grip.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const canvases=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);
  if(canvas.width!==element.width)canvas.width=element.width;
  if(canvas.height!==element.height)canvas.height=element.height;
  return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const ctx=actual(this).getContext('2d');
  return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});
};
const photographed=[{x:12.5,y:18.25,width:20,height:80},{x:75,y:40,width:25,height:60},{x:130.75,y:120.5,width:35,height:75}];
let fixturePhoto=photographed;
globalThis.Worker=class{
  constructor(url){
    this.url=String(url);this.terminated=false;
    if(!/\/(?:recognize|neural)-worker\.js$/.test(this.url))throw Error('Non-capture workers use the normal small-project fallback');
  }
  postMessage(message){queueMicrotask(()=>{
    if(this.terminated)return;
    if(this.url.endsWith('/neural-worker.js'))return this.onmessage?.({data:{type:'error',id:message.id,message:'Deterministic editor photo fixture'}});
    const scale=message.options.pxPerMm;
    const contours=fixturePhoto.map(({x,y,width,height})=>({points:[{x:x*scale,y:y*scale},{x:(x+width)*scale,y:y*scale},{x:(x+width)*scale,y:(y+height)*scale},{x:x*scale,y:(y+height)*scale}]}));
    this.onmessage?.({data:{result:{contours,mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
  });}
  terminate(){this.terminated=true;}
};
function fixture(id,width,height){
  return {...blankProject(),id,name:id,width,height,tools:[],modules:[{id:`filler-${id}`,name:'Původní modul',x:0,y:0,width:42,height:42,locked:false,sizeMode:'manual'}]};
}
const projects=[fixture('photo-large',504,378),fixture('photo-keep',84,84),fixture('photo-grow',84,84),fixture('photo-new',84,84),fixture('photo-reject',504,378),fixture('photo-single',504,378)];
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));
localStorage.setItem('suplik-studio-current',JSON.stringify(projects[0].id));
localStorage.setItem('suplik-studio-library-v1','[]');
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
await import('../dist/app.js');
after(async()=>{delete globalThis.Worker;await win.happyDOM.close();});

const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const allSaved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1'));
const saved=()=>allSaved().find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const logical=project=>{const result=structuredClone(project);delete result.updatedAt;return result;};
const change=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);if(element.type==='checkbox')element.checked=value;else element.value=value;element.dispatchEvent(new win.Event('change',{bubbles:true}));};
const type=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.value=value;element.dispatchEvent(new win.Event('input',{bubbles:true}));};
async function waitFor(fn,message){const start=performance.now();while(!fn()){if(performance.now()-start>8000)throw Error('Timed out: '+message+'; '+$('#modal-root').textContent);await new Promise(resolve=>setTimeout(resolve,3));}}
function open(id){action('projects');click(`[data-open="${id}"]`);return saved();}
function approximate(actualValue,expected,message){assert.ok(Math.abs(actualValue-expected)<.001,`${message}: ${actualValue}, expected ${expected}`);}
async function preparePhoto(){
  action('capture');click('#sample-scan');await waitFor(()=>$('[data-name="2"]'),'three recognised tools');
  change('#capture-layout','photo');change('[data-item="1"]',false);
  type('[data-name="0"]','Dílenský klíč');type('[data-depth="0"]','8,5');
  type('[data-name="2"]','Ráčna 3/8');type('[data-depth="2"]','12');
}
async function importPhoto(){
  await preparePhoto();
  click('#capture-add');await waitFor(()=>saved().tools.length===2,'photo module committed');
  return saved();
}
function photoModule(project){const ids=new Set(project.tools.map(tool=>tool.moduleId));assert.equal(ids.size,1,'all photographed tools belong to one module');const module=project.modules.find(module=>ids.has(module.id));assert.ok(module);assert.equal(module.grouped,true);assert.equal(module.sizeMode,'manual');return module;}
function assertArrangement(project){
  const module=photoModule(project);assert.deepEqual(project.tools.map(tool=>tool.name),['Dílenský klíč','Ráčna 3/8']);
  assert.deepEqual(project.tools.map(tool=>tool.depth),[8.5,12]);assert.ok(project.tools.every(tool=>tool.rotation===0));
  assert.ok(project.tools.every(tool=>Array.isArray(tool.fingerGrips)&&tool.fingerGrips.length===0),'photo import does not add unrequested grips that change its spacing');
  approximate(project.tools[1].x-project.tools[0].x,118.25,'photographed horizontal offset');
  approximate(project.tools[1].y-project.tools[0].y,102.25,'photographed vertical offset');
  for(const [index,source] of [photographed[0],photographed[2]].entries()){
    assert.deepEqual(project.tools[index].points,simpleOutline([{x:0,y:0},{x:source.width,y:0},{x:source.width,y:source.height},{x:0,y:source.height}]),'imported tool keeps its measured outline');
  }
  return module;
}
function assertInside(project){const module=photoModule(project);assert.ok(module.x>=0&&module.y>=0&&module.x+module.width<=project.width+.001&&module.y+module.height<=project.height+.001,'the entire photo module is inside the drawer');assert.deepEqual(validateLayout(project),[]);}
function assertHistory(before,after){action('undo');assert.deepEqual(logical(saved()),logical(before),'one undo removes the complete photo import');action('redo');assert.deepEqual(logical(saved()),logical(after),'one redo restores its complete layout');}

test('photo import adds a persistent rigid module in one history step without moving prior modules',async()=>{
  const before=saved(),after=await importPhoto();await waitFor(()=>!$('#modal-root').children.length,'successful capture closes');
  assert.equal(after.modules.length,2);assertArrangement(after);assertInside(after);
  assert.deepEqual(after.modules.find(module=>module.id===before.modules[0].id),before.modules[0],'existing unlocked filler module stays unchanged');
  const reloaded=validateProject(JSON.parse(JSON.stringify(after)));assertArrangement(reloaded);
  const arranged={...reloaded,...autoArrange(reloaded)};assertArrangement(arranged);assertInside(arranged);
  assertHistory(before,after);
});

test('a module that does not fit stays whole when kept outside and undo removes the complete import',async()=>{
  const before=open('photo-keep'),pending=await importPhoto();
  await waitFor(()=>$('[data-fit="keep"]'),'the fit dialog remains visible after onAdd');
  const module=assertArrangement(pending);assert.ok(module.x>=pending.width||module.y>=pending.height,'the whole module is parked outside');
  assert.deepEqual(pending.modules.find(module=>module.id===before.modules[0].id),before.modules[0]);
  click('[data-fit="keep"]');assert.equal($('#modal-root').children.length,0);assert.deepEqual(logical(saved()),logical(pending));assertArrangement(saved());
  assertHistory(before,pending);
});

test('growing the drawer places the intact photographed module and remains part of the same undo step',async()=>{
  const before=open('photo-grow');await importPhoto();await waitFor(()=>$('[data-fit="grow"]'),'grow fit option');
  assert.equal($('[data-fit="grow"]').disabled,false);click('[data-fit="grow"]');
  const grown=saved();assert.equal($('#modal-root').children.length,0);assertArrangement(grown);assertInside(grown);
  assert.ok(grown.width>before.width||grown.height>before.height);
  assert.deepEqual(grown.modules.find(module=>module.id===before.modules[0].id),before.modules[0]);
  assertHistory(before,grown);
});

test('moving an oversized photo module to a new drawer keeps its arrangement and restores the original drawer',async()=>{
  const before=open('photo-new');await importPhoto();await waitFor(()=>$('[data-fit="new"]'),'new drawer fit option');
  assert.equal($('[data-fit="new"]').disabled,false);click('[data-fit="new"]');
  const fresh=saved();assert.notEqual(fresh.id,before.id);assert.equal($('#modal-root').children.length,0);assertArrangement(fresh);assertInside(fresh);
  assert.equal(fresh.modules.length,1,'the new drawer carries only the photo module');
  assert.deepEqual(logical(allSaved().find(project=>project.id===before.id)),logical(before),'the original drawer returns to its pre-import state');
});

test('insufficient photographed wall spacing rejects atomically and lets the same drafts use ordinary shared packing',async()=>{
  const before=open('photo-reject'),library=localStorage.getItem('suplik-studio-library-v1');
  const history=()=>({undo:$('#app [data-action="undo"]').disabled,redo:$('#app [data-action="redo"]').disabled});
  const priorHistory=history();
  // The raw outlines are separated by 1.75 mm, but their clearance and required
  // wall do not fit. Preserving them must fail rather than inventing more space.
  fixturePhoto=[photographed[0],photographed[1],{...photographed[2],x:34.25,y:20}];
  try{
    await preparePhoto();click('#capture-add');
    await waitFor(()=>$('#capture-error')?.textContent.includes('Rozložení z fotky nelze zachovat'),'wall spacing rejection');
    assert.deepEqual(saved(),before,'rejection does not persist any partial project changes');
    assert.deepEqual(history(),priorHistory,'rejection creates no undo or redo entry');
    assert.equal(localStorage.getItem('suplik-studio-library-v1'),library,'rejection does not cache any tools in the library');
    assert.ok($('#trace-canvas'),'the original capture stays open');assert.equal($('#capture-layout').value,'photo');
    assert.equal($('[data-name="0"]').value,'Dílenský klíč');assert.equal($('[data-name="2"]').value,'Ráčna 3/8');
    assert.equal($('[data-depth="0"]').value,'8,5');assert.equal($('[data-item="1"]').checked,false);assert.equal($('#capture-add').disabled,false);
    change('#capture-layout','shared');click('#capture-add');await waitFor(()=>saved().tools.length===2,'retry with normal shared packing');
    await waitFor(()=>!$('#modal-root').children.length,'successful repacking closes capture');
    const packed=saved();assert.deepEqual(packed.tools.map(tool=>tool.name),['Dílenský klíč','Ráčna 3/8']);assert.deepEqual(packed.tools.map(tool=>tool.depth),[8.5,12]);
    assert.equal(new Set(packed.tools.map(tool=>tool.moduleId)).size,1);assert.deepEqual(validateLayout(packed),[]);
    assertHistory(before,packed);
  }finally{fixturePhoto=photographed;$('#modal-root [data-modal-close]')?.click();}
});

test('excluding every tool but one still uses the explicit photo module branch',async()=>{
  const before=open('photo-single');await preparePhoto();change('[data-item="0"]',false);
  assert.equal($('#capture-layout').value,'photo');click('#capture-add');await waitFor(()=>saved().tools.length===1,'single selected photo tool');
  await waitFor(()=>!$('#modal-root').children.length,'single photo import closes');
  const after=saved(),module=photoModule(after),tool=after.tools[0];assert.equal(after.modules.length,2);
  assert.equal(tool.name,'Ráčna 3/8');assert.equal(tool.depth,12);assert.equal(tool.rotation,0);assert.deepEqual(tool.fingerGrips,[]);
  assert.deepEqual(tool.points,simpleOutline([{x:0,y:0},{x:35,y:0},{x:35,y:75},{x:0,y:75}]));
  assert.equal(module.grouped,true);assert.equal(module.sizeMode,'manual');assertInside(after);
  assert.deepEqual(after.modules.find(module=>module.id===before.modules[0].id),before.modules[0]);assertHistory(before,after);
});
