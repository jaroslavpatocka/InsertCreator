import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';
import {executeManufacturingTask} from '../dist/manufacturing-worker.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=callback=>nativeTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const prefix='';
localStorage.setItem(prefix+'suplik-studio-lang','"cs"');localStorage.setItem(prefix+'suplik-studio-unit','"mm"');
const drawnColors=[];
const gl=new Proxy({},{get:(_,name)=>name==='getUniformLocation'?((program,key)=>key):name==='uniform3fv'?((key,value)=>{if(key==='color')drawnColors.push([...value]);}):name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='webgl2'?gl:null;};
const posted=[];
globalThis.Worker=class{
  constructor(url){this.url=String(url);}
  postMessage(data){posted.push({url:this.url,data});queueMicrotask(async()=>{
    if(this.terminated)return;
    try{
      if(this.url.endsWith('/mesh-worker.js')){
        const batch=Object.hasOwn(data,'batch')?data.batch:previewBatch(data.project);
        const result=data.type==='plan'?{batch}:{...moduleMesh(data.project,data.moduleId,batch),joints:batch?.jointPlan?.joints.length||0,unjoined:batch?.jointPlan?.unjoined.length||0};
        if(!this.terminated)this.onmessage?.({data:{id:data.id,result}});
      }else{
        const result=await executeManufacturingTask(data.operation,data.project,data.options||{});
        if(!this.terminated)this.onmessage?.({data:{type:'result',id:data.id,result}});
      }
    }catch(error){if(!this.terminated)this.onmessage?.({data:{type:'error',id:data.id,error:{message:error.message},message:error.message,name:error.name}});}
  });}
  terminate(){this.terminated=true;}
};
const fixture={...blankProject(),id:'manufacturing-controls',name:'V?robn? nastaven?',width:252,height:168,bedWidth:100,bedHeight:100,insertHeight:20,base:2.4,printMode:'solid',bottomMode:'plain',connectors:false,sizeLabels:false,
  modules:[{id:'m',name:'Dvojit? modul',x:0,y:0,width:168,height:84,sizeMode:'manual',locked:true}],
  tools:[{id:'t',name:'Kl??',moduleId:'m',points:[{x:0,y:0},{x:25,y:0},{x:25,y:18},{x:0,y:18}],x:20,y:20,rotation:0,depth:8,fingerGrips:[]}]};
localStorage.setItem(prefix+'suplik-studio-projects-v1',JSON.stringify([fixture]));localStorage.setItem(prefix+'suplik-studio-current',JSON.stringify(fixture.id));
await import('../dist/app.js');
after(()=>win.happyDOM.abort());
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const node=$(selector);assert.ok(node,'Missing '+selector);node.click();};
const action=name=>click('#app [data-action="'+name+'"]');
const change=(selector,value)=>{const node=$(selector);assert.ok(node,'Missing '+selector);if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);node.dispatchEvent(new win.Event('change',{bubbles:true}));};
const store=()=>localStorage.getItem(prefix+'suplik-studio-projects-v1');
const saved=()=>JSON.parse(store()).find(project=>project.id===fixture.id);
const history=()=>[$('#app [data-action="undo"]').disabled,$('#app [data-action="redo"]').disabled];
async function until(predicate,message){const start=performance.now();while(!predicate()){if(performance.now()-start>5000)assert.fail(message);await new Promise(resolve=>nativeTimeout(resolve,5));}}
const meshJobs=()=>posted.filter(job=>job.data.type==='mesh');

test('export contains only manufacturing selection controls and returns to main 3D settings',async()=>{
  const before=store(),undo=history();action('export');
  for(const selector of ['#print-light','#print-bottom','#print-colors','#export-connectors','#preview-cuts','[data-fit-pdf]','[data-fit-stl]'])assert.equal($('.modal '+selector),null,selector+' belongs beside the main model');
  assert.ok($('.modal [data-format="stl"]'));assert.ok($('.modal [data-export-module="m"]'));assert.ok($('.modal [data-field="bedWidth"]'));assert.ok($('.modal [data-export-preview]'));
  click('[data-model-settings]');assert.equal($('.modal'),null);assert.ok($('#board-svg').classList.contains('view-3d'));assert.ok($('#manufacturing-settings #print-light'));

  assert.equal(store(),before);assert.deepEqual(history(),undo);await until(()=>$('#board-svg').dataset.meshReady==='1/1','main mesh should finish after returning from export');
});

test('main print construction and bottom controls reach the live mesh and remain undoable',async()=>{
  const original=structuredClone(saved()),count=meshJobs().length;change('#print-light',true);
  await until(()=>meshJobs().slice(count).some(job=>job.data.project.printMode==='light'),'light geometry must replace the solid preview');
  assert.equal(saved().printMode,'light');assert.deepEqual(saved().tools,original.tools);assert.deepEqual(saved().modules,original.modules);
  change('#print-bottom','adhesive');await until(()=>meshJobs().some(job=>job.data.project.bottomMode==='adhesive'),'chosen bottom must reach preview');assert.equal(saved().bottomMode,'adhesive');
  action('undo');assert.equal(saved().bottomMode,'plain');action('undo');assert.equal(saved().printMode,'solid');
});

test('bed-cut visibility is a display choice and does not change saved geometry or history',async()=>{
  const before=store(),undo=history();change('#preview-cuts',true);
  assert.equal($('#preview-cuts').checked,true);assert.equal(store(),before);assert.deepEqual(history(),undo);
  await until(()=>posted.some(job=>job.data.project?.previewCuts===true),'cut visibility must reach preview generation');
  change('#preview-cuts',false);assert.equal(store(),before);assert.deepEqual(history(),undo);
});

test('material enablement and zone colors refresh the live manufacturing preview',async()=>{
  change('#print-colors',true);await until(()=>meshJobs().some(job=>job.data.project.multiMaterial?.enabled),'multimaterial geometry must reach preview');
  await until(()=>$('#board-svg').dataset.meshReady==='1/1','colored mesh should finish');const count=drawnColors.length;change('[data-zone-color="floorColor"]','#1267ab');
  assert.equal(saved().multiMaterial.floorColor,'#1267ab');await until(()=>drawnColors.slice(count).some(color=>color.every((value,index)=>Math.abs(value-[18,103,171][index]/255)<1e-6)),'color edits must reach the GPU surface color');
  const before=store();action('export');assert.equal($('.modal #print-colors'),null);assert.equal(store(),before);click('[data-modal-close]');
});
