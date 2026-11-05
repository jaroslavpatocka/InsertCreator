// A known floor-depth error must stop before print-part preparation, including
// when a stale export button is triggered after its disabled state was cleared.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';

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

const {executeManufacturingTask}=await import('../dist/manufacturing-worker.js');
const requests=[];
globalThis.Worker=class{
  postMessage(data){
    requests.push(data);
    queueMicrotask(async()=>{
      if(this.terminated)return;
      try{
        const result=await executeManufacturingTask(data.operation,data.project,data.options||{});
        if(!this.terminated)this.onmessage?.({data:{type:'result',id:data.id,result}});
      }catch(error){if(!this.terminated)this.onmessage?.({data:{type:'error',id:data.id,name:error.name,message:error.message,i18n:error.i18n}});}
    });
  }
  terminate(){this.terminated=true;}
};
const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const fixture={...blankProject(),id:'depth-preflight',name:'Barevné kapsy',width:504,height:378,bedWidth:256,bedHeight:256,insertHeight:20,base:2.4,printMode:'light',bottomMode:'plain',sizeLabels:true,connectors:true,jointClearance:.2,
  multiMaterial:{enabled:true,floor:true,text:true,floorThickness:.6},
  modules:[{id:'deep-module',name:'Příliš hluboká sada',x:0,y:0,width:84,height:84,sizeMode:'manual'},{id:'valid-module',name:'Platný samostatný modul',x:126,y:0,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'deep',name:'Hluboký nástroj',moduleId:'deep-module',points:rect(25,18),x:20,y:20,rotation:0,depth:17.6,fingerGrips:[],nominalSize:{value:13,unit:'mm'},sizeLabel:'13'},
    {id:'valid',name:'Platný nástroj',moduleId:'valid-module',points:rect(25,18),x:146,y:20,rotation:0,depth:8,fingerGrips:[],nominalSize:{value:8,unit:'mm'},sizeLabel:'8'}]};
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([fixture]));localStorage.setItem('suplik-studio-current',JSON.stringify(fixture.id));
const downloads=[];URL.createObjectURL=()=>`blob:http://localhost/export-${downloads.length}`;URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
await import('../dist/app.js');
after(()=>win.happyDOM.abort());

const $=selector=>win.document.querySelector(selector);
const click=selector=>{const node=typeof selector==='string'?$(selector):selector;assert.ok(node,`Missing ${selector}`);node.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===fixture.id);
const stable=project=>{const {updatedAt,...rest}=project;return rest;};
const exports=()=>requests.filter(request=>request.operation==='export');
async function until(predicate,message){const start=performance.now();while(!predicate()){if(performance.now()-start>5000)assert.fail(message+': '+$('#modal-root').textContent);await pause(5);}}
const analyzed=()=>until(()=>$('[data-export-analysis]')?.getAttribute('data-analysis-busy')!=='true','manufacturing analysis must finish');

test('known inlay depth blocks ZIP immediately and after analysis, and stale clicks cannot start preparation',async()=>{
  const before=saved(),exportCount=exports().length;action('export');
  assert.equal($('[data-do-export]').disabled,true,'the known 20.6 mm height requirement blocks ZIP before asynchronous analysis');
  assert.ok($('.modal [data-action="fit-pocket-height"]'));
  assert.match($('.modal').textContent,/20[,.]6/);
  await analyzed();assert.equal($('[data-do-export]').disabled,true,'an analysis reply cannot re-enable the invalid export');
  const stale=$('[data-do-export]');stale.disabled=false;stale.click();await pause(120);
  assert.equal(exports().length,exportCount,'the export entry point independently checks the selected pocket depths');
  assert.equal(downloads.length,0);assert.deepEqual(stable(saved()),stable(before),'blocked exports cannot alter project geometry');
  assert.ok($('.modal [data-action="fit-pocket-height"]'),'recovery stays available instead of a print-progress modal');
});

test('the explicit height repair enables an actual ZIP and remains a single undo step',async()=>{
  const before=saved(),count=downloads.length;click('.modal [data-action="fit-pocket-height"]');
  assert.equal(saved().insertHeight,20.6);assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().multiMaterial,before.multiMaterial);
  await analyzed();assert.equal($('[data-do-export]').disabled,false);click('[data-do-export]');
  await until(()=>downloads.length===count+1,'a repaired project should export a real ZIP');
  assert.ok(exports().some(request=>request.project.insertHeight===20.6));assert.match(downloads.at(-1),/-tiskove-dily\.zip$/);
  await until(()=>!$('[data-action="undo"]').disabled,'closing export must refresh history');action('undo');
  assert.deepEqual(stable(saved()),stable(before));assert.equal($('[data-action="undo"]').disabled,true,'preparation and download must not add history entries');
});

test('an unselected deep module does not block exporting a valid selected module',async()=>{
  const before=saved(),count=downloads.length;action('export');
  const deep=$('[data-export-module="deep-module"]');assert.ok(deep);deep.checked=false;deep.dispatchEvent(new win.Event('change',{bubbles:true}));
  await analyzed();assert.equal($('[data-do-export]').disabled,false,'preflight only considers the selected modules');
  assert.equal($('.modal [data-action="fit-pocket-height"]'),null,'an unselected deep module cannot add an irrelevant height correction');click('[data-do-export]');
  await until(()=>downloads.length===count+1,'the valid selection should export');
  assert.deepEqual(exports().at(-1).options.moduleIds,['valid-module']);assert.deepEqual(stable(saved()),stable(before));
});
