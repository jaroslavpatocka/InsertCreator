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
const rectangle=[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}];
const tool=(id,moduleId,x,y)=>({id,name:id,moduleId,x,y,points:rectangle,rotation:0,depth:8,locked:false,fingerGrips:[]});
function fixture(){
  return validateProject({...blankProject(),id:'bulk-main',name:'Hromadné úpravy',width:588,height:588,limitToBed:false,sizeLabels:false,
    modules:[{id:'ma',name:'A',x:0,y:0,width:84,height:126,sizeMode:'auto',setId:'uniform',setLayout:'uniform'},{id:'mb',name:'B',x:168,y:0,width:84,height:126,sizeMode:'auto',setId:'uniform',setLayout:'uniform'},{id:'mc',name:'Společný',x:0,y:168,width:168,height:126,sizeMode:'manual',grouped:true,setId:'shared',setLayout:'shared'},{id:'filler',name:'Výplň',x:336,y:168,width:84,height:84,sizeMode:'manual'}],
    tools:[tool('one','ma',32,30),tool('two','mb',200,30),tool('three','mc',30,188),tool('four','mc',100,188)],
    toolSets:[{id:'uniform',name:'První sada',toolIds:['one','two'],layout:'uniform'},{id:'shared',name:'Druhá sada',toolIds:['three','four'],layout:'shared'}]});
}
const initial=fixture();assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"bulk-main"');
const blobs=new Map(),downloads=[];URL.createObjectURL=blob=>{const url='blob:http://localhost/bulk-'+blobs.size;blobs.set(url,blob);return url;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
await import('../dist/app.js');
// SVG pointer coordinates are millimetres in this fixture; production uses the screen CTM.
const svgPrototype=(win.SVGSVGElement||win.SVGElement).prototype,captured=new Map();
svgPrototype.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
svgPrototype.getScreenCTM=()=>({inverse:()=>({})});
svgPrototype.setPointerCapture=function(id){captured.set(id,this);};
svgPrototype.releasePointerCapture=function(id){captured.delete(id);};
const $=s=>win.document.querySelector(s),$$=s=>[...win.document.querySelectorAll(s)];
const click=s=>{const el=typeof s==='string'?$(s):s;assert.ok(el,'Missing '+s);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const state=()=>{const p=saved();delete p.updatedAt;return p;};
const change=(selector,value)=>{const el=$(selector);assert.ok(el,selector);el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const checked=()=>$$('[data-tool-check]:checked').map(el=>el.dataset.toolCheck);
const select=(...ids)=>{if(checked().length)action('select-no-tools');for(const id of ids){const el=$(`[data-tool-check="${id}"]`);assert.ok(el,'checkbox '+id);el.checked=true;el.dispatchEvent(new win.Event('change',{bubbles:true}));}};
const key=(name,extra={},target=win.document.body)=>{const event=new win.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event;};
const sameAfterUndo=before=>{action('undo');assert.deepEqual(state(),before,'one undo restores the entire operation');};
const board=()=>$('#board-svg');
const pointer=(type,target=board(),{id=71,x=10,y=10,button=0}={})=>{const event=new win.PointerEvent(type,{pointerId:id,pointerType:'mouse',isPrimary:true,button,buttons:type==='pointerup'||type==='pointercancel'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
const startDrag=(moduleId,id=71)=>pointer('pointerdown',board().querySelector(`[data-module="${moduleId}"] .tool-outline`),{id});
after(()=>win.happyDOM.abort());

test('checkbox subset rotates together and creates exactly one history entry',()=>{
  const before=state();select('one','two');assert.deepEqual(checked(),['one','two']);
  assert.match($('.bulk-heading').textContent,/2/);action('bulk-rotate');
  const next=state();assert.deepEqual(next.tools.map(t=>t.rotation),[90,90,0,0]);assert.deepEqual(validateLayout(next),[]);
  sameAfterUndo(before);assert.equal($('#app [data-action="undo"]').disabled,true,'selection changes did not add history entries');
  action('bulk-flip');assert.deepEqual(saved().tools.map(t=>t.rotation),[180,180,0,0]);assert.deepEqual(validateLayout(saved()),[]);sameAfterUndo(before);
});

test('deleting a subset cleans both sets, removes only an emptied tool module and preserves the filler',()=>{
  const before=state();select('one','three');action('bulk-delete');
  const p=state();assert.deepEqual(p.tools.map(t=>t.id),['two','four']);assert.deepEqual(p.modules.map(m=>m.id),['mb','mc','filler']);
  assert.deepEqual(p.toolSets.map(s=>[s.id,s.toolIds]),[['uniform',['two']],['shared',['four']]]);assert.deepEqual(validateLayout(p),[]);
  assert.deepEqual(checked(),[],'deleted tools are removed from selection');sameAfterUndo(before);
});

test('select-all depth uses explicit inch input in millimetres and one undo restores all pockets',()=>{
  const before=state();action('select-all-tools');assert.equal(checked().length,4);action('bulk-depth');
  change('[data-field="bulkDepth"]','1/2 in');click('[data-apply-bulk-depth]');assert.equal($('.modal'),null);
  assert.ok(saved().tools.every(t=>Math.abs(t.depth-12.7)<1e-8));assert.deepEqual(saved().modules,before.modules);sameAfterUndo(before);
});

test('partial shared selection moves its whole module, invalid movement is atomic and keeps the dialog open',()=>{
  const before=state();select('three');action('bulk-move');change('[data-field="bulkDx"]',0);change('[data-field="bulkDy"]','84 mm');click('[data-apply-bulk-move]');
  assert.equal($('.modal'),null);const moved=state();assert.equal(moved.modules.find(m=>m.id==='mc').y,252);
  for(const id of ['three','four'])assert.equal(moved.tools.find(t=>t.id===id).y,before.tools.find(t=>t.id===id).y+84);
  assert.deepEqual(moved.tools.filter(t=>['one','two'].includes(t.id)),before.tools.filter(t=>['one','two'].includes(t.id)));assert.deepEqual(validateLayout(moved),[]);sameAfterUndo(before);
  select('three');action('bulk-move');change('[data-field="bulkDx"]',168);change('[data-field="bulkDy"]',-168);click('[data-apply-bulk-move]');
  assert.ok($('.modal'),'failed operation stays reviewable');assert.deepEqual(state(),before);assert.match($('#toast').textContent,/překrýv/);click('[data-modal-close]');
  assert.equal($('#app [data-action="undo"]').disabled,true,'failed movement adds no undo entry');
});

test('bulk locks include unselected siblings and prevent rotation until unlocked',()=>{
  const before=state();select('three');action('bulk-lock');
  assert.ok(saved().tools.filter(t=>t.moduleId==='mc').every(t=>t.locked));assert.equal(saved().modules.find(m=>m.id==='mc').locked,true);
  const locked=state();action('bulk-rotate');assert.deepEqual(state(),locked);assert.match($('#toast').textContent,/odemkněte/);
  action('bulk-unlock');assert.ok(saved().tools.filter(t=>t.moduleId==='mc').every(t=>!t.locked));
  action('undo');assert.deepEqual(state(),locked);sameAfterUndo(before);
});

test('Ctrl+A and Escape change selection without editing project; R and Delete act on the selected subset',()=>{
  const before=state();select();assert.equal(key('a',{ctrlKey:true}).defaultPrevented,true);assert.equal(checked().length,4);key('Escape');assert.deepEqual(checked(),[]);assert.deepEqual(state(),before);
  select('one','two');key('r');assert.deepEqual(saved().tools.map(t=>t.rotation),[90,90,0,0]);sameAfterUndo(before);
  select('three');key('Delete');assert.deepEqual(saved().tools.map(t=>t.id),['one','two','four']);sameAfterUndo(before);
  click('[data-select="one"]');const field=$('[data-field="name"]');assert.ok(field);field.focus();const event=key('a',{ctrlKey:true},field);assert.equal(event.defaultPrevented,false,'typing fields retain their native select-all');field.blur();
});

test('Ctrl+R and Meta+R retain browser reload without rotating the active selection or adding history',()=>{
  select('one','two');const before=state(),stored=localStorage.getItem('suplik-studio-projects-v1');
  const history=()=>({undo:$('#app [data-action="undo"]').disabled,redo:$('#app [data-action="redo"]').disabled}),prior=history();
  for(const modifier of [{ctrlKey:true},{metaKey:true}]){
    assert.equal(key('r',modifier).defaultPrevented,false,'browser reload shortcut is not intercepted');assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);assert.deepEqual(history(),prior);assert.deepEqual(checked(),['one','two']);
  }
});

test('creating a set starts with the bulk selection, preserves other members and is one undo step',()=>{
  const before=state();select('one','three');action('bulk-create-set');
  assert.deepEqual($$('[data-set-tool]:checked').map(el=>el.dataset.setTool),['one','three']);assert.deepEqual(state(),before,'reviewing the selected set does not edit the drawer');
  change('[data-field="setName"]','Společný výběr');click('[data-set-save]');
  const p=state(),created=p.toolSets.find(s=>s.name==='Společný výběr');assert.ok(created);assert.deepEqual(created.toolIds,['one','three']);
  assert.deepEqual(p.toolSets.find(s=>s.id==='uniform').toolIds,['two']);assert.deepEqual(p.toolSets.find(s=>s.id==='shared').toolIds,['four']);assert.deepEqual(validateLayout(p),[]);
  click('[data-tool-sets-close]');sameAfterUndo(before);
});

test('dragging one selected module moves the full bulk selection and shared siblings by one relative snapped vector',()=>{
  const before=state();select('one','three');startDrag('mc');
  pointer('pointermove',board(),{x:10,y:54});pointer('pointermove',board(),{x:10,y:96});
  assert.deepEqual(state(),before,'drag preview is not persisted');pointer('pointerup',board(),{x:10,y:96});
  const p=state();
  for(const id of ['ma','mc'])assert.equal(p.modules.find(m=>m.id===id).y,before.modules.find(m=>m.id===id).y+84);
  for(const id of ['one','three','four']){const next=p.tools.find(t=>t.id===id),old=before.tools.find(t=>t.id===id);assert.equal(next.y,old.y+84);assert.equal(next.x,old.x);assert.deepEqual(next.points,old.points);}
  assert.deepEqual(p.tools.find(t=>t.id==='two'),before.tools.find(t=>t.id==='two'));assert.deepEqual(p.modules.find(m=>m.id==='filler'),before.modules.find(m=>m.id==='filler'));
  assert.deepEqual(checked(),['one','three'],'bulk selection remains intact');assert.deepEqual(validateLayout(p),[]);sameAfterUndo(before);
  assert.equal($('#app [data-action="undo"]').disabled,true,'multiple pointer moves form one undo step');
  startDrag('mb');pointer('pointermove',board(),{x:10,y:52});pointer('pointerup',board(),{x:10,y:52});
  assert.equal(saved().modules.find(m=>m.id==='mb').y,42,'an unselected grabbed module retains ordinary single-module dragging');
  assert.deepEqual(saved().tools.filter(t=>['one','three','four'].includes(t.id)),before.tools.filter(t=>['one','three','four'].includes(t.id)));assert.deepEqual(checked(),[],'working with a different module clears the previous tool selection');sameAfterUndo(before);
});

test('bulk drag collision or outside target rolls every selected module back atomically',()=>{
  const before=state();select('one','three');
  for(const delta of [{x:178,y:10},{x:10,y:-74}]){
    startDrag('mc');pointer('pointermove',board(),{x:10,y:52});pointer('pointermove',board(),delta);pointer('pointerup',board(),delta);
    assert.deepEqual(state(),before);assert.deepEqual(checked(),['one','three']);assert.equal($('#app [data-action="undo"]').disabled,true,'failed drag leaves no history');
    assert.match($('#toast').textContent,/překrýv|pozice Y|přesahuje/);
  }
});

test('a locked selected module elsewhere prevents bulk drag and does not partially move the grabbed module',()=>{
  const before=state();select('three');action('bulk-lock');select('one','three');const locked=state();
  startDrag('ma');pointer('pointermove',board(),{x:10,y:52});pointer('pointerup',board(),{x:10,y:52});
  assert.deepEqual(state(),locked);assert.deepEqual(checked(),['one','three']);assert.match($('#toast').textContent,/odemkněte/);sameAfterUndo(before);
});

test('bulk drag keeps pointer identity and cancel, lost capture or blur discard every preview',()=>{
  const before=state();select('one','three');
  for(const end of ['pointercancel','lostpointercapture','blur']){
    startDrag('mc',71);
    pointer('pointerdown',board().querySelector('[data-module="mb"] .tool-outline'),{id:72});
    pointer('pointermove',board(),{id:72,x:10,y:94});pointer('pointerup',board(),{id:72,x:10,y:94});
    pointer('pointermove',board(),{id:71,x:10,y:52});
    if(end==='blur')win.dispatchEvent(new win.Event('blur'));else pointer(end,board(),{id:71});
    pointer('pointermove',board(),{id:71,x:10,y:94});pointer('pointerup',board(),{id:71,x:10,y:94});
    assert.deepEqual(state(),before);assert.deepEqual(checked(),['one','three']);assert.equal($('#app [data-action="undo"]').disabled,true);
    assert.equal(captured.has(71),false,'cancel releases the active pointer capture');
  }
  // A fresh gesture still succeeds after every interrupted one, and another pointer cannot end it.
  startDrag('mc',73);pointer('pointermove',board(),{id:73,x:10,y:52});pointer('pointerup',board(),{id:99,x:10,y:52});
  assert.deepEqual(state(),before);pointer('pointerup',board(),{id:73,x:10,y:52});assert.equal(saved().modules.find(m=>m.id==='mc').y,before.modules.find(m=>m.id==='mc').y+42);sameAfterUndo(before);
});

test('editing shortcuts cannot commit a drag preview and Escape cancels before normal keyboard edits resume',()=>{
  const before=state();select('one','three');
  const stored=localStorage.getItem('suplik-studio-projects-v1'),history=()=>({undo:$('#app [data-action="undo"]').disabled,redo:$('#app [data-action="redo"]').disabled}),prior=history();
  startDrag('mc',81);pointer('pointermove',board(),{id:81,x:10,y:52});
  for(const [name,modifiers] of [['r',{}],['z',{ctrlKey:true}],['Delete',{}]]){
    assert.equal(key(name,modifiers).defaultPrevented,true,'editing shortcut is blocked during preview');assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);assert.deepEqual(history(),prior);assert.deepEqual(checked(),['one','three']);
  }
  assert.equal(key('Escape').defaultPrevented,true);pointer('pointerup',board(),{id:81,x:10,y:52});
  assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);assert.deepEqual(history(),prior);assert.deepEqual(checked(),['one','three']);
  key('r');assert.deepEqual(saved().tools.map(t=>t.rotation),[90,0,90,0],'plain R works after the gesture is canceled');assert.deepEqual(validateLayout(saved()),[]);sameAfterUndo(before);
});

test('zero movement and locking an already locked selection leave data and history unchanged',()=>{
  const before=state();select('one','three');
  const stored=localStorage.getItem('suplik-studio-projects-v1'),history=()=>({undo:$('#app [data-action="undo"]').disabled,redo:$('#app [data-action="redo"]').disabled}),prior=history();
  action('bulk-move');click('[data-apply-bulk-move]');assert.equal($('.modal'),null);assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);assert.deepEqual(history(),prior);assert.deepEqual(checked(),['one','three']);
  action('bulk-lock');const locked=state(),lockedStored=localStorage.getItem('suplik-studio-projects-v1'),lockedHistory=history();
  action('bulk-lock');assert.deepEqual(state(),locked);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),lockedStored);assert.deepEqual(history(),lockedHistory);assert.deepEqual(checked(),['one','three']);
  sameAfterUndo(before);assert.equal($('#app [data-action="undo"]').disabled,true,'the repeated lock did not add a second undo entry');
});

test('size label text and drawer toggle persist through JSON export without changing geometry',async()=>{
  select();click('[data-select="one"]');const before=state();
  change('[data-field="sizeLabel"]','13 mm');assert.equal(saved().tools[0].sizeLabel,'13 mm');action('toggle-size-labels');assert.equal(saved().sizeLabels,true);
  const labeled=state();assert.deepEqual(labeled.tools.map(t=>t.points),before.tools.map(t=>t.points));assert.deepEqual(labeled.modules,before.modules);
  action('save-project');assert.equal(downloads.length,1);const exported=JSON.parse(await downloads[0].blob.text());assert.equal(exported.project.sizeLabels,true);assert.equal(exported.project.tools[0].sizeLabel,'13 mm');
  const restored=validateProject(exported);assert.equal(restored.sizeLabels,true);assert.equal(restored.tools[0].sizeLabel,'13 mm');
  action('undo');assert.equal(saved().sizeLabels,false);sameAfterUndo(before);
});
