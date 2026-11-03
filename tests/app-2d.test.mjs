import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
win.scrollTo=()=>{};
const pendingFrames=new Map();let nextFrame=0;
globalThis.requestAnimationFrame=win.requestAnimationFrame=callback=>{pendingFrames.set(++nextFrame,callback);return nextFrame;};
globalThis.cancelAnimationFrame=win.cancelAnimationFrame=id=>pendingFrames.delete(id);
async function paint(){
  for(let i=0;pendingFrames.size&&i<12;i++){
    const callbacks=[...pendingFrames.values()];pendingFrames.clear();
    for(const callback of callbacks)callback(performance.now());
    await Promise.resolve();
  }
  assert.equal(pendingFrames.size,0,'camera painting must settle');
}
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const rectangle={x:100,y:50,left:100,top:50,right:900,bottom:550,width:800,height:500,toJSON(){return this;}};
const originalRect=win.Element.prototype.getBoundingClientRect;
win.Element.prototype.getBoundingClientRect=function(){return ['board-svg','board-area'].includes(this.id)?rectangle:originalRect.call(this);};
const captured=new Map();
win.Element.prototype.setPointerCapture=function(id){captured.set(id,this);};
win.Element.prototype.hasPointerCapture=function(id){return captured.get(id)===this;};
win.Element.prototype.releasePointerCapture=function(id){if(captured.get(id)===this)captured.delete(id);};
const svgPrototype=(win.SVGSVGElement||win.SVGElement).prototype;
// Editor drags use mm directly in this DOM fixture; camera checks use the actual viewBox mapping below.
svgPrototype.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
svgPrototype.getScreenCTM=()=>({inverse:()=>({})});
const points=[{x:0,y:0},{x:20,y:0},{x:20,y:40},{x:0,y:40}];
function fixture(id,name,width=252,height=168){
  return {...blankProject(),id,name,width,height,printMode:'solid',limitToBed:false,
    modules:[{id:'m-move',name:'Volný modul',x:0,y:0,width:84,height:84,locked:false,sizeMode:'auto'},{id:'m-locked',name:'Zamčený modul',x:84,y:0,width:84,height:84,locked:true,sizeMode:'auto'}],
    tools:[{id:'t-move',name:'Volný nástroj',points,x:20,y:20,rotation:0,depth:10,moduleId:'m-move',locked:false,fingerGrips:[]},{id:'t-locked',name:'Zamčený nástroj',points,x:104,y:20,rotation:0,depth:10,moduleId:'m-locked',locked:true,fingerGrips:[]}]};
}
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([fixture('camera-main','Kamera A'),fixture('camera-other','Kamera B',294,210)]));
localStorage.setItem('suplik-studio-current',JSON.stringify('camera-main'));
const $=selector=>win.document.querySelector(selector);
const action=name=>{const button=$(`#app [data-action="${name}"]`);assert.ok(button,'Missing action '+name);button.click();};
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const serialized=()=>localStorage.getItem('suplik-studio-projects-v1');
const history=()=>({undo:$('#app [data-action=undo]').disabled,redo:$('#app [data-action=redo]').disabled});
const board=()=>$('#board-svg');
const box=()=>{const values=board().getAttribute('viewBox').trim().split(/[ ,]+/).map(Number);assert.equal(values.length,4);assert.ok(values.every(Number.isFinite));return{x:values[0],y:values[1],width:values[2],height:values[3]};};
const percent=()=>Number($('[data-zoom-value]').textContent.match(/[\d.]+/)[0]);
function pointer(type,target=board(),{id=1,button=2,x=350,y=250,buttons=type==='pointerup'||type==='pointercancel'?0:button===2?2:1,pointerType='mouse'}={}){
  const event=new win.PointerEvent(type,{pointerId:id,pointerType,isPrimary:true,button,buttons,clientX:x,clientY:y,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;
}
function wheel(target=board(),{deltaY=-120,x=700,y=220,deltaMode=0}={}){
  const event=new win.WheelEvent('wheel',{deltaY,deltaMode,clientX:x,clientY:y,bubbles:true,cancelable:true});
  if(event.clientX===undefined)Object.defineProperties(event,{clientX:{value:x},clientY:{value:y}});
  target.dispatchEvent(event);return event;
}
async function drag(target,button,dx,dy,{id=1,end='pointerup'}={}){
  const down=pointer('pointerdown',target,{id,button});
  pointer('pointermove',board(),{id,button:-1,buttons:button===2?2:1,x:350+dx,y:250+dy});await paint();
  pointer(end,board(),{id,button,x:350+dx,y:250+dy,buttons:0});await paint();return down;
}
function screenPoint(point,bounds=box()){
  const scale=Math.min(rectangle.width/bounds.width,rectangle.height/bounds.height);
  return{x:rectangle.left+(rectangle.width-bounds.width*scale)/2+(point.x-bounds.x)*scale,y:rectangle.top+(rectangle.height-bounds.height*scale)/2+(point.y-bounds.y)*scale};
}
function worldPoint(x,y,bounds=box()){
  const scale=Math.min(rectangle.width/bounds.width,rectangle.height/bounds.height);
  return{x:bounds.x+(x-rectangle.left-(rectangle.width-bounds.width*scale)/2)/scale,y:bounds.y+(y-rectangle.top-(rectangle.height-bounds.height*scale)/2)/scale};
}
async function reset(){action('projects');$('[data-open="camera-main"]').click();action('2d');action('fit');await paint();}
function unchanged(snapshot,undo){assert.equal(serialized(),snapshot,'camera navigation must not change project data or updatedAt');assert.deepEqual(history(),undo,'camera navigation must not add undo/redo entries');}
await import('../dist/app.js');await paint();

test('2D camera controls integrate without changing editor data or history',async t=>{
  t.after(async()=>{await win.happyDOM.close();});
  await t.test('right pan works on background and locked modules without moving their geometry',async()=>{
    await reset();const snapshot=serialized(),undo=history();
    for(const selector of [null,'[data-module="m-move"]','[data-module="m-locked"]']){
      const before=box(),origin=screenPoint({x:0,y:0}),target=selector?board().querySelector(selector):board();
      const down=await drag(target,2,64,-32);assert.equal(down.defaultPrevented,true);
      const moved=screenPoint({x:0,y:0});assert.notDeepEqual(box(),before);assert.equal(box().width,before.width);assert.equal(box().height,before.height);
      assert.ok(Math.abs(moved.x-origin.x-64)<.01);assert.ok(Math.abs(moved.y-origin.y+32)<.01);unchanged(snapshot,undo);
    }
  });
  await t.test('wheel zoom preserves the cursor anchor and updates the visible percentage',async()=>{
    await reset();const snapshot=serialized(),undo=history(),before=box(),anchor={x:720,y:170},world=worldPoint(anchor.x,anchor.y);
    assert.equal(wheel(board(),{x:anchor.x,y:anchor.y}).defaultPrevented,true);await paint();
    assert.ok(box().width<before.width);assert.ok(percent()>100);const fixed=screenPoint(world);
    assert.ok(Math.abs(fixed.x-anchor.x)<.01);assert.ok(Math.abs(fixed.y-anchor.y)<.01);
    wheel(board(),{deltaY:-1e9});await paint();assert.equal(percent(),300);const max=box();wheel(board(),{deltaY:-1e9});await paint();assert.deepEqual(box(),max);
    wheel(board(),{deltaY:1e9});await paint();assert.equal(percent(),50);
    assert.equal(wheel($('.board-toolbar')).defaultPrevented,false);unchanged(snapshot,undo);
  });
  await t.test('left tool drag still edits the project while its camera stays unchanged',async()=>{
    await reset();wheel();await paint();await drag(board(),2,40,-20);
    const before=saved(),camera=box(),label=percent();
    await drag(board().querySelector('[data-module="m-move"] .tool-outline'),0,0,42,{id:9});
    assert.equal(saved().modules.find(m=>m.id==='m-move').y,before.modules.find(m=>m.id==='m-move').y+42);
    assert.deepEqual(box(),camera);assert.equal(percent(),label);assert.equal(history().undo,false);
    const snapshot=serialized(),undo=history();await drag(board(),2,-20,15);wheel();await paint();unchanged(snapshot,undo);
    action('undo');assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().tools,before.tools,'one undo must reach the real edit');
  });
  await t.test('mode switches retain 2D pan and zoom, Fit and project changes reset them',async()=>{
    await reset();const initial=box(),snapshot=serialized(),undo=history();
    await drag(board(),2,55,-20);wheel();await paint();const changed=box(),label=percent();
    action('3d');await paint();action('2d');await paint();assert.deepEqual(box(),changed);assert.equal(percent(),label);unchanged(snapshot,undo);
    action('fit');await paint();assert.deepEqual(box(),initial);assert.equal(percent(),100);unchanged(snapshot,undo);
    await drag(board(),2,55,-20);wheel();await paint();
    action('projects');$('[data-open="camera-other"]').click();await paint();assert.equal(percent(),100);
    action('projects');$('[data-open="camera-main"]').click();await paint();assert.deepEqual(box(),initial);assert.equal(percent(),100);
  });
  await t.test('cancellation and blur stop navigation and allow a new right drag',async()=>{
    await reset();const snapshot=serialized(),undo=history();
    for(const end of ['pointercancel','lostpointercapture','blur']){
      pointer('pointerdown',board(),{id:20});pointer('pointermove',board(),{id:20,buttons:2,x:390,y:265});await paint();
      if(end==='blur')win.dispatchEvent(new win.Event('blur'));else pointer(end,board(),{id:20,buttons:0});
      const stopped=box();pointer('pointermove',board(),{id:20,buttons:2,x:700,y:500});await paint();assert.deepEqual(box(),stopped);
      assert.equal(board().classList.contains('is-navigating'),false);
      await drag(board(),2,-25,-10,{id:21});assert.notDeepEqual(box(),stopped);
    }
    unchanged(snapshot,undo);
  });
});
