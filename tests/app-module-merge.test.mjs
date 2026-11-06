import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';
import {steppedModuleFootprint,moduleIntersects} from '../dist/module-footprint.js';

const storagePrefix='';
const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const key=name=>storagePrefix+'suplik-studio-'+name;
localStorage.setItem(key('lang'),'"cs"');localStorage.setItem(key('unit'),'"mm"');

// The diagonal pockets are separate even where their conservative 42 mm body
// cells intersect. This is a real geometry fixture, not mocked validation.
const points=[{x:0,y:0},{x:12,y:0},{x:12,y:126},{x:0,y:126}];
const makeTool=(id,moduleId,x,y)=>({id,name:id,moduleId,x,y,points,rotation:45,depth:8,locked:false,fingerGrips:[]});
function fixture(id,{locked=false}={}){
  const project=validateProject({...blankProject(),id,name:id,width:630,height:420,grid:42,bottomMode:'plain',wall:2.4,clearance:.8,sizeLabels:false,
    modules:[{id:'moving',name:'Pohyblivý modul',x:0,y:0,width:126,height:126,sizeMode:'auto'},
      {id:'stationary',name:'Cílový modul',x:252,y:0,width:126,height:126,sizeMode:'auto',locked},
      {id:'companion',name:'Další vybraný modul',x:0,y:210,width:126,height:126,sizeMode:'auto'}],
    tools:[makeTool('moving-tool','moving',12,12),makeTool('stationary-tool','stationary',264,12),makeTool('companion-tool','companion',12,222)]});
  project.modules=project.modules.map(module=>steppedModuleFootprint(project,module));
  assert.ok(project.modules.every(module=>module.cells?.length===7),'diagonal bodies must have actual stepped cells');
  assert.deepEqual(validateLayout(project),[],'fixture begins manufacturably separated');
  return project;
}
const names=['history','away','independent','cancel-pointer','cancel-capture','cancel-blur','cancel-escape','invalid','locked','multi','numeric','context','touch'];
const projects=names.map(name=>fixture('merge-'+name,{locked:name==='locked'}));
localStorage.setItem(key('projects-v1'),JSON.stringify(projects));localStorage.setItem(key('current'),JSON.stringify(projects[0].id));
const urls=new Map(),downloads=[];
URL.createObjectURL=blob=>{const url='blob:http://localhost/module-merge-'+urls.size;urls.set(url,blob);return url;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:urls.get(this.href)});};
await import('../dist/app.js');
const prototype=(win.SVGSVGElement||win.SVGElement).prototype,captured=new Map();
prototype.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
prototype.getScreenCTM=()=>({inverse:()=>({})});
prototype.setPointerCapture=function(id){captured.set(id,this);};
prototype.releasePointerCapture=function(id){captured.delete(id);};
const $=selector=>win.document.querySelector(selector),$$=selector=>[...win.document.querySelectorAll(selector)];
const click=selector=>{const element=typeof selector==='string'?$(selector):selector;assert.ok(element,'Missing '+selector);element.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click(`#app [data-action="${name}"]`);
const clean=project=>{const copy=structuredClone(project);delete copy.updatedAt;return copy;};
const saved=()=>JSON.parse(localStorage.getItem(key('projects-v1'))).find(project=>project.id===JSON.parse(localStorage.getItem(key('current'))));
const state=()=>clean(saved());
const board=()=>$('#board-svg');
const target=id=>{const element=board().querySelector(`.tool-outline[data-tool="${id}"]`);assert.ok(element,'Missing tool '+id);return element;};
const bodyPath=id=>board().querySelector(`.tool-body[data-tool="${id}"]`).getAttribute('d');
const checked=()=>$$('[data-tool-check]:checked').map(element=>element.dataset.toolCheck);
function openProject(name){
  action('projects');click(`[data-open="merge-${name}"]`);
  assert.equal(state().id,'merge-'+name);assert.equal($('#app [data-action="undo"]').disabled,true);
}
function change(selector,value){const element=$(selector);assert.ok(element,selector);element.value=String(value);element.dispatchEvent(new win.Event('change',{bubbles:true}));}
function select(...ids){for(const id of ids){const element=$(`[data-tool-check="${id}"]`);assert.ok(element,id);element.checked=true;element.dispatchEvent(new win.Event('change',{bubbles:true}));}}
function pointer(type,element=board(),{id=71,x=10,y=10,pointerType='mouse'}={}){
  const event=new win.PointerEvent(type,{pointerId:id,pointerType,isPrimary:true,button:0,buttons:['pointerup','pointercancel','lostpointercapture'].includes(type)?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true});
  element.dispatchEvent(event);return event;
}
const start=(options={})=>pointer('pointerdown',target('moving-tool'),options);
const move=(dx,options={})=>pointer('pointermove',board(),{x:10+dx,y:10,...options});
const drop=(dx,options={})=>pointer('pointerup',board(),{x:10+dx,y:10,...options});
function previewMerged(){
  assert.equal(board().querySelectorAll('[data-module]').length,2,'preview must show the merged body and the untouched companion');
  assert.equal(target('moving-tool').closest('[data-module]').dataset.module,'moving');
  assert.equal(target('stationary-tool').closest('[data-module]').dataset.module,'moving','stationary pocket appears in the merged preview');
}
function mergedAt(project,before,dx,{companionMoved=false}={}){
  assert.deepEqual(validateLayout(project),[],'merged model must pass real pocket and wall checks');
  assert.equal(project.modules.length,2);
  const merged=project.modules.find(module=>module.id==='moving');assert.ok(merged,'the moved seed keeps its module ID');
  assert.equal(merged.grouped,true);assert.equal(merged.sizeMode,'manual');
  assert.ok(!project.modules.some(module=>module.id==='stationary'),'the captured body record is removed');
  for(const old of before.tools){
    const next=project.tools.find(tool=>tool.id===old.id);assert.ok(next,'tool ID survives');
    const moves=old.id==='moving-tool'||companionMoved&&old.id==='companion-tool';
    assert.deepEqual(next,{...old,x:old.x+(moves?dx:0),moduleId:old.id==='stationary-tool'?'moving':old.moduleId},'world pose and every pocket property survive');
  }
  if(!companionMoved)assert.deepEqual(project.modules.find(module=>module.id==='companion'),before.modules.find(module=>module.id==='companion'));
}
function undoRedo(before,next){
  action('undo');assert.deepEqual(state(),before,'one undo restores separate modules and all positions');
  assert.equal($('#app [data-action="undo"]').disabled,true,'the gesture created exactly one history entry');
  action('redo');assert.deepEqual(state(),next,'redo restores exactly the same IDs, bodies and memberships');
}
after(()=>win.happyDOM.abort());

test('single drag previews a diagonal body merge, continues after capture, persists and has one undo/redo',async()=>{
  openProject('history');const before=state(),stored=localStorage.getItem(key('projects-v1')),stationaryPath=bodyPath('stationary-tool');
  const overlap=structuredClone(before);overlap.modules.find(module=>module.id==='moving').x+=210;overlap.tools.find(tool=>tool.id==='moving-tool').x+=210;
  assert.equal(moduleIntersects(overlap.modules[0],overlap.modules[1],overlap.grid),true);
  assert.ok(validateLayout(overlap).every(issue=>issue.ids.every(id=>['moving','stationary'].includes(id))),'only module bodies overlap before merging');
  start();move(168);previewMerged();const firstPath=bodyPath('moving-tool');
  move(210);previewMerged();assert.notEqual(bodyPath('moving-tool'),firstPath,'the same pointer continues moving after its preview captured a target');
  assert.equal(bodyPath('stationary-tool'),stationaryPath,'target pocket stays at its original world pose');
  assert.equal(localStorage.getItem(key('projects-v1')),stored,'preview never persists');
  drop(210);const next=state();mergedAt(next,before,210);
  assert.equal(target('moving-tool').dataset.toolSelected,'true');assert.equal($('[data-field="name"]').value,'moving-tool','the selected tool still owns its inspector');
  undoRedo(before,next);assert.equal(target('moving-tool').dataset.toolSelected,'true');
  action('save-project');if($('[data-file-save]'))click('[data-file-save]');
  const download=downloads.at(-1);assert.ok(download?.name.endsWith('.json'));const exported=JSON.parse(await download.blob.text());
  assert.equal(exported.app,'InsertCreator');assert.deepEqual(clean(exported.project),next,'portable JSON saves the complete merged project');
  assert.deepEqual(validateLayout(validateProject(exported.project)),[]);
});

test('moving away from a merged preview restores original bodies before committing the final position',()=>{
  openProject('away');const before=state(),stationaryPath=bodyPath('stationary-tool');start();move(210);previewMerged();move(42);
  assert.equal(board().querySelectorAll('[data-module]').length,3,'target is released when this preview no longer overlaps');
  assert.equal(target('stationary-tool').closest('[data-module]').dataset.module,'stationary');assert.equal(bodyPath('stationary-tool'),stationaryPath);
  drop(42);const next=state();assert.equal(next.modules.length,3);assert.deepEqual(next.tools.find(tool=>tool.id==='stationary-tool'),before.tools.find(tool=>tool.id==='stationary-tool'));
  assert.equal(next.tools.find(tool=>tool.id==='moving-tool').x,before.tools.find(tool=>tool.id==='moving-tool').x+42);
  undoRedo(before,next);
});

test('a later in-place edit of an unmoved tool cannot alter the original nonmerging drag undo snapshot',()=>{
  openProject('independent');const before=state();start();move(42);drop(42);
  const moved=state();assert.equal(moved.modules.length,3,'this move does not merge any bodies');
  assert.equal(moved.tools.find(tool=>tool.id==='moving-tool').x,before.tools.find(tool=>tool.id==='moving-tool').x+42);
  assert.deepEqual(moved.tools.find(tool=>tool.id==='stationary-tool'),before.tools.find(tool=>tool.id==='stationary-tool'));
  click(target('stationary-tool'));change('[data-field="name"]','Upravený nepřesunutý klíč');
  const edited=state();assert.equal(edited.tools.find(tool=>tool.id==='stationary-tool').name,'Upravený nepřesunutý klíč');
  action('undo');assert.deepEqual(state(),moved,'undoing the name edit restores the complete post-drag state');
  action('undo');assert.deepEqual(state(),before,'the original drag snapshot must remain independent of later in-place edits');
  assert.equal($('#app [data-action="undo"]').disabled,true);
  action('redo');assert.deepEqual(state(),moved,'redoing only the drag must not leak the later name');
  action('redo');assert.deepEqual(state(),edited,'the second redo independently restores the name edit');
});

for(const [name,end] of [['cancel-pointer','pointercancel'],['cancel-capture','lostpointercapture'],['cancel-blur','blur'],['cancel-escape','Escape']]){
  test(`${end} rolls back a merged preview without saving or adding history`,()=>{
    openProject(name);const before=state(),stored=localStorage.getItem(key('projects-v1'));start();move(210);previewMerged();
    pointer('pointerup',board(),{id:99,x:220,y:10});assert.equal(localStorage.getItem(key('projects-v1')),stored,'another pointer cannot commit');
    if(end==='blur')win.dispatchEvent(new win.Event('blur'));
    else if(end==='Escape')win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    else pointer(end);
    move(252);drop(252);
    assert.deepEqual(state(),before);assert.equal(localStorage.getItem(key('projects-v1')),stored);
    assert.equal(board().querySelectorAll('[data-module]').length,3);assert.equal($('#app [data-action="undo"]').disabled,true);assert.equal(captured.has(71),false);
  });
}

test('a real pocket collision after a valid merged preview rejects the complete drop atomically',()=>{
  openProject('invalid');const before=state(),stored=localStorage.getItem(key('projects-v1'));start();move(168);previewMerged();move(252);drop(252);
  assert.deepEqual(state(),before);assert.equal(localStorage.getItem(key('projects-v1')),stored);assert.equal($('#app [data-action="undo"]').disabled,true);
  assert.equal(board().querySelectorAll('[data-module]').length,3);assert.match($('#toast').textContent,/překrý|dotýk|kaps|stěn/i);
});

test('an overlapping position-locked target cannot be captured by automatic merge',()=>{
  openProject('locked');const before=state();start();move(210);drop(210);
  assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  assert.equal(target('stationary-tool').closest('[data-module]').dataset.module,'stationary');
});

test('multiselection drag captures an unselected target while preserving the full selected vector and checkboxes',()=>{
  openProject('multi');const before=state();select('moving-tool','companion-tool');start();move(210);previewMerged();
  assert.deepEqual(checked(),['moving-tool','companion-tool']);drop(210);const next=state();mergedAt(next,before,210,{companionMoved:true});
  assert.deepEqual(checked(),['moving-tool','companion-tool'],'capturing a target does not change the requested tool selection');
  assert.equal(next.modules.find(module=>module.id==='companion').x,210);undoRedo(before,next);
});

test('numeric module position merges with the same pocket poses and retains module selection',()=>{
  openProject('numeric');const before=state();click(board().querySelector('[data-module="moving"] .module-footprint'));change('[data-field="moduleX"]',210);
  const next=state();mergedAt(next,before,210);assert.equal($('#board-svg [data-module="moving"]').dataset.moduleSelected,'true');
  assert.ok($('[data-field="moduleX"]'),'the surviving module inspector stays editable');undoRedo(before,next);
});

test('contextual bulk move dialog uses the same automatic merge and a single history entry',()=>{
  openProject('context');const before=state();select('moving-tool');target('moving-tool').dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:50}));
  click('[data-context-action="bulk-move"]');assert.equal($('[data-bulk-move-mode]').value,'modules');change('[data-field="bulkDx"]',210);click('[data-apply-bulk-move]');
  assert.equal($('.modal'),null,'the successful move closes its dialog');const next=state();mergedAt(next,before,210);assert.deepEqual(checked(),['moving-tool']);undoRedo(before,next);
});

test('touch Move mode previews a merge and pointer cancellation restores the separate modules',()=>{
  openProject('touch');const before=state();action('move-mode');assert.equal($('#app [data-action="move-mode"]').getAttribute('aria-pressed'),'true');
  start({id:91,pointerType:'touch'});move(210,{id:91,pointerType:'touch'});previewMerged();pointer('pointercancel',board(),{id:91,pointerType:'touch'});
  drop(210,{id:91,pointerType:'touch'});assert.deepEqual(state(),before);assert.equal(board().querySelectorAll('[data-module]').length,3);
  assert.equal($('#app [data-action="undo"]').disabled,true);assert.equal(captured.has(91),false);
});
