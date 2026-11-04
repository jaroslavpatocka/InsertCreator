import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {bounds,validateLayout} from '../dist/geometry.js';
import {validateProject} from '../dist/model.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const blobURLs=new Map(),downloads=[];
URL.createObjectURL=blob=>{const url=`blob:http://localhost/download-${blobURLs.size}`;blobURLs.set(url,blob);return url;};
URL.revokeObjectURL=url=>blobURLs.delete(url);
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobURLs.get(this.href)});};
const canvases=new WeakMap();
const actual=element=>{
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);
  if(canvas.width!==element.width)canvas.width=element.width;
  if(canvas.height!==element.height)canvas.height=element.height;
  return canvas;
};
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const ctx=actual(this).getContext('2d');
  return new Proxy(ctx,{get:(t,key)=>key==='drawImage'?((image,...args)=>t.drawImage(image instanceof win.HTMLCanvasElement?actual(image):image,...args)):typeof t[key]==='function'?t[key].bind(t):t[key],set:(t,k,v)=>(t[k]=v,true)});
};
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const el=$(selector);assert.ok(el,'Missing '+selector);el.click();};
const waitFor=async(fn,timeout=12000)=>{const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw Error('Timed out waiting for UI');await new Promise(r=>setTimeout(r,15));}};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const logical=p=>{const copy=structuredClone(p);delete copy.updatedAt;return copy;};
async function arrange(){
  const before=logical(saved());action('smart-layout');assert.ok($('[data-smart-progress]'));
  await waitFor(()=>$('[data-smart-close]'),60000);assert.doesNotMatch($('.smart-layout-result h3').textContent,/nepodařilo|failed|couldn.t/i,$('.smart-layout-result').textContent);
  click('[data-smart-close]');return JSON.stringify(logical(saved()))!==JSON.stringify(before);
}
const change=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);if(element.type==='checkbox')element.checked=Boolean(value);else element.value=String(value);element.dispatchEvent(new win.Event('change',{bubbles:true}));};
const createDrawerFromUI=(name,width,height)=>{action('projects');click('[data-new]');change('[data-field=drawerName]',name);change('[data-field=drawerWidth]',width);change('[data-field=drawerHeight]',height);click('[data-create-drawer]');return saved();};
const downloadFrom=async selector=>{const count=downloads.length;click(selector);await waitFor(()=>downloads.length>count);assert.ok(downloads.at(-1).blob,'A generated file Blob must be present');return downloads.at(-1);};
function storedZip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=[];let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
    assert.equal(view.getUint16(offset+8,true),0,'These ZIP entries must be stored without compression');
    const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;
    files.push({name:new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)),bytes:bytes.subarray(start,start+size)});offset=start+size;
  }
  assert.ok(files.length,'The downloaded ZIP must contain files');return files;
}
function stlHeight(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=view.getUint32(80,true);assert.ok(triangles>0);assert.equal(bytes.length,84+triangles*50);
  let zmin=Infinity,zmax=-Infinity;
  for(let i=0;i<triangles;i++)for(let vertex=0;vertex<3;vertex++){
    const start=84+i*50+12+vertex*12,x=view.getFloat32(start,true),y=view.getFloat32(start+4,true),z=view.getFloat32(start+8,true);
    assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z));zmin=Math.min(zmin,z);zmax=Math.max(zmax,z);
  }
  assert.ok(zmin>=-1e-5);return zmax-zmin;
}
await import('../dist/app.js');

test('rotation shortcut ignores Ctrl, Meta and Alt while plain R still rotates',()=>{
  const original=saved(),scratch=createDrawerFromUI('Otočení klávesou R',588,420);
  try{
    action('add-shape');change('#shape-type','rect');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
    // Leave room for either orientation so this test checks keyboard handling, not an invalid pocket rotation.
    action('resize-module');change('[data-field=moduleWidth]',168);change('[data-field=moduleHeight]',168);click('[data-resize-module]');
    const before=saved(),rotation=before.tools[0].rotation;assert.deepEqual(validateLayout(before),[]);
    for(const modifier of ['ctrlKey','metaKey','altKey']){
      win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'r',[modifier]:true,bubbles:true}));
      assert.deepEqual(saved().tools,before.tools,modifier+' must not rotate the tool');assert.deepEqual(saved().modules,before.modules);
    }
    win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'r',bubbles:true}));
    assert.equal(saved().tools[0].rotation,(rotation+90)%360);assert.deepEqual(validateLayout(saved()),[]);
    action('undo');assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);
  }finally{
    action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
  }
});

test('legacy projects keep their original pockets until finger grips are explicitly requested',async()=>{
  const before=saved();assert.ok(before.tools.every(t=>!Object.prototype.hasOwnProperty.call(t,'fingerGrips')));
  click('.tool-row');assert.match($('#app [data-action=finger-grips-auto]').textContent,/Přidat výřezy pro prsty/);
  assert.ok($('.finger-grip-preview .grip-pocket'));assert.ok($('.finger-grip-preview .grip-tool'));
  const arranged=await arrange();
  try{assert.ok(saved().tools.every(t=>!Object.prototype.hasOwnProperty.call(t,'fingerGrips')));assert.deepEqual(saved().tools.map(t=>t.points),before.tools.map(t=>t.points));}
  finally{if(arranged)action('undo');}
});

test('new finger grips support editing, individual removal, undo and explicit empty JSON transfers',async()=>{
  const original=saved(),scratch=createDrawerFromUI('Výřezy pro prsty',588,420);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]','Test výřezů');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  const first=saved().tools[0],points=first.points;assert.equal(first.fingerGrips.length,2);assert.ok(first.fingerGrips.every(g=>g.radius===9));
  assert.equal(Number($('#app [data-field=toolWidth]').value),bounds(first).width,'Displayed tool size must exclude finger recesses');
  action('finger-grips');const row=$('[data-grip-row]'),id=row.dataset.gripRow;
  change(`[data-grip-row="${id}"] [data-field=fingerY]`,first.fingerGrips[0].y+2);change(`[data-grip-row="${id}"] [data-field=fingerDiameter]`,20);click('[data-grips-save]');
  const edited=saved().tools[0].fingerGrips;assert.equal(edited[0].radius,10);assert.equal(edited[0].y,first.fingerGrips[0].y+2);assert.deepEqual(saved().tools[0].points,points);
  action('finger-grips');change(`[data-grip-row="${id}"] [data-field=fingerX]`,'');assert.ok($('[data-grip-error]').textContent);assert.deepEqual(saved().tools[0].fingerGrips,edited);
  click('[data-grip-delete]');assert.equal(win.document.querySelectorAll('[data-grip-row]').length,1,'An incomplete row must still be removable');click('[data-grips-save]');assert.equal(saved().tools[0].fingerGrips.length,1);
  action('undo');assert.deepEqual(saved().tools[0].fingerGrips,edited);
  action('finger-grips');click('[data-grip-add]');assert.equal(win.document.querySelectorAll('[data-grip-row]').length,3);click('[data-grips-save]');assert.equal(saved().tools[0].fingerGrips.length,3);action('undo');
  action('finger-grips-clear');assert.deepEqual(saved().tools[0].fingerGrips,[]);const arranged=await arrange();assert.deepEqual(saved().tools[0].fingerGrips,[]);
  if(arranged)action('undo');assert.deepEqual(saved().tools[0].fingerGrips,[]);action('undo');assert.deepEqual(saved().tools[0].fingerGrips,edited);action('redo');assert.deepEqual(saved().tools[0].fingerGrips,[]);
  action('duplicate');const copy=saved().tools.at(-1);assert.deepEqual(copy.fingerGrips,[],'Duplicating explicit removal must not generate new defaults');assert.deepEqual(copy.points,points);
  action('library');const copyCard=[...win.document.querySelectorAll('.library-item')].find(el=>el.querySelector('strong').textContent===copy.name);assert.ok(copyCard);copyCard.querySelector('[data-library-add]').click();assert.deepEqual(saved().tools.at(-1).fingerGrips,[],'The library must preserve explicit removal');
  const backup=await downloadFrom('#app [data-action=save-project]'),json=await backup.blob.text();assert.ok(JSON.parse(json).project.tools.every(t=>Array.isArray(t.fingerGrips)&&t.fingerGrips.length===0));
  const fileInput=$('#project-file');Object.defineProperty(fileInput,'files',{configurable:true,value:[{size:json.length,text:async()=>json}]});
  fileInput.dispatchEvent(new win.Event('change',{bubbles:true}));await waitFor(()=>saved().id!==scratch.id);delete fileInput.files;
  const imported=saved();assert.ok(imported.tools.every(t=>Array.isArray(t.fingerGrips)&&t.fingerGrips.length===0));assert.deepEqual(imported.tools[0].points,points);
  await arrange();assert.ok(saved().tools.every(t=>t.fingerGrips.length===0));
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click(`[data-remove-project="${imported.id}"]`);click('[data-modal-close]');
});

test('finger grip edits validate before commit and preserve manual locked modules and raw dimensions',()=>{
  const original=saved(),scratch=createDrawerFromUI('Ověření výřezů',588,420);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]','Pevný modul');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  const first=saved().tools[0],module=saved().modules[0];
  action('resize-module');change('[data-field=moduleWidth]',module.width);change('[data-field=moduleHeight]',module.height);click('[data-resize-module]');action('lock');const locked=saved();
  action('finger-grips');const row=$('[data-grip-row]'),id=row.dataset.gripRow;
  change(`[data-grip-row="${id}"] [data-field=fingerX]`,3000);click('[data-grips-save]');assert.deepEqual(saved(),locked);assert.ok($('[data-grip-error]').textContent);assert.ok($('[data-grips-save]'));
  change(`[data-grip-row="${id}"] [data-field=fingerX]`,first.fingerGrips[0].x);change(`[data-grip-row="${id}"] [data-field=fingerDiameter]`,80);click('[data-grips-save]');assert.deepEqual(saved(),locked);assert.match($('[data-grip-error]').textContent,/Zvětšete modul/);
  change(`[data-grip-row="${id}"] [data-field=fingerDiameter]`,20);change(`[data-grip-row="${id}"] [data-field=fingerY]`,first.fingerGrips[0].y+2);click('[data-grips-save]');
  assert.deepEqual(saved().modules,locked.modules);assert.deepEqual(saved().tools[0].points,first.points);assert.equal(saved().tools[0].fingerGrips[0].radius,10);
  action('undo');assert.deepEqual(saved().tools[0].fingerGrips,first.fingerGrips);action('lock');
  const grips=saved().tools[0].fingerGrips,newWidth=bounds(saved().tools[0]).width*2;change('#app [data-field=toolWidth]',newWidth);const scaled=saved().tools[0];
  assert.deepEqual(scaled.fingerGrips,grips.map(g=>({...g,x:g.x*2,y:g.y*2})));assert.equal(Number($('#app [data-field=toolWidth]').value),newWidth);action('undo');
  action('size-module-auto');
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]','Jiný neumístěný nástroj');change('[data-field=shapeWidth]',1500);change('[data-field=shapeHeight]',1500);click('[data-confirm]');
  const unplaced=saved().tools.at(-1);assert.equal(unplaced.moduleId,null);click(`[data-select="${first.id}"]`);
  action('finger-grips');const editId=$('[data-grip-row]').dataset.gripRow;change(`[data-grip-row="${editId}"] [data-field=fingerDiameter]`,20);click('[data-grips-save]');
  assert.equal(saved().tools.find(t=>t.id===first.id).fingerGrips[0].radius,10,'An unrelated unplaced tool must not block a valid grip edit');assert.equal(saved().tools.find(t=>t.id===unplaced.id).moduleId,null);
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('finger grip growth cannot displace another previously placed tool or change undo history',async()=>{
  const original=saved(),scratch=createDrawerFromUI('Plný malý šuplík',84,84),ids=[];
  for(const name of ['První nástroj','Druhý nástroj']){
    action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]',name);change('[data-field=shapeWidth]',30);change('[data-field=shapeHeight]',60);click('[data-confirm]');
    ids.push(saved().tools.at(-1).id);action('finger-grips-clear');
  }
  await arrange();assert.equal(saved().tools.length,2);assert.ok(saved().tools.every(t=>saved().modules.some(m=>m.id===t.moduleId)));assert.deepEqual(validateLayout(saved()),[]);
  click(`[data-select="${ids[0]}"]`);change('#app [data-field=name]','První nástroj před úpravou');const before=saved();
  action('finger-grips-auto');assert.deepEqual(saved(),before,'A grip edit must not move an existing tool out of the drawer');
  assert.match($('#toast').textContent,/místo/);assert.match($('#toast').textContent,/Druhý nástroj/);
  action('undo');assert.equal(saved().tools.find(t=>t.id===ids[0]).name,'První nástroj','Rejected changes must not create an undo entry');
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('tool scaling rejects detached prospective finger grips without mutating serialized state',()=>{
  const original=saved(),scratch=createDrawerFromUI('Bezpečné měřítko výřezů',588,420);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  action('finger-grips');const id=$('[data-grip-row]').dataset.gripRow;
  change(`[data-grip-row="${id}"] [data-field=fingerX]`,48);change(`[data-grip-row="${id}"] [data-field=fingerY]`,40);click('[data-grips-save]');assert.equal($('#modal-root').children.length,0);
  const before=saved(),width=bounds(before.tools[0]).width;
  change('#app [data-field=toolWidth]',width*2);
  assert.deepEqual(saved(),before,'A circle that would detach after scaling must leave the saved project unchanged');
  assert.equal(Number($('#app [data-field=toolWidth]').value),Math.round(width*10)/10);assert.match($('#toast').textContent,/Automaticky umístit/);
  const restored=validateProject(JSON.parse(JSON.stringify(saved())));assert.deepEqual(restored.tools,before.tools,'The unchanged serialized project must remain reloadable');
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('visible drawer dimensions control restores millimetre fields without resizing tools',()=>{
  const before=saved(),viewport={width:win.innerWidth,height:win.innerHeight},scrollIntoView=win.HTMLElement.prototype.scrollIntoView;
  const scrolls=[];
  try{
    click('.tool-row');assert.ok($('#app [data-scope=tool][data-field=toolWidth]'));
    assert.ok($('#app [data-scope=project][data-field=width]')===null);
    assert.match($('.drawer-dimensions').textContent,/Rozměry šuplíku/);
    win.happyDOM.setWindowSize({width:390,height:844});
    win.HTMLElement.prototype.scrollIntoView=function(options){scrolls.push({id:this.id,options});};
    click('.drawer-dimensions');
    assert.equal(scrolls.length,1);assert.equal(scrolls[0].id,'drawer-settings');
    assert.equal($('#app [data-scope=project][data-field=width]').value,String(before.width));
    assert.equal($('#app [data-scope=project][data-field=height]').value,String(before.height));
    change('#app [data-scope=project][data-field=width]',535);
    change('#app [data-scope=project][data-field=height]',401);
    const resized=saved();assert.equal(resized.width,535);assert.equal(resized.height,401);
    assert.deepEqual(resized.tools,before.tools,'Drawer dimensions must preserve tool contours and positions');
    assert.deepEqual(resized.modules,before.modules,'Drawer dimensions must preserve the current layout');
    for(const key of ['grid','clearance','wall','base','insertHeight','printMode','bottomMode','bedWidth','bedHeight','limitToBed'])assert.deepEqual(resized[key],before[key],key+' must remain unchanged');
    assert.match($('.drawer-dimensions').textContent,/535 × 401 mm/);
    action('undo');action('undo');assert.equal(saved().width,before.width);assert.equal(saved().height,before.height);
  }finally{win.HTMLElement.prototype.scrollIntoView=scrollIntoView;win.happyDOM.setWindowSize(viewport);}
});

test('named drawers keep independent real dimensions when switching between them',()=>{
  const original=saved(),all=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1'));
  action('projects');assert.match($('.modal-head h2').textContent,/Moje šuplíky/);
  const count=all().length;click('[data-new]');assert.equal(all().length,count,'Opening the creation form must not create an unnamed drawer');
  click('[data-create-drawer]');assert.equal(all().length,count,'An explicit drawer name is required');
  change('[data-field=drawerName]','Horní šuplík');change('[data-field=drawerWidth]',535);change('[data-field=drawerHeight]',401);click('[data-create-drawer]');
  const first=saved();assert.equal(first.name,'Horní šuplík');assert.equal(first.width,535);assert.equal(first.height,401);
  const second=createDrawerFromUI('Spodní šuplík',675,485);assert.notEqual(second.id,first.id);
  action('projects');click(`[data-open="${first.id}"]`);click('.drawer-dimensions');
  change('#app [data-field=width]',551);change('#app [data-field=height]',417);
  assert.equal(saved().id,first.id);assert.equal(saved().width,551);assert.equal(saved().height,417);
  assert.equal(all().find(p=>p.id===second.id).width,675);assert.equal(all().find(p=>p.id===second.id).height,485);
  action('projects');click(`[data-open="${second.id}"]`);assert.equal(saved().name,'Spodní šuplík');assert.equal($('#app [data-field=width]').value,'675');assert.equal($('#app [data-field=height]').value,'485');
  action('projects');click(`[data-open="${first.id}"]`);assert.equal($('#app [data-field=width]').value,'551');assert.equal($('#app [data-field=height]').value,'417');
  action('projects');click(`[data-open="${original.id}"]`);assert.deepEqual(saved().tools,original.tools);
  action('projects');click(`[data-remove-project="${first.id}"]`);click(`[data-remove-project="${second.id}"]`);click('[data-modal-close]');
});

test('manual and automatic module sizes preserve contours, position locks and undo history',async()=>{
  const original=saved(),scratch=createDrawerFromUI('Zkouška velikosti modulů',504,378);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]','Zkušební kapsa');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  const before=saved(),module=before.modules[0],points=before.tools[0].points;
  assert.equal(module.locked,false);action('resize-module');
  change('[data-field=moduleWidth]',110);change('[data-field=moduleHeight]',170);click('[data-resize-module]');
  let resized=saved();assert.equal(resized.modules[0].width,110);assert.equal(resized.modules[0].height,170);assert.equal(resized.modules[0].sizeMode,'manual');assert.equal(resized.modules[0].locked,false);
  assert.deepEqual(resized.tools[0].points,points);assert.match($('.module-sizing').textContent,/Jmenovité 110 × 170 mm/);assert.match($('.module-sizing').textContent,/Vnější 109,5 × 169,5 mm/);
  const arranged=await arrange();resized=saved();assert.equal(resized.modules[0].width,110);assert.equal(resized.modules[0].height,170);assert.equal(resized.modules[0].sizeMode,'manual');assert.deepEqual(resized.tools[0].points,points);
  if(arranged)action('undo');action('size-module-auto');resized=saved();assert.equal(resized.modules[0].sizeMode,'auto');assert.equal(resized.modules[0].width,module.width);assert.equal(resized.modules[0].height,module.height);assert.equal(resized.modules[0].locked,false);assert.deepEqual(resized.tools[0].points,points);
  action('undo');assert.equal(saved().modules[0].width,110);assert.equal(saved().modules[0].sizeMode,'manual');assert.deepEqual(saved().tools[0].points,points);
  action('undo');assert.equal(saved().modules[0].width,module.width);assert.equal(saved().modules[0].height,module.height);assert.deepEqual(saved().tools,before.tools);
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('expanding a drawer leaves outside manual modules movable for automatic recovery',async()=>{
  const original=saved(),scratch=createDrawerFromUI('Rozšíření odloženého modulu',504,378);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  action('resize-module');change('[data-field=moduleWidth]',151.5);change('[data-field=moduleHeight]',139.25);click('[data-resize-module]');
  const points=saved().tools[0].points;
  click('.drawer-dimensions');change('#app [data-field=width]',42);change('#app [data-field=height]',42);await arrange();
  const outside=saved().modules[0];assert.ok(outside.x+outside.width>42||outside.y+outside.height>42);assert.equal(outside.locked,false);assert.equal(saved().tools[0].locked,false);
  action('expand');assert.match($('.modal .tip').textContent,/Zamkne se 0 /);
  change('[data-field=expandWidth]',168);change('[data-field=expandHeight]',168);click('[data-confirm]');
  assert.equal(saved().modules[0].locked,false,'An outside module must not be locked by drawer expansion');
  assert.equal(saved().tools[0].locked,false,'Tools in an outside module must remain available for placement');
  await arrange();const recovered=saved(),m=recovered.modules[0];
  assert.equal(m.width,151.5);assert.equal(m.height,139.25);assert.equal(m.sizeMode,'manual');assert.equal(m.locked,false);
  assert.ok(m.x>=0&&m.y>=0&&m.x+m.width<=168&&m.y+m.height<=168,'The retained manual footprint must fit inside the expanded drawer');
  assert.deepEqual(recovered.tools[0].points,points,'Recovery must preserve the tool contour');
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('touch selection scrolls normally until explicit move mode enables pointer capture',()=>{
  const before=saved().modules.map(m=>[m.id,m.x,m.y]),svg=$('#board-svg'),group=$('#board-svg [data-module]');let points=0,captured=0;
  svg.createSVGPoint=()=>{points++;throw Error('Touch selection must not start a drag');};
  const down=new win.PointerEvent('pointerdown',{pointerType:'touch',pointerId:1,isPrimary:true,clientX:30,clientY:40,bubbles:true,cancelable:true});group.dispatchEvent(down);
  group.dispatchEvent(new win.PointerEvent('pointermove',{pointerType:'touch',pointerId:1,clientX:80,clientY:120,bubbles:true}));
  assert.equal(points,0);assert.equal(down.defaultPrevented,false);group.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
  assert.ok(!$('#app [data-scope=tool][data-field=name]'),'A tap on the module background selects the module without selecting its tool');
  assert.ok($('#app .module-sizing'));assert.deepEqual(saved().modules.map(m=>[m.id,m.x,m.y]),before);
  const hit=$('#board-svg .tool-outline');hit.dispatchEvent(new win.PointerEvent('pointerdown',{pointerType:'touch',pointerId:3,isPrimary:true,bubbles:true,cancelable:true}));
  hit.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));assert.ok($('#app [data-scope=tool][data-field=name]'),'A direct tap on a tool still opens its properties');
  action('move-mode');const moving=$('#board-svg');assert.ok(moving.classList.contains('moving'));
  moving.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});moving.getScreenCTM=()=>({inverse:()=>({})});moving.setPointerCapture=()=>captured++;
  const dragDown=new win.PointerEvent('pointerdown',{pointerType:'touch',pointerId:2,isPrimary:true,clientX:30,clientY:40,bubbles:true,cancelable:true});$('#board-svg [data-module]').dispatchEvent(dragDown);
  assert.equal(dragDown.defaultPrevented,true);assert.equal(captured,1);moving.dispatchEvent(new win.PointerEvent('pointerup',{pointerType:'touch',pointerId:2,bubbles:true}));
  action('move-mode');assert.ok(!$('#board-svg').classList.contains('moving'));assert.deepEqual(saved().modules.map(m=>[m.id,m.x,m.y]),before);action('drawer-tab');
});

test('saved status recovers after browser storage becomes writable again',()=>{
  action('drawer-tab');const setItem=localStorage.setItem,width=saved().width;
  try{
    Object.defineProperty(localStorage,'setItem',{configurable:true,value:()=>{throw new DOMException('Storage quota exceeded','QuotaExceededError');}});change('#app [data-field=width]',width+42);
    assert.match($('.save-state').textContent,/Stáhněte zálohu/);
  }finally{Object.defineProperty(localStorage,'setItem',{configurable:true,value:setItem});}
  action('undo');assert.match($('.save-state').textContent,/Uloženo v zařízení/);assert.equal(saved().tools.length,6);
});

const czech=/[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;
test('language switch in the top bar translates the interface, persists and updates document metadata',()=>{
  try{
    action('drawer-tab');assert.match($('#drawer-settings .panel-title').textContent,/Rozměry šuplíku/);
    click('#app .topbar [data-action=set-lang][data-value=en]');
    assert.equal(localStorage.getItem('suplik-studio-lang'),'"en"');assert.equal(win.document.documentElement.lang,'en');
    assert.match($('#drawer-settings .panel-title').textContent,/Drawer dimensions/);
    assert.ok($('#app [data-action=set-lang][data-value=en]').classList.contains('active'));
    assert.match(win.document.title,/a place for every tool/);assert.match($('meta[name=description]').getAttribute('content'),/drawer insert/);
    for(const selector of ['.topbar','.page-heading .subtitle','.steps','.board-toolbar','.board-footer','.metrics','#drawer-settings','.export-card','.footer-line','.mobile-nav','.sidebar-nav'])
      assert.doesNotMatch($(selector).textContent,czech,selector+' must be fully translated');
    action('help');assert.doesNotMatch($('.modal').textContent,czech,'Help must be fully translated');click('[data-modal-close-extra]');
    action('export');assert.match($('.modal-head h2').textContent,/Ready to make/);click('[data-modal-close]');
    action('projects');assert.match($('.modal-head h2').textContent,/My drawers/);click('[data-modal-close]');
  }finally{click('#app [data-action=set-lang][data-value=cs]');}
  assert.equal(localStorage.getItem('suplik-studio-lang'),'"cs"');assert.match($('#drawer-settings .panel-title').textContent,/Rozměry šuplíku/);assert.match(win.document.title,/místo pro každý nástroj/);
});

test('inch units display, typed lengths accept any unit and drawers can override the app unit',()=>{
  const original=saved(),scratch=createDrawerFromUI('Palcový šuplík',504,378);
  try{
    action('drawer-tab');click('#app .topbar [data-action=set-unit][data-value=in]');
    assert.equal(localStorage.getItem('suplik-studio-unit'),'"in"');
    assert.equal($('#app [data-scope=project][data-field=width]').value,'19.843');assert.equal($('#app [data-field=width]').parentElement.querySelector('em').textContent,'in');
    assert.match($('.drawer-dimensions').textContent,/19,843 × 14,882 in/);
    change('#app [data-field=width]','20 in');assert.equal(saved().width,508);assert.equal($('#app [data-field=width]').value,'20');
    change('#app [data-field=height]','400 mm');assert.equal(saved().height,400);
    change('#app [data-field=height]','15 1/2"');assert.ok(Math.abs(saved().height-393.7)<1e-9);
    change('#app [data-field=insertHeight]','1"');assert.equal(saved().insertHeight,25.4);
    const before=saved();change('#app [data-field=width]','abc');assert.deepEqual(saved(),before);assert.match($('#toast').textContent,/platnou délku/);
    change('#app [data-field=width]','200 in');assert.deepEqual(saved(),before,'Limits are still enforced in mm');assert.match($('#toast').textContent,/118,11 in/);
    // App default back to mm, this drawer overrides it with inches.
    click('#app .topbar [data-action=set-unit][data-value=mm]');assert.equal($('#app [data-field=width]').value,'508');
    change('#app [data-scope=project][data-field=unit]','in');assert.equal(saved().unit,'in');
    assert.equal($('#app [data-field=width]').value,'20');assert.ok($('.topbar .pref-switch.overridden'));
    action('undo');assert.equal(saved().unit,'');assert.equal($('#app [data-field=width]').value,'508');action('redo');assert.equal(saved().unit,'in');assert.equal($('#app [data-field=width]').value,'20');
    change('#app [data-field=width]','520 mm');assert.equal(saved().width,520);
    assert.equal(validateProject(JSON.parse(JSON.stringify(saved()))).unit,'in','The drawer unit must survive a JSON roundtrip');
    action('projects');assert.match($(`[data-open="${scratch.id}"]`).closest('.project-card').textContent,/20,472 × 15,5 in/);
    click(`[data-open="${original.id}"]`);assert.equal($('#app [data-field=width]').value,String(original.width),'Other drawers keep the app unit');
    action('projects');click(`[data-open="${scratch.id}"]`);assert.equal($('#app [data-field=width]').value,'20.472');assert.equal(saved().unit,'in');
    // A new drawer typed in inches while the app default is mm.
    const typed=createDrawerFromUI('Smíšené jednotky','20 in','15 in');assert.equal(typed.width,508);assert.equal(typed.height,381);assert.equal(typed.unit,'');
    action('projects');click(`[data-open="${scratch.id}"]`);action('projects');click(`[data-remove-project="${typed.id}"]`);click('[data-modal-close]');
  }finally{click('#app .topbar [data-action=set-unit][data-value=mm]');}
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
  assert.equal(localStorage.getItem('suplik-studio-unit'),'"mm"');assert.equal($('#app [data-field=width]').value,String(original.width));
});

test('sidebar lists all drawers with create, switch and delete, replacing the old menu item',()=>{
  const original=saved(),all=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')),confirm=win.confirm;
  assert.equal([...win.document.querySelectorAll('.sidebar-nav .nav-item')].filter(b=>/Moje šuplíky/.test(b.textContent)).length,0,'The menu item is replaced by the sidebar list');
  assert.ok($('.sidebar [data-action=projects]')===null);assert.ok($('.mobile-nav [data-action=projects]'),'Mobile keeps the drawers modal');
  assert.match($('.drawer-section .sidebar-label').textContent,/MOJE ŠUPLÍKY/);
  assert.equal(win.document.querySelectorAll('.drawer-list .drawer-card').length,all().length);
  assert.equal($('.drawer-list [aria-current=true]').dataset.drawerOpen,original.id);assert.ok($(`.drawer-list [data-drawer-remove="${original.id}"]`)===null,'The open drawer cannot be deleted');
  click('.sidebar [data-action=new-drawer]');change('[data-field=drawerName]','Boční šuplík');change('[data-field=drawerWidth]',1100);change('[data-field=drawerHeight]',700);click('[data-create-drawer]');
  const created=saved();assert.equal(created.name,'Boční šuplík');assert.equal($('.drawer-list [aria-current=true]').dataset.drawerOpen,created.id);
  const card=()=>$(`.drawer-list [data-drawer-open="${created.id}"]`).textContent;
  assert.match(card(),/1 100 × 700 mm · 0 nástrojů/,'Czech number grouping');
  click('#app .topbar [data-action=set-lang][data-value=en]');assert.match(card(),/1,100 × 700 mm · 0 tools/,'English number grouping');assert.match($('.drawer-section .sidebar-label').textContent,/MY DRAWERS/);
  click('#app .topbar [data-action=set-lang][data-value=cs]');
  click(`.drawer-list [data-drawer-open="${original.id}"]`);assert.equal(saved().id,original.id);assert.deepEqual(saved().tools,original.tools);
  try{
    win.confirm=()=>false;click(`.drawer-list [data-drawer-remove="${created.id}"]`);assert.ok(all().some(p=>p.id===created.id),'Cancelled confirm keeps the drawer');
    win.confirm=()=>true;click(`.drawer-list [data-drawer-remove="${created.id}"]`);assert.ok(!all().some(p=>p.id===created.id));
  }finally{win.confirm=confirm;}
  assert.ok($(`.drawer-list [data-drawer-open="${created.id}"]`)===null);assert.equal(saved().id,original.id);
});

test('tools and modules can use their own units inside one millimetre drawer',async()=>{
  const original=saved(),scratch=createDrawerFromUI('Smíšené nástroje',588,420),ids=[];
  try{
  action('drawer-tab');change('#app [data-field=insertHeight]',70);
  for(const [name,w,h] of [['Palcový nástroj',40,80],['Metrický nástroj',30,60]]){
    action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]',name);change('[data-field=shapeWidth]',w);change('[data-field=shapeHeight]',h);click('[data-confirm]');ids.push(saved().tools.at(-1).id);
  }
  const [a,b]=ids,find=id=>saved().tools.find(t=>t.id===id),field=name=>$(`#app [data-scope=tool][data-field=${name}]`);
  const inches=mm=>String(Math.round(mm/25.4*1000)/1000);
  click(`[data-select="${a}"]`);change('#app [data-scope=tool][data-field=unit]','in');assert.equal(find(a).unit,'in');
  assert.equal(field('toolWidth').value,inches(bounds(find(a)).width));assert.equal(field('toolWidth').parentElement.querySelector('em').textContent,'in');
  change('#app [data-scope=tool][data-field=depth]','2');assert.ok(Math.abs(find(a).depth-50.8)<1e-9,'A bare number uses the tool unit');
  assert.match($(`[data-select="${a}"]`).textContent,/in/);assert.ok($(`[data-select="${a}"] .unit-badge`));
  click(`[data-select="${b}"]`);assert.equal(field('toolWidth').value,String(Math.round(bounds(find(b)).width*10)/10));assert.equal(field('depth').parentElement.querySelector('em').textContent,'mm');
  change('#app [data-scope=tool][data-field=unit]','mm');assert.equal(find(b).unit,'mm');assert.equal(saved().unit,'');
  change('#app [data-scope=tool][data-field=depth]','1 in');assert.ok(Math.abs(find(b).depth-25.4)<1e-9,'Typed suffixes still override the tool unit');
  click(`[data-select="${a}"]`);assert.equal(field('depth').value,'2');
  const restored=validateProject(JSON.parse(JSON.stringify(saved())));assert.equal(restored.tools.find(t=>t.id===a).unit,'in');assert.equal(restored.tools.find(t=>t.id===b).unit,'mm');
  action('undo');action('undo');assert.equal(find(b).unit,undefined);action('undo');action('undo');assert.equal(find(a).unit,undefined);assert.notEqual(find(a).depth,50.8);
  action('redo');action('redo');assert.equal(find(a).unit,'in');assert.ok(Math.abs(find(a).depth-50.8)<1e-9);
  // Module override
  const moduleId=find(a).moduleId;change('#app [data-scope=module][data-field=unit]','in');assert.equal(saved().modules.find(m=>m.id===moduleId).unit,'in');
  const mod=()=>saved().modules.find(m=>m.id===find(a).moduleId);assert.match($('.module-sizing').textContent,new RegExp(`Jmenovité ${inches(mod().width).replace('.',',')} × `));assert.ok($('.module-sizing .unit-badge'));
  await arrange();assert.equal(mod().unit,'in','Arrangement keeps the module unit');
  action('resize-module');assert.equal($('[data-field=moduleWidth]').parentElement.querySelector('em').textContent,'in');
  const [w,h]=[mod().width,mod().height].map(v=>Math.floor(v/25.4*2)/2);change('[data-field=moduleWidth]',String(w));change('[data-field=moduleHeight]',String(h));click('[data-resize-module]');
  assert.ok(Math.abs(mod().width-w*25.4)<1e-9,'Bare module sizes use the module unit');assert.ok(Math.abs(mod().height-h*25.4)<1e-9);assert.equal(mod().unit,'in');assert.equal(mod().sizeMode,'manual');
  action('undo');assert.equal(mod().sizeMode,'auto');assert.equal(mod().unit,'in');
  action('duplicate');assert.equal(saved().tools.at(-1).unit,'in','A copy keeps the tool unit');
  }finally{action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');}
});

test('editor workflows and actual photo pipeline integrate with persistent projects',async()=>{
  assert.equal(win.document.querySelectorAll('.tool-row').length,6);
  assert.equal(win.document.querySelectorAll('#board-svg .module').length,6);
  assert.match($('#app').textContent,/Dílna · ruční nářadí/);
  action('3d');assert.ok(win.document.querySelectorAll('#board-svg polygon').length>6);action('2d');
  action('expand');const expandWidth=$('[data-field=expandWidth]');expandWidth.value='588';click('[data-confirm]');
  assert.equal(saved().width,588);assert.ok(saved().modules.every(m=>m.locked));
  action('library');click('[data-library-add="0"]');assert.equal(saved().tools.length,7);
  const lockedPositions=saved().modules.filter(m=>m.locked).map(m=>[m.id,m.x,m.y]);
  const arranged=await arrange();assert.deepEqual(saved().modules.filter(m=>m.locked).map(m=>[m.id,m.x,m.y]),lockedPositions);
  if(arranged){action('undo');assert.equal(saved().tools.length,7);action('redo');}
  // The measured sample needs a 252mm module including its walls and clearance.
  action('export');change('.modal [data-field=bedHeight]',256);click('[data-modal-close]');
  action('capture');click('#sample-scan');await waitFor(()=>$('#trace-items input[type=checkbox]'));
  assert.ok($('#calibration-canvas')===null,'A4 scale and perspective must be automatic');
  assert.ok($('#trace-threshold')===null,'The user must not have to tune a threshold');
  assert.ok($('#trace-smoothing')===null,'The user must not have to tune smoothing');
  assert.equal($('#capture-add').disabled,false,'Clean sample must be ready immediately');
  assert.equal(win.document.querySelectorAll('#trace-items input[type=checkbox]').length,2,'Actual sample raster must recover 2 separate tools');
  assert.match($('#trace-summary').textContent,/2/);
  click('#trace-mask');click('#capture-add');await waitFor(()=>!$('#modal-root').children.length);
  assert.equal(saved().tools.length,9);
  assert.ok(saved().tools.at(-1).points.length>10);
  assert.ok(saved().tools.at(-1).points.every(p=>Number.isFinite(p.x)&&p.x>=0));
  assert.equal(win.document.querySelectorAll('.tool-row').length,9);
  action('export');assert.ok($('[data-do-export]'));assert.ok($('#print-light'));
  change('#print-light',true);assert.equal(saved().printMode,'light');assert.equal($('#print-light').checked,true);
  change('#print-bottom','adhesive');assert.equal(saved().bottomMode,'adhesive');assert.ok($('#print-bottom option[value=adhesive][selected]'),'The saved bottom must be marked in the re-rendered select');
  const bedWidth=saved().bedWidth;change('.modal [data-field=bedWidth]',49);assert.equal(saved().bedWidth,bedWidth,'Invalid printer width must not persist');
  change('.modal [data-field=bedWidth]',50);change('.modal [data-field=bedHeight]',50);assert.equal($('[data-do-export]').disabled,false,'Valid oversized models export as automatically cut mesh parts');
  assert.ok(!$('#limit-bed'),'The print batch always fits its printer without a legacy-limit bypass');assert.equal(saved().limitToBed,true,'The stored legacy flag is retained');
  change('.modal [data-field=bedWidth]',180);change('.modal [data-field=bedHeight]',256);
  assert.equal(saved().bedWidth,180);assert.equal(saved().bedHeight,256);assert.equal(saved().limitToBed,true);assert.equal($('[data-do-export]').disabled,false);

  const pdf=await downloadFrom('[data-fit-pdf]'),pdfText=await pdf.blob.text();
  assert.match(pdf.name,/-meritko-1-1\.pdf$/);assert.equal(pdf.blob.type,'application/pdf');assert.match(pdfText,/^%PDF-1\.4/);assert.match(pdfText,/\/PrintScaling \/None/);assert.match(pdfText,/presne 100 mm/);assert.match(pdfText,/%%EOF/);
  const thin=await downloadFrom('[data-fit-stl]');assert.match(thin.name,/-zkousky\.zip$/);assert.equal(thin.blob.type,'application/zip');
  const thinFiles=storedZip(new Uint8Array(await thin.blob.arrayBuffer()));assert.equal(thinFiles.length,saved().modules.length);
  for(const file of thinFiles){assert.match(file.name,/-zkouska\.stl$/);assert.ok(Math.abs(stlHeight(file.bytes)-1)<1e-5,'A fit test must be a genuine 1mm high model');}

  const beforePrint=localStorage.getItem('suplik-studio-projects-v1'),printHistory=[$('#app [data-action=undo]').disabled,$('#app [data-action=redo]').disabled];
  const full=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(full.name,/-tiskove-dily\.zip$/);assert.equal(full.blob.type,'application/zip');
  const fullFiles=storedZip(new Uint8Array(await full.blob.arrayBuffer())),fullModels=fullFiles.filter(file=>file.name.endsWith('.stl'));
  const assembly=JSON.parse(new TextDecoder().decode(fullFiles.find(file=>file.name==='assembly.json').bytes));assert.equal(assembly.parts.length,fullModels.length);
  for(const m of saved().modules){
    const own=assembly.parts.filter(part=>part.moduleId===m.id);assert.ok(own.length,'Every selected module is represented in the assembly map');
    const p=saved(),depth=Math.max(...p.tools.filter(t=>t.moduleId===m.id).map(t=>t.depth)),height=Math.max(...own.map(part=>stlHeight(fullModels.find(file=>file.name===part.file).bytes)));
    assert.ok(Math.abs(height-(p.base+depth))<1e-4,'The combined adhesive light mesh parts retain the full pocket depth and minimum floor');
    assert.ok(height>p.base+1,'The production pocket extends beyond the 1mm fit test');
  }
  assert.ok(!fullFiles.some(file=>file.name.endsWith('.svg')||file.name.endsWith('.dxf')),'The print batch contains STL manufacturing geometry');assert.ok(fullFiles.some(file=>/readme/i.test(file.name)));
  assert.equal(localStorage.getItem('suplik-studio-projects-v1'),beforePrint,'Mesh cutting and downloading cannot mutate the project');assert.deepEqual([$('#app [data-action=undo]').disabled,$('#app [data-action=redo]').disabled],printHistory);
  const exportedProject=JSON.parse(new TextDecoder().decode(fullFiles.find(file=>file.name==='projekt.json').bytes)).project;
  assert.equal(exportedProject.printMode,'light');assert.equal(exportedProject.bottomMode,'adhesive');assert.equal(exportedProject.bedWidth,180);

  action('export');click('[data-format=svg]');assert.match($('.modal-body').textContent,/Černá/);const svg=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(svg.name,/\.svg$/);assert.equal(svg.blob.type,'image/svg+xml');assert.match(await svg.blob.text(),/<svg[^>]*width="[\d.]+mm"/);
  action('export');click('[data-format=dxf]');const dxf=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(dxf.name,/\.dxf$/);assert.equal(dxf.blob.type,'application/dxf');assert.match(await dxf.blob.text(),/\$INSUNITS\r\n70\r\n4/);
  action('export');click('[data-format=json]');const json=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(json.name,/\.json$/);assert.equal(json.blob.type,'application/json');assert.equal(JSON.parse(await json.blob.text()).project.bottomMode,'adhesive');
  createDrawerFromUI('Nový prázdný šuplík',504,378);assert.equal(saved().tools.length,0);assert.match($('#board-area').textContent,/Začněte/);
  action('library');assert.ok(win.document.querySelectorAll('.library-item').length>=8);click('[data-modal-close]');
  action('help');assert.ok(win.document.querySelectorAll('.modal-body a[target=_blank]').length>=4);click('[data-modal-close-extra]');
  await win.happyDOM.close();
});
