import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas} from '@napi-rs/canvas';
import {blankProject,validateProject} from '../dist/model.js';
import {bounds,validateLayout} from '../dist/geometry.js';
import {setCoherence} from '../dist/tool-sets.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?createCanvas(this.width||300,this.height||150).getContext('2d'):null;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const initial=validateProject({...blankProject(),id:'pocket-growth-ui',width:220,height:100,grid:10,limitToBed:false,
  modules:[{id:'photo',name:'Fotka',x:0,y:0,width:80,height:40,sizeMode:'manual',grouped:true,pocketMargin:.8},
    {id:'other',name:'Vedlejší modul',x:120,y:0,width:80,height:40,sizeMode:'manual',locked:true,pocketMargin:.8},
    {id:'full',name:'Celá šířka',x:0,y:60,width:220,height:40,sizeMode:'manual',pocketMargin:.8}],
  tools:[{id:'left',name:'Levý',moduleId:'photo',x:10,y:10,points:rectangle(30,20)},
    {id:'right',name:'Pravý',moduleId:'photo',x:45,y:10,points:rectangle(30,20)},
    {id:'fixed',name:'Pevný',moduleId:'other',x:140,y:10,points:rectangle(30,20)},
    {id:'wide',name:'Široký',moduleId:'full',x:5,y:70,points:rectangle(210,20)}].map(tool=>({...tool,rotation:0,depth:8,fingerGrips:[]}))});
assert.deepEqual(validateLayout(initial),[]);
const lockedSibling={...initial,id:'pocket-growth-locked-sibling',tools:initial.tools.map(tool=>({...tool,locked:tool.id==='right'||tool.locked}))};
const uniform=validateProject({...initial,id:'pocket-growth-uniform',
  modules:initial.modules.map(module=>['photo','other'].includes(module.id)?{...module,setId:'uniform-set',setLayout:'uniform'}:module),
  tools:initial.tools.filter(tool=>tool.id!=='right').map(tool=>tool.id==='left'?{...tool,points:rectangle(60,20)}:tool),
  toolSets:[{id:'uniform-set',name:'Stejné moduly',layout:'uniform',toolIds:['left','fixed']}]});
assert.deepEqual(validateLayout(uniform),[]);assert.deepEqual(setCoherence(uniform,uniform.toolSets).satisfied,['uniform-set']);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial,lockedSibling,uniform]));localStorage.setItem('suplik-studio-current',JSON.stringify(initial.id));
await import('../dist/app.js');after(()=>win.happyDOM.abort());
const $=selector=>win.document.querySelector(selector);
const state=()=>{const current=JSON.parse(localStorage.getItem('suplik-studio-current')),project=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(item=>item.id===current);delete project.updatedAt;return project;};
const click=element=>{assert.ok(element);if(element.click)element.click();else element.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const select=id=>click($(`#board-svg [data-tool="${id}"]`));
const action=name=>click($(`#app [data-action="${name}"]`));
function change(scope,value){const field=$(`[data-scope="${scope}"][data-field="pocketMargin"]`);assert.ok(field);field.value=value;field.dispatchEvent(new win.Event('change',{bubbles:true}));}
const center=tool=>{const box=bounds(tool);return{x:box.x+box.width/2,y:box.y+box.height/2};};
function assertPreserved(next,before){
  assert.deepEqual(next.modules.slice(1),before.modules.slice(1));assert.deepEqual(next.tools.slice(2),before.tools.slice(2));
  for(let i=0;i<2;i++)for(const key of ['id','moduleId','points','rotation','depth','fingerGrips'])assert.deepEqual(next.tools[i][key],before.tools[i][key],key);
  const a=center(next.tools[0]),b=center(next.tools[1]);assert.ok(b.x>a.x);assert.ok(Math.abs(a.y-b.y)<1e-7);
  assert.equal(next.modules[0].grouped,true);assert.equal(next.modules[0].sizeMode,'manual');
  assert.equal(next.modules[0].width%next.grid,0);assert.equal(next.modules[0].height%next.grid,0);
  assert.deepEqual(validateLayout(next),[]);assert.equal(next.clearance,before.clearance);
}

test('module margin grows one photo module without repacking, and undo/redo restores the whole change',()=>{
  select('left');const before=state();change('module','4');const next=state();
  assert.equal(next.modules[0].pocketMargin,4);assert.ok(next.modules[0].width>=90);assertPreserved(next,before);
  assert.ok(center(next.tools[1]).x-center(next.tools[0]).x>35,'increased pocket margins must increase the unsafe original center spacing');
  action('undo');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  action('redo');assert.deepEqual(state(),next);action('undo');assert.deepEqual(state(),before);
});

test('an individual pocket override expands the existing shared module and retains inheritance elsewhere',()=>{
  select('left');const before=state();change('tool','8');const next=state();
  assert.equal(next.tools[0].pocketMargin,8);assert.equal(next.modules[0].pocketMargin,.8);assert.equal(Object.hasOwn(next.tools[1],'pocketMargin'),false);
  assert.ok(next.modules[0].width>before.modules[0].width);assertPreserved(next,before);
  action('undo');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('a margin whose expanded module cannot fit in the drawer leaves state and history unchanged',()=>{
  select('wide');const before=state();change('module','10');
  assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  assert.deepEqual(validateLayout(state()),[]);
});

test('a locked sibling permits safe margin edits but prevents growth that would move it',()=>{
  action('projects');click($('[data-open="pocket-growth-locked-sibling"]'));select('left');
  const before=state();change('tool','1.2');const next=state();
  assert.equal(next.tools[0].pocketMargin,1.2);assert.deepEqual(next.modules,before.modules);
  assert.deepEqual(next.tools.slice(1),before.tools.slice(1),'a locked sibling and unrelated tools retain every property');
  assert.deepEqual(next.tools[0].points,before.tools[0].points);assert.equal(next.tools[0].x,before.tools[0].x);assert.equal(next.tools[0].y,before.tools[0].y);
  assert.deepEqual(validateLayout(next),[]);action('undo');assert.deepEqual(state(),before);
  change('tool','8');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('growing one uniform set module changes its stored layout to auto without resizing its sibling',()=>{
  action('projects');click($('[data-open="pocket-growth-uniform"]'));select('left');
  const before=state();assert.equal(before.toolSets[0].layout,'uniform');change('module','8');const next=state();
  assert.equal(next.modules[0].pocketMargin,8);assert.ok(next.modules[0].width>before.modules[0].width);
  assert.equal(next.toolSets[0].layout,'auto');assert.deepEqual(next.toolSets[0].toolIds,before.toolSets[0].toolIds);
  assert.deepEqual(next.modules.slice(1),before.modules.slice(1),'the sibling and unrelated modules do not move or resize');
  assert.deepEqual(next.tools.slice(1),before.tools.slice(1));assert.deepEqual(next.tools[0].points,before.tools[0].points);
  assert.deepEqual(validateLayout(next),[]);action('undo');assert.deepEqual(state(),before);assert.equal(state().toolSets[0].layout,'uniform');
  assert.equal($('#app [data-action="undo"]').disabled,true,'resizing and releasing the uniform preference form one history step');
  action('redo');assert.deepEqual(state(),next);
});
