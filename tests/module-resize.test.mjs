import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {bounds,validateLayout} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const el=$(selector);assert.ok(el,'Missing '+selector);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const change=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.value=String(value);element.dispatchEvent(new win.Event('change',{bubbles:true}));};
const createDrawerFromUI=(name,width,height)=>{action('projects');click('[data-new]');change('[data-field=drawerName]',name);change('[data-field=drawerWidth]',width);change('[data-field=drawerHeight]',height);click('[data-create-drawer]');return saved();};
const addRect=(w,h)=>{action('add-shape');change('#shape-type','rect');change('[data-field=shapeWidth]',w);change('[data-field=shapeHeight]',h);click('[data-confirm]');};
const addBlank=(w,h)=>{action('add-shape');change('#shape-type','blank');change('[data-field=shapeWidth]',w);change('[data-field=shapeHeight]',h);click('[data-confirm]');};
await import('../dist/app.js');

// The board SVG is re-rendered often, so client → SVG coordinates are mocked 1:1 on the prototype.
const svgProto=Object.getPrototypeOf($('#board-svg'));
svgProto.createSVGPoint=function(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};};
svgProto.getScreenCTM=()=>({inverse:()=>({})});
svgProto.setPointerCapture=()=>{};
const pointer=(type,target,x,y,{id=7,pointerType='mouse'}={})=>{const event=new win.PointerEvent(type,{pointerId:id,pointerType,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
/** Drag a resize handle of the selected module by (dx,dy) mm. */
function dragHandle(dir,dx,dy=0,opts){
  const handle=$(`#board-svg [data-resize="${dir}"]`);assert.ok(handle,'Missing handle '+dir);
  const start={x:10,y:10};pointer('pointerdown',handle.querySelector('.resize-hit'),start.x,start.y,opts);
  pointer('pointermove',$('#board-svg'),start.x+dx/2,start.y+dy/2,opts);
  pointer('pointermove',$('#board-svg'),start.x+dx,start.y+dy,opts);
  pointer('pointerup',$('#board-svg'),start.x+dx,start.y+dy,opts);
}
const toolModule=()=>{const p=saved(),t=p.tools.at(-1);return p.modules.find(m=>m.id===t.moduleId);};
const issuesFor=(p,id)=>validateLayout(p).filter(i=>i.ids.includes(id));

createDrawerFromUI('Změna velikosti',588,420);
addRect(40,80);

test('handles render for the selected unlocked module and are disabled for a locked one',()=>{
  const m=toolModule();assert.ok(m);
  for(const dir of ['e','s','se','w','n'])assert.ok($(`#board-svg [data-resize="${dir}"][data-resize-of="${m.id}"]`),'handle '+dir);
  assert.ok($('#board-svg .resize-e'),'cursor class for the right edge');
  if(!m.locked)action('lock');assert.equal(saved().modules.find(x=>x.id===m.id).locked,true);
  assert.ok($('#board-svg [data-resize]')===null,'Locked modules must not expose active handles');
  const disabled=$('#board-svg .resize-handle.disabled');assert.ok(disabled);assert.match(disabled.querySelector('title').textContent,/Odemkněte modul pro změnu velikosti/);
  const before=saved();pointer('pointerdown',disabled.querySelector('.resize-hit'),10,10);pointer('pointerup',$('#board-svg'),40,10);
  assert.ok(JSON.stringify(saved())===JSON.stringify(before),'Project unchanged');assert.match($('#toast').textContent,/Odemkněte modul/);
  assert.ok($('#app [data-action=module-step]').disabled,'Quick buttons are disabled on a locked module');
  action('lock');assert.equal(saved().modules.find(x=>x.id===m.id).locked,false);assert.ok($('#board-svg [data-resize="e"]'));
});

test('dragging the right handle widens by whole grid steps in one undo step',()=>{
  const before=saved(),m=toolModule(),grid=before.grid;
  dragHandle('e',grid*2+3);
  const after=toolModule();
  assert.equal(after.width,m.width+grid*2);assert.equal(after.height,m.height);assert.equal(after.x,m.x);assert.equal(after.sizeMode,'manual');
  assert.deepEqual(issuesFor(saved(),m.id),[]);
  action('undo');assert.deepEqual(saved().modules,before.modules,'One undo restores the size');assert.deepEqual(saved().tools,before.tools);
});

test('resize ignores other pointers, cancels on blur or lost capture, and accepts the next gesture',()=>{
  const serialized=()=>localStorage.getItem('suplik-studio-projects-v1');
  const history=()=>({undo:$('#app [data-action=undo]').disabled,redo:$('#app [data-action=redo]').disabled});
  const start=(id=40)=>pointer('pointerdown',$('#board-svg [data-resize="s"] .resize-hit'),10,10,{id});
  const move=(dy,id=40)=>pointer('pointermove',$('#board-svg'),10,10+dy,{id});
  const end=(type,id=40)=>pointer(type,$('#board-svg'),10,10,{id});
  let before=saved(),m=toolModule(),stored=serialized(),undo=history();
  start();move(before.grid);
  end('pointerup',99);end('pointercancel',99);end('lostpointercapture',99);
  assert.ok($('#board-svg .resize-label'),'An unrelated pointer must not end the active resize');
  assert.equal(serialized(),stored);assert.deepEqual(history(),undo);
  move(before.grid*2);end('pointerup');
  assert.equal(toolModule().height,m.height+before.grid*2,'The original pointer still completes the resize');
  const committed=serialized();end('lostpointercapture');assert.equal(serialized(),committed,'Normal release after pointerup cannot revert a committed edit');
  action('undo');assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().tools,before.tools);

  before=saved();m=toolModule();stored=serialized();undo=history();
  start();move(before.grid);win.dispatchEvent(new win.Event('blur'));
  assert.equal($('#board-svg .resize-label'),null,'Blur removes the resize preview');
  assert.equal(serialized(),stored);assert.deepEqual(history(),undo);
  move(before.grid*2);end('pointerup');
  assert.equal(serialized(),stored,'Late events after blur cannot save a resize');assert.deepEqual(history(),undo);
  assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().tools,before.tools);

  start();move(before.grid);end('lostpointercapture');
  assert.equal($('#board-svg .resize-label'),null,'Lost capture restores the original module');
  move(before.grid*2);end('pointerup');
  assert.equal(serialized(),stored);assert.deepEqual(history(),undo);
  dragHandle('s',0,before.grid);
  assert.equal(toolModule().height,m.height+before.grid,'A cancelled resize does not leave the next gesture stuck');
  action('undo');assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().tools,before.tools);
});

test('module drag ignores unrelated pointers and cancels on lost capture or blur without history',()=>{
  const before=saved(),serialized=()=>localStorage.getItem('suplik-studio-projects-v1'),stored=serialized(),undo=$('#app [data-action=undo]').disabled,redo=$('#app [data-action=redo]').disabled;
  const moduleId=toolModule().id;
  for(const cause of ['lostpointercapture','blur']){
    pointer('pointerdown',$(`#board-svg [data-module="${moduleId}"] .tool-outline`),10,10,{id:51});
    pointer('pointermove',$('#board-svg'),10,10+before.grid,{id:51});
    pointer('pointerup',$('#board-svg'),10,10+before.grid,{id:99});
    if(cause==='blur')win.dispatchEvent(new win.Event('blur'));
    else pointer('lostpointercapture',$('#board-svg'),10,10,{id:51});
    pointer('pointermove',$('#board-svg'),10,10+before.grid*2,{id:51});pointer('pointerup',$('#board-svg'),10,10,{id:51});
    assert.equal(serialized(),stored);assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().tools,before.tools);
    assert.equal($('#app [data-action=undo]').disabled,undo);assert.equal($('#app [data-action=redo]').disabled,redo);
  }
});

test('touch drag on the bottom handle works without move mode',()=>{
  const before=saved(),m=toolModule();
  dragHandle('s',before.grid,0+before.grid,{pointerType:'touch',id:3});
  assert.equal(toolModule().height,m.height+before.grid);action('undo');assert.deepEqual(saved().modules,before.modules);
});

test('a too small drag clamps to the minimum and keeps a valid layout',()=>{
  // Without grid snapping the minimum is exact (pockets + wall), not rounded up to the grid.
  action('drawer-tab');action('snap');click('.tool-row');
  const before=saved(),m=toolModule();
  dragHandle('e',-1000);
  const after=toolModule(),p=saved(),t=p.tools.at(-1);
  assert.ok(after.width<m.width,'The module shrinks');assert.ok(after.width>=bounds(t).width+2*p.wall,'…but still holds the pocket and wall');
  assert.deepEqual(issuesFor(p,m.id),[]);assert.deepEqual(issuesFor(p,t.id),[]);
  action('undo');assert.deepEqual(saved().modules,before.modules);
  action('drawer-tab');action('snap');click('.tool-row');
});

test('resizing never overlaps a neighbouring module or leaves the drawer',()=>{
  addBlank(84,84);
  const p=saved(),blank=p.modules.find(x=>!p.tools.some(t=>t.moduleId===x.id));assert.ok(blank);
  click('.tool-row');const m=toolModule();
  const right=p.modules.filter(o=>o.id!==m.id&&o.x>=m.x+m.width-1e-6&&o.y<m.y+m.height&&o.y+o.height>m.y);
  dragHandle('e',2000);
  const wide=saved().modules.find(x=>x.id===m.id);
  if(right.length)assert.ok(wide.x+wide.width<=Math.min(...right.map(o=>o.x))+1e-6,'Stops at the neighbour');
  const steps=saved();dragHandle('s',0,2000);
  const after=saved(),r=after.modules.find(x=>x.id===m.id);
  assert.equal(validateLayout(after).filter(i=>i.type==='overlap').length,0);
  assert.ok(r.x+r.width<=after.width+1e-6&&r.y+r.height<=after.height+1e-6,'Stays in the drawer');
  assert.ok(r.width>m.width||r.height>m.height,'It still grows where there is room');
  action('undo');assert.deepEqual(saved().modules,steps.modules,'The bottom drag is one undo step');
  while(saved().modules.find(x=>x.id===m.id).width!==m.width)action('undo');assert.deepEqual(saved().modules.find(x=>x.id===m.id).height,m.height);
});

test('Alt+Shift+arrows resize by one grid step',()=>{
  click('.tool-row');const before=saved(),m=toolModule();
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,shiftKey:true,bubbles:true}));
  assert.equal(toolModule().height,m.height+before.grid);assert.equal(toolModule().width,m.width);
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(toolModule().height,m.height+before.grid,'Plain arrows do not resize');
  action('undo');assert.deepEqual(saved().modules,before.modules);
});

test('inspector quick buttons and the dialog step buttons',()=>{
  click('.tool-row');const before=saved(),m=toolModule(),grid=before.grid;
  assert.match($('#app [data-action=resize-module]').textContent,/Změnit velikost/);
  click('#app [data-action=module-step][data-value="h+"]');assert.equal(toolModule().height,m.height+grid);
  action('undo');assert.deepEqual(saved().modules,before.modules);
  action('resize-module');click('[data-dialog-step=moduleWidth][data-dir="1"]');click('[data-dialog-step=moduleWidth][data-dir="1"]');click('[data-dialog-step=moduleHeight][data-dir="-1"]');assert.equal(Number($('[data-field=moduleHeight]').value),m.height-grid);click('[data-dialog-step=moduleHeight][data-dir="1"]');click('[data-dialog-step=moduleHeight][data-dir="1"]');
  assert.equal(Number($('[data-field=moduleWidth]').value),m.width+2*grid);click('[data-dialog-step=moduleWidth][data-dir="-1"]');click('[data-dialog-step=moduleWidth][data-dir="-1"]');assert.equal(Number($('[data-field=moduleWidth]').value),m.width);
  click('[data-resize-module]');
  const after=toolModule();
  if($('#modal-root').children.length){click('[data-modal-close]');assert.fail('Dialog resize failed: '+$('#toast').textContent);}
  assert.equal(after.width,m.width);assert.equal(after.height,m.height+grid);assert.equal(after.sizeMode,'manual');
  action('undo');assert.deepEqual(saved().modules,before.modules);
});

test('tool scale in % and by longest side in any unit, undoable',()=>{
  click('.tool-row');const before=saved(),t=before.tools.at(-1),b=bounds(t),cx=b.x+b.width/2,cy=b.y+b.height/2;
  change('#app [data-field=toolScale]','110');
  let s=saved().tools.at(-1),nb=bounds(s);
  assert.ok(Math.abs(nb.width-b.width*1.1)<1e-6&&Math.abs(nb.height-b.height*1.1)<1e-6);
  const m=saved().modules.find(x=>x.id===s.moduleId);assert.deepEqual(issuesFor(saved(),s.id),[],'The auto module follows the outline');
  assert.ok(m);action('undo');assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);
  change('#app [data-field=toolLength]','200 mm');s=saved().tools.at(-1);nb=bounds(s);
  assert.ok(Math.abs(Math.max(nb.width,nb.height)-200)<1e-6);assert.ok(Math.abs(nb.width/nb.height-b.width/b.height)<1e-6,'Uniform scale');
  action('undo');
  change('#app [data-field=toolLength]','8 in');nb=bounds(saved().tools.at(-1));assert.ok(Math.abs(Math.max(nb.width,nb.height)-203.2)<1e-6);
  action('undo');assert.deepEqual(saved().tools,before.tools);
  change('#app [data-field=toolScale]','9000');assert.deepEqual(saved().tools,before.tools);assert.match($('#toast').textContent,/měřítko/i);
  assert.ok(Number.isFinite(cx+cy));
});

test('tool scale respects locked modules and keeps the centre when the module is manual',()=>{
  click('.tool-row');action('lock');const before=saved();
  change('#app [data-field=toolScale]','120');assert.ok(JSON.stringify(saved())===JSON.stringify(before),'Project unchanged');assert.match($('#toast').textContent,/odemkněte modul/);
  action('lock');
  click('#app [data-action=module-step][data-value="w+"]');click('#app [data-action=module-step][data-value="h+"]');
  const t=saved().tools.at(-1),b=bounds(t),m=toolModule();
  change('#app [data-field=toolScale]','90');const nb=bounds(saved().tools.at(-1));
  assert.ok(Math.abs((nb.x+nb.width/2)-(b.x+b.width/2))<1e-6&&Math.abs((nb.y+nb.height/2)-(b.y+b.height/2))<1e-6,'Scaled about the centre');
  assert.deepEqual(toolModule(),m,'A manual module keeps its size');
  action('undo');action('undo');action('undo');
});

test('many unplaced tools collapse into one issue line',()=>{
  createDrawerFromUI('Malý šuplík',100,100);
  for(let i=0;i<4;i++)addRect(70,70);
  const box=$('#app .issue-box');assert.ok(box);
  assert.match(box.textContent,/4 nástroje jsou větší než šuplík 100 × 100 mm/);
  assert.doesNotMatch(box.textContent,/zatím nemá umístěný modul/);
  assert.ok(box.querySelector('[data-action=expand]'));assert.ok(box.querySelector('[data-action=auto]'));
});

test('English labels',()=>{
  createDrawerFromUI('English',588,420);addRect(40,80);
  click('#app .topbar [data-action=set-lang][data-value=en]');
  try{
    assert.match($('#app [data-action=resize-module]').textContent,/Resize/);
    assert.match($('#app [data-field=toolScale]').closest('label').textContent,/Scale/);
    assert.match($('#app [data-field=toolLength]').closest('label').textContent,/Length/);
    assert.match($('#board-svg [data-resize="e"] title').textContent,/Drag to resize/);
    assert.ok($('#app [data-action=module-step][aria-label^="Widen by"]'));
  }finally{click('#app .topbar [data-action=set-lang][data-value=cs]');}
});
