import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import Clipper from '../dist/vendor/clipper.js';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {catalogSets} from '../dist/catalog/index.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const catalog=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm');assert.equal(catalog.tools.length,26);
const tools=catalog.tools.map((item,index)=>{const tool={id:`catalog-${index}`,name:item.name.cs,points:item.points,unit:item.unit,nominalSize:{value:item.size,unit:item.unit},x:0,y:0,rotation:0,depth:Math.min(item.depth,17.6),moduleId:null,locked:false};return{...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})};});
const base={...blankProject(),id:'performance-26',name:'26 real catalogue wrenches',width:1260,height:840,tools},large=validateProject({...base,...autoArrange(base)});assert.deepEqual(validateLayout(large),[]);assert.equal(large.tools.length,26);
const rectangle=[{x:0,y:0},{x:20,y:0},{x:20,y:40},{x:0,y:40}],dragProject=validateProject({...blankProject(),id:'performance-drag',name:'Drag collision',width:420,height:252,modules:[{id:'first',name:'First',x:0,y:0,width:84,height:84,sizeMode:'manual',locked:false},{id:'second',name:'Second',x:126,y:0,width:84,height:84,sizeMode:'manual',locked:false}],tools:[{id:'drag-a',name:'A',x:20,y:20,moduleId:'first'},{id:'drag-b',name:'B',x:146,y:20,moduleId:'second'}].map(tool=>({...tool,points:rectangle,rotation:0,depth:8,fingerGrips:[],locked:false}))});assert.deepEqual(validateLayout(dragProject),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([large,dragProject]));localStorage.setItem('suplik-studio-current','"performance-26"');
// Count the real polygon engine, rather than inferring work from wall-clock time.
const nativeExecute=Clipper.Clipper.prototype.Execute,nativeOffset=Clipper.ClipperOffset.prototype.Execute;
const operations={boolean:0,offset:0};Clipper.Clipper.prototype.Execute=function(...args){operations.boolean++;return nativeExecute.apply(this,args);};Clipper.ClipperOffset.prototype.Execute=function(...args){operations.offset++;return nativeOffset.apply(this,args);};
await import('../dist/app.js');
const proto=(win.SVGSVGElement||win.SVGElement).prototype;proto.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};proto.getScreenCTM=()=>({inverse:()=>({})});proto.setPointerCapture=()=>{};proto.releasePointerCapture=()=>{};
const $=selector=>win.document.querySelector(selector),click=(selector,options={})=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,...options}));},action=name=>click(`#app [data-action="${name}"]`);
const state=()=>{const id=JSON.parse(localStorage.getItem('suplik-studio-current')),project=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===id);delete project.updatedAt;return project;};
const tick=()=>new Promise(resolve=>nativeTimeout(resolve,0)),settle=async()=>{await tick();await tick();},counts=()=>({...operations});
const pointer=(type,el,x,y,extra={})=>el.dispatchEvent(new win.PointerEvent(type,{pointerId:37,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true,...extra}));
const select=id=>click(`#board-svg .tool-outline[data-tool="${id}"]`),moduleRect=id=>$(`#board-svg [data-module="${id}"] > rect`);
after(()=>{Clipper.Clipper.prototype.Execute=nativeExecute;Clipper.ClipperOffset.prototype.Execute=nativeOffset;return win.happyDOM.abort();});

test('repeated selection across a real 26-tool catalogue drawer performs no additional polygon operations after warm-up',t=>{
  for(const tool of large.tools)select(tool.id);const before=state(),start=counts(),time=performance.now();
  for(let pass=0;pass<2;pass++)for(const tool of large.tools)select(tool.id);
  assert.deepEqual(counts(),start,'selection reuses validation and pocket geometry, including central finger bays');assert.deepEqual(state(),before);assert.ok($('#app [data-action="undo"]').disabled);t.diagnostic(`52 actual contour selections: ${Math.round(performance.now()-time)}ms; zero extra Clipper booleans or offsets`);
});

test('2D wheel zoom and right-button pan preserve the existing model DOM and only update its viewBox',async()=>{
  select(large.tools[0].id);await settle();const svg=$('#board-svg'),outline=$('#board-svg .tool-outline'),beforeBox=svg.getAttribute('viewBox'),before=state(),start=counts();svg.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});
  const wheel=new win.WheelEvent('wheel',{deltaY:-120,deltaMode:0,bubbles:true,cancelable:true});Object.defineProperties(wheel,{clientX:{value:450},clientY:{value:300}});svg.dispatchEvent(wheel);await settle();assert.notEqual(svg.getAttribute('viewBox'),beforeBox);assert.equal($('#board-svg'),svg);assert.equal($('#board-svg .tool-outline'),outline);assert.ok(outline.isConnected);
  const zoomed=svg.getAttribute('viewBox');pointer('pointerdown',svg,400,250,{button:2,buttons:2});pointer('pointermove',svg,460,280,{button:-1,buttons:2});await settle();pointer('pointerup',svg,460,280,{button:2,buttons:0});assert.notEqual(svg.getAttribute('viewBox'),zoomed);assert.equal($('#board-svg'),svg);assert.equal($('#board-svg .tool-outline'),outline);assert.deepEqual(counts(),start);assert.deepEqual(state(),before);assert.ok($('#app [data-action="undo"]').disabled);
});

test('drag preview is immediate without polygon work, marks outer module collision and rejects it on release',async()=>{
  action('projects');click('[data-open="performance-drag"]');action('2d');await settle();click(moduleRect('first'));const before=state(),start=counts();
  pointer('pointerdown',moduleRect('first'),20,20);pointer('pointermove',$('#board-svg'),146,20);assert.equal(Number(moduleRect('first').getAttribute('x')),126.9,'preview moves immediately to the snapped collision position');assert.equal(moduleRect('first').getAttribute('stroke'),'#cb7d60','outer collision is visible during the fast preview');assert.deepEqual(counts(),start);assert.deepEqual(state(),before,'preview is not persisted');
  pointer('pointerup',$('#board-svg'),146,20);assert.deepEqual(state(),before,'release cannot commit overlapping modules');assert.equal(Number(moduleRect('first').getAttribute('x')),.9);assert.ok($('#app [data-action="undo"]').disabled);assert.match($('#toast').textContent,/jiný modul/);
});

test('a valid drag remains responsive, then persists one reversible change with final geometry validation',()=>{
  const before=state(),start=counts();pointer('pointerdown',moduleRect('first'),20,20);pointer('pointermove',$('#board-svg'),20,146);assert.equal(Number(moduleRect('first').getAttribute('y')),126.9);assert.deepEqual(counts(),start);assert.deepEqual(state(),before);
  pointer('pointerup',$('#board-svg'),20,146);const moved=state();assert.equal(moved.modules.find(module=>module.id==='first').y,126);assert.equal(moved.tools.find(tool=>tool.id==='drag-a').y,146);assert.ok(!$('#app [data-action="undo"]').disabled);assert.deepEqual(validateLayout(moved),[]);assert.deepEqual(moved.modules.find(module=>module.id==='second'),before.modules.find(module=>module.id==='second'));action('undo');assert.deepEqual(state(),before);assert.ok($('#app [data-action="undo"]').disabled);
});
