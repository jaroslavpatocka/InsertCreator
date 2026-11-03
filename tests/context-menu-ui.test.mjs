import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const points=[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}];
const initial=validateProject({...blankProject(),id:'context-menu',width:840,height:630,modules:[{id:'a',name:'Moje sada',x:0,y:0,width:252,height:168,sizeMode:'manual',grouped:true},{id:'filler',name:'Výplň',x:336,y:0,width:126,height:126,sizeMode:'manual',locked:true}],tools:[{id:'one',name:'Klíč',moduleId:'a',x:35,y:40,points,depth:8,fingerGrips:[]},{id:'two',name:'Šroubovák',moduleId:'a',x:130,y:40,points,depth:8,fingerGrips:[]}]});
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"context-menu"');
await import('../dist/app.js');
const $=selector=>document.querySelector(selector),shape=id=>$(`#board-svg .tool-outline[data-tool="${id}"]`),body=id=>$(`#board-svg [data-module="${id}"] > rect`),menu=()=>$('.model-context-menu');
const click=target=>{const el=typeof target==='string'?$(target):target;assert.ok(el);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const right=target=>{assert.ok(target);target.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:100,clientY:100}));assert.ok(menu());};
const key=value=>document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1'))[0];
const check=id=>{const el=$(`[data-tool-check="${id}"]`);el.checked=true;el.dispatchEvent(new win.Event('change',{bubbles:true}));};
after(()=>win.happyDOM.abort());

test('right click selects the actual set member and actions edit it with one undo',()=>{
  const before=saved();right(shape('two'));assert.equal(menu().getAttribute('role'),'menu');assert.equal(menu().getAttribute('aria-label'),'Šroubovák');
  assert.equal($('[data-field="name"]').value,'Šroubovák');assert.equal(document.activeElement.dataset.contextAction,'context-properties');
  click('[data-context-action="rotate"]');assert.equal(menu(),null);assert.equal(saved().tools[1].rotation,90);assert.deepEqual(saved().tools[0],before.tools[0]);
  click('[data-action="undo"]');assert.equal(saved().tools[1].rotation,0);
});
test('right click keeps all highlighted members when a selected bulk member is hit',()=>{
  check('one');check('two');right(shape('two'));
  assert.ok($('[data-context-action="bulk-rotate"]'));assert.equal(document.querySelectorAll('[data-tool-check]:checked').length,2);
  click('[data-context-action="bulk-rotate"]');assert.deepEqual(saved().tools.map(t=>t.rotation),[90,90]);click('[data-action="undo"]');
});
test('module background changes context, clears all tool selection and offers module actions',()=>{
  right(body('filler'));assert.equal(document.querySelectorAll('[data-tool-check]:checked').length,0);
  assert.ok($('[data-context-action="rotate-module"]').disabled);assert.equal($('[data-context-action="lock"]').textContent,'Odemknout');
  assert.equal($('[data-context-action="rotate"]'),null);key('Escape');assert.equal(menu(),null);assert.equal(document.activeElement.id,'board-svg');
});
test('menu keyboard navigation, outside dismissal and viewport clamping work without geometry edits',()=>{
  const before=saved();right(shape('one'));key('End');assert.equal(document.activeElement.dataset.contextAction,'delete');key('Home');key('ArrowDown');assert.equal(document.activeElement.dataset.contextAction,'rotate');
  key('Escape');right(shape('one'));document.body.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,pointerId:9}));assert.equal(menu(),null);
  right(shape('one'));window.dispatchEvent(new win.Event('resize'));assert.equal(menu(),null);assert.deepEqual(saved(),before);
});
test('a right-button pan does not also open a context menu',()=>{
  const target=shape('one');target.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:2,pointerId:55,isPrimary:true,clientX:10,clientY:10}));
  document.dispatchEvent(new win.PointerEvent('pointermove',{bubbles:true,button:2,pointerId:55,clientX:35,clientY:10}));
  $('#board-svg').dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:35,clientY:10}));assert.equal(menu(),null);
});
