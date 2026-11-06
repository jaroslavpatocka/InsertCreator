import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
const style=win.document.createElement('style');style.textContent=await fs.readFile(new URL('../dist/style.css',import.meta.url),'utf8');win.document.head.append(style);
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
Object.defineProperty(win.navigator,'hardwareConcurrency',{value:4,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');

const gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='webgl2'?gl:null;};
const jobs=[];
globalThis.Worker=class{
  constructor(url){this.url=String(url);}
  postMessage(message){jobs.push({worker:this,message,replied:false});}
  terminate(){this.terminated=true;}
};

const {blankProject}=await import('../dist/model.js');
const fixture=(id,count)=>({...blankProject(),id,name:id,width:504,height:378,printMode:'solid',modules:Array.from({length:count},(_,i)=>({id:`${id}-m${i}`,name:`Modul ${i+1}`,x:i*84,y:0,width:84,height:84})),tools:[]});
const project=fixture('five-modules',5),failedProject=fixture('failed-module',1);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([project,failedProject]));localStorage.setItem('suplik-studio-current',JSON.stringify(project.id));
await import('../dist/app.js');
after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.happyDOM.abort();});

const $=selector=>win.document.querySelector(selector);
const action=name=>{const button=$(`#app [data-action="${name}"]`);assert.ok(button,`Missing ${name} action`);button.click();};
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
const meshJobs=()=>jobs.filter(job=>job.worker.url.endsWith('/mesh-worker.js')&&job.message.type==='mesh');
const reply=({error}={})=>{
  const job=meshJobs().find(job=>!job.replied);assert.ok(job,'A mesh worker must be waiting');job.replied=true;
  const result={vertices:new Float32Array(18),ranges:[{zone:'body',first:0,count:3}],facets:1,parts:1,joints:0,unjoined:0};
  job.worker.onmessage({data:error?{id:job.message.id,error:{message:error}}:{id:job.message.id,result}});
};

test('3D keeps partial models hidden behind loading and safely returns from 2D to cached meshes',async()=>{
  action('3d');
  assert.ok($('#board-area').classList.contains('preview-loading'));
  assert.equal($('#board-area').getAttribute('data-preview-busy'),'true');
  assert.equal($('#board-svg').getAttribute('aria-hidden'),'true');
  assert.match($('[data-preview-state]').textContent,/Načítání 3D náhledu/);
  assert.ok($('[data-preview-state] .preview-spinner'),'loading has a visible spinner');
  assert.equal($('[data-preview-state] progress').max,5);assert.equal($('[data-preview-state] progress').value,0);
  assert.equal(win.getComputedStyle($('#board-svg')).visibility,'hidden');
  assert.equal(win.getComputedStyle($('.board-gl')).visibility,'hidden');
  assert.equal(win.getComputedStyle($('.view-3d-hint')).visibility,'hidden');
  reply();await flush();
  assert.equal($('#board-svg').dataset.meshReady,'1/5');
  assert.ok($('#board-area').classList.contains('preview-loading'),'one completed module must not expose a partial model');
  assert.equal($('[data-preview-state] progress').value,1);
  action('2d');
  assert.equal($('#board-area').classList.contains('preview-loading'),false);assert.equal($('#board-svg').hasAttribute('aria-hidden'),false);
  for(let i=0;i<4;i++)reply();await flush();
  assert.equal($('[data-preview-state]'),null,'background 3D completion must not insert loading into the 2D view');
  assert.equal($('#board-svg').classList.contains('view-3d'),false);
  const requested=meshJobs().length;action('3d');
  assert.equal($('#board-svg').dataset.meshReady,'5/5');
  assert.equal($('#board-area').classList.contains('preview-loading'),false);assert.equal($('#board-area').getAttribute('data-preview-busy'),'false');
  assert.equal($('#board-svg').hasAttribute('aria-hidden'),false);assert.equal($('[data-preview-state]').hidden,true);
  assert.notEqual(win.getComputedStyle($('#board-svg')).visibility,'hidden');assert.notEqual(win.getComputedStyle($('.board-gl')).visibility,'hidden');
  action('2d');action('3d');assert.equal(meshJobs().length,requested,'cached re-entry starts no mesh workers');
});

test('a failed mesh keeps the incomplete model hidden and a successful retry reveals it',async()=>{
  const drawer=$('[data-drawer-open="failed-module"]');assert.ok(drawer);drawer.click();
  assert.ok($('#board-area').classList.contains('preview-loading'));
  reply({error:'Mesh unavailable'});await flush();
  assert.equal($('#board-area').classList.contains('preview-loading'),true);
  assert.equal($('#board-area').getAttribute('data-preview-busy'),'false');assert.equal($('#board-svg').getAttribute('aria-hidden'),'true');
  assert.equal($('[data-preview-state]').hidden,false);assert.equal($('[data-preview-state]').getAttribute('data-preview-busy'),'false');
  assert.match($('[data-preview-state]').textContent,/Mesh unavailable/);assert.equal($('[data-preview-state] progress'),null);
  assert.equal($('[data-preview-state] .preview-spinner'),null);
  assert.match($('[data-preview-state]').textContent,/3D náhled se nepodařilo dokončit/);
  assert.equal(win.getComputedStyle($('#board-svg')).visibility,'hidden');assert.equal(win.getComputedStyle($('.board-gl')).visibility,'hidden');
  action('retry-preview');
  assert.equal($('#board-area').getAttribute('data-preview-busy'),'true');assert.ok($('[data-preview-state] .preview-spinner'));
  reply();await flush();
  assert.equal($('#board-svg').dataset.meshReady,'1/1');assert.equal($('#board-area').classList.contains('preview-loading'),false);
  assert.equal($('#board-svg').hasAttribute('aria-hidden'),false);assert.equal($('[data-preview-state]').hidden,true);
});
