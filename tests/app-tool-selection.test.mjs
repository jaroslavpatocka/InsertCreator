import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
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
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const points=[{x:0,y:0},{x:20,y:0},{x:20,y:120},{x:0,y:120}];
const initial=validateProject({...blankProject(),id:'pick-shared',name:'Výběr členů sady',width:840,height:630,limitToBed:true,bedWidth:220,bedHeight:220,
  modules:[{id:'shared',name:'Dva klíče',x:0,y:0,width:294,height:210,sizeMode:'manual',grouped:true}],
  tools:[{id:'one',name:'První klíč',x:40,y:45},{id:'two',name:'Druhý klíč',x:145,y:45},{id:'three',name:'Třetí klíč',x:235,y:45}].map(t=>({...t,points,rotation:0,depth:8,moduleId:'shared',fingerGrips:[]})),
  toolSets:[{id:'set',name:'Tři klíče',toolIds:['one','two','three'],layout:'shared'}]});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"pick-shared"');
await import('../dist/app.js');
const proto=(win.SVGSVGElement||win.SVGElement).prototype;
proto.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
proto.getScreenCTM=()=>({inverse:()=>({})});proto.setPointerCapture=()=>{};proto.releasePointerCapture=()=>{};
const $=selector=>win.document.querySelector(selector);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='pick-shared');
const state=()=>{const p=saved();delete p.updatedAt;return p;};
const target=id=>{const el=$(`#board-svg [data-tool="${id}"]`);assert.ok(el,'tool must have its own model hit target: '+id);return el.matches('path')?el:el.querySelector('path')||el;};
const click=(el,options={})=>{assert.ok(el);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,...options}));};
const action=name=>click($(`#app [data-action="${name}"]`));
const change=(selector,value)=>{const el=$(selector);assert.ok(el,selector);el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const pointer=(type,el)=>el.dispatchEvent(new win.PointerEvent(type,{pointerId:19,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:150,clientY:80,bubbles:true,cancelable:true}));
after(()=>win.happyDOM.abort());

test('clicking or pressing either contour in a shared module selects that exact tool without editing the drawer',()=>{
  const before=state();
  for(const id of ['two','one']){
    click(target(id));assert.equal($('[data-field="name"]').value,before.tools.find(t=>t.id===id).name);
    assert.ok($('[data-action="finger-grips"]'),'individual finger editing is available');
  }
  pointer('pointerdown',target('two'));pointer('pointerup',$('#board-svg'));
  assert.equal($('[data-field="name"]').value,'Druhý klíč');
  assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true,'selection alone adds no history');
});

test('finger editing from a picked set member changes only that member and is one undo step',()=>{
  const before=state();click(target('two'));action('finger-grips');
  assert.match($('.modal').textContent,/Druhý klíč/);click($('[data-grip-auto]'));
  const rows=[...win.document.querySelectorAll('[data-grip-row]')];assert.equal(rows.length,2);
  for(const row of rows)assert.ok(Math.abs(Number(row.querySelector('[data-field="fingerY"]').value)-60)<.01,'automatic grips belong at the shaft midpoint');
  change('[data-grip-row] [data-field="fingerDiameter"]',20);
  click($('[data-grips-save]'));assert.equal($('.modal'),null);
  const next=state();assert.deepEqual(next.tools[0],before.tools[0]);assert.deepEqual(next.modules,before.modules);assert.deepEqual(next.toolSets,before.toolSets);
  assert.equal(next.tools[1].fingerGrips.length,2);assert.deepEqual(next.tools[1].fingerGrips.map(g=>g.radius),[10,9]);
  assert.deepEqual(validateLayout(next),[]);assert.deepEqual([next.limitToBed,next.bedWidth,next.bedHeight],[true,220,220]);
  action('undo');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('Ctrl and Shift on individual shared contours toggle only the clicked set member',()=>{
  const before=state(),checked=()=>[...win.document.querySelectorAll('[data-tool-check]:checked')].map(el=>el.dataset.toolCheck);
  click(target('two'),{ctrlKey:true});assert.deepEqual(checked(),['two']);
  click(target('one'),{shiftKey:true});assert.deepEqual(checked(),['one','two']);
  click(target('two'),{ctrlKey:true});assert.deepEqual(checked(),['one']);
  action('select-no-tools');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('single rotation property and a custom angle for multiple picked members preserve the shared module',()=>{
  const before=state();click(target('two'));change('[data-field="rotation"]',30);
  assert.equal(saved().tools[1].rotation,30);assert.deepEqual(saved().tools.filter(t=>t.id!=='two'),before.tools.filter(t=>t.id!=='two'));
  assert.deepEqual(saved().modules,before.modules);assert.deepEqual(validateLayout(saved()),[]);action('undo');assert.deepEqual(state(),before);
  click(target('two'));change('[data-field="rotation"]',360);assert.deepEqual(state(),before);assert.match($('#toast').textContent,/úhel/);
  click(target('one'),{ctrlKey:true});click(target('two'),{ctrlKey:true});action('bulk-angle');
  change('[data-rotation-mode]','absolute');change('[data-field="bulkAngle"]',30);click($('[data-apply-bulk-angle]'));
  assert.ok(!$('.modal'),'the valid angle closes the dialog');assert.deepEqual(saved().tools.map(t=>t.rotation),[30,30,0]);
  assert.deepEqual(saved().tools[2],before.tools[2]);assert.deepEqual(saved().modules,before.modules);assert.deepEqual(validateLayout(saved()),[]);
  action('undo');assert.deepEqual(state(),before);action('bulk-angle');
  change('[data-field="bulkAngle"]',-15);click($('[data-apply-bulk-angle]'));
  assert.deepEqual(saved().tools.map(t=>t.rotation),[345,345,0]);action('undo');action('select-no-tools');assert.deepEqual(state(),before);
});

test('shared module background and its member list select the container and then the requested member',()=>{
  const before=state();click($('#board-svg [data-module="shared"] > rect'));
  const members=$('.module-members');assert.ok(members);assert.equal(members.querySelectorAll('[data-select]').length,3);
  click(members.querySelector('[data-select="three"]'));assert.equal($('[data-field="name"]').value,'Třetí klíč');
  const hit=target('two'),keyboardTarget=hit.hasAttribute('tabindex')?hit:$('#board-svg [data-tool="two"][tabindex]');
  keyboardTarget.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.equal($('[data-field="name"]').value,'Druhý klíč');assert.deepEqual(state(),before);
});

test('precise and bulk pocket movement leaves the module and unselected tools in place',()=>{
  const before=state();click(target('two'));change('[data-field="toolX"]',159);
  assert.equal(saved().tools[1].x,159);assert.deepEqual(saved().modules,before.modules);
  assert.deepEqual(saved().tools.filter(t=>t.id!=='two'),before.tools.filter(t=>t.id!=='two'));action('undo');assert.deepEqual(state(),before);
  click(target('two'));change('[data-field="toolX"]',285);assert.deepEqual(state(),before,'an outside pocket cannot be committed');
  click(target('one'),{ctrlKey:true});click(target('two'),{ctrlKey:true});action('bulk-move');
  change('[data-bulk-move-mode]','tools');change('[data-field="bulkDx"]',10);change('[data-field="bulkDy"]',5);click($('[data-apply-bulk-move]'));
  assert.ok(!$('.modal'),'the valid pocket movement closes the dialog');const next=state();
  assert.deepEqual(next.tools.slice(0,2).map(t=>[t.x,t.y]),[[50,50],[155,50]]);
  assert.deepEqual(next.tools[2],before.tools[2]);assert.deepEqual(next.modules,before.modules);assert.deepEqual(validateLayout(next),[]);
  action('undo');action('select-no-tools');assert.deepEqual(state(),before);
});

test('selected pockets can be aligned and evenly distributed without moving the container',()=>{
  const before=state();click(target('two'));change('[data-field="toolY"]',55);const uneven=state();
  for(const id of ['one','two','three'])click(target(id),{ctrlKey:true});
  action('bulk-align');change('[data-align-axis]','y');change('[data-align-edge]','min');click($('[data-apply-bulk-align]'));
  assert.ok(!$('.modal'));assert.deepEqual(saved().tools.map(t=>t.y),[45,45,45]);assert.deepEqual(saved().modules,before.modules);
  action('undo');assert.deepEqual(state(),uneven);action('undo');assert.deepEqual(state(),before);
  action('bulk-align');change('[data-align-axis]','x');click($('[data-apply-bulk-distribute]'));
  assert.ok(!$('.modal'));const next=state();assert.equal(next.tools[0].x,40);assert.equal(next.tools[2].x,235);
  assert.ok(Math.abs(next.tools[1].x-137.5)<1e-8);assert.deepEqual(next.modules,before.modules);assert.deepEqual(validateLayout(next),[]);
  action('undo');action('select-no-tools');assert.deepEqual(state(),before);
});

test('automatic or cleared finger grips apply only to the selected tools in one transaction',()=>{
  const before=state();click(target('one'),{ctrlKey:true});click(target('two'),{ctrlKey:true});action('bulk-grips-auto');
  const gripped=state();assert.ok(gripped.tools.slice(0,2).every(t=>t.fingerGrips.length===2&&t.fingerGrips.every(g=>Math.abs(g.y-60)<.01)));
  assert.deepEqual(gripped.tools[2],before.tools[2]);assert.deepEqual(gripped.modules,before.modules);assert.deepEqual(validateLayout(gripped),[]);
  action('bulk-grips-clear');assert.ok(saved().tools.every(t=>t.fingerGrips.length===0));action('undo');assert.deepEqual(state(),gripped);
  action('undo');action('select-no-tools');assert.deepEqual(state(),before);
});

test('module position, whole-module rotation and copying retain the source and support one undo each',()=>{
  const before=state();click($('#board-svg [data-module="shared"] > rect'));change('[data-field="moduleX"]',42);
  assert.equal(saved().modules[0].x,42);assert.deepEqual(saved().tools.map(t=>t.x),before.tools.map(t=>t.x+42));action('undo');assert.deepEqual(state(),before);
  action('rotate-module');const rotated=state();assert.deepEqual([rotated.modules[0].x,rotated.modules[0].y,rotated.modules[0].width,rotated.modules[0].height],[0,0,210,294]);
  assert.ok(rotated.tools.every(t=>t.rotation===90));assert.deepEqual(validateLayout(rotated),[]);action('undo');assert.deepEqual(state(),before);
  action('duplicate-module');const copied=state();assert.equal(copied.modules.length,2);assert.equal(copied.tools.length,6);
  assert.deepEqual(copied.modules.find(m=>m.id==='shared'),before.modules[0]);
  assert.deepEqual(copied.tools.filter(t=>before.tools.some(o=>o.id===t.id)),before.tools);assert.deepEqual(validateLayout(copied),[]);
  const copy=copied.modules.find(m=>m.id!=='shared');assert.equal(copy.locked,false);
  assert.deepEqual(copied.toolSets.find(s=>s.id==='set'),before.toolSets[0]);assert.equal(copied.toolSets.length,2);
  assert.deepEqual([copied.limitToBed,copied.bedWidth,copied.bedHeight],[true,220,220]);
  action('undo');assert.deepEqual(state(),before);
});
