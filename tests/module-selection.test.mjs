import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const points=[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}];
const tool=(id,moduleId,x,y)=>({id,name:id,moduleId,x,y,points,rotation:0,depth:8,locked:false,fingerGrips:[]});
const initial=validateProject({...blankProject(),id:'module-context',name:'Výběr kontextu modulu',width:1008,height:840,limitToBed:false,
  modules:[{id:'a',name:'Sada A',x:0,y:0,width:252,height:168,sizeMode:'manual',grouped:true},{id:'b',name:'Sada B',x:336,y:0,width:252,height:168,sizeMode:'manual',grouped:true},{id:'single',name:'Jeden nástroj',x:0,y:294,width:168,height:168,sizeMode:'manual'},{id:'filler',name:'Výplň',x:672,y:0,width:126,height:126,sizeMode:'manual',locked:true}],
  tools:[tool('a1','a',35,40),tool('a2','a',130,40),tool('b1','b',370,40),tool('b2','b',465,40),tool('single-tool','single',55,340)]});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"module-context"');
await import('../dist/app.js');
const proto=(win.SVGSVGElement||win.SVGElement).prototype,captured=new Set();
proto.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
proto.getScreenCTM=()=>({inverse:()=>({})});proto.setPointerCapture=id=>captured.add(id);proto.releasePointerCapture=id=>captured.delete(id);
const $=selector=>win.document.querySelector(selector),$$=selector=>[...win.document.querySelectorAll(selector)],board=()=>$('#board-svg');
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='module-context');
const state=()=>{const p=saved();delete p.updatedAt;return p;};
const click=(target,options={})=>{const el=typeof target==='string'?$(target):target;assert.ok(el,'Missing '+target);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,...options}));};
const action=name=>click(`#app [data-action="${name}"]`),body=id=>$(`#board-svg [data-module="${id}"] > rect`),shape=id=>$(`#board-svg .tool-outline[data-tool="${id}"]`);
const checked=()=>$$('[data-tool-check]:checked').map(el=>el.dataset.toolCheck);
const select=(...ids)=>{if(checked().length)action('select-no-tools');for(const id of ids){const el=$(`[data-tool-check="${id}"]`);assert.ok(el);el.checked=true;el.dispatchEvent(new win.Event('change',{bubbles:true}));}};
const key=(name,target=win.document.body,extra={})=>target.dispatchEvent(new win.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...extra}));
const pointer=(type,target=board(),{id=91,x=20,y=20,pointerType='mouse',...extra}={})=>{assert.ok(target,'pointer target');target.dispatchEvent(new win.PointerEvent(type,{pointerId:id,pointerType,isPrimary:true,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true,...extra}));};
// Pointer capture retargets the final click to the stable SVG, whose child paths were redrawn on pointerdown.
function gesture(target,options={}){pointer('pointerdown',target,options);pointer('pointerup',board(),options);click(board());}
function assertModule(id){
  assert.deepEqual(checked(),[],'module context clears the bulk checkboxes');
  assert.equal($$('#board-svg [data-tool-selected="true"]').length,0,'module context does not highlight an implicit member');
  assert.ok(!$('[data-field="name"]'),'single tool properties are not shown for module background');
  assert.ok(!$('[data-action="bulk-rotate"]'),'old bulk actions are no longer active');
  const module=saved().modules.find(m=>m.id===id);assert.ok(module);
  assert.equal(Number($('[data-field="moduleX"]').dataset.mm),module.x);assert.equal(Number($('[data-field="moduleY"]').dataset.mm),module.y);
  assert.equal($(`#board-svg [data-module="${id}"]`).dataset.moduleSelected,'true');
}
const noHistory=()=>assert.equal($('#app [data-action="undo"]').disabled,true,'selection alone does not create history');
async function paint3D(){
  // Let a scheduled orbit frame start, then wait for the bounded worker fallback
  // to replace the loading state with actual module facets.
  await new Promise(resolve=>nativeTimeout(resolve,0));
  const started=performance.now();
  while(performance.now()-started<10000){
    if(!$('[data-preview-state][aria-busy="true"]')&&$('#board-svg [data-module="b"]'))return;
    await new Promise(resolve=>nativeTimeout(resolve,2));
  }
  assert.fail('3D module facets did not finish rendering: '+$('[data-preview-state]')?.textContent);
}
after(()=>{win.dispatchEvent(new win.Event('pagehide'));return win.happyDOM.abort();});

test('captured mouse and pen clicks on a shared module background clear every selected tool without editing data',()=>{
  const before=state(),stored=localStorage.getItem('suplik-studio-projects-v1');
  for(const pointerType of ['mouse','pen']){
    select('a1','a2');gesture(body('a'),{pointerType});assertModule('a');key('r');
    assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);noHistory();
  }
});

test('a single-member module and a different shared module are selected as containers without selecting their first member',()=>{
  const before=state();click(shape('a1'));gesture(body('single'));assertModule('single');
  select('a1','a2');gesture(body('b'));assertModule('b');assert.deepEqual(state(),before);noHistory();
  select('a1','a2');gesture(shape('b1'));assert.deepEqual(checked(),[]);assert.equal($('[data-field="name"]').value,'b1');
  assert.deepEqual($$('#board-svg .tool-body[data-tool-selected="true"]').map(el=>el.dataset.tool),['b1']);
  assert.deepEqual(state(),before);noHistory();
});

test('Ctrl and Shift add only direct tool hits; module background always exits tool selection',()=>{
  const before=state();
  click(shape('a1'),{ctrlKey:true});click(shape('b1'),{shiftKey:true});assert.deepEqual(checked(),['a1','b1']);
  for(const extra of [{ctrlKey:true},{shiftKey:true}]){
    select('a1','a2');click(body('b'),extra);assertModule('b');
  }
  assert.deepEqual(state(),before);noHistory();
});

test('dragging background or an unselected tool in another module never moves the previous bulk selection',()=>{
  const before=state();
  for(const grab of [()=>body('b'),()=>shape('b1')]){
    select('a1','a2');pointer('pointerdown',grab());pointer('pointermove',board(),{y:62});pointer('pointerup',board(),{y:62});click(board());
    const next=state();assert.deepEqual(checked(),[]);assert.equal(next.modules.find(m=>m.id==='b').y,42);
    assert.deepEqual(next.modules.filter(m=>m.id!=='b'),before.modules.filter(m=>m.id!=='b'));
    assert.deepEqual(next.tools.filter(t=>t.moduleId!=='b'),before.tools.filter(t=>t.moduleId!=='b'));assert.deepEqual(validateLayout(next),[]);
    action('undo');assert.deepEqual(state(),before);noHistory();
  }
});

test('a selected tool still drags all selected modules, but a no-movement captured click chooses only that tool',()=>{
  const before=state();select('a1','b1');pointer('pointerdown',shape('a1'));pointer('pointermove',board(),{y:62});pointer('pointerup',board(),{y:62});click(board());
  const moved=state();assert.deepEqual(checked(),['a1','b1']);for(const id of ['a','b'])assert.equal(moved.modules.find(m=>m.id===id).y,42);
  assert.deepEqual(validateLayout(moved),[]);action('undo');assert.deepEqual(state(),before);noHistory();
  gesture(shape('a1'));assert.deepEqual(checked(),[]);assert.equal($('[data-field="name"]').value,'a1');assert.deepEqual(state(),before);noHistory();
});

test('touch Move mode, locked fillers and keyboard module selection clear stale tool actions',()=>{
  const before=state();action('move-mode');select('a1','a2');gesture(body('single'),{pointerType:'touch'});assertModule('single');action('move-mode');
  select('a1','a2');gesture(body('filler'));assertModule('filler');key('r');assert.deepEqual(state(),before);noHistory();
  key('Delete');assert.deepEqual(saved().tools,before.tools,'Delete on a filler cannot delete formerly selected tools');assert.ok(!saved().modules.some(m=>m.id==='filler'));
  action('undo');assert.deepEqual(state(),before);noHistory();
  for(const name of ['Enter',' ']){select('a1','a2');key(name,$('#board-svg [data-module="single"]'));assertModule('single');}
  assert.deepEqual(state(),before);noHistory();
});

test('a resize handle switches to its module context even while another module has selected tools',()=>{
  const before=state();click(shape('b1'));select('a1','a2');
  gesture($('#board-svg [data-resize-of="b"][data-resize="e"]'));assertModule('b');assert.deepEqual(state(),before);noHistory();
});

test('a captured no-movement 3D facet click selects the module and clears old tool selection',async()=>{
  const before=state();select('a1','a2');action('3d');
  await paint3D();gesture($('#board-svg [data-module="b"]'));await paint3D();assertModule('b');assert.deepEqual(state(),before);noHistory();
  action('2d');
});

test('locked bulk movement keeps its selection, while an unmoved captured click still selects only the hit tool',()=>{
  const before=state();click(shape('b1'));action('lock');const locked=state();
  const history=()=>({undo:$('#app [data-action="undo"]').disabled,redo:$('#app [data-action="redo"]').disabled}),prior=history();
  assert.equal(locked.modules.find(m=>m.id==='b').locked,true);
  for(const id of ['a1','b1']){
    select('a1','b1');gesture(shape(id));assert.deepEqual(checked(),[]);assert.equal($('[data-field="name"]').value,id);
    assert.deepEqual(state(),locked);assert.deepEqual(history(),prior,'an unmoved locked gesture adds no undo step');
    select('a1','b1');pointer('pointerdown',shape(id));pointer('pointermove',board(),{y:62});pointer('pointerup',board(),{y:62});click(board());
    assert.deepEqual(checked(),['a1','b1'],'blocked movement preserves the intended bulk selection');assert.deepEqual(state(),locked);
    assert.deepEqual(history(),prior);assert.match($('#toast').textContent,/odemkněte/);
  }
  action('undo');action('select-no-tools');assert.deepEqual(state(),before);noHistory();
});

test('a primary 3D gesture on empty canvas cannot be stolen by another pointer and cancel or blur releases the next pick',async()=>{
  const before=state();select('a1','a2');action('3d');
  await paint3D();
  for(const secondary of [{pointerType:'mouse',isPrimary:false},{pointerType:'pen',isPrimary:true}]){
    pointer('pointerdown',board(),{id:121});
    pointer('pointerdown',$('#board-svg [data-module="b"]'),{id:122,...secondary});
    pointer('pointerup',board(),{id:122,...secondary});click($('#board-svg [data-module="b"]'));
    assert.deepEqual(checked(),['a1','a2'],'secondary pointer click cannot replace the active empty-canvas gesture');
    pointer('pointermove',board(),{id:121,x:35});pointer('pointerup',board(),{id:121,x:35});click(board());await paint3D();
    assert.deepEqual(checked(),['a1','a2'],'orbiting the primary pointer does not become a module selection');
    assert.deepEqual(state(),before);noHistory();
  }
  for(const end of ['pointercancel','blur']){
    pointer('pointerdown',board(),{id:123});
    if(end==='blur')win.dispatchEvent(new win.Event('blur'));else pointer('pointercancel',board(),{id:123});
    gesture($('#board-svg [data-module="b"]'),{id:124});await paint3D();assertModule('b');assert.deepEqual(state(),before);noHistory();
    select('a1','a2');await paint3D();
  }
  action('select-no-tools');action('2d');
});
