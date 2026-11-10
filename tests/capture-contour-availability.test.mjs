import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {bindCaptureContourEditor} from '../dist/capture-contour-editor.js';
import {setLang} from '../dist/i18n.js';
import {setAppUnit} from '../dist/units.js';

const clone=value=>structuredClone(value);
function fixture(t,{empty=false,zoom=1,activeIndex=null,notch=false,pocketMargin=null,center=null}={}){
  const win=new Window({url:'http://localhost/'});
  for(const key of ['document','localStorage','HTMLElement'])globalThis[key]=win[key];globalThis.window=win;
  setLang('cs',{save:false});setAppUnit('mm',{save:false});
  win.document.body.innerHTML='<div class="capture-canvas"><canvas width="800" height="500"></canvas></div><div class="detail"><canvas width="800" height="500"></canvas></div>';
  const canvas=win.document.querySelector('.capture-canvas canvas'),detail=win.document.querySelector('.detail canvas');
  const views=new Map([[canvas,{zoom,x:center?400-center.x*zoom:zoom>1?-100:0,y:center?250-center.y*zoom:zoom>1?-50:0}],[detail,{zoom:1.5,x:-40,y:-50}]]);
  const rects=new Map([[canvas,{left:100,top:50,width:400,height:250}],[detail,{left:30,top:20,width:400,height:250}]]);
  for(const [target,rect] of rects)target.getBoundingClientRect=()=>rect;
  const items=empty?[]:[80,460].map((x,index)=>({name:'Tool '+index,checked:index===0,category:'wrenches',depth:'8',pocketShape:'measured',contour:{points:[{x,y:150},{x:x+110,y:notch?160:150},{x:x+220,y:150},{x:x+220,y:350},{x,y:350}]},info:{minX:x,minY:150,width:110,height:100,center:{x:x+110,y:250}}}));
  const originals=clone(items),errors=[],created=[],updates=[];let active=activeIndex,busy=false;
  const editor=bindCaptureContourEditor(canvas,{getItems:()=>items,getActiveIndex:()=>active,onSelect:index=>active=index,getPhotoScale:()=>2,getView:()=>views.get(canvas),getPocketMargin:()=>pocketMargin,isBusy:()=>busy,onUpdate:index=>updates.push(index),onCreateContour:model=>created.push(model),onError:message=>errors.push(message)});
  function button(action,target=canvas){const palette=target===canvas?win.document.querySelector('.capture-contour-toolbar'):win.document.querySelector('.capture-contour-detail-tools');const result=palette?.querySelector(`[data-contour-action="${action}"]`);assert.ok(result,'visible '+action+' button');return result;}
  function pointer(type,point,{target=canvas,pointerType='mouse',...options}={}){const rect=rects.get(target),view=views.get(target),event=new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerId:1,pointerType,isPrimary:true,clientX:rect.left+(point.x*view.zoom+view.x)*rect.width/target.width,clientY:rect.top+(point.y*view.zoom+view.y)*rect.height/target.height,...options});target.dispatchEvent(event);return event;}
  function click(point,options){pointer('pointerdown',point,options);pointer('pointerup',point,options);}
  const detailCleanup=()=>editor.bindSurface(detail,{getView:()=>views.get(detail)});
  t.after(async()=>{editor.destroy();await win.happyDOM.close();});
  return{win,canvas,detail,items,originals,errors,created,updates,editor,button,pointer,click,detailCleanup,active:()=>active,select:index=>{active=index;editor.refresh();},setBusy:value=>{busy=value;editor.refresh();}};
}

test('every editing tool is available before selecting a contour or adding a point',t=>{
  const f=fixture(t);
  for(const action of ['point','curve','straight','delete','smooth','draw','redraw','toggle'])assert.equal(f.button(action).disabled,false,action+' is immediately available');
  for(const action of ['undo','redo','reset'])assert.equal(f.button(action).disabled,true,action+' retains its history prerequisite');
  for(const action of ['curve','straight','delete']){f.button(action).click();assert.equal(f.button(action).getAttribute('aria-pressed'),'true',action+' can be chosen before any contour');assert.equal(f.active(),null);assert.deepEqual(f.items,f.originals,'choosing a tool alone never edits geometry');}
});

for(const pointerType of ['mouse','touch'])for(const action of ['curve','straight','delete'])test(`${pointerType} ${action} works on an untouched unchecked contour without a preliminary point`,t=>{
  const f=fixture(t,{zoom:1.25,notch:action==='delete'});f.button(action).click();f.click(action==='straight'?{x:460,y:150}:{x:570,y:action==='delete'?160:150},{pointerType});
  assert.equal(f.active(),1,'the clicked contour becomes the target');assert.deepEqual(f.items[0],f.originals[0],'the first contour stays untouched');
  const item=f.items[1];assert.deepEqual(item.contour,f.originals[1].contour,'the detected outline remains immutable');assert.equal(item.checked,false,'editing does not change manufacturing selection');assert.ok(item.contourEdit,'the tool operates directly on the target');
  assert.equal(item.contourEdit.nodes.length,action==='curve'?5:4,'only the requested point operation is performed');
  if(action==='curve'){const node=item.contourEdit.nodes.find(node=>node.manual);assert.ok(node.in&&node.out,'curve exposes real handles at the clicked edge');}
  if(action==='straight')assert.ok(item.contourEdit.nodes.every(node=>!node.in&&!node.out));
  assert.equal(f.button('undo').disabled,false);f.button('undo').click();assert.deepEqual(f.items,f.originals,'one undo restores the complete direct action');assert.equal(f.button('undo').disabled,true,'no preliminary insertion remains in history');
  f.button('redo').click();assert.ok(f.items[1].contourEdit);assert.equal(f.items[1].contourEdit.nodes.length,action==='curve'?5:4);assert.deepEqual(f.errors.filter(Boolean),[]);
});

for(const action of ['curve','straight'])test(`${action} can be chosen first and applied at an edge in a single undo step`,t=>{
  const f=fixture(t);f.button(action).click();f.click({x:515,y:150});
  assert.equal(f.active(),1);assert.equal(f.items[1].contourEdit.nodes.length,5);const node=f.items[1].contourEdit.nodes.find(node=>node.manual&&Math.abs(node.x-27.5)<1e-8&&node.y===0);assert.ok(node,'the click creates its own calibrated point');
  if(action==='curve')assert.ok(node.in&&node.out);else assert.ok(!node.in&&!node.out);
  f.button('undo').click();assert.deepEqual(f.items,f.originals,'insertion and chosen operation are atomic');assert.equal(f.button('undo').disabled,true);assert.deepEqual(f.errors.filter(Boolean),[]);
});

for(const action of ['curve','straight'])test(`${action} resolves the blue clearance edge back to the measured profile at 12x zoom`,t=>{
  const f=fixture(t,{zoom:12,pocketMargin:1,center:{x:135,y:150}});assert.equal(f.active(),null);f.button(action).click();f.click({x:135,y:148});
  assert.equal(f.active(),0,'the visible blue edge targets the checked contour without a preliminary point');assert.ok(f.items[0].contourEdit);assert.equal(f.items[0].contourEdit.nodes.length,5);
  const node=f.items[0].contourEdit.nodes.find(node=>node.manual);assert.ok(node);assert.ok(Math.abs(node.x-27.5)<1e-8);assert.equal(node.y,0,'the new node stays on the raw y150 edge rather than the y148 manufacturing clearance');
  if(action==='curve')assert.ok(node.in&&node.out);else assert.ok(!node.in&&!node.out);
  assert.deepEqual(f.items[0].contour,f.originals[0].contour);assert.deepEqual(f.items[1],f.originals[1]);f.button('undo').click();assert.deepEqual(f.items,f.originals,'blue-edge insertion and the chosen action share one undo step');assert.equal(f.button('undo').disabled,true);assert.deepEqual(f.errors.filter(Boolean),[]);
});

test('delete ignores an edge between existing nodes and never inserts a disposable point',t=>{
  const f=fixture(t);f.button('delete').click();f.click({x:515,y:150});assert.deepEqual(f.items,f.originals);assert.equal(f.button('undo').disabled,true);assert.equal(f.button('delete').getAttribute('aria-pressed'),'true','delete remains ready for an actual node');
});

for(const cancellation of ['pointercancel','second-finger','busy'])test(`an armed point operation rolls back on ${cancellation} without adding history`,t=>{
  const f=fixture(t);f.button('curve').click();f.pointer('pointerdown',{x:570,y:150},{pointerType:'touch'});assert.equal(f.editor.dragging,true);assert.deepEqual(f.items,f.originals,'pointerdown alone does not commit a point operation');
  if(cancellation==='second-finger')f.pointer('pointerdown',{x:590,y:150},{pointerType:'touch',pointerId:2,isPrimary:false});
  else if(cancellation==='busy'){f.setBusy(true);f.pointer('pointerup',{x:570,y:150},{pointerType:'touch'});f.setBusy(false);}
  else f.pointer('pointercancel',{x:570,y:150},{pointerType:'touch'});
  assert.equal(f.editor.dragging,false);assert.deepEqual(f.items,f.originals);assert.equal(f.button('undo').disabled,true);
});

test('choosing delete first cannot cut off a protected automatic corner',t=>{
  const f=fixture(t);f.button('delete').click();f.click({x:460,y:150});assert.equal(f.active(),1,'the actual automatic corner is targeted');assert.deepEqual(f.items,f.originals,'unsafe corner removal is rejected atomically');assert.equal(f.button('undo').disabled,true);assert.ok(f.errors.some(message=>message.includes('nástroje')),'the protected edge explains the rejection');
});

test('armed point tools target a different main-view contour after selection changes',t=>{
  const f=fixture(t);f.select(0);f.button('curve').click();f.click({x:570,y:150});assert.equal(f.active(),1);assert.ok(f.items[1].contourEdit.nodes.find(node=>node.manual)?.in);assert.deepEqual(f.items[0],f.originals[0]);
  f.select(0);f.button('straight').click();f.click({x:190,y:150});assert.equal(f.active(),0);assert.equal(f.items[0].contourEdit.nodes.length,5);assert.ok(f.items[1].contourEdit.nodes.find(node=>node.manual)?.in,'the other contour curve is retained');
});

test('detail palette is immediately usable and only targets its active contour',t=>{
  const f=fixture(t,{activeIndex:0}),cleanup=f.detailCleanup();t.after(cleanup);
  for(const action of ['curve','straight','delete','smooth','redraw'])assert.equal(f.button(action,f.detail).disabled,false);
  f.button('curve',f.detail).click();f.click({x:570,y:150},{target:f.detail,pointerType:'touch'});assert.deepEqual(f.items,f.originals,'detail cannot edit another contour by its photo coordinates');
  f.click({x:190,y:150},{target:f.detail,pointerType:'touch'});assert.equal(f.active(),0);assert.equal(f.items[0].contourEdit.nodes.length,5);assert.ok(f.items[0].contourEdit.nodes.find(node=>node.manual)?.in);assert.deepEqual(f.items[1],f.originals[1]);
});

test('smoothing starts on any contour immediately without inserting a point',t=>{
  const f=fixture(t);f.button('smooth').click();f.pointer('pointerdown',{x:570,y:150},{pointerType:'touch'});assert.equal(f.active(),1);assert.equal(f.editor.dragging,true,'the brush starts without a point-selection gesture');f.pointer('pointerup',{x:570,y:150},{pointerType:'touch'});
  assert.deepEqual(f.items[0],f.originals[0]);assert.deepEqual(f.items[1].contour,f.originals[1].contour);assert.ok(!f.items[1].contourEdit||f.items[1].contourEdit.nodes.length===4,'brushing does not insert a point');assert.deepEqual(f.errors.filter(Boolean),[]);
});

test('redraw chosen before any contour replaces the contour nearest the stroke start',t=>{
  const f=fixture(t);f.button('redraw').click();const path=[{x:450,y:140},{x:690,y:140},{x:690,y:360},{x:450,y:360},{x:450,y:140}];f.pointer('pointerdown',path[0]);for(const p of path.slice(1))f.pointer('pointermove',p);f.pointer('pointerup',path.at(-1));
  assert.equal(f.active(),1);assert.ok(f.items[1].contourEdit);assert.equal(f.items[1].contourEdit.nodes.length,4);assert.deepEqual(f.items[0],f.originals[0]);assert.deepEqual(f.items[1].contour,f.originals[1].contour);assert.deepEqual(f.created,[],'redraw never creates a separate tool');assert.deepEqual(f.errors.filter(Boolean),[]);
  f.button('undo').click();assert.deepEqual(f.items,f.originals,'the whole redraw is one undo step');
});

test('busy state blocks palette and pointer editing, while an empty result still allows drawing',t=>{
  const f=fixture(t);f.setBusy(true);for(const action of ['point','curve','straight','delete','smooth','draw','redraw','toggle'])assert.equal(f.button(action).disabled,true);f.click({x:570,y:150});assert.deepEqual(f.items,f.originals);assert.equal(f.active(),null);
  f.setBusy(false);for(const action of ['curve','straight','delete','smooth','redraw'])assert.equal(f.button(action).disabled,false);
  const empty=fixture(t,{empty:true});assert.equal(empty.button('draw').disabled,false);for(const action of ['curve','straight','delete','smooth','redraw'])assert.equal(empty.button(action).disabled,true,action+' has no contour to target');
});
