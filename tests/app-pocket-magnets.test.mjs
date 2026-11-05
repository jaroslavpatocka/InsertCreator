import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';

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
const project=validateProject({...blankProject(),id:'pocket-magnets',name:'Magnety',width:252,height:84,insertHeight:12,printMode:'solid',
  modules:[{id:'mod',name:'Modul',x:0,y:0,width:252,height:84}],
  tools:[{id:'t',name:'Klíč',moduleId:'mod',points:[{x:0,y:0},{x:150,y:0},{x:150,y:30},{x:0,y:30}],x:20,y:20,depth:9.6}]});
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([project]));
localStorage.setItem('suplik-studio-current','"pocket-magnets"');
await import('../dist/app.js');
after(()=>win.happyDOM?.abort?.());

const $=selector=>document.querySelector(selector);
const pause=()=>new Promise(resolve=>nativeTimeout(resolve,0));

test('the selected tool can get a magnet: dialog, height raise, 2D mark, undoable removal',async()=>{
  await pause();
  const outline=$('.tool-outline[data-tool="t"]');
  assert.ok(outline,'tool is on the board');
  outline.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));await pause();
  const add=$('[data-action="pocket-magnets"]');
  assert.ok(add,'the inspector offers magnets');
  add.click();await pause();
  assert.match($('[data-magnet-status]').textContent,/zvýší z 12 mm na 13 mm/);
  $('[data-magnets-save]').click();await pause();
  assert.ok($('.board-svg .tool-magnet'),'the hole is drawn on the board');
  assert.match($('#toast').textContent,/Magnety uloženy/);
  $('[data-action="pocket-magnets-clear"]').click();await pause();
  assert.equal($('.board-svg .tool-magnet'),null);
});
