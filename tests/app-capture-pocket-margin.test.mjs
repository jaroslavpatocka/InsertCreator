import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';
import {effectivePocketMargin} from '../dist/pocket-margin.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const canvases=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;const target=actual(this).getContext('2d');
  return new Proxy(target,{get:(ctx,key)=>key==='drawImage'?((source,...args)=>ctx.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof ctx[key]==='function'?ctx[key].bind(ctx):ctx[key],set:(ctx,key,value)=>(ctx[key]=value,true)});
};
const workers=new Set(),phases=[];
class BrowserWorker{
  constructor(url){
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>{if(data.type==='progress')phases.push(data.phase);this.onmessage?.({data});});
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
const rect=[{x:0,y:0},{x:18,y:0},{x:18,y:30},{x:0,y:30}];
const initial=validateProject({...blankProject(),id:'app-capture-margin',name:'Existující šuplík',width:756,height:504,clearance:.35,
  modules:[{id:'old-a',name:'Původní A',x:0,y:0,width:84,height:84,sizeMode:'manual',grouped:true,pocketMargin:.45},
    {id:'old-b',name:'Původní B',x:84,y:0,width:84,height:84,sizeMode:'manual',grouped:true}],
  tools:[{id:'old-tool-a',name:'Původní nástroj A',moduleId:'old-a',x:20,y:20,points:rect},
    {id:'old-tool-b',name:'Původní nástroj B',moduleId:'old-b',x:104,y:20,points:rect,pocketMargin:.2}].map(tool=>({...tool,rotation:0,depth:8,fingerGrips:[]}))});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current',JSON.stringify(initial.id));
localStorage.setItem('suplik-studio-library-v1','[]');localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
await import('../dist/app.js');
after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;await win.happyDOM.close();});
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const field=$(selector);assert.ok(field,'Expected '+selector);field.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===initial.id);
const logical=project=>{const copy=structuredClone(project);delete copy.updatedAt;return copy;};
function type(selector,value){const field=$(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new win.Event('input',{bubbles:true}));}
function change(selector,value){const field=$(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new win.Event('change',{bubbles:true}));}
async function waitFor(fn,label){const started=performance.now();while(!fn()){if(performance.now()-started>30000)throw Error(label+'; '+($('#capture-error')?.textContent||$('#modal-root')?.textContent||$('#toast')?.textContent));await new Promise(resolve=>setTimeout(resolve,3));}}

test('real app photo capture scopes module margins and exact zero to the new addition, with atomic undo',{timeout:90000},async t=>{
  for(const layout of ['shared','photo','each'])await t.test(layout+' import retains existing drawer and finalizes inherited tool margins before caching',async()=>{
    const before=saved(),oldToolIds=new Set(before.tools.map(tool=>tool.id)),oldModuleIds=new Set(before.modules.map(module=>module.id));
    const inferenceBefore=phases.filter(phase=>phase==='inference').length;
    assert.equal($('#app [data-action="undo"]').disabled,true);
    action('capture');click('#sample-scan');await waitFor(()=>$('[data-name="1"]'),'real sample recognition');
    assert.ok(phases.filter(phase=>phase==='inference').length>inferenceBefore,'the actual ONNX worker must recognize this sample');
    change('#capture-layout',layout);type('#capture-pocket-margin','1.5 mm');
    type('[data-name="0"]',layout+' · nulová vůle');type('[data-name="1"]',layout+' · dědí margin modulu');
    click('#capture-guide-start');type('#capture-guide-margin','0');click('#capture-add');
    await waitFor(()=>saved().tools.length===before.tools.length+2&&!$('#trace-canvas'),'actual app addition and capture close');
    const next=saved(),added=next.tools.filter(tool=>!oldToolIds.has(tool.id)),created=next.modules.filter(module=>!oldModuleIds.has(module.id));
    assert.equal(created.length,layout==='each'?2:1,'the chosen import layout determines the new module count');
    const createdIds=new Set(created.map(module=>module.id));
    assert.ok(created.every(module=>module.pocketMargin===1.5),'every newly created module receives the capture margin');
    assert.ok(added.every(tool=>createdIds.has(tool.moduleId)));
    assert.equal(new Set(added.map(tool=>tool.moduleId)).size,layout==='each'?2:1,'each-tool import keeps its pockets in separate modules');
    assert.equal(added[0].pocketMargin,0);assert.equal(Object.hasOwn(added[1],'pocketMargin'),false,'the temporary inherited packing override must be removed');
    assert.equal(effectivePocketMargin(added[0],next),0);assert.equal(effectivePocketMargin(added[1],next),1.5);
    assert.deepEqual(next.modules.filter(module=>oldModuleIds.has(module.id)),before.modules);
    assert.deepEqual(next.tools.filter(tool=>oldToolIds.has(tool.id)),before.tools);
    assert.equal(next.clearance,.35);assert.equal(next.width,before.width);assert.equal(next.height,before.height);assert.deepEqual(validateLayout(next),[]);
    const library=JSON.parse(localStorage.getItem('suplik-studio-library-v1'));
    const cachedZero=library.find(tool=>tool.name===added[0].name),cachedInherited=library.find(tool=>tool.name===added[1].name);
    assert.ok(cachedZero&&cachedInherited,'the real app must cache the imported tools');assert.equal(cachedZero.pocketMargin,0);assert.equal(Object.hasOwn(cachedInherited,'pocketMargin'),false,'library caching sees the finalized source, not its temporary packing margin');
    action('undo');assert.deepEqual(logical(saved()),logical(before),'one undo restores the entire drawer before capture');assert.equal($('#app [data-action="undo"]').disabled,true,'the capture creates exactly one history entry');
    action('redo');assert.deepEqual(logical(saved()),logical(next),'redo restores module inheritance and exact zero together');
    action('undo');assert.deepEqual(logical(saved()),logical(before));
  });
});
