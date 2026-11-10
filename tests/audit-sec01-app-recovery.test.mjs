// SEC-01: staged project import and startup recovery from a project whose opening never finished.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';

const key=name=>name; // the mobile copy namespaces its storage keys
const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const name of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[name]=name==='window'?win:win[name];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

const square=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
const drawer=(id,name)=>({...blankProject(),id,name,modules:[{id:id+'-m',name:'M',x:0,y:0,width:84,height:84}],tools:[{id:id+'-t',name:'Klíč',moduleId:id+'-m',x:30,y:30,points:square}]});
const star=(n=6000)=>Array.from({length:n},(_,i)=>{const theta=2*Math.PI*((i*3001)%n)/n;return{x:80+80*Math.cos(theta),y:80+80*Math.sin(theta)};});
const wavy=(n=6000)=>Array.from({length:n},(_,i)=>{const theta=2*Math.PI*i/n,r=70+6*Math.sin(theta*40)+2*Math.sin(theta*313);return{x:80+r*Math.cos(theta),y:80+r*Math.sin(theta)};});
const withContour=(id,points)=>({...blankProject(),id,name:id,modules:[{id:'m',name:'M',x:0,y:0,width:210,height:210}],tools:[{id:'t',name:'Obrys '+id,moduleId:'m',x:20,y:20,points}]});

// The previous session hung while opening "stuck"; it must be kept but not rendered again.
localStorage.setItem(key('suplik-studio-projects-v1'),JSON.stringify([drawer('stuck','Zaseknutý'),drawer('spare','Náhradní')]));
localStorage.setItem(key('suplik-studio-current'),JSON.stringify('stuck'));
localStorage.setItem(key('suplik-studio-opening'),JSON.stringify('stuck'));
localStorage.setItem(key('suplik-studio-lang'),'"cs"');localStorage.setItem(key('suplik-studio-unit'),'"mm"');
await import('../dist/app.js');
after(async()=>{await win.happyDOM.close();});

const $=selector=>win.document.querySelector(selector);
const read=name=>JSON.parse(localStorage.getItem(key(name)));
const stored=()=>read('suplik-studio-projects-v1');
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
async function until(check,message,ms=8000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error(message);await pause(20);}}
function importJSON(project){
  const json=JSON.stringify({schemaVersion:1,app:'InsertCreator',project}),input=$('#project-file');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:json.length,name:'drawer.json',text:async()=>json}]});
  input.dispatchEvent(new win.Event('change',{bubbles:true}));delete input.files;
}

test('startup skips the project whose last opening never finished, keeps it stored and clears the marker',async()=>{
  assert.equal(read('suplik-studio-current'),'spare');
  assert.deepEqual(stored().map(project=>project.id).sort(),['spare','stuck']);
  assert.match($('#toast').textContent,/Zaseknutý/);
  await until(()=>read('suplik-studio-opening')===null,'a finished render clears the opening marker',4000);
});

test('a crafted crossing contour is rejected before anything is saved and the open project stays',async()=>{
  const before=localStorage.getItem(key('suplik-studio-projects-v1')),start=performance.now();
  importJSON(withContour('hostile',star()));
  await until(()=>$('[data-project-import-progress] [role=alert], .modal [role=alert]'),'import error should be shown');
  assert.ok(performance.now()-start<4000,'rejection must be prompt');
  assert.match($('.modal [role=alert]').textContent,/kříží/);
  assert.equal(localStorage.getItem(key('suplik-studio-projects-v1')),before,'stored projects are unchanged');
  assert.equal(read('suplik-studio-current'),'spare');assert.equal(read('suplik-studio-opening'),null);
  $('[data-import-close]').click();
});

test('a large valid traced contour still imports and is persisted after it rendered',async()=>{
  importJSON(withContour('traced',wavy()));
  await until(()=>read('suplik-studio-current')!=='spare','valid import should open');
  const current=stored().find(project=>project.id===read('suplik-studio-current'));
  assert.equal(current.name,'traced');assert.equal(current.tools[0].points.length,6000);
  assert.equal(stored().length,3);
});
