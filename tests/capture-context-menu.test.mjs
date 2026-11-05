import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {hitCaptureItem,bindCaptureContextMenu} from '../dist/capture-context-menu.js';
import {openContextMenu,closeContextMenu} from '../dist/context-menu.js';
import {openModal} from '../dist/ui.js';
import {setLang} from '../dist/i18n.js';

function item(points,{name='Klíč',checked=true,center}={}){
  const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
  return {name,checked,contour:{points},info:{center:center||{x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2}}};
}
const polygon=coordinates=>coordinates.map(([x,y])=>({x,y}));
const rectangle=(x,y,width,height,options)=>item(polygon([[x,y],[x+width,y],[x+width,y+height],[x,y+height]]),options);
const concave=()=>item(polygon([[100,100],[300,100],[300,300],[240,300],[240,160],[160,160],[160,300],[100,300]]));

test('capture hit testing follows the outline and includes visible boundary and number badge',()=>{
  const items=[concave()];
  assert.equal(hitCaptureItem(items,{x:125,y:250}),0,'the leg of a concave tool is selectable');
  assert.equal(hitCaptureItem(items,{x:200,y:250}),null,'empty space in the bounding rectangle is not the tool');
  assert.equal(hitCaptureItem(items,{x:300,y:220}),0,'the visible outline itself is selectable');
  assert.equal(hitCaptureItem(items,{x:200,y:200}),0,'a number badge outside the polygon remains selectable');
  assert.equal(hitCaptureItem(items,{x:50,y:50}),null);
  assert.equal(hitCaptureItem([], {x:125,y:250}),null);
});

test('capture hit testing matches scaled badges and the painted active-tool order',()=>{
  const one=concave();
  assert.equal(hitCaptureItem([one],{x:218,y:200},{scale:1}),null);
  assert.equal(hitCaptureItem([one],{x:218,y:200},{scale:2}),0,'badge radius follows the canvas rendering scale');
  assert.equal(hitCaptureItem([one],{x:222,y:200},{scale:2}),null);
  assert.equal(hitCaptureItem([one],{x:222,y:200},{scale:2,activeIndex:0}),0,'the active badge is larger');
  const overlap=[rectangle(20,20,80,80),rectangle(30,30,80,80)];
  assert.equal(hitCaptureItem(overlap,{x:60,y:60}),1,'later contours are painted on top');
  assert.equal(hitCaptureItem(overlap,{x:60,y:60},{activeIndex:0}),0,'the active contour is painted last');
});

function fixture(t,{language='cs'}={}){
  const win=new Window({url:'http://localhost/'});
  win.document.body.innerHTML='<button id="opener">Fotografie</button><div id="modal-root"></div><button id="outside">Mimo náhled</button>';
  for(const key of ['window','document','localStorage','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
  globalThis.requestAnimationFrame=callback=>{callback(performance.now());return 1;};
  setLang(language,{save:false});
  const opener=win.document.querySelector('#opener');opener.focus();
  const modal=openModal({title:'Fotografie',body:'<canvas id="trace-canvas" width="1000" height="500" tabindex="0"></canvas><input id="name"><input id="depth">'});
  const canvas=modal.body.querySelector('canvas');
  Object.defineProperty(canvas,'clientWidth',{configurable:true,value:500});
  const rect={left:120,top:80,x:120,y:80,width:500,height:250,right:620,bottom:330};
  canvas.getBoundingClientRect=()=>rect;
  const items=[rectangle(100,100,120,200),rectangle(500,100,120,200,{name:'Šroubovák',checked:false})];
  let activeIndex=null,busy=false;
  const selected=[],edits=[];
  const dispose=bindCaptureContextMenu(canvas,{
    getItems:()=>items,getActiveIndex:()=>activeIndex,isBusy:()=>busy,
    onSelect:index=>{activeIndex=index;selected.push(index);},
    onEdit:(index,field)=>{edits.push({index,field});modal.body.querySelector(`#${field}`).focus();},
    getDescription:(selectedItem,index)=>`${index+1} · ${selectedItem.name} · 12 × 20 mm`
  });
  t.after(async()=>{dispose();closeContextMenu();modal.close();setLang('cs',{save:false});await win.happyDOM.close();});
  const menu=()=>win.document.querySelector('.model-context-menu');
  const right=(point={x:550,y:150})=>{
    const event=new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rect.left+point.x*rect.width/canvas.width,clientY:rect.top+point.y*rect.height/canvas.height});
    canvas.dispatchEvent(event);return event;
  };
  const key=(value,options={},target=canvas)=>{const event=new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
  const click=action=>{const button=menu()?.querySelector(`[data-context-action="${action}"]`);assert.ok(button,`Missing ${action} action`);button.click();};
  return {win,modal,canvas,items,selected,edits,dispose,menu,right,key,click,setActive:index=>activeIndex=index,setBusy:value=>busy=value};
}

test('right click resolves CSS-scaled photo coordinates and edits only the matching tool',t=>{
  const f=fixture(t),before=structuredClone(f.items);
  assert.equal(f.right().defaultPrevented,true);
  assert.deepEqual(f.selected,[1]);
  assert.equal(f.menu().getAttribute('aria-label'),'2 · Šroubovák · 12 × 20 mm');
  assert.equal(f.menu().getAttribute('role'),'menu');
  assert.equal(f.win.document.activeElement.dataset.contextAction,'properties');
  assert.equal(f.items[1].checked,false,'viewing an excluded tool does not select it for import');
  f.click('properties');assert.deepEqual(f.edits,[{index:1,field:'name'}]);
  assert.equal(f.win.document.activeElement.id,'name');assert.equal(f.menu(),null);
  f.right({x:150,y:150});f.click('depth');
  assert.deepEqual(f.edits.at(-1),{index:0,field:'depth'});assert.equal(f.win.document.activeElement.id,'depth');
  assert.deepEqual(f.items,before,'context actions leave the source tool data to the capture editor');
});

test('background and busy capture suppress tool actions without changing import choices',t=>{
  const f=fixture(t),before=structuredClone(f.items);
  assert.equal(f.right({x:400,y:400}).defaultPrevented,true);assert.equal(f.menu(),null);assert.deepEqual(f.selected,[]);
  f.right();assert.ok(f.menu());f.right({x:400,y:400});assert.equal(f.menu(),null,'a background click dismisses the previous tool menu');
  f.setBusy(true);assert.equal(f.right().defaultPrevented,true);assert.equal(f.menu(),null);assert.deepEqual(f.selected,[1]);
  f.setActive(0);f.key('ContextMenu');assert.equal(f.menu(),null,'busy capture cannot open keyboard actions');
  assert.deepEqual(f.items,before);
});

test('keyboard context actions use the active tool and Escape returns to the live capture',t=>{
  const f=fixture(t);
  f.key('ContextMenu');assert.equal(f.menu(),null,'a keyboard request needs an active tool');
  f.setActive(1);f.canvas.focus();assert.equal(f.key('F10',{shiftKey:true}).defaultPrevented,true);assert.ok(f.menu());
  assert.match(f.menu().textContent,/Šroubovák/);assert.deepEqual(f.selected,[1]);
  f.key('Escape',{},f.win.document.activeElement);
  assert.equal(f.menu(),null);assert.equal(f.win.document.activeElement,f.canvas);
  assert.equal(f.modal.el.isConnected,true,'closing the context menu must not close photo capture');
  f.key('ContextMenu');assert.ok(f.menu());f.click('depth');assert.deepEqual(f.edits,[{index:1,field:'depth'}]);
});

test('capture context actions respect the selected language',t=>{
  const f=fixture(t,{language:'en'});f.right();
  assert.equal(f.menu().querySelector('[data-context-action="properties"]').textContent,'Tool properties');
  assert.equal(f.menu().querySelector('[data-context-action="depth"]').textContent,'Pocket depth');
  assert.doesNotMatch(f.menu().textContent,/Vlastnosti nástroje|Hloubka kapsy/);
});

test('capture context cleanup removes handlers and closes only the menu owned by that capture',t=>{
  const f=fixture(t);f.right();assert.ok(f.menu());f.dispose();assert.equal(f.menu(),null);
  f.right();f.setActive(0);f.key('ContextMenu');assert.equal(f.menu(),null,'disposed preview cannot open another menu');
  const other=openContextMenu({title:'Jiný náhled',items:[{action:'other',label:'Jiná akce'}]});
  f.dispose();assert.equal(other.menu.isConnected,true,'repeated cleanup cannot dismiss another surface menu');
  other.close();
});

test('capture cleanup preserves a later menu that replaced its own menu',t=>{
  const f=fixture(t);f.right();
  const other=openContextMenu({title:'Jiný náhled',items:[{action:'other',label:'Jiná akce'}]});
  f.dispose();assert.equal(other.menu.isConnected,true,'the cleanup handle belongs to its original menu');
  other.close();
});

test('dismissing actions during import keeps the preview usable after a recoverable failure',t=>{
  const f=fixture(t),before=structuredClone(f.items);
  f.right();assert.ok(f.menu());f.setBusy(true);f.dispose.dismiss();
  assert.equal(f.menu(),null,'starting import dismisses the open tool actions');
  f.right();assert.equal(f.menu(),null,'busy import still blocks opening actions');
  f.setBusy(false);f.right({x:150,y:150});assert.ok(f.menu(),'a failed import can restore the same preview binding');
  f.click('properties');assert.deepEqual(f.edits,[{index:0,field:'name'}]);
  assert.deepEqual(f.items,before,'dismissal and recovery leave all import choices and contours intact');
});
