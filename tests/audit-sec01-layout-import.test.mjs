import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';

const prefix='';
const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>{const id=nativeTimeout(fn,ms,...args);if(ms>=4000)id.unref?.();return id;};
globalThis.requestAnimationFrame=fn=>nativeTimeout(()=>fn(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const square=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
const previous={...blankProject(),id:'previous',name:'Previous safe project',modules:[{id:'m',name:'M',x:0,y:0,width:84,height:84}],tools:[{id:'safe',name:'Safe',moduleId:'m',x:20,y:20,points:square}]};
localStorage.setItem(prefix+'suplik-studio-projects-v1',JSON.stringify([previous]));localStorage.setItem(prefix+'suplik-studio-current',JSON.stringify('previous'));
await import('../dist/app.js');
after(async()=>{await win.happyDOM.close();});
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for rejected import');await pause(10);}}

test('actual file-input import rejects layout budget failure before switching or persisting',async t=>{
  const before=localStorage.getItem(prefix+'suplik-studio-projects-v1'),current=localStorage.getItem(prefix+'suplik-studio-current');
  const hostile={...blankProject(),modules:[{id:'m',x:0,y:0,width:210,height:210}],tools:Array.from({length:1000},(_,i)=>({id:'t'+i,name:'audit'+i,moduleId:'m',x:20,y:20,points:square,fingerGrips:[]}))};
  const json=JSON.stringify({schemaVersion:1,app:'InsertCreator',project:hostile}),input=document.querySelector('#project-file');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:json.length,name:'overlaps.json',text:async()=>json}]});
  let heartbeat=false;nativeTimeout(()=>{heartbeat=true;},0);const start=performance.now();input.dispatchEvent(new win.Event('change',{bubbles:true}));delete input.files;
  await until(()=>document.querySelector('.modal [role=alert]'));
  const ms=performance.now()-start;assert.ok(ms<2500);assert.ok(heartbeat,'event loop was given time to process input');
  assert.match(document.querySelector('.modal [role=alert]').textContent,/příliš složitý|too complex/);
  assert.equal(localStorage.getItem(prefix+'suplik-studio-projects-v1'),before);assert.equal(localStorage.getItem(prefix+'suplik-studio-current'),current);
  document.querySelector('[data-import-close]').click();assert.equal(document.querySelector('.modal'),null);assert.ok(document.querySelector('.app-shell'));
  t.diagnostic(JSON.stringify({tools:1000,importRejectedMs:ms,heartbeat,projectsPreserved:true,currentPreserved:true}));
});
