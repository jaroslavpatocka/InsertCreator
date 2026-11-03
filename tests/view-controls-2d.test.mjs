import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createViewControls2D,normalizeCamera2D} from '../dist/view-controls.js';

function fixture(t,{width=800,height=500,frameWidth=1000,frameHeight=625}={}){
  const win=new Window({url:'http://localhost/'});
  win.document.body.innerHTML='<div id="host"><svg><g data-module="one"><path/></g></svg></div><div id="outside"></div>';
  const svg=win.document.querySelector('svg'),callbacks=new Map(),capture=[],release=[];
  let camera=normalizeCamera2D(),nextId=0,renders=0,selections=0,editorDowns=0;
  svg.getBoundingClientRect=()=>({left:100,top:50,width,height});
  svg.setPointerCapture=id=>capture.push(id);svg.releasePointerCapture=id=>release.push(id);
  const host=win.document.querySelector('#host');host.addEventListener('click',()=>selections++);host.addEventListener('pointerdown',()=>editorDowns++);
  const controls=createViewControls2D(svg,{getCamera:()=>camera,setCamera:value=>camera=value,getFrame:()=>({width:frameWidth/camera.zoom,height:frameHeight/camera.zoom}),render:()=>renders++,requestFrame:callback=>{callbacks.set(++nextId,callback);return nextId;},cancelFrame:id=>callbacks.delete(id)});
  t.after(async()=>{controls.dispose();await win.happyDOM.close();});
  return {win,svg,controls,callbacks,capture,release,get camera(){return camera;},get renders(){return renders;},get selections(){return selections;},get editorDowns(){return editorDowns;},
    flush(){const pending=[...callbacks.values()];callbacks.clear();pending.forEach(callback=>callback());},
    pointer(type,extra={},target=svg){const event=new win.PointerEvent(type,{pointerType:'mouse',pointerId:7,isPrimary:true,button:2,buttons:2,clientX:300,clientY:200,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event;},
    wheel(extra={}){const event=new win.WheelEvent('wheel',{deltaY:100,deltaMode:0,bubbles:true,cancelable:true,...extra});Object.defineProperties(event,{clientX:{value:extra.clientX??700},clientY:{value:extra.clientY??150}});svg.dispatchEvent(event);return event;}
  };
}

test('2D right drag pans in viewBox units and batches rendering',t=>{
  const f=fixture(t);
  assert.equal(f.pointer('pointerdown').defaultPrevented,true);assert.deepEqual(f.capture,[7]);assert.equal(f.editorDowns,0);
  f.pointer('pointermove',{clientX:340,clientY:220});f.pointer('pointermove',{clientX:380,clientY:240});
  assert.deepEqual(f.camera,{zoom:1,panX:-100,panY:-50});assert.equal(f.renders,0);assert.equal(f.callbacks.size,1);assert.ok(f.svg.classList.contains('is-navigating'));
  f.flush();assert.equal(f.renders,1);f.pointer('pointerup',{buttons:0});assert.deepEqual(f.release,[7]);assert.equal(f.svg.classList.contains('is-navigating'),false);
  const click=new f.win.MouseEvent('click',{bubbles:true,cancelable:true});f.svg.dispatchEvent(click);assert.equal(click.defaultPrevented,true);assert.equal(f.selections,0);
});

test('2D leaves left-button tool editing and normal selection untouched',t=>{
  const f=fixture(t),target=f.svg.querySelector('path'),before=f.camera;
  assert.equal(f.pointer('pointerdown',{button:0,buttons:1},target).defaultPrevented,false);
  f.pointer('pointermove',{button:0,buttons:1,clientX:480},target);f.pointer('pointerup',{button:0,buttons:0},target);
  const click=new f.win.MouseEvent('click',{bubbles:true,cancelable:true});target.dispatchEvent(click);
  assert.equal(click.defaultPrevented,false);assert.equal(f.selections,1);assert.equal(f.editorDowns,1);assert.deepEqual(f.camera,before);assert.deepEqual(f.capture,[]);
});

test('2D wheel keeps the cursor point fixed across pixel, line and page units',t=>{
  const f=fixture(t),point=()=>({x:f.camera.panX+.25*1000/f.camera.zoom,y:f.camera.panY-.3*625/f.camera.zoom}),before=point();
  assert.equal(f.wheel({deltaY:-100}).defaultPrevented,true);f.wheel({deltaMode:1,deltaY:-3});f.wheel({deltaMode:2,deltaY:-.2});
  const after=point();assert.ok(f.camera.zoom>1);assert.equal(f.callbacks.size,1);
  assert.ok(Math.abs(after.x-before.x)<1e-9);assert.ok(Math.abs(after.y-before.y)<1e-9);
  f.flush();assert.equal(f.renders,1);
  f.wheel({deltaY:-10000});assert.equal(f.camera.zoom,3);const atLimit={...f.camera};f.wheel({deltaY:-10000});assert.deepEqual(f.camera,atLimit);
  f.wheel({deltaY:10000});assert.equal(f.camera.zoom,.5);assert.ok(Object.values(f.camera).every(Number.isFinite));
});

test('2D pan and cursor anchoring account for SVG letterboxing',t=>{
  const f=fixture(t,{width:800,height:800,frameWidth:1000,frameHeight:500});
  // The 1000×500 viewBox occupies y=250..650, with 200 px top/bottom letterboxes.
  f.pointer('pointerdown');f.pointer('pointermove',{clientX:380,clientY:240});f.pointer('pointerup',{buttons:0});
  assert.deepEqual(f.camera,{zoom:1,panX:-100,panY:-50});
  const point=()=>({x:f.camera.panX+.25*1000/f.camera.zoom,y:f.camera.panY-.25*500/f.camera.zoom}),before=point();
  f.wheel({clientX:700,clientY:350,deltaY:-100});const after=point();
  assert.ok(Math.abs(after.x-before.x)<1e-9);assert.ok(Math.abs(after.y-before.y)<1e-9);
});

test('2D cancellation, released buttons, blur and disposal end navigation',t=>{
  const f=fixture(t);
  for(const end of ['pointercancel','lostpointercapture','blur','released']){
    f.pointer('pointerdown');f.pointer('pointermove',{clientX:330});
    if(end==='blur')f.win.dispatchEvent(new f.win.Event('blur'));
    else if(end==='released')f.pointer('pointermove',{clientX:330,buttons:0});
    else f.pointer(end,{buttons:0});
    const before={...f.camera};f.pointer('pointermove',{clientX:700});assert.deepEqual(f.camera,before);assert.equal(f.svg.classList.contains('is-navigating'),false);
  }
  f.pointer('pointerdown');f.pointer('pointermove',{clientX:350});f.controls.dispose();const before={...f.camera};
  assert.equal(f.callbacks.size,0);f.pointer('pointermove',{clientX:600});f.wheel();assert.deepEqual(f.camera,before);
  f.win.dispatchEvent(new f.win.Event('resize'));assert.equal(f.callbacks.size,0);
});

test('2D context menu suppression remains local and invalid camera values normalize',t=>{
  const f=fixture(t),inside=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}),outside=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});
  f.svg.dispatchEvent(inside);f.win.document.querySelector('#outside').dispatchEvent(outside);assert.equal(inside.defaultPrevented,true);assert.equal(outside.defaultPrevented,false);
  assert.deepEqual(normalizeCamera2D({zoom:Infinity,panX:NaN,panY:Infinity}),{zoom:1,panX:0,panY:0});
  assert.deepEqual(normalizeCamera2D({zoom:9,panX:2,panY:-4}),{zoom:3,panX:2,panY:-4});
});
