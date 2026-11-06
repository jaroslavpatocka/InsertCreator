import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {bindCaptureContourEditor} from '../dist/capture-contour-editor.js';
import {capturePhotoGeometry,captureItemDimensions,toolFromCaptureItem} from '../dist/capture-tools.js';
import {flattenContour} from '../dist/capture-contour-edit.js';
import * as navigation from '../dist/capture-view.js';
import {setLang} from '../dist/i18n.js';

function fixture(t,{zoom=1,scale=2,pocketShape='measured',outline,language='cs',two=false}={}){
  const win=new Window({url:'http://localhost/'});
  for(const key of ['document','localStorage','HTMLElement'])globalThis[key]=win[key];globalThis.window=win;
  setLang(language,{save:false});
  win.document.body.innerHTML='<div class="capture-canvas"><canvas width="800" height="500" tabindex="0"></canvas></div>';
  const canvas=win.document.querySelector('canvas'),rect={left:100,top:50,width:400,height:250};canvas.getBoundingClientRect=()=>rect;
  const points=outline||[{x:100,y:150},{x:600,y:150},{x:600,y:350},{x:100,y:350}];
  const item={name:'Klíč',checked:true,category:'wrenches',sizeLabel:'17 mm',depth:'8',pocketShape,contour:{points},info:{minX:100,minY:150,width:250,height:100,center:{x:350,y:250}}};
  const items=[item];if(two)items.push({...structuredClone(item),name:'Druhý klíč',contour:{points:points.map(p=>({x:p.x,y:p.y+250}))},info:{...item.info,minY:item.info.minY+250,center:{x:item.info.center.x,y:item.info.center.y+250}}});
  const updates=[],errors=[];let active=null,view={zoom,x:zoom>1?-100:0,y:zoom>1?-50:0},editor;
  const viewCleanup=navigation.bindCanvasView(canvas,{getView:()=>view,setView:value=>view=value,draw:()=>{},canTouchPan:()=>!editor?.dragging&&view.zoom>1,onNavigationStart:()=>editor?.cancel()});
  editor=bindCaptureContourEditor(canvas,{getItems:()=>items,getActiveIndex:()=>active,onSelect:index=>active=index,getPhotoScale:()=>scale,getView:()=>view,onUpdate:index=>updates.push(index),onError:value=>errors.push(value)});
  const screen=point=>({clientX:rect.left+(point.x*view.zoom+view.x)*rect.width/canvas.width,clientY:rect.top+(point.y*view.zoom+view.y)*rect.height/canvas.height});
  const pointer=(type,point,options={})=>{const event=new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerId:1,pointerType:'mouse',isPrimary:true,...screen(point),...options});canvas.dispatchEvent(event);return event;};
  const key=(key,options={})=>canvas.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  const click=point=>{pointer('pointerdown',point);pointer('pointerup',point);};
  const action=name=>{const button=win.document.querySelector(`[data-context-action="${name}"]`);assert.ok(button,'Missing contour action '+name);button.click();};
  t.after(async()=>{editor.destroy();viewCleanup();await win.happyDOM.close();});
  return{win,canvas,item,items,editor,updates,errors,pointer,key,click,action,view:()=>view,scale,select:index=>{active=index;editor.refresh();},active:()=>active};
}

test('a profile click inserts a calibrated point, shows actions, and moves only that point through a zoomed canvas',t=>{
  const f=fixture(t,{zoom:2}),original=structuredClone(f.item.contour);
  f.click({x:350,y:150});assert.equal(f.item.contourEdit.nodes.length,5);assert.ok(f.win.document.querySelector('[data-context-action="curve"]'));
  f.action('move');f.pointer('pointerdown',{x:350,y:150});f.pointer('pointermove',{x:350,y:110});f.pointer('pointerup',{x:350,y:110});
  const photo=capturePhotoGeometry(f.item,2).points;
  for(const point of original.points)assert.ok(photo.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<1e-8),'untouched corner is fixed in photo coordinates');
  assert.ok(photo.some(p=>p.x===350&&p.y===110));assert.deepEqual(f.item.contour,original);assert.equal(f.item.pocketShape,'measured');
  const tool=toolFromCaptureItem(f.item,{scale:2,depth:8,id:'edited',preservePosition:true});assert.ok(tool.points.some(p=>p.x===125&&p.y===0));
  assert.deepEqual(f.view(),{zoom:2,x:-100,y:-50},'point movement must not pan the canvas');
});

test('point editing supports undo, redo, keyboard movement and exact numeric placement',t=>{
  const f=fixture(t);f.click({x:350,y:150});f.action('move');
  f.key('ArrowUp');assert.equal(f.item.contourEdit.nodes.find(node=>node.manual).y,-.1);
  const field=f.win.document.querySelector('[data-contour-field="y"]');field.value='-12.5 mm';field.dispatchEvent(new f.win.Event('change',{bubbles:true}));assert.equal(f.item.contourEdit.nodes.find(node=>node.manual).y,-12.5);
  f.win.document.querySelector('[data-contour-action="undo"]').click();assert.equal(f.item.contourEdit.nodes.find(node=>node.manual).y,-.1);
  f.win.document.querySelector('[data-contour-action="redo"]').click();assert.equal(f.item.contourEdit.nodes.find(node=>node.manual).y,-12.5);
  f.win.document.querySelector('[data-contour-action="reset"]').click();assert.equal(f.item.editedPoints,undefined);assert.deepEqual(f.item.contour.points,[{x:100,y:150},{x:600,y:150},{x:600,y:350},{x:100,y:350}]);
});

test('Bézier action exposes draggable handles and width/length actions focus accessible dimensional controls',t=>{
  const f=fixture(t);f.click({x:350,y:150});f.action('curve');
  const before=f.item.contourEdit.nodes.find(node=>node.manual);assert.ok(before.in&&before.out);
  const handle={x:f.item.contourEditOrigin.x+before.out.x*2,y:f.item.contourEditOrigin.y+before.out.y*2};
  f.pointer('pointerdown',handle);f.pointer('pointermove',{x:handle.x,y:handle.y-30});f.pointer('pointerup',{x:handle.x,y:handle.y-30});
  assert.equal(f.item.contourEdit.nodes.find(node=>node.manual).out.y,before.out.y-15);assert.ok(flattenContour(f.item.contourEdit.nodes).length>5);
  f.click({x:350,y:150});f.action('width');assert.equal(f.win.document.activeElement.dataset.contourField,'width');
  const width=f.win.document.activeElement;width.value='120 mm';width.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  assert.ok(f.item.editedPoints.length>5);assert.equal(f.item.name,'Klíč');assert.equal(f.item.depth,'8');
});

test('Escape, pointer cancellation and an invalid crossing each roll back the whole gesture',t=>{
  const f=fixture(t);f.click({x:350,y:150});f.action('move');const before=structuredClone(f.item.editedPoints);
  f.pointer('pointerdown',{x:350,y:150});f.pointer('pointermove',{x:350,y:110});f.key('Escape');assert.deepEqual(f.item.editedPoints,before);
  f.pointer('pointerdown',{x:350,y:150});f.pointer('pointermove',{x:350,y:110});f.pointer('pointercancel',{x:350,y:110});assert.deepEqual(f.item.editedPoints,before);
  f.pointer('pointerdown',{x:350,y:150});f.pointer('pointermove',{x:350,y:420});f.pointer('pointerup',{x:350,y:420});assert.deepEqual(f.item.editedPoints,before);assert.ok(f.errors.some(message=>message.includes('křížit')));
});

test('dragging away from the profile pans a zoomed view and never inserts a contour point',t=>{
  const f=fixture(t,{zoom:2});f.pointer('pointerdown',{x:250,y:240});f.pointer('pointermove',{x:280,y:260});f.pointer('pointerup',{x:280,y:260});
  assert.equal(f.item.editedPoints,undefined);assert.notDeepEqual(f.view(),{zoom:2,x:-100,y:-50});
});

test('a click with sub-threshold jitter leaves geometry unchanged and does not add a hidden undo step',t=>{
  const f=fixture(t);f.click({x:350,y:150});f.action('move');const before=structuredClone(f.item.editedPoints);
  f.pointer('pointerdown',{x:350,y:150});f.pointer('pointermove',{x:352,y:150});f.pointer('pointerup',{x:352,y:150});
  assert.deepEqual(f.item.editedPoints,before,'one CSS-pixel jitter is a click, not a silent one-millimetre correction');
  f.action('move');f.win.document.querySelector('[data-contour-action="undo"]').click();assert.equal(f.item.editedPoints,undefined,'one undo removes only the intentional insertion');
});

for(const zoom of [1,2])test(`touch point hit area is 44 CSS pixels at zoom ${zoom} and a grab offset cannot move the point sideways`,t=>{
  const f=fixture(t,{zoom});f.click({x:350,y:150});f.action('move');
  const offset=40/zoom;f.pointer('pointerdown',{x:350+offset,y:150},{pointerType:'touch'});f.pointer('pointermove',{x:350+offset,y:150-offset},{pointerType:'touch'});f.pointer('pointerup',{x:350+offset,y:150-offset},{pointerType:'touch'});
  assert.equal(f.item.contourEdit.nodes.length,5,'a grab20CSSpx from the existing point selects it instead of inserting another');
  const moved=capturePhotoGeometry(f.item,2).points.find(p=>Math.abs(p.x-350)<1e-7);assert.ok(moved);assert.ok(Math.abs(moved.y-(150-offset))<1e-7);
});

test('invalid and still-dirty numeric drafts cannot validate or overwrite the last good geometry',t=>{
  const f=fixture(t);f.click({x:350,y:150});f.action('move');const before=structuredClone(f.item.editedPoints);
  const input=f.win.document.querySelector('[data-contour-field="length"]');input.value='0 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));
  assert.equal(f.editor.validate(),false,'dirty input is checked even if blur/change has not fired');assert.equal(f.win.document.activeElement,input);assert.equal(input.getAttribute('aria-invalid'),'true');assert.deepEqual(f.item.editedPoints,before);
  input.value='270 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));input.dispatchEvent(new f.win.Event('change',{bubbles:true}));assert.equal(f.editor.validate(),true);assert.notDeepEqual(f.item.editedPoints,before);
});

test('the point action menu stays within a narrow phone viewport',t=>{
  const f=fixture(t);f.win.innerWidth=320;f.win.innerHeight=568;f.click({x:590,y:350});
  const menu=f.win.document.querySelector('.capture-contour-menu');assert.ok(menu);
  assert.ok(parseFloat(menu.style.left)>=8&&parseFloat(menu.style.left)<=62);assert.ok(parseFloat(menu.style.top)>=8&&parseFloat(menu.style.top)<=240);
});

for(const selection of ['profile','external'])test(`a pending length belongs to its original tool across ${selection} selection and late native blur`,async t=>{
  const f=fixture(t,{two:true});f.click({x:350,y:150});f.action('move');
  const input=f.win.document.querySelector('[data-contour-field="length"]');input.focus();input.value='200 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));input.addEventListener('blur',()=>input.dispatchEvent(new f.win.Event('change',{bubbles:true})),{once:true});
  if(selection==='profile'){f.pointer('pointerdown',{x:350,y:400});f.pointer('pointerup',{x:350,y:400});}
  else{f.select(1);f.canvas.focus();}
  await Promise.resolve();assert.equal(captureItemDimensions(f.items[0],2).length,200);assert.equal(captureItemDimensions(f.items[1],2).length,250,'the second tool never receives the first tool’s pending value');assert.equal(f.active(),1);
});

test('a pending coordinate retains its original point when a different tool is selected before blur',t=>{
  const f=fixture(t,{two:true});f.click({x:350,y:150});f.action('move');
  const input=f.win.document.querySelector('[data-contour-field="x"]');input.focus();input.value='130 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));input.addEventListener('blur',()=>input.dispatchEvent(new f.win.Event('change',{bubbles:true})),{once:true});
  f.select(1);f.canvas.focus();input.dispatchEvent(new f.win.Event('change',{bubbles:true}));assert.equal(f.items[0].contourEdit.nodes.find(node=>node.manual).x,130);assert.equal(f.items[1].editedPoints,undefined,'a point draft cannot create or modify a point on another tool');
});

test('an invalid coordinate can return to its owning point even after the other tool disables coordinate fields',t=>{
  const f=fixture(t,{two:true});f.click({x:350,y:150});f.action('move');
  const input=f.win.document.querySelector('[data-contour-field="x"]');input.focus();input.value='bad';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));f.select(1);
  assert.equal(f.editor.validate(),false);assert.equal(f.active(),0);assert.equal(input.disabled,false);assert.equal(f.win.document.activeElement,input);assert.equal(input.value,'bad');assert.equal(f.items[1].editedPoints,undefined);
});

test('a pending coordinate stays on its original node when another point is inserted on the same profile',t=>{
  const f=fixture(t);f.click({x:350,y:150});f.action('move');
  const input=f.win.document.querySelector('[data-contour-field="x"]');input.focus();input.value='130 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));input.addEventListener('blur',()=>input.dispatchEvent(new f.win.Event('change',{bubbles:true})),{once:true});
  f.click({x:350,y:350});const nodes=f.item.contourEdit.nodes;
  assert.equal(nodes.length,6);assert.ok(nodes.some(node=>node.manual&&node.x===130&&node.y===0),'the original top point receives its own pending coordinate');assert.ok(nodes.some(node=>node.manual&&node.x===125&&node.y===100),'the new bottom point keeps the clicked position');
});

for(const selection of ['profile','external'])test(`an invalid owned draft survives ${selection} selection and blocks validation until its own tool is corrected`,t=>{
  const f=fixture(t,{two:true});f.click({x:350,y:150});f.action('move');
  const input=f.win.document.querySelector('[data-contour-field="length"]');input.focus();input.value='0 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));input.addEventListener('blur',()=>input.dispatchEvent(new f.win.Event('change',{bubbles:true})),{once:true});
  if(selection==='profile'){f.pointer('pointerdown',{x:350,y:400});f.pointer('pointerup',{x:350,y:400});}else{f.select(1);f.canvas.focus();}
  assert.equal(f.editor.validate(),false);assert.equal(f.active(),0,'validation returns focus and selection to the owner of the invalid draft');assert.equal(input.value,'0 mm');assert.equal(captureItemDimensions(f.items[1],2).length,250);
  input.value='200 mm';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));input.dispatchEvent(new f.win.Event('change',{bubbles:true}));assert.equal(f.editor.validate(),true);assert.equal(captureItemDimensions(f.items[0],2).length,200);assert.equal(captureItemDimensions(f.items[1],2).length,250);
});

for(const pocketShape of ['hybrid','functional'])test(`starting a manual ${pocketShape} correction preserves the displayed profile without a mode-change jump`,t=>{
  const f=fixture(t,{pocketShape,outline:[{x:100,y:190},{x:220,y:150},{x:530,y:180},{x:600,y:230},{x:560,y:350},{x:210,y:320},{x:100,y:290}]});
  const before=capturePhotoGeometry(f.item,2).points,a=before[0],b=before[1];
  f.click({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const after=capturePhotoGeometry(f.item,2).points;
  for(const point of before)assert.ok(after.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<1e-7),'switching to manual mode preserves the profile already shown');
  assert.equal(f.item.pocketShape,'measured');
});

for(const pocketShape of ['hybrid','functional'])test(`reopening manual edits after an explicit ${pocketShape} mode change uses the new displayed profile`,t=>{
  const f=fixture(t,{outline:[{x:100,y:150},{x:600,y:150},{x:600,y:220},{x:300,y:220},{x:300,y:350},{x:100,y:350}]});
  f.click({x:350,y:150});f.action('move');f.pointer('pointerdown',{x:350,y:150});f.pointer('pointermove',{x:350,y:120});f.pointer('pointerup',{x:350,y:120});
  f.item.pocketShape=pocketShape;f.editor.refresh();const before=capturePhotoGeometry(f.item,2).points,a=before[0],b=before[1];
  f.click({x:(a.x+b.x)/2,y:(a.y+b.y)/2});const after=capturePhotoGeometry(f.item,2).points;
  for(const point of before)assert.ok(after.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<1e-6),'new visible profile must not be replaced by the stale pre-fit manual node cache');
  assert.equal(f.item.pocketShape,'measured');
});

if(typeof navigation.bindTouchNavigation==='function')test('a second touch rolls back a point drag and hands the gesture to existing pinch navigation',t=>{
  const f=fixture(t);f.pointer('pointerdown',{x:350,y:150},{pointerType:'touch'});f.pointer('pointermove',{x:350,y:120},{pointerType:'touch'});assert.ok(f.item.editedPoints);
  f.pointer('pointerdown',{x:550,y:250},{pointerType:'touch',pointerId:2,isPrimary:false});assert.equal(f.item.editedPoints,undefined,'pinch handoff restores the pre-drag draft');
  f.pointer('pointermove',{x:650,y:300},{pointerType:'touch',pointerId:2,isPrimary:false});assert.ok(f.view().zoom>1);assert.equal(f.editor.dragging,false);
});
