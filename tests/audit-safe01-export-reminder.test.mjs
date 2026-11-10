// SAFE-01: the manufacture decision (export modal) must remind every user, not only first-time
// users, to verify the real size/scale and print a test sample, with direct links to the existing
// 1:1 PDF and thin test STL. No blanket disclaimer and no claim that a valid mesh certifies fit.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';

const PREFIX='';
const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{const timer=nativeTimeout(fn,ms,...args);if(ms>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=fn=>nativeTimeout(()=>fn(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
win.HTMLCanvasElement.prototype.getContext=()=>null;
localStorage.setItem(PREFIX+'suplik-studio-lang','"cs"');localStorage.setItem(PREFIX+'suplik-studio-unit','"mm"');
// Workers only record operations; nothing heavy runs in this test.
const posted=[];
globalThis.Worker=class{constructor(url){this.url=String(url);}postMessage(data){posted.push(data?.operation||data?.type||'');}addEventListener(){}removeEventListener(){}terminate(){}};
win.Worker=globalThis.Worker;
const fixture={...blankProject(),id:'safe01',name:'SAFE-01',width:252,height:168,bedWidth:256,bedHeight:256,connectors:false,sizeLabels:false,
  modules:[{id:'m',name:'Modul',x:0,y:0,width:126,height:84,sizeMode:'manual',locked:true}],
  tools:[{id:'t',name:'Klíč',moduleId:'m',points:[{x:0,y:0},{x:25,y:0},{x:25,y:18},{x:0,y:18}],x:20,y:20,rotation:0,depth:8,fingerGrips:[]}]};
localStorage.setItem(PREFIX+'suplik-studio-projects-v1',JSON.stringify([fixture]));localStorage.setItem(PREFIX+'suplik-studio-current',JSON.stringify(fixture.id));
await import('../dist/app.js');
after(()=>{win.document.querySelector('[data-modal-close]')?.click();win.happyDOM.abort();});

const $=selector=>document.querySelector(selector);
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
const openExport=()=>{const button=$('#app [data-action="export"]');assert.ok(button,'export action');button.click();assert.ok($('.modal'),'export modal');};
const closeModal=()=>{$('[data-modal-close]')?.click();};
const format=key=>{const button=$(`[data-format="${key}"]`);assert.ok(button,key);button.click();};

test('every non-backup export shows the real-size and test-sample reminder, on every visit',async()=>{
  for(let visit=0;visit<2;visit++){
    openExport();
    for(const key of ['stl','svg','dxf']){
      format(key);
      const note=$('[data-export-fit-reminder]');
      assert.ok(note,`reminder for ${key} on visit ${visit+1}`);
      assert.equal(note.getAttribute('role'),'note');
      const text=note.textContent;
      assert.match(text,/Před výrobou ověřte skutečnou velikost/);
      assert.match(text,/měřítko/);assert.match(text,/zkušební vzorek/);assert.match(text,/materiál i tolerance tiskárny/);
      assert.match(text,/neověřuje, že díl fyzicky padne/,'mesh validation is not presented as physical certification');
      assert.doesNotMatch(text,/odpovědnost|liability|záruk/i,'no blanket waiver');
      assert.ok(note.querySelector('[data-export-fit-pdf]'),'link to the existing 1:1 PDF');
      assert.ok(note.querySelector('[data-export-fit-stl]'),'link to the existing thin test STL');
      assert.equal(note.querySelector('[data-export-fit-pdf]').disabled,false);
    }
    format('json');
    assert.equal($('[data-export-fit-reminder]')===null,true,'a JSON backup is not a manufacturing decision');
    format('stl');
    closeModal();
    assert.equal($('[data-export-fit-reminder]')===null,true);
  }
});

test('the reminder opens the same 1:1 PDF task as the manufacturing panel',async()=>{
  openExport();format('stl');
  const before=posted.filter(op=>op==='fit-pdf').length;
  $('[data-export-fit-pdf]').click();
  for(let i=0;i<100&&posted.filter(op=>op==='fit-pdf').length===before;i++)await pause(5);
  assert.equal(posted.filter(op=>op==='fit-pdf').length,before+1,'fit-pdf job started');
  assert.equal($('[data-export-fit-reminder]')===null,true,'the export modal made way for the PDF task');
  closeModal();
});

test('the reminder is translated to English',async()=>{
  const source=await fs.readFile(new URL('../dist/locales/en-app.js',import.meta.url),'utf8');
  assert.match(source,/'Před výrobou ověřte skutečnou velikost':'Check the real size before manufacturing'/);
  assert.match(source,/Print a test sample first: material and printer tolerances change the result, and the model check does not confirm a physical fit\./);
});
