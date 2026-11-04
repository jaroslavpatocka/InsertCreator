import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
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
  const started=performance.now();
  while(performance.now()-started<10000){
    const callbacks=[...pendingFrames.values()];pendingFrames.clear();
    for(const callback of callbacks)callback(performance.now());
    await Promise.resolve();
    if(!pendingFrames.size&&!win.document.querySelector('[data-preview-state][aria-busy="true"]'))return;
    await new Promise(resolve=>nativeSetTimeout(resolve,2));
  }
  assert.fail('camera painting and the asynchronous preview must settle: '+win.document.querySelector('[data-preview-state]')?.textContent);
}
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const workers=[];let previewRequests=0;
globalThis.Worker=class BrowserWorker{
  constructor(url){
    this.native=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.push(this);
    this.native.on('message',data=>this.onmessage?.({data}));this.native.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));this.native.on('messageerror',()=>this.onmessageerror?.());
  }
  postMessage(data){if(data.operation==='preview')previewRequests++;this.native.postMessage(data);}
  terminate(){return this.native.terminate();}
};

const rectangle={x:100,y:50,left:100,top:50,right:900,bottom:550,width:800,height:500,toJSON(){return this;}};
const originalRect=win.Element.prototype.getBoundingClientRect;
win.Element.prototype.getBoundingClientRect=function(){return ['board-svg','board-area'].includes(this.id)?rectangle:originalRect.call(this);};
const captured=new Map();
win.Element.prototype.setPointerCapture=function(id){captured.set(id,this);};
win.Element.prototype.hasPointerCapture=function(id){return captured.get(id)===this;};
win.Element.prototype.releasePointerCapture=function(id){if(captured.get(id)===this)captured.delete(id);};
const svgPrototype=(win.SVGSVGElement||win.SVGElement).prototype;
svgPrototype.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
svgPrototype.getScreenCTM=()=>({inverse:()=>({})});

const points=[{x:0,y:0},{x:20,y:0},{x:20,y:40},{x:0,y:40}];
function fixture(id,name,width=252,height=168){
  return {...blankProject(),id,name,width,height,printMode:'solid',limitToBed:false,
    modules:[{id:'m-move',name:'Volný modul',x:0,y:0,width:84,height:84,locked:false,sizeMode:'auto'},{id:'m-locked',name:'Zamčený modul',x:84,y:0,width:84,height:84,locked:true,sizeMode:'auto'}],
    tools:[{id:'t-move',name:'Volný nástroj',points,x:20,y:20,rotation:0,depth:10,moduleId:'m-move',locked:false,fingerGrips:[]},{id:'t-locked',name:'Zamčený nástroj',points,x:104,y:20,rotation:0,depth:10,moduleId:'m-locked',locked:true,fingerGrips:[]}]};
}
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([fixture('camera-main','Kamera A'),fixture('camera-other','Kamera B',294,210),{...fixture('camera-empty','Prázdný šuplík'),modules:[],tools:[]}]));
localStorage.setItem('suplik-studio-current',JSON.stringify('camera-main'));
const $=selector=>win.document.querySelector(selector);
const action=name=>{const button=$(`#app [data-action="${name}"]`);assert.ok(button,'Missing action '+name);button.click();};
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const serialized=()=>localStorage.getItem('suplik-studio-projects-v1');
const history=()=>({undo:$('#app [data-action=undo]').disabled,redo:$('#app [data-action=redo]').disabled});
const board=()=>$('#board-svg');
const geometry=()=>[...board().querySelectorAll('polygon')].map(el=>el.getAttribute('points')).join('|');
const box=()=>{const values=board().getAttribute('viewBox').trim().split(/[ ,]+/).map(Number);assert.equal(values.length,4);assert.ok(values.every(Number.isFinite));assert.ok(values[2]>0&&values[3]>0);return{x:values[0],y:values[1],width:values[2],height:values[3]};};
function zoomPercent(){const text=$('#app [data-action=zoom-in]').parentElement.textContent,match=text.match(/([\d,.]+)\s*%/);assert.ok(match,'the active camera zoom must be visible');return Number(match[1].replace(',','.'));}
function pointer(type,target=board(),{id=1,button=0,x=350,y=250,buttons=type==='pointerup'||type==='pointercancel'?0:button===2?2:1,pointerType='mouse'}={}){
  const event=new win.PointerEvent(type,{pointerId:id,pointerType,isPrimary:true,button,buttons,clientX:x,clientY:y,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;
}
function wheel(target=board(),{deltaY=-120,x=700,y=220,deltaMode=0}={}){
  const event=new win.WheelEvent('wheel',{deltaY,deltaMode,clientX:x,clientY:y,bubbles:true,cancelable:true});
  // Happy DOM's WheelEvent lacks the standard MouseEvent coordinates.
  if(event.clientX===undefined)Object.defineProperties(event,{clientX:{value:x},clientY:{value:y}});
  target.dispatchEvent(event);return event;
}
async function drag(target,button,dx,dy,{id=1,end='pointerup',postClick=false}={}){
  const down=pointer('pointerdown',target,{id,button});
  pointer('pointermove',board(),{id,button:-1,buttons:button===2?2:1,x:350+dx,y:250+dy});await paint();
  const rendered=geometry(),view=box();
  pointer(end,board(),{id,button,x:350+dx,y:250+dy,buttons:0});
  if(postClick)board().querySelector('[data-module]')?.dispatchEvent(new win.MouseEvent('click',{button:0,detail:1,bubbles:true,cancelable:true}));
  await paint();if(postClick){assert.equal(geometry(),rendered,'the post-drag click must not change the camera');assert.deepEqual(box(),view);}
  return down;
}
function screenPoint(point,bounds=box()){
  const scale=Math.min(rectangle.width/bounds.width,rectangle.height/bounds.height);
  return{x:rectangle.left+(rectangle.width-bounds.width*scale)/2+(point.x-bounds.x)*scale,y:rectangle.top+(rectangle.height-bounds.height*scale)/2+(point.y-bounds.y)*scale};
}
function worldPoint(x,y,bounds=box()){
  const scale=Math.min(rectangle.width/bounds.width,rectangle.height/bounds.height);
  return{x:bounds.x+(x-rectangle.left-(rectangle.width-bounds.width*scale)/2)/scale,y:bounds.y+(y-rectangle.top-(rectangle.height-bounds.height*scale)/2)/scale};
}
async function reset(){
  action('projects');$('[data-open="camera-main"]').click();action('3d');action('fit');await paint();
}
function unchanged(snapshot,undo){assert.equal(serialized(),snapshot,'camera navigation must not write project data or updatedAt');assert.deepEqual(history(),undo,'camera navigation must not add undo/redo entries');}
await import('../dist/app.js');await paint();

test('3D mouse navigation changes only the camera and preserves normal 2D behavior',async t=>{
  t.after(async()=>{win.dispatchEvent(new win.Event('pagehide'));await Promise.all(workers.map(worker=>worker.terminate()));await win.happyDOM.close();});
  await t.test('left drag orbits over background, unlocked and locked modules without editing data or undo',async()=>{
    await reset();action('2d');
    const field=$('#app [data-field=width]'),originalWidth=saved().width;field.value=String(originalWidth+42);field.dispatchEvent(new win.Event('change',{bubbles:true}));action('3d');await paint();
    const snapshot=serialized(),undo=history();assert.equal(undo.undo,false);
    for(const selector of [null,'[data-module="m-move"]','[data-module="m-locked"]']){
      const before=geometry(),target=selector?board().querySelector(selector):board();assert.ok(target);
      const down=await drag(target,0,55,20,{postClick:true});
      assert.equal(down.defaultPrevented,true);assert.ok(geometry()!==before,'left drag must orbit the rendered mesh');unchanged(snapshot,undo);
    }
    action('undo');assert.equal(saved().width,originalWidth,'one undo must still reach the preceding real edit');
    action('redo');assert.equal(saved().width,originalWidth+42);
  });

  await t.test('right drag pans the model in screen pixels without rotating it',async()=>{
    await reset();const snapshot=serialized(),undo=history(),before=box(),mesh=geometry(),origin=screenPoint({x:0,y:0},before);
    const retained=board().querySelector('[data-module]'),requests=previewRequests;
    await drag(board().querySelector('[data-module="m-locked"]'),2,64,-32);
    const after=box(),moved=screenPoint({x:0,y:0},after);
    assert.equal(geometry(),mesh,'pan must preserve the projected orientation');
    assert.notDeepEqual(after,before);assert.ok(Math.abs(moved.x-origin.x-64)<1);assert.ok(Math.abs(moved.y-origin.y+32)<1);
    assert.equal(board().querySelector('[data-module]'),retained,'pan keeps the existing SVG mesh nodes');assert.equal(previewRequests,requests,'pan must not request another worker render');
    unchanged(snapshot,undo);
  });

  await t.test('wheel zoom is cursor anchored, clamped and confined to the 3D board',async()=>{
    await reset();const snapshot=serialized(),undo=history(),before=box(),anchor={x:720,y:170},world=worldPoint(anchor.x,anchor.y,before);
    const retained=board().querySelector('[data-module]'),requests=previewRequests;
    assert.equal(wheel(board(),{x:anchor.x,y:anchor.y}).defaultPrevented,true);await paint();
    assert.ok(box().width<before.width);assert.ok(zoomPercent()>100);
    const fixed=screenPoint(world);assert.ok(Math.abs(fixed.x-anchor.x)<.01);assert.ok(Math.abs(fixed.y-anchor.y)<.01);
    wheel(board(),{deltaY:-1e9});await paint();const maximum=box(),maxPercent=zoomPercent();
    wheel(board(),{deltaY:-1e9});await paint();assert.deepEqual(box(),maximum);assert.equal(zoomPercent(),maxPercent);
    wheel(board(),{deltaY:1e9});await paint();const minimum=box(),minPercent=zoomPercent();
    wheel(board(),{deltaY:1e9});await paint();assert.deepEqual(box(),minimum);assert.equal(zoomPercent(),minPercent);
    assert.ok(Number.isFinite(maxPercent)&&maxPercent>100);assert.ok(Number.isFinite(minPercent)&&minPercent>0&&minPercent<100);
    assert.equal(wheel($('.board-toolbar')).defaultPrevented,false,'wheel outside the SVG must keep scrolling the page');
    assert.equal(board().querySelector('[data-module]'),retained,'zoom changes the viewBox without replacing mesh nodes');assert.equal(previewRequests,requests,'zoom must not request another worker render');
    unchanged(snapshot,undo);
  });

  await t.test('zoom buttons work and Fit restores orbit, pan and zoom together',async()=>{
    await reset();const snapshot=serialized(),undo=history(),initial=box(),mesh=geometry();
    action('zoom-in');await paint();const zoomed=box();assert.ok(zoomed.width<initial.width);assert.ok(zoomPercent()>100);
    action('zoom-out');await paint();assert.ok(box().width>zoomed.width);
    await drag(board(),0,80,-30);await drag(board(),2,40,60);wheel();await paint();
    action('fit');await paint();assert.deepEqual(box(),initial);assert.equal(geometry(),mesh);assert.equal(zoomPercent(),100);
    unchanged(snapshot,undo);
  });

  await t.test('2D/3D switches preserve the camera while a project switch resets it',async()=>{
    await reset();const initial=box(),initialMesh=geometry(),snapshot=serialized(),undo=history();
    await drag(board(),0,73,22);await drag(board(),2,35,-18);wheel();await paint();
    const changed=box(),changedMesh=geometry(),percent=zoomPercent();
    assert.ok(changedMesh!==initialMesh,'orbit must visibly change the camera before switching modes');assert.notDeepEqual(changed,initial);
    action('2d');await paint();action('3d');await paint();
    assert.deepEqual(box(),changed);assert.equal(geometry(),changedMesh);assert.equal(zoomPercent(),percent);unchanged(snapshot,undo);
    action('projects');$('[data-open="camera-other"]').click();await paint();action('projects');$('[data-open="camera-main"]').click();action('3d');await paint();
    assert.deepEqual(box(),initial);assert.equal(geometry(),initialMesh);assert.equal(zoomPercent(),100);
  });

  await t.test('cancel and lost capture stop gestures, ignore late moves and allow another drag',async()=>{
    await reset();const snapshot=serialized(),undo=history();
    for(const end of ['pointercancel','lostpointercapture']){
      await drag(board().querySelector('[data-module="m-move"]'),0,40,15,{id:7,end});
      const stopped=box(),mesh=geometry();
      pointer('pointermove',board(),{id:7,x:850,y:500});await paint();assert.deepEqual(box(),stopped);assert.equal(geometry(),mesh);
      pointer('pointerup',board(),{id:7,buttons:0});await paint();
      await drag(board(),0,-25,-10,{id:8,postClick:true});assert.ok(geometry()!==mesh,'a terminated gesture must not leave controls stuck');
    }
    unchanged(snapshot,undo);
  });

  await t.test('context menu is prevented on the board, while 2D touch scroll and left drag remain usable',async()=>{
    await reset();const snapshot=serialized(),undo=history();
    const context=target=>{const event=new win.MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true});target.dispatchEvent(event);return event.defaultPrevented;};
    assert.equal(context(board()),true);assert.equal(context(board().querySelector('[data-module]')),true);assert.equal(context($('.board-toolbar')),false);unchanged(snapshot,undo);
    action('2d');await paint();assert.equal(context(board()),true);assert.equal(wheel().defaultPrevented,true);await paint();
    const before=saved(),touch=pointer('pointerdown',board().querySelector('[data-module="m-move"]'),{pointerType:'touch',id:21});
    pointer('pointermove',board(),{pointerType:'touch',id:21,y:340});pointer('pointerup',board(),{pointerType:'touch',id:21,buttons:0});await paint();
    assert.equal(touch.defaultPrevented,false);assert.deepEqual(saved(),before,'a normal 2D touch must not move tools');
    await drag(board().querySelector('[data-module="m-move"]'),0,0,42,{id:22});
    assert.equal(saved().modules.find(m=>m.id==='m-move').y,before.modules.find(m=>m.id==='m-move').y+42,'2D left drag must still move the module');
    action('undo');assert.deepEqual(saved().modules,before.modules);

    action('projects');$('[data-open="camera-empty"]').click();action('3d');await paint();
    const emptySnapshot=serialized(),emptyHistory=history();assert.equal(zoomPercent(),100);
    assert.ok($('.board-empty')===null,'the empty-drawer capture prompt must not cover the 3D SVG');
    const reference=board().querySelector('[data-reference="drawer"]');assert.ok(reference,'an empty drawer still needs its navigable reference plane');
    const emptyMesh=geometry();await drag(reference,0,45,20,{id:31});assert.ok(geometry()!==emptyMesh,'empty 3D drawers must orbit');
    const emptyView=box();await drag(board(),2,35,-25,{id:32});assert.notDeepEqual(box(),emptyView,'empty 3D drawers must pan');
    const emptyWidth=box().width;wheel();await paint();assert.ok(box().width<emptyWidth,'empty 3D drawers must zoom');unchanged(emptySnapshot,emptyHistory);
    action('2d');await paint();assert.ok($('.board-empty [data-action=capture]'),'2D must restore the Add tool prompt for an empty drawer');unchanged(emptySnapshot,emptyHistory);
  });
});
