// Wheel zoom and left-button panning of the recognised-tools preview.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindCanvasView,clampView,identityView,photoToView,viewToPhoto,zoomViewAt} from '../dist/capture-view.js';
import {hitCaptureItem} from '../dist/capture-context-menu.js';

function fakeCanvas(){
  const listeners=new Map(),classes=new Set();
  return {width:1000,height:500,classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),add:name=>classes.add(name),remove:name=>classes.delete(name)},classes,
    getBoundingClientRect:()=>({left:0,top:0,width:500,height:250,}),setPointerCapture(){},releasePointerCapture(){},
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),
    fire(type,event){listeners.get(type)?.({preventDefault(){this.prevented=true;},...event});},listeners};
}
function bound(view=identityView()){
  const canvas=fakeCanvas(),state={view,draws:0};
  const dispose=bindCanvasView(canvas,{getView:()=>state.view,setView:next=>{state.view=next;},draw:()=>state.draws++});
  return {canvas,state,dispose};
}

test('zooming keeps the photo point under the cursor in place',()=>{
  const anchor={x:300,y:200},before=viewToPhoto(identityView(),anchor),view=zoomViewAt(identityView(),3,anchor,1000,500),after=viewToPhoto(view,anchor);
  assert.ok(Math.abs(after.x-before.x)<1e-9&&Math.abs(after.y-before.y)<1e-9);
  const back=photoToView(view,before);assert.ok(Math.abs(back.x-anchor.x)<1e-9&&Math.abs(back.y-anchor.y)<1e-9);
});

test('the wheel zooms in and back out to the unchanged overview',()=>{
  const {canvas,state}=bound();
  canvas.fire('wheel',{deltaY:-300,deltaMode:0,clientX:150,clientY:100});
  assert.ok(state.view.zoom>1);assert.equal(canvas.classes.has('can-pan'),true);
  for(let i=0;i<20;i++)canvas.fire('wheel',{deltaY:600,deltaMode:0,clientX:400,clientY:20});
  assert.equal(state.view.zoom,1);assert.equal(state.view.x,0);assert.equal(state.view.y,0);
  assert.equal(canvas.classes.has('can-pan'),false);
});

test('the left button pans a zoomed view and the photo cannot leave the canvas',()=>{
  const {canvas,state}=bound({zoom:2,x:-500,y:-250});
  canvas.fire('pointerdown',{button:0,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:100,clientY:100});
  canvas.fire('pointermove',{pointerId:1,buttons:1,clientX:150,clientY:120});
  assert.equal(state.view.x,-400);assert.equal(state.view.y,-210);
  canvas.fire('pointermove',{pointerId:1,buttons:1,clientX:4000,clientY:4000});
  assert.equal(state.view.x,0);assert.equal(state.view.y,0);
  canvas.fire('pointerup',{pointerId:1});
  canvas.fire('pointermove',{pointerId:1,buttons:1,clientX:0,clientY:0});
  assert.equal(state.view.x,0,'moving after release does nothing');
});

test('the right button and touch never navigate',()=>{
  const {canvas,state}=bound({zoom:2,x:-500,y:-250});
  canvas.fire('pointerdown',{button:2,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:100,clientY:100});
  canvas.fire('pointermove',{pointerId:1,buttons:2,clientX:200,clientY:200});
  canvas.fire('pointerdown',{button:0,pointerId:2,pointerType:'touch',isPrimary:true,clientX:100,clientY:100});
  canvas.fire('pointermove',{pointerId:2,buttons:1,clientX:200,clientY:200});
  assert.equal(state.view.x,-500);assert.equal(state.view.y,-250);
});

test('the tool menu still hits the right tool on a zoomed view',()=>{
  const items=[{contour:{points:[{x:100,y:100},{x:140,y:100},{x:140,y:140},{x:100,y:140}]},info:{center:{x:120,y:120}}}];
  const view=clampView({zoom:4,x:-300,y:-300},1000,500),screen=photoToView(view,{x:120,y:120});
  assert.equal(hitCaptureItem(items,viewToPhoto(view,screen),{scale:1}),0);
  assert.equal(hitCaptureItem(items,screen,{scale:1}),null,'unmapped canvas coordinates would miss it');
});

test('disposing removes the listeners',()=>{
  const {canvas,dispose}=bound();dispose();assert.equal(canvas.listeners.size,0);
});
