import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {transformedPoints,validateLayout} from '../dist/geometry.js';
import {moduleRotationHandles} from '../dist/module-rotation-handles.js';

const storagePrefix='';
const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const key=name=>storagePrefix+'suplik-studio-'+name;
localStorage.setItem(key('lang'),'"cs"');localStorage.setItem(key('unit'),'"mm"');
const points=[{x:0,y:0},{x:64,y:0},{x:64,y:10},{x:35,y:10},{x:35,y:18},{x:0,y:18}];
const makeTool=(id,moduleId,x,y,outline=points)=>({id,name:id,moduleId,x,y,points:outline,rotation:0,depth:8,locked:false,fingerGrips:[]});
function fixture(name,{locked=false,blocked=false}={}){
  const project=validateProject({...blankProject(),id:'rotation-'+name,name:'Rotace '+name,width:630,height:420,grid:42,bottomMode:'plain',wall:2.4,clearance:.8,sizeLabels:false,
    modules:[{id:'rotating',name:'Celý modul',x:126,y:126,width:168,height:84,sizeMode:'manual',grouped:true,locked},
      {id:'companion',name:'Nedotčený modul',x:blocked?126:420,y:42,width:168,height:84,sizeMode:'manual'}],
    tools:[makeTool('first','rotating',145,145),makeTool('second','rotating',225,145,[{x:0,y:0},{x:45,y:0},{x:45,y:10},{x:0,y:10}]),makeTool('unrelated','companion',blocked?145:439,61)]});
  assert.deepEqual(validateLayout(project),[],'fixture starts with valid walls and separate modules');
  return project;
}
const names=['history','snap','shiftstart','rounding','keyboard','pointer','cancel-pointer','cancel-capture','cancel-blur','cancel-escape','invalid','locked','touch','pinch','pen'];
const projects=names.map(name=>fixture(name,{locked:name==='locked',blocked:name==='invalid'}));
localStorage.setItem(key('projects-v1'),JSON.stringify(projects));localStorage.setItem(key('current'),JSON.stringify(projects[0].id));
await import('../dist/app.js');
const proto=(win.SVGSVGElement||win.SVGElement).prototype,captured=new Map();
proto.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
proto.getScreenCTM=()=>({inverse:()=>({})});
proto.setPointerCapture=function(id){captured.set(id,this);};
proto.releasePointerCapture=function(id){captured.delete(id);};
const $=selector=>win.document.querySelector(selector),$$=selector=>[...win.document.querySelectorAll(selector)];
const click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem(key('projects-v1'))).find(p=>p.id===JSON.parse(localStorage.getItem(key('current'))));
const state=()=>{const copy=structuredClone(saved());delete copy.updatedAt;return copy;};
const board=()=>$('#board-svg');
const body=id=>board().querySelector(`.tool-body[data-tool="${id}"]`).getAttribute('d');
function openProject(name){
  action('projects');click(`[data-open="rotation-${name}"]`);
  assert.equal(state().id,'rotation-'+name);
  assert.equal($('#app [data-action="undo"]').disabled,true);
}
function pointer(type,target=board(),{id=71,x=330,y=126,pointerType='mouse',isPrimary=true,shiftKey=false}={}){
  const event=new win.PointerEvent(type,{pointerId:id,pointerType,isPrimary,button:0,buttons:['pointerup','pointercancel','lostpointercapture'].includes(type)?0:1,clientX:x,clientY:y,shiftKey,bubbles:true,cancelable:true});
  target.dispatchEvent(event);return event;
}
let gesture;
function start({corner='ne',...options}={}){
  const module=state().modules.find(m=>m.id==='rotating'),centre={x:module.x+module.width/2,y:module.y+module.height/2};
  const target=$(`[data-rotate-of="rotating"][data-rotate-corner="${corner}"] .rotation-hit`);assert.ok(target,'Missing rotation corner '+corner);
  // Coordinates use the real SVG frame; the prototype above models a 1:1 screen mapping.
  const dx=(corner.includes('e')?1:-1)*(module.width/2+12),dy=(corner.includes('s')?1:-1)*(module.height/2+12);
  gesture={centre,dx,dy,options};
  pointer('pointerdown',target,{x:centre.x+dx,y:centre.y+dy,...options});
}
function at(degrees){const a=degrees*Math.PI/180,{centre,dx,dy}=gesture;return{x:centre.x+dx*Math.cos(a)-dy*Math.sin(a),y:centre.y+dx*Math.sin(a)+dy*Math.cos(a)};}
const move=(degrees,options={})=>pointer('pointermove',board(),{...at(degrees),...gesture.options,...options});
const drop=(degrees,options={})=>pointer('pointerup',board(),{...at(degrees),...gesture.options,...options});
const end=(type,options={})=>pointer(type,board(),{...at(0),...gesture.options,...options});
function assertRigidRotation(before,next,degrees){
  const module=before.modules.find(m=>m.id==='rotating'),cx=module.x+module.width/2,cy=module.y+module.height/2,angle=degrees*Math.PI/180;
  for(const old of before.tools){
    const current=next.tools.find(t=>t.id===old.id);
    if(old.moduleId!=='rotating'){assert.deepEqual(current,old);continue;}
    assert.deepEqual(current.points,old.points,'local measured outline is untouched');
    assert.deepEqual(current.fingerGrips,old.fingerGrips);assert.equal(current.moduleId,old.moduleId);
    const actual=transformedPoints(current),expected=transformedPoints(old).map(p=>({x:cx+(p.x-cx)*Math.cos(angle)-(p.y-cy)*Math.sin(angle),y:cy+(p.x-cx)*Math.sin(angle)+(p.y-cy)*Math.cos(angle)}));
    actual.forEach((p,i)=>{assert.ok(Math.abs(p.x-expected[i].x)<1e-6,'rigid world X');assert.ok(Math.abs(p.y-expected[i].y)<1e-6,'rigid world Y');});
  }
  assert.deepEqual(next.modules.find(m=>m.id==='companion'),before.modules.find(m=>m.id==='companion'));
  assert.deepEqual(validateLayout(next),[],'committed rotation must keep real walls and module separation valid');
}
after(()=>win.happyDOM.abort());

test('the selected module exposes four distinct rotation corners and locked modules disable them',()=>{
  openProject('history');
  assert.deepEqual($$('[data-rotate-of="rotating"]').map(el=>el.dataset.rotateCorner).sort(),['ne','nw','se','sw']);
  for(const corner of ['nw','ne','se','sw'])assert.ok($(`[data-rotate-corner="${corner}"] .rotation-hit`),'a visible handle has a dedicated target');
  openProject('locked');
  assert.equal($$('[data-rotate-of="rotating"]').length,0,'locked corners expose no active gesture target');
  const disabled=$('[data-rotate-corner][aria-disabled="true"]');assert.ok(disabled,'disabled rotation remains visibly explained');
  const before=state();pointer('pointerdown',disabled.querySelector('.rotation-hit'));pointer('pointerup');assert.deepEqual(state(),before);
});

test('free corner drag rotates all module pockets by 45 degrees, previews without saves and commits one undo/redo',()=>{
  openProject('history');const before=state(),stored=localStorage.getItem(key('projects-v1')),original=body('first');
  start();move(18);const firstPreview=body('first');assert.notEqual(firstPreview,original);move(45);
  assert.notEqual(body('first'),firstPreview,'preview continues following the same pointer');assert.ok($('.rotation-label'));
  assert.equal(localStorage.getItem(key('projects-v1')),stored,'preview never persists');
  drop(45);const next=state();assertRigidRotation(before,next,45);assert.equal($('.rotation-label'),null);
  action('undo');assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true,'one gesture is one history entry');
  action('redo');assert.deepEqual(state(),next);
});

test('Shift snaps free rotation to 15 degree increments',()=>{
  openProject('snap');const before=state();start({corner:'nw'});move(37,{shiftKey:true});drop(37,{shiftKey:true});assertRigidRotation(before,state(),30);
});

test('holding Shift before pressing a corner still starts rotation and applies the 15 degree snap',()=>{
  openProject('shiftstart');const before=state();start({corner:'se',shiftKey:true});move(37);assert.ok($('.rotation-label'));drop(37);assertRigidRotation(before,state(),30);
});

test('ordinary corner rotation uses single degrees without the grid changing its angle',()=>{
  openProject('rounding');const before=state();start();move(37.4);drop(37.4);assertRigidRotation(before,state(),37);
});

test('focused rotation corners accept arrow keys and the Shift 15 degree increment',()=>{
  openProject('keyboard');const before=state();
  const press=shiftKey=>{const handle=$('[data-rotate-of="rotating"][data-rotate-corner="ne"]');handle.focus();handle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey,bubbles:true,cancelable:true}));};
  press(true);assertRigidRotation(before,state(),15);action('undo');assert.deepEqual(state(),before);
  press(false);assertRigidRotation(before,state(),1);
});

test('coarse corner targets stay inside the visible frame at low zoom and keep the module centre available',()=>{
  const frame={x:-34,y:-34,width:698,height:488},px=2.2;
  for(const [x,y] of [[0,0],[462,336]]){
    const module={id:'edge',x,y,width:168,height:84},project={modules:[module],tools:[]};
    const svg=win.document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.innerHTML=moduleRotationHandles(module,project,{px,coarse:true,frame});
    assert.equal(svg.querySelectorAll('[data-rotate-of="edge"]').length,4);
    const boxes=[...svg.querySelectorAll('.rotation-hit')].map(rect=>Object.fromEntries(['x','y','width','height'].map(name=>[name,Number(rect.getAttribute(name))])));
    assert.equal(boxes.length,4,'each unobstructed corner keeps its full touch target');
    for(const box of boxes){
      assert.ok(box.x>=frame.x-1e-6&&box.y>=frame.y-1e-6,'target starts inside the visible frame');
      assert.ok(box.x+box.width<=frame.x+frame.width+1e-6&&box.y+box.height<=frame.y+frame.height+1e-6,'target ends inside the visible frame');
      assert.ok(Math.abs(box.width/px-44)<1e-6&&Math.abs(box.height/px-44)<1e-6,'coarse target remains 44 screen pixels');
    }
    const centre={x:x+module.width/2,y:y+module.height/2};
    assert.equal(boxes.some(box=>centre.x>=box.x&&centre.x<=box.x+box.width&&centre.y>=box.y&&centre.y<=box.y+box.height),false,'the module centre remains available for selection and moving');
  }
});

test('other pointer events cannot finish or cancel the owned rotation',()=>{
  openProject('pointer');const before=state(),stored=localStorage.getItem(key('projects-v1'));start({id:81});move(20);
  drop(20,{id:99});end('pointercancel',{id:99});end('lostpointercapture',{id:99});assert.ok($('.rotation-label'));assert.equal(localStorage.getItem(key('projects-v1')),stored);
  move(45);drop(45);assertRigidRotation(before,state(),45);const committed=state();end('lostpointercapture');assert.deepEqual(state(),committed,'capture release after commit cannot revert it');
});

for(const [name,cause] of [['cancel-pointer','pointercancel'],['cancel-capture','lostpointercapture'],['cancel-blur','blur'],['cancel-escape','Escape']])test(cause+' restores a rotation preview without saving or adding history',()=>{
  openProject(name);const before=state(),stored=localStorage.getItem(key('projects-v1')),original=body('first');start({id:82});move(45);assert.notEqual(body('first'),original);
  if(cause==='blur')win.dispatchEvent(new win.Event('blur'));
  else if(cause==='Escape')board().dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  else end(cause);
  assert.equal($('.rotation-label'),null);assert.equal(body('first'),original);assert.equal(localStorage.getItem(key('projects-v1')),stored);assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  move(75);drop(75);assert.deepEqual(state(),before,'late pointer events cannot save the cancelled preview');
  start({id:83});move(30);drop(30);assertRigidRotation(before,state(),30);
});

test('a rotation whose expanded shell collides with a neighbour is indicated and rolled back on release',()=>{
  openProject('invalid');const before=state(),stored=localStorage.getItem(key('projects-v1'));start();move(45);
  assert.ok($('.rotation-label.limited'),'invalid target angle has immediate feedback');drop(45);
  assert.deepEqual(state(),before);assert.equal(localStorage.getItem(key('projects-v1')),stored);assert.equal($('#app [data-action="undo"]').disabled,true);assert.equal($('.rotation-label'),null);
});

for(const pointerType of ['touch','pen'])test(pointerType+' can rotate an explicit corner without Move mode',()=>{
  openProject(pointerType);const before=state();assert.equal($('#app [data-action="move-mode"]').getAttribute('aria-pressed'),'false');
  start({pointerType,id:91,corner:'sw'});move(45);assert.ok($('.rotation-label'));drop(45);assertRigidRotation(before,state(),45);
});
