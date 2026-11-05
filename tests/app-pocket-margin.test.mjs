import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas} from '@napi-rs/canvas';
import {blankProject,validateProject} from '../dist/model.js';
import {pocketOutline,validateLayout} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?createCanvas(this.width||300,this.height||150).getContext('2d'):null;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const points=[{x:0,y:0},{x:20,y:0},{x:20,y:50},{x:0,y:50}];
const initial=validateProject({...blankProject(),id:'margin-ui',width:504,height:336,
  modules:[{id:'a',name:'A',x:0,y:0,width:168,height:168,sizeMode:'manual',grouped:true,pocketMargin:1},{id:'b',name:'B',x:168,y:0,width:168,height:168,sizeMode:'manual',grouped:true,pocketMargin:.3,locked:true}],
  tools:[{id:'inherit',name:'Inherited',moduleId:'a',x:6,y:35,points},{id:'zero',name:'Zero',moduleId:'a',x:90,y:35,points,pocketMargin:0},{id:'other',name:'Other',moduleId:'b',x:200,y:35,points}].map(tool=>({...tool,rotation:0,depth:8,fingerGrips:[]}))});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"margin-ui"');
await import('../dist/app.js');after(()=>win.happyDOM.abort());
const $=selector=>win.document.querySelector(selector);
const state=()=>{const project=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='margin-ui');delete project.updatedAt;return project;};
const click=element=>{assert.ok(element);if(element.click)element.click();else element.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const select=id=>click($(`#board-svg [data-tool="${id}"]`));
const action=name=>click($(`#app [data-action="${name}"]`));
function change(scope,value){const field=$(`[data-scope="${scope}"][data-field="pocketMargin"]`);assert.ok(field);field.value=value;field.dispatchEvent(new win.Event('change',{bubbles:true}));}
const width=(project,id)=>{const points=pocketOutline(project.tools.find(tool=>tool.id===id),project);return Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));};

test('one tool can override or clear its module margin, including exact zero, with one undo',()=>{
  select('inherit');const before=state();assert.equal($('[data-scope="tool"][data-field="pocketMargin"]').value,'');
  change('tool','2');let next=state();assert.equal(next.tools[0].pocketMargin,2);assert.equal(width(next,'inherit'),24);assert.deepEqual(next.modules,before.modules);assert.deepEqual(next.tools.slice(1),before.tools.slice(1));assert.equal(next.clearance,.8);
  action('undo');assert.deepEqual(state(),before);
  change('tool','0');next=state();assert.equal(next.tools[0].pocketMargin,0);assert.equal(width(next,'inherit'),20);
  change('tool','');next=state();assert.equal(Object.hasOwn(next.tools[0],'pocketMargin'),false);assert.equal(width(next,'inherit'),22);
  action('undo');assert.equal(state().tools[0].pocketMargin,0);action('undo');assert.deepEqual(state(),before);
});
test('module margin affects only inheriting tools in that module and accepts explicit units',()=>{
  select('inherit');const before=state();change('module','0.1 in');const next=state();
  assert.equal(next.modules[0].pocketMargin,2.54);assert.equal(next.modules[1].pocketMargin,.3);assert.equal(next.clearance,.8);assert.deepEqual(next.tools,before.tools);assert.equal(width(next,'zero'),20);assert.ok(Math.abs(width(next,'inherit')-25.08)<1e-6);
  const stored=validateProject(next);assert.deepEqual(validateProject(JSON.parse(JSON.stringify(stored))),stored);
  action('undo');assert.deepEqual(state(),before);
});
test('invalid margins, unsafe expansion and locked module edits leave project and undo unchanged',()=>{
  select('inherit');const before=state();for(const value of ['-1','11','bad','10']){change('tool',value);assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);}
  select('other');for(const scope of ['tool','module']){assert.equal($(`[data-scope="${scope}"][data-field="pocketMargin"]`).disabled,true);change(scope,'1');assert.deepEqual(state(),before);}
});
