import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas} from '@napi-rs/canvas';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?createCanvas(this.width||300,this.height||150).getContext('2d'):null;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const source=[{x:0,y:0},{x:20,y:0},{x:20.3,y:10},{x:20,y:20},{x:20.25,y:30},{x:20,y:80},{x:0,y:80},{x:-.2,y:60},{x:0,y:40},{x:-.1,y:20}];
const initial=validateProject({...blankProject(),id:'functional-ui',name:'Geometric pocket',width:420,height:336,
  modules:[{id:'shared',name:'Tools',x:0,y:0,width:252,height:168,sizeMode:'manual',grouped:true}],
  tools:[{id:'rough',name:'Tool <&>',x:35,points:source},{id:'locked',name:'Locked',x:100,points:source,locked:true}].map(tool=>({...tool,y:40,rotation:0,depth:8,moduleId:'shared',fingerGrips:[]}))});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"functional-ui"');
await import('../dist/app.js');
after(()=>win.happyDOM.abort());
const $=selector=>win.document.querySelector(selector);
const state=()=>{const project=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='functional-ui');delete project.updatedAt;return project;};
const click=element=>{assert.ok(element,'expected UI control');if(typeof element.click==='function')element.click();else element.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click($(`#app [data-action="${name}"]`));
function select(id){click($(`#board-svg [data-tool="${id}"]`));const section=$('[data-inspector-section="tool-shape"]');section.open=true;return section.querySelector('[data-action="functional-pocket"]');}

test('geometric pocket preview is read-only; apply persists one undoable valid geometry change',()=>{
  const before=state();click(select('rough'));
  assert.ok($('[data-functional-pocket-preview]'));assert.ok($('[data-functional-pocket-preview] line'));
  assert.equal($('#modal-title').nextElementSibling.textContent,'Tool <&>');
  assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  click($('#modal-root .modal-foot [data-modal-close]'));assert.equal($('[data-functional-pocket-preview]'),null);assert.deepEqual(state(),before);
  click(select('rough'));
  const displayed=$('[data-functional-pocket-preview] polygon').getAttribute('points').split(' ').map(pair=>{const [x,y]=pair.split(',').map(Number);return{x,y};});
  const minX=Math.min(...displayed.map(p=>p.x)),minY=Math.min(...displayed.map(p=>p.y));
  click($('[data-apply-functional-pocket]'));
  assert.equal($('[data-functional-pocket-preview]'),null);const next=state();assert.notDeepEqual(next.tools[0].points,before.tools[0].points);
  assert.deepEqual(next.tools[0].points,displayed.map(p=>({x:p.x-minX,y:p.y-minY})),'the applied polygon must be the polygon reviewed in the preview');
  assert.deepEqual(next.tools[1],before.tools[1]);assert.deepEqual(next.modules,before.modules);assert.deepEqual(validateLayout(next),[]);
  assert.match($('#toast').textContent,/Tvar kapsy upraven/);
  click(select('rough'));click($('[data-apply-functional-pocket]'));assert.deepEqual(state(),next,'reapplying the approved shape is a no-op');
  action('undo');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  action('redo');assert.deepEqual(state(),next);action('undo');
});

test('locked tool disables geometric pocket action without creating an undo entry',()=>{
  const before=state(),button=select('locked');assert.equal(button.disabled,true);click(button);assert.deepEqual(state(),before);assert.equal($('[data-functional-pocket-preview]'),null);assert.equal($('#app [data-action="undo"]').disabled,true);
});
