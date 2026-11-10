import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createCanvas} from '@napi-rs/canvas';
import {bindCaptureContourEditor} from '../dist/capture-contour-editor.js';
import {bindCanvasView} from '../dist/capture-view.js';
import {flattenContour} from '../dist/capture-contour-edit.js';
import {captureSelectionItem} from '../dist/capture-selection-result.js';
import {capturePhotoGeometry,capturePocketGeometry,toolFromCaptureItem} from '../dist/capture-tools.js';
import {setLang} from '../dist/i18n.js';
import {setAppUnit} from '../dist/units.js';

const clone=value=>structuredClone(value);
const rectangle=[{x:160,y:180},{x:560,y:180},{x:560,y:380},{x:160,y:380}];
const drawPath=[{x:220,y:210},{x:500,y:210},{x:500,y:350},{x:220,y:350},{x:220,y:210}];
const enclosingPath=[{x:140,y:160},{x:580,y:160},{x:580,y:400},{x:140,y:400},{x:140,y:160}];
const box=points=>({x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))});
const near=(actual,expected,label,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<tolerance,`${label}: ${actual} != ${expected}`);

function fixture(t,{empty=false,scale=4,shape='measured'}={}){
  const win=new Window({url:'http://localhost/'});
  for(const key of ['document','localStorage','HTMLElement'])globalThis[key]=win[key];
  globalThis.window=win;setLang('cs',{save:false});setAppUnit('mm',{save:false});
  win.document.body.innerHTML='<div class="capture-canvas"><canvas width="1200" height="800"></canvas></div><div class="capture-guide-preview"><canvas width="900" height="600"></canvas></div>';
  const canvas=win.document.querySelector('.capture-canvas canvas'),detail=win.document.querySelector('.capture-guide-preview canvas');
  const surfaces=new Map([[canvas,{view:{zoom:1.8,x:-150,y:-80},rect:{left:77,top:41,width:600,height:400}}],[detail,{view:{zoom:2.4,x:-180,y:-110},rect:{left:29,top:97,width:300,height:200}}]]),cleanup=[];
  for(const [surface,state] of surfaces){surface.getBoundingClientRect=()=>state.rect;const backing=createCanvas(surface.width,surface.height);surface.getContext=type=>type==='2d'?backing.getContext('2d'):null;}
  const raw={name:'Původní klíč',category:'wrenches',sizeLabel:'17 mm',depth:'8',checked:true,pocketShape:shape,contour:{points:clone(rectangle)},info:{minX:160,minY:180,width:400/scale,height:200/scale,center:{x:360,y:280}}},items=empty?[]:[raw],created=[],errors=[];
  let active=empty?null:0,editor,redraws=0;
  const draw=()=>{redraws++;for(const [surface,state] of surfaces){const ctx=surface.getContext('2d');ctx.save();ctx.setTransform(state.view.zoom,0,0,state.view.zoom,state.view.x,state.view.y);editor?.draw(ctx,surface.width/state.rect.width/state.view.zoom,surface);ctx.restore();}};
  for(const [surface,state] of surfaces)cleanup.push(bindCanvasView(surface,{getView:()=>state.view,setView:view=>state.view=view,draw,canTouchPan:()=>!editor?.dragging&&state.view.zoom>1,onNavigationStart:()=>editor?.cancel()}));
  editor=bindCaptureContourEditor(canvas,{getItems:()=>items,getActiveIndex:()=>active,onSelect:index=>active=index,getPhotoScale:()=>scale,getView:()=>surfaces.get(canvas).view,onUpdate:draw,onRedraw:draw,onError:message=>errors.push(message),onCreateContour:model=>{
    const photo=flattenContour(model.nodes).map(p=>({x:model.origin.x+p.x*scale,y:model.origin.y+p.y*scale}));
    const item=captureSelectionItem({contour:{points:photo},method:'freehand'},{scale,image:{width:1200,height:800},name:'Ručně kreslený nástroj',pocketShape:'measured'});
    items.push(item);active=items.length-1;created.push(clone(model));editor.refresh();
  }});
  let unbindDetail=editor.bindSurface(detail,{getView:()=>surfaces.get(detail).view});
  function pointer(type,p,{surface=canvas,view=surfaces.get(surface).view,pointerType='mouse',pointerId=1,...rest}={}){
    const {rect}=surfaces.get(surface),event=new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerType,pointerId,isPrimary:pointerId===1,clientX:rect.left+(p.x*view.zoom+view.x)*rect.width/surface.width,clientY:rect.top+(p.y*view.zoom+view.y)*rect.height/surface.height,...rest});surface.dispatchEvent(event);return event;
  }
  const action=name=>{const button=win.document.querySelector(`[data-contour-action="${name}"]`);assert.ok(button,`missing ${name}`);assert.equal(button.disabled,false,`${name} enabled`);button.click();};
  const stroke=(points,options={})=>{pointer('pointerdown',points[0],options);for(const p of points.slice(1))pointer('pointermove',p,options);pointer('pointerup',points.at(-1),options);};
  const key=value=>canvas.dispatchEvent(new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  t.after(async()=>{editor.destroy();unbindDetail?.();cleanup.reverse().forEach(fn=>fn());await win.happyDOM.close();});
  return{win,canvas,detail,surfaces,items,item:raw,created,errors,editor,action,pointer,stroke,key,redraws:()=>redraws,unbind:()=>{unbindDetail?.();unbindDetail=null;},select:index=>{active=index;editor.refresh();}};
}

for(const pointerType of ['mouse','pen','touch'])for(const surfaceName of ['canvas','detail'])test(`new freehand ${pointerType} on ${surfaceName} creates a calibrated outline even with no detected tools`,t=>{
  const f=fixture(t,{empty:true,scale:3.7}),surface=f[surfaceName],view=clone(f.surfaces.get(surface).view);f.action('draw');
  assert.match(f.win.document.querySelector('.capture-contour-hint').textContent,/Nový obrys/);
  f.stroke(drawPath,{surface,pointerType});assert.equal(f.created.length,1);assert.equal(f.items.length,1);assert.equal(f.items[0].selectionSource,'freehand');assert.equal(f.items[0].pocketShape,'measured');assert.equal(f.editor.dragging,false);assert.deepEqual(f.surfaces.get(surface).view,view,'drawing never pans the zoomed photo');
  const actual=box(f.items[0].contour.points);near(actual.x0,220,'photo minX');near(actual.x1,500,'photo maxX');near(actual.y0,210,'photo minY');near(actual.y1,350,'photo maxY');near(f.items[0].info.width,280/3.7,'physical width');near(f.items[0].info.height,140/3.7,'physical height');
  const tool=toolFromCaptureItem(f.items[0],{scale:3.7,depth:8,id:'new'}),physical=box(tool.points);near(physical.x1-physical.x0,280/3.7,'actual tool width',.000051);near(physical.y1-physical.y0,140/3.7,'actual tool height',.000051);assert.deepEqual(f.errors.filter(Boolean),[]);assert.ok(f.redraws()>2,'draft is rendered while drawing');
});

for(const pointerType of ['mouse','pen','touch'])for(const surfaceName of ['canvas','detail'])test(`outward redraw ${pointerType} on ${surfaceName} retains the tool and one Undo restores it`,t=>{
  const f=fixture(t),before=clone(f.item),surface=f[surfaceName];f.action('redraw');f.stroke(enclosingPath,{surface,pointerType});assert.equal(f.items.length,1);assert.equal(f.created.length,0);assert.deepEqual(f.item.contour,before.contour,'source photo contour is immutable');
  for(const field of ['name','category','sizeLabel','depth','checked'])assert.equal(f.item[field],before[field],field+' preserved');
  const actual=box(capturePhotoGeometry(f.item,4).points);near(actual.x0,140,'minX');near(actual.x1,580,'maxX');near(actual.y0,160,'minY');near(actual.y1,400,'maxY');const done=clone(f.item);f.action('undo');assert.deepEqual(f.item,before);assert.equal(f.win.document.querySelector('[data-contour-action="undo"]').disabled,true,'one completed stroke is one history entry');f.action('redo');assert.deepEqual(f.item,done);assert.deepEqual(f.errors.filter(Boolean),[]);
});

test('redraw of an ideal profile retains the existing2percent reserve once and keeps the drawn mm unchanged',t=>{
  const f=fixture(t,{shape:'ideal'}),source=clone(f.item.contour);f.action('redraw');f.stroke(enclosingPath);assert.equal(f.item.contourReserveRatio,.02);assert.equal(f.item.pocketShape,'measured');const drawn=box(capturePhotoGeometry(f.item,4).points);near(drawn.x1-drawn.x0,440,'drawn px width');near(drawn.y1-drawn.y0,240,'drawn px height');
  f.item.pocketShape='ideal';assert.equal(capturePocketGeometry(f.item,4).reserveRatio,0,'returning to ideal does not add2percent again');const fitted=box(capturePhotoGeometry(f.item,4).points);near(fitted.x1-fitted.x0,440,'single reserve width');near(fitted.y1-fitted.y0,240,'single reserve height');assert.deepEqual(f.item.contour,source);
});

for(const pointerType of ['mouse','pen','touch'])for(const surfaceName of ['canvas','detail'])test(`inward redraw ${pointerType} on ${surfaceName} is rejected atomically at the original tool boundary`,t=>{
  const f=fixture(t),before=clone(f.item);f.action('redraw');f.stroke(drawPath,{surface:f[surfaceName],pointerType});assert.deepEqual(f.item,before,'the entire old tool, metadata and source contour survive');assert.equal(f.created.length,0);assert.equal(f.items.length,1);assert.equal(f.win.document.querySelector('[data-contour-action="undo"]').disabled,true,'a rejected shrink adds no history entry');assert.ok(f.errors.some(message=>/původní hraně/.test(message)),'the blocked edit explains the protected tool edge');assert.match(f.win.document.querySelector('.capture-contour-status').textContent,/Dosažena hrana nástroje/);assert.equal(f.editor.dragging,false);
});

test('a crossing freehand outline is refused without changing the existing item or adding history',t=>{
  const f=fixture(t),before=clone(f.item);f.action('redraw');f.stroke([{x:220,y:210},{x:500,y:350},{x:500,y:210},{x:220,y:350}]);assert.deepEqual(f.item,before);assert.equal(f.created.length,0);assert.ok(f.errors.some(message=>/křížit/.test(message)));assert.equal(f.win.document.querySelector('[data-contour-action="undo"]').disabled,true);assert.equal(f.editor.dragging,false);
});

for(const cancellation of ['Escape','blur','pointercancel','lostpointercapture','pinch','unbind','destroy'])test(`freehand ${cancellation} discards the entire draft without a new tool or edit`,t=>{
  const f=fixture(t),before=clone(f.item),surface=cancellation==='unbind'?f.detail:f.canvas;f.action('redraw');f.pointer('pointerdown',drawPath[0],{surface});f.pointer('pointermove',drawPath[1],{surface});f.pointer('pointermove',drawPath[2],{surface});assert.deepEqual(f.item,before,'draft is isolated before release');
  if(cancellation==='Escape')f.key('Escape');else if(cancellation==='blur')f.win.dispatchEvent(new f.win.Event('blur'));else if(cancellation==='pinch')f.pointer('pointerdown',{x:600,y:400},{surface,pointerType:'touch',pointerId:2});else if(cancellation==='unbind')f.unbind();else if(cancellation==='destroy')f.editor.destroy();else f.pointer(cancellation,drawPath[2],{surface});
  assert.equal(f.editor.dragging,false);f.pointer('pointerup',drawPath[3],{surface});assert.deepEqual(f.item,before);assert.equal(f.created.length,0);const undo=f.win.document.querySelector('[data-contour-action="undo"]');if(undo)assert.equal(undo.disabled,true);
});

test('freehand mapping stays fixed when the enlarged preview view changes during its draft',t=>{
  const f=fixture(t,{empty:true}),surface=f.detail,lockedView=clone(f.surfaces.get(surface).view);f.action('draw');f.pointer('pointerdown',drawPath[0],{surface,view:lockedView});f.surfaces.get(surface).view={zoom:4,x:-400,y:-300};for(const p of drawPath.slice(1))f.pointer('pointermove',p,{surface,view:lockedView});f.pointer('pointerup',drawPath.at(-1),{surface,view:lockedView});assert.equal(f.created.length,1);const actual=box(f.items[0].contour.points);near(actual.x0,220,'fixed mapping minX');near(actual.x1,500,'fixed mapping maxX');near(actual.y0,210,'fixed mapping minY');near(actual.y1,350,'fixed mapping maxY');
});

test('right button and a click without an outline cannot create substitute freehand geometry',t=>{
  const f=fixture(t,{empty:true});f.action('draw');f.pointer('pointerdown',drawPath[0],{button:2,buttons:2});f.pointer('pointermove',drawPath[1],{buttons:2});f.pointer('pointerup',drawPath[2],{button:2});assert.equal(f.created.length,0);f.stroke([drawPath[0],drawPath[0]]);assert.equal(f.created.length,0);assert.equal(f.items.length,0);assert.ok(f.errors.some(message=>/alespoň tři/.test(message)));
});
