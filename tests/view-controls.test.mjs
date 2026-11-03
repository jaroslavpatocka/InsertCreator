import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createCamera3D} from '../dist/preview3d.js';
import {createViewControls,wheelPixels} from '../dist/view-controls.js';

function fixture(t){
  const win=new Window({url:'http://localhost/'});win.document.body.innerHTML='<div id="host"><svg><polygon data-module="one"/></svg></div><div id="outside"></div>';
  const svg=win.document.querySelector('svg'),callbacks=new Map(),capture=[],release=[];let camera=createCamera3D(),nextId=0,renders=0,selections=0;
  svg.getBoundingClientRect=()=>({left:100,top:50,width:800,height:500});
  svg.setPointerCapture=id=>capture.push(id);svg.releasePointerCapture=id=>release.push(id);
  win.document.querySelector('#host').addEventListener('click',()=>selections++);
  const controls=createViewControls(svg,{getCamera:()=>camera,setCamera:value=>camera=value,getFrame:()=>({width:1000/camera.zoom,height:625/camera.zoom}),render:()=>renders++,requestFrame:callback=>{callbacks.set(++nextId,callback);return nextId;},cancelFrame:id=>callbacks.delete(id)});
  t.after(async()=>{controls.dispose();await win.happyDOM.close();});
  return {win,svg,capture,release,controls,callbacks,get camera(){return camera;},get renders(){return renders;},get selections(){return selections;},flush(){const pending=[...callbacks.values()];callbacks.clear();pending.forEach(callback=>callback());},pointer(type,extra={}){const event=new win.PointerEvent(type,{pointerType:'mouse',pointerId:7,isPrimary:true,button:0,buttons:1,clientX:300,clientY:200,bubbles:true,cancelable:true,...extra});svg.dispatchEvent(event);return event;},wheel(extra={}){const event=new win.WheelEvent('wheel',{deltaY:100,deltaMode:0,bubbles:true,cancelable:true,...extra});Object.defineProperties(event,{clientX:{value:extra.clientX??700},clientY:{value:extra.clientY??150}});svg.dispatchEvent(event);return event;}};
}

test('orbit batches rendering and suppresses only the click following a drag',t=>{
  const f=fixture(t),before=f.camera;
  assert.equal(f.pointer('pointerdown').defaultPrevented,true);assert.deepEqual(f.capture,[7]);
  f.pointer('pointermove',{clientX:340,clientY:220});f.pointer('pointermove',{clientX:370,clientY:230});
  assert.notEqual(f.camera.yaw,before.yaw);assert.notEqual(f.camera.pitch,before.pitch);assert.equal(f.renders,0);assert.equal(f.callbacks.size,1);assert.ok(f.svg.classList.contains('is-navigating'));
  f.flush();assert.equal(f.renders,1);f.pointer('pointerup',{buttons:0});assert.deepEqual(f.release,[7]);assert.equal(f.svg.classList.contains('is-navigating'),false);
  const click=new f.win.MouseEvent('click',{bubbles:true,cancelable:true,button:0});f.svg.dispatchEvent(click);assert.equal(click.defaultPrevented,true);assert.equal(f.selections,0);
  f.pointer('pointerdown');f.pointer('pointerup',{buttons:0});f.svg.dispatchEvent(new f.win.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));assert.equal(f.selections,1);
});

test('right dragging pans in projection units without changing camera orientation',t=>{
  const f=fixture(t),before=f.camera;
  f.pointer('pointerdown',{button:2,buttons:2});f.pointer('pointermove',{button:-1,buttons:2,clientX:380,clientY:240});f.pointer('pointerup',{button:2,buttons:0});
  assert.ok(Math.abs(f.camera.yaw-before.yaw)<1e-12);assert.equal(f.camera.pitch,before.pitch);assert.equal(f.camera.panX,-100);assert.equal(f.camera.panY,-50);assert.equal(f.camera.zoom,1);
});

test('batched wheel zoom preserves the projected point under the cursor and normalizes units',t=>{
  const f=fixture(t),point=()=>({x:f.camera.panX+.25*1000/f.camera.zoom,y:f.camera.panY-.3*625/f.camera.zoom}),before=point();
  assert.equal(f.wheel().defaultPrevented,true);f.wheel();f.wheel({deltaMode:1,deltaY:3});assert.equal(f.callbacks.size,1);assert.ok(f.camera.zoom<1);
  const after=point();assert.ok(Math.abs(after.x-before.x)<1e-9);assert.ok(Math.abs(after.y-before.y)<1e-9);f.flush();assert.equal(f.renders,1);
  assert.equal(wheelPixels({deltaY:3,deltaMode:1},500),48);assert.equal(wheelPixels({deltaY:1,deltaMode:2},500),500);assert.equal(wheelPixels({deltaY:NaN,deltaMode:0},500),0);
  for(let i=0;i<20;i++)f.wheel({deltaY:-10000});assert.ok(Object.values(f.camera).every(Number.isFinite));assert.ok(f.camera.zoom>=1);
});

test('pointer cancellation, lost capture and disposal cannot leave a sticky drag',t=>{
  const f=fixture(t);
  for(const end of ['pointercancel','lostpointercapture']){
    f.pointer('pointerdown');f.pointer('pointermove',{clientX:330});f.pointer(end,{buttons:0});const before=f.camera;
    f.pointer('pointermove',{clientX:700});assert.deepEqual(f.camera,before);assert.equal(f.svg.classList.contains('is-navigating'),false);
  }
  f.pointer('pointerdown');f.pointer('pointermove',{clientX:350});f.controls.dispose();const before=f.camera;
  assert.equal(f.callbacks.size,0);f.pointer('pointermove',{clientX:600});f.wheel();assert.deepEqual(f.camera,before);
});

test('context menu suppression stays inside the controlled SVG',t=>{
  const f=fixture(t),inside=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}),outside=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});
  f.svg.dispatchEvent(inside);f.win.document.querySelector('#outside').dispatchEvent(outside);assert.equal(inside.defaultPrevented,true);assert.equal(outside.defaultPrevented,false);
});
