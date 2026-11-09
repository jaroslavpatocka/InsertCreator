import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {openFingerGripEditor} from '../dist/finger-grip-editor.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write('<div id="modal-root"></div>');
for(const key of ['window','document','localStorage','HTMLElement','SVGElement'])globalThis[key]=key==='window'?win:win[key];
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
const {setLang}=await import('../dist/i18n.js');setLang('cs',{save:false});
const $=selector=>win.document.querySelector(selector);
const clone=value=>JSON.parse(JSON.stringify(value));
const tool=()=>({id:'tool',name:'Independent 100 x 20 mm tool',points:[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:0,y:20}],x:200,y:300,rotation:37,depth:8,fingerGrips:[{id:'left',x:0,y:10,radius:9},{id:'right',x:100,y:10,radius:9}]});
let rect;
function layout(next={left:80,top:40,width:798,height:300}){
  rect=next;const svg=$('.fge-svg');svg.getBoundingClientRect=()=>({...rect,right:rect.left+rect.width,bottom:rect.top+rect.height});
  const captured=new Set();svg.setPointerCapture=id=>captured.add(id);svg.hasPointerCapture=id=>captured.has(id);
  svg.releasePointerCapture=id=>{captured.delete(id);svg.dispatchEvent(new win.PointerEvent('lostpointercapture',{pointerId:id,bubbles:true}));};
  return svg;
}
const view=()=>{const [x,y,width,height]=$('.fge-svg').getAttribute('viewBox').split(' ').map(Number);return{x,y,width,height};};
function client(x,y){const v=view(),scale=Math.min(rect.width/v.width,rect.height/v.height);return{x:rect.left+(rect.width-v.width*scale)/2+(x-v.x)*scale,y:rect.top+(rect.height-v.height*scale)/2+(y-v.y)*scale};}
function pointer(type,target,x,y,extra={}){const p=client(x,y);target.dispatchEvent(new win.PointerEvent(type,{pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:p.x,clientY:p.y,bubbles:true,cancelable:true,...extra}));}
function drag(gripId,action,start,end,extra={}){const svg=$('.fge-svg'),target=$(`[data-grip-id="${gripId}"] [data-grip-action="${action}"]`);assert.ok(target);pointer('pointerdown',target,...start,extra);pointer('pointermove',svg,...end,extra);pointer('pointerup',svg,...end,extra);}
function typed(gripId,field,value,event='input'){const input=$(`[data-grip-row="${gripId}"] [data-field="${field}"]`);assert.ok(input);input.value=String(value);input.dispatchEvent(new win.Event(event,{bubbles:true}));return input;}
const value=(gripId,field)=>Number($(`[data-grip-row="${gripId}"] [data-field="${field}"]`).value);
const click=selector=>{assert.ok($(selector),selector);$(selector).click();};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.00001,`${actual} != ${expected}`);

test('finger cutout editor manipulates physical draft geometry and commits only on Save',async t=>{
  t.after(async()=>{await win.happyDOM.close();});
  await t.test('mouse, pen and touch move the chosen cutout by known millimetres without changing source tool or SVG transform',()=>{
    for(const pointerType of ['mouse','pen','touch']){
      const source=tool(),original=clone(source);let saved,planSeen;
      const modal=openFingerGripEditor({tool:source,validate:grips=>({count:grips.length}),onSave:(grips,plan)=>{saved=grips;planSeen=plan;}});
      const svg=layout(),before=$('.fge-svg').getAttribute('viewBox');
      drag('left','move',[0,10],[5,12],{pointerType});
      near(value('left','fingerX'),5);near(value('left','fingerY'),12);assert.equal($('.fge-svg'),svg);assert.equal(svg.getAttribute('viewBox'),before);
      assert.deepEqual(source,original);assert.equal(saved,undefined);click('[data-grips-save]');
      assert.deepEqual(saved,[{id:'left',x:5,y:12,radius:9},original.fingerGrips[1]]);assert.deepEqual(planSeen,{count:2});assert.equal($('#modal-root').children.length,0,'synchronous callbacks commit and close synchronously');modal.close();
    }
  });
  await t.test('drag handles change diameter, independent width/height, both axes and rotation',()=>{
    let saved;const modal=openFingerGripEditor({tool:tool(),onSave:grips=>saved=grips});layout();
    drag('left','radius',[9,10],[15,10]);near(value('left','fingerDiameter'),30);
    typed('left','fingerShape','ellipse','change');typed('left','fingerWidth','24 mm');typed('left','fingerHeight','12 mm');
    drag('left','width',[12,10],[16,10]);near(value('left','fingerWidth'),32);near(value('left','fingerHeight'),12);
    drag('left','height',[0,16],[0,20]);near(value('left','fingerHeight'),20);
    drag('left','size',[16,20],[18,21]);near(value('left','fingerWidth'),36);near(value('left','fingerHeight'),22);
    const target=$('[data-grip-id="left"] [data-grip-action="rotation"]');pointer('pointerdown',target,0,-30);pointer('pointermove',$('.fge-svg'),40,10);pointer('pointerup',$('.fge-svg'),40,10);
    near(value('left','fingerRotation'),90);click('[data-grips-save]');
    assert.deepEqual(saved[0],{id:'left',x:0,y:10,shape:'ellipse',width:36,height:22,rotation:90});modal.close();
  });
  await t.test('each inserted shape is a real saved shape; rounded corners and shape conversion retain clean metadata',()=>{
    for(const shape of ['circle','ellipse','rounded-rect','rectangle']){
      let saved;const source={...tool(),fingerGrips:[]},modal=openFingerGripEditor({tool:source,onSave:grips=>saved=grips});layout();
      const select=$('[data-grip-new-shape]');select.value=shape;select.dispatchEvent(new win.Event('change',{bubbles:true}));click('[data-grip-add]');
      const gripId=$('[data-grip-row]').dataset.gripRow;
      if(shape==='rounded-rect'){typed(gripId,'fingerWidth','20 mm');typed(gripId,'fingerHeight','16 mm');typed(gripId,'fingerCornerRadius','3 mm');typed(gripId,'fingerRotation','30');}
      click('[data-grips-save]');assert.equal(saved.length,1);assert.equal(saved[0].shape||'circle',shape);
      if(shape==='circle')assert.deepEqual(Object.keys(saved[0]).sort(),['id','radius','x','y']);
      else{assert.equal(Object.hasOwn(saved[0],'radius'),false);assert.equal(saved[0].width,shape==='rounded-rect'?20:18);assert.equal(saved[0].height,shape==='rounded-rect'?16:18);}
      if(shape==='rounded-rect'){assert.equal(saved[0].cornerRadius,3);assert.equal(saved[0].rotation,30);}modal.close();
    }
    let saved;const modal=openFingerGripEditor({tool:tool(),onSave:grips=>saved=grips});layout();typed('left','fingerShape','rounded-rect','change');typed('left','fingerShape','circle','change');click('[data-grips-save]');assert.deepEqual(saved[0],{id:'left',x:0,y:10,radius:9});modal.close();
  });
  await t.test('invalid numeric drafts stay with their cutout; an incomplete row can be deleted and disconnected geometry cannot save',()=>{
    let saved;const modal=openFingerGripEditor({tool:tool(),onSave:grips=>saved=grips});layout();
    typed('left','fingerX','');assert.equal($('[data-grips-save]').disabled,true);assert.ok($('[data-grip-error]').textContent);
    click('[data-grip-select="right"]');assert.equal($('[data-grip-row="left"] [data-field="fingerX"]').value,'');
    click('[data-grip-add]');assert.equal(win.document.querySelectorAll('[data-grip-row]').length,3);assert.equal($('[data-grip-row="left"] [data-field="fingerX"]').value,'');
    click('[data-grip-delete="left"]');assert.equal($('[data-grips-save]').disabled,false);click('[data-grips-save]');assert.equal(saved.length,2);assert.ok(saved.every(grip=>grip.id!=='left'));modal.close();
    let calls=0;const second=openFingerGripEditor({tool:tool(),onSave:()=>calls++});layout();typed('left','fingerX','500 mm');assert.equal($('[data-grips-save]').disabled,true);click('[data-grips-save]');assert.equal(calls,0);typed('left','fingerX','0 mm');assert.equal($('[data-grips-save]').disabled,false);second.close();
  });
  await t.test('cancel, lost capture, blur, Escape and a second touch roll back previews without accidental saves',()=>{
    for(const cancellation of ['pointercancel','lostpointercapture','blur','Escape','second-touch']){
      let saved;const original=tool(),modal=openFingerGripEditor({tool:original,onSave:grips=>saved=grips}),svg=layout(),target=$('[data-grip-id="left"] [data-grip-action="move"]');
      const extra={pointerType:cancellation==='second-touch'?'touch':'mouse'};pointer('pointerdown',target,0,10,extra);pointer('pointermove',svg,5,12,extra);near(value('left','fingerX'),5);
      if(cancellation==='blur')win.dispatchEvent(new win.Event('blur'));
      else if(cancellation==='Escape')svg.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      else if(cancellation==='second-touch'){pointer('pointerdown',svg,20,10,{pointerId:8,pointerType:'touch',isPrimary:false});pointer('pointermove',svg,15,15,extra);pointer('pointerup',svg,20,10,{pointerId:8,pointerType:'touch'});pointer('pointerup',svg,15,15,extra);}
      else pointer(cancellation,svg,5,12,extra);
      near(value('left','fingerX'),0);near(value('left','fingerY'),10);assert.ok($('.fge-svg'));assert.equal(saved,undefined);click('[data-grips-save]');assert.deepEqual(saved,original.fingerGrips);modal.close();
    }
  });
  await t.test('letterboxing, zoom, pan and negative source origins preserve raw millimetre coordinates',()=>{
    const source=tool();source.points=source.points.map(point=>({x:point.x-20,y:point.y-10}));source.fingerGrips=source.fingerGrips.map(grip=>({...grip,x:grip.x-20,y:grip.y-10}));let saved;
    const modal=openFingerGripEditor({tool:source,onSave:grips=>saved=grips}),svg=layout({left:83,top:47,width:600,height:600});
    drag('left','move',[-20,0],[-17,4]);near(value('left','fingerX'),-17);near(value('left','fingerY'),4);
    const beforeZoom=view(),anchor=client(-17,4);const wheel=new win.WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true});Object.defineProperties(wheel,{clientX:{value:anchor.x},clientY:{value:anchor.y}});svg.dispatchEvent(wheel);assert.ok(view().width<beforeZoom.width);assert.ok(Number.isFinite(view().x+view().y));
    drag('left','move',[-17,4],[-15,7]);near(value('left','fingerX'),-15);near(value('left','fingerY'),7);
    const beforePan=view();pointer('pointerdown',svg,0,0,{button:2,buttons:2});pointer('pointermove',svg,5,0,{button:2,buttons:2});pointer('pointerup',svg,5,0,{button:2,buttons:0});assert.notEqual(view().x,beforePan.x);near(value('left','fingerX'),-15);
    click('[data-grips-save]');near(saved[0].x,-15);near(saved[0].y,7);assert.deepEqual(source.points,[{x:-20,y:-10},{x:80,y:-10},{x:80,y:10},{x:-20,y:10}]);modal.close();
  });
  await t.test('selected overlapping cutout is painted above the other and remains the drag owner',()=>{
    const source=tool();source.fingerGrips=[{id:'left',x:81,y:10,radius:9},{id:'right',x:83.2,y:10.2,radius:9}];let saved;
    const modal=openFingerGripEditor({tool:source,onSave:grips=>saved=grips});layout();click('[data-grip-select="left"]');
    assert.equal([...$('.fge-svg').querySelectorAll('[data-grip-id]')].at(-1).dataset.gripId,'left');drag('left','move',[82,10.1],[84,12.1]);click('[data-grips-save]');near(saved[0].x,83);near(saved[0].y,12);assert.deepEqual(saved[1],source.fingerGrips[1]);modal.close();
  });
  await t.test('real overlapping handle hits preserve centre dragging and off-centre grab offsets',()=>{
    for(const geometry of [{radius:2},{radius:9},{shape:'rectangle',width:4,height:4,rotation:25}]){
      const source=tool();source.fingerGrips=[{id:'left',x:0,y:10,...geometry}];let saved;
      const modal=openFingerGripEditor({tool:source,onSave:grips=>saved=grips}),svg=layout({left:80,top:40,width:240,height:240});
      click('[data-grip-view="fit"]');
      const target=$(`[data-grip-id="left"] [data-grip-action="${geometry.radius?'radius':'size'}"] .fge-handle-hit`),x=Number(target.getAttribute('cx')),y=Number(target.getAttribute('cy')),hit=Number(target.getAttribute('r'));
      assert.ok(Math.hypot(x,y-10)<hit,'native SVG handle hit really covers the shape centre');
      pointer('pointerdown',target,0,10,{pointerType:'touch'});pointer('pointermove',svg,3,12,{pointerType:'touch'});pointer('pointerup',svg,3,12,{pointerType:'touch'});click('[data-grips-save]');
      near(saved[0].x,3);near(saved[0].y,12);for(const [name,expected] of Object.entries(geometry)){if(typeof expected==='number')near(saved[0][name],expected);else assert.equal(saved[0][name],expected);}modal.close();
    }
    let saved;const modal=openFingerGripEditor({tool:tool(),onSave:grips=>saved=grips});layout();
    drag('left','radius',[12,10],[13,10]);near(value('left','fingerDiameter'),20);
    typed('left','fingerShape','rectangle','change');typed('left','fingerWidth','20 mm');typed('left','fingerHeight','12 mm');
    drag('left','width',[12,11],[13,11]);near(value('left','fingerWidth'),22);near(value('left','fingerHeight'),12);
    const handle=$('[data-grip-id="left"] [data-grip-action="rotation"] .fge-handle'),start=[Number(handle.getAttribute('cx'))+1,Number(handle.getAttribute('cy'))],startAngle=Math.atan2(start[1]-10,start[0]),endAngle=startAngle+Math.PI/6,distance=Math.hypot(start[0],start[1]-10),end=[Math.cos(endAngle)*distance,10+Math.sin(endAngle)*distance];
    drag('left','rotation',start,end);near(value('left','fingerRotation'),30);click('[data-grips-save]');near(saved[0].width,22);near(saved[0].rotation,30);modal.close();
  });
  await t.test('touch pointers released outside the SVG cannot leave future drags blocked',()=>{
    let saved;const modal=openFingerGripEditor({tool:tool(),onSave:grips=>saved=grips}),svg=layout();
    pointer('pointerdown',$('[data-grip-id="left"] [data-grip-action="move"]'),0,10,{pointerId:1,pointerType:'touch'});pointer('pointermove',svg,5,12,{pointerId:1,pointerType:'touch'});
    pointer('pointerdown',svg,20,10,{pointerId:2,pointerType:'touch',isPrimary:false});near(value('left','fingerX'),0);
    win.dispatchEvent(new win.PointerEvent('pointerup',{pointerId:1,pointerType:'touch',bubbles:true}));win.document.body.dispatchEvent(new win.PointerEvent('pointercancel',{pointerId:2,pointerType:'touch',bubbles:true}));
    drag('left','move',[0,10],[4,11],{pointerId:3,pointerType:'touch'});near(value('left','fingerX'),4);near(value('left','fingerY'),11);click('[data-grips-save]');near(saved[0].x,4);modal.close();
  });
  await t.test('inch fields accept explicit metric values and asynchronous validation cannot save after closing',async()=>{
    let saved;const modal=openFingerGripEditor({tool:tool(),unit:'in',onSave:grips=>saved=grips});layout();typed('left','fingerDiameter','20 mm','change');typed('left','fingerY','0.5 in','change');click('[data-grips-save]');assert.equal(saved[0].radius,10);assert.equal(saved[0].y,12.7);modal.close();
    let resolve,calls=0;const pending=openFingerGripEditor({tool:tool(),validate:()=>new Promise(done=>resolve=done),onSave:()=>calls++});layout();click('[data-grips-save]');assert.equal($('[data-grips-save]').disabled,true);assert.equal($('[data-grip-row] input').disabled,true);pending.close();resolve({valid:true});await Promise.resolve();await Promise.resolve();assert.equal(calls,0);assert.equal($('#modal-root').children.length,0);
  });
  await t.test('keyboard moves selected geometry, rounded defaults resize safely and observer cleanup cannot affect a later modal',()=>{
    const observers=[];globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
    try{
      const source=tool();source.fingerGrips=[{id:'rounded',x:0,y:10,shape:'rounded-rect',width:18,height:12}];let saved;
      const modal=openFingerGripEditor({tool:source,onSave:grips=>saved=grips}),svg=layout();click('[data-grip-select="rounded"]');
      svg.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));near(value('rounded','fingerX'),10);
      svg.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true}));near(value('rounded','fingerX'),9.9);
      drag('rounded','width',[18.9,10],[21.9,10]);near(value('rounded','fingerWidth'),24);near(value('rounded','fingerCornerRadius'),3);
      rect={...rect,width:1200};observers[0].callback();near(value('rounded','fingerX'),9.9);click('[data-grips-save]');near(saved[0].width,24);assert.equal(observers[0].disconnected,true);
      const next=openFingerGripEditor({tool:tool()});layout();const before=$('.fge-svg').innerHTML;observers[0].callback();assert.equal($('.fge-svg').innerHTML,before,'closed observer cannot redraw a new modal');next.close();modal.close();
    }finally{delete globalThis.ResizeObserver;}
  });
});
