import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
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
const waitFor=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>12000)throw Error('Timed out waiting for UI');await new Promise(r=>setTimeout(r,15));}};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
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
  const rotation=saved().tools[0].rotation;
  for(const modifier of ['ctrlKey','metaKey','altKey']){
    win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'r',[modifier]:true,bubbles:true}));
    assert.equal(saved().tools[0].rotation,rotation,modifier+' must not rotate the tool');
  }
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'r',bubbles:true}));
  assert.equal(saved().tools[0].rotation,(rotation+90)%360);
  action('undo');assert.equal(saved().tools[0].rotation,rotation);
});

test('visible drawer dimensions control restores millimetre fields without resizing tools',()=>{
  const before=saved(),viewport={width:win.innerWidth,height:win.innerHeight},scrollIntoView=win.HTMLElement.prototype.scrollIntoView;
  const scrolls=[];
  try{
    click('.tool-row');assert.ok($('#app [data-scope=tool][data-field=toolWidth]'));
    assert.equal($('#app [data-scope=project][data-field=width]'),null);
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

test('manual and automatic module sizes preserve contours, position locks and undo history',()=>{
  const original=saved(),scratch=createDrawerFromUI('Zkouška velikosti modulů',504,378);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeName]','Zkušební kapsa');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  const before=saved(),module=before.modules[0],points=before.tools[0].points;
  assert.equal(module.locked,false);action('resize-module');
  change('[data-field=moduleWidth]',110);change('[data-field=moduleHeight]',170);click('[data-resize-module]');
  let resized=saved();assert.equal(resized.modules[0].width,110);assert.equal(resized.modules[0].height,170);assert.equal(resized.modules[0].sizeMode,'manual');assert.equal(resized.modules[0].locked,false);
  assert.deepEqual(resized.tools[0].points,points);assert.match($('.module-sizing').textContent,/Jmenovité 110 × 170 mm/);assert.match($('.module-sizing').textContent,/Vnější 109,5 × 169,5 mm/);
  action('auto');resized=saved();assert.equal(resized.modules[0].width,110);assert.equal(resized.modules[0].height,170);assert.equal(resized.modules[0].sizeMode,'manual');assert.deepEqual(resized.tools[0].points,points);
  action('undo');action('size-module-auto');resized=saved();assert.equal(resized.modules[0].sizeMode,'auto');assert.equal(resized.modules[0].width,module.width);assert.equal(resized.modules[0].height,module.height);assert.equal(resized.modules[0].locked,false);assert.deepEqual(resized.tools[0].points,points);
  action('undo');assert.equal(saved().modules[0].width,110);assert.equal(saved().modules[0].sizeMode,'manual');assert.deepEqual(saved().tools[0].points,points);
  action('undo');assert.equal(saved().modules[0].width,module.width);assert.equal(saved().modules[0].height,module.height);assert.deepEqual(saved().tools,before.tools);
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('expanding a drawer leaves outside manual modules movable for automatic recovery',()=>{
  const original=saved(),scratch=createDrawerFromUI('Rozšíření odloženého modulu',504,378);
  action('add-shape');change('#shape-type','rect');change('[data-field=shapeWidth]',40);change('[data-field=shapeHeight]',80);click('[data-confirm]');
  action('resize-module');change('[data-field=moduleWidth]',151.5);change('[data-field=moduleHeight]',139.25);click('[data-resize-module]');
  const points=saved().tools[0].points;
  click('.drawer-dimensions');change('#app [data-field=width]',42);change('#app [data-field=height]',42);action('auto');
  const outside=saved().modules[0];assert.ok(outside.x>=42);assert.equal(outside.locked,false);assert.equal(saved().tools[0].locked,false);
  action('expand');assert.match($('.modal .tip').textContent,/Zamkne se 0 /);
  change('[data-field=expandWidth]',168);change('[data-field=expandHeight]',168);click('[data-confirm]');
  assert.equal(saved().modules[0].locked,false,'An outside module must not be locked by drawer expansion');
  assert.equal(saved().tools[0].locked,false,'Tools in an outside module must remain available for placement');
  action('auto');const recovered=saved(),m=recovered.modules[0];
  assert.equal(m.width,151.5);assert.equal(m.height,139.25);assert.equal(m.sizeMode,'manual');assert.equal(m.locked,false);
  assert.ok(m.x>=0&&m.y>=0&&m.x+m.width<=168&&m.y+m.height<=168,'The retained manual footprint must fit inside the expanded drawer');
  assert.deepEqual(recovered.tools[0].points,points,'Recovery must preserve the tool contour');
  action('projects');click(`[data-open="${original.id}"]`);action('projects');click(`[data-remove-project="${scratch.id}"]`);click('[data-modal-close]');
});

test('touch selection scrolls normally until explicit move mode enables pointer capture',()=>{
  const before=saved().modules.map(m=>[m.id,m.x,m.y]),svg=$('#board-svg'),group=$('#board-svg [data-module]');let points=0,captured=0;
  svg.createSVGPoint=()=>{points++;throw Error('Touch selection must not start a drag');};
  const down=new win.PointerEvent('pointerdown',{pointerType:'touch',pointerId:1,clientX:30,clientY:40,bubbles:true,cancelable:true});group.dispatchEvent(down);
  group.dispatchEvent(new win.PointerEvent('pointermove',{pointerType:'touch',pointerId:1,clientX:80,clientY:120,bubbles:true}));
  assert.equal(points,0);assert.equal(down.defaultPrevented,false);group.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
  assert.ok($('#app [data-scope=tool][data-field=name]'),'A normal tap still selects the tool');assert.deepEqual(saved().modules.map(m=>[m.id,m.x,m.y]),before);
  action('move-mode');const moving=$('#board-svg');assert.ok(moving.classList.contains('moving'));
  moving.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});moving.getScreenCTM=()=>({inverse:()=>({})});moving.setPointerCapture=()=>captured++;
  const dragDown=new win.PointerEvent('pointerdown',{pointerType:'touch',pointerId:2,clientX:30,clientY:40,bubbles:true,cancelable:true});$('#board-svg [data-module]').dispatchEvent(dragDown);
  assert.equal(dragDown.defaultPrevented,true);assert.equal(captured,1);moving.dispatchEvent(new win.PointerEvent('pointerup',{pointerType:'touch',pointerId:2,bubbles:true}));
  action('move-mode');assert.ok(!$('#board-svg').classList.contains('moving'));assert.deepEqual(saved().modules.map(m=>[m.id,m.x,m.y]),before);action('drawer-tab');
});

test('saved status recovers after browser storage becomes writable again',()=>{
  const setItem=localStorage.setItem;
  try{
    Object.defineProperty(localStorage,'setItem',{configurable:true,value:()=>{throw new DOMException('Storage quota exceeded','QuotaExceededError');}});action('auto');
    assert.match($('.save-state').textContent,/Stáhněte zálohu/);
  }finally{Object.defineProperty(localStorage,'setItem',{configurable:true,value:setItem});}
  action('undo');assert.match($('.save-state').textContent,/Uloženo v zařízení/);assert.equal(saved().tools.length,6);
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
  action('auto');assert.deepEqual(saved().modules.filter(m=>m.locked).map(m=>[m.id,m.x,m.y]),lockedPositions);
  action('undo');assert.equal(saved().tools.length,7);action('redo');
  // The measured sample needs a 252mm module including its walls and clearance.
  action('export');change('.modal [data-field=bedHeight]',256);click('[data-modal-close]');
  action('capture');click('#sample-scan');await waitFor(()=>$('#trace-items input[type=checkbox]'));
  assert.equal($('#calibration-canvas'),null,'A4 scale and perspective must be automatic');
  assert.equal($('#trace-threshold'),null,'The user must not have to tune a threshold');
  assert.equal($('#trace-smoothing'),null,'The user must not have to tune smoothing');
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
  change('.modal [data-field=bedWidth]',50);change('.modal [data-field=bedHeight]',50);assert.match($('#bed-warnings').textContent,/nevejde/);assert.equal($('[data-do-export]').disabled,true,'Oversized final parts must be blocked for a limited printer');
  change('#limit-bed',false);assert.equal(saved().limitToBed,false);assert.equal($('[data-do-export]').disabled,false,'The explicit printer limit can be disabled');
  change('.modal [data-field=bedWidth]',180);change('.modal [data-field=bedHeight]',256);change('#limit-bed',true);
  assert.equal(saved().bedWidth,180);assert.equal(saved().bedHeight,256);assert.equal(saved().limitToBed,true);assert.equal($('[data-do-export]').disabled,false);

  const pdf=await downloadFrom('[data-fit-pdf]'),pdfText=await pdf.blob.text();
  assert.match(pdf.name,/-meritko-1-1\.pdf$/);assert.equal(pdf.blob.type,'application/pdf');assert.match(pdfText,/^%PDF-1\.4/);assert.match(pdfText,/\/PrintScaling \/None/);assert.match(pdfText,/presne 100 mm/);assert.match(pdfText,/%%EOF/);
  const thin=await downloadFrom('[data-fit-stl]');assert.match(thin.name,/-zkousky\.zip$/);assert.equal(thin.blob.type,'application/zip');
  const thinFiles=storedZip(new Uint8Array(await thin.blob.arrayBuffer()));assert.equal(thinFiles.length,saved().modules.length);
  for(const file of thinFiles){assert.match(file.name,/-zkouska\.stl$/);assert.ok(Math.abs(stlHeight(file.bytes)-1)<1e-5,'A fit test must be a genuine 1mm high model');}

  const full=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(full.name,/-moduly\.zip$/);assert.equal(full.blob.type,'application/zip');
  const fullFiles=storedZip(new Uint8Array(await full.blob.arrayBuffer())),fullModels=fullFiles.filter(file=>file.name.endsWith('.stl'));
  assert.equal(fullModels.length,saved().modules.length);
  for(const [i,file] of fullModels.entries()){
    const p=saved(),m=p.modules[i],depth=Math.max(...p.tools.filter(t=>t.moduleId===m.id).map(t=>t.depth)),height=stlHeight(file.bytes);
    assert.ok(Math.abs(height-(p.base+depth))<1e-4,'The adhesive light module must retain its full pocket depth and minimum floor');
    assert.ok(height>p.base+1,'The production pocket must extend beyond the 1mm fit test and its minimum floor');
  }
  assert.ok(fullFiles.some(file=>file.name==='sestava.svg'));const exportedProject=JSON.parse(new TextDecoder().decode(fullFiles.find(file=>file.name==='projekt.json').bytes)).project;
  assert.equal(exportedProject.printMode,'light');assert.equal(exportedProject.bottomMode,'adhesive');assert.equal(exportedProject.bedWidth,180);

  action('export');click('[data-format=svg]');assert.match($('.modal-body').textContent,/Černá/);const svg=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(svg.name,/\.svg$/);assert.equal(svg.blob.type,'image/svg+xml');assert.match(await svg.blob.text(),/<svg[^>]*width="[\d.]+mm"/);
  action('export');click('[data-format=dxf]');const dxf=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(dxf.name,/\.dxf$/);assert.equal(dxf.blob.type,'application/dxf');assert.match(await dxf.blob.text(),/\$INSUNITS\r\n70\r\n4/);
  action('export');click('[data-format=json]');const json=await downloadFrom('[data-do-export]');await waitFor(()=>!$('#modal-root').children.length);assert.match(json.name,/\.json$/);assert.equal(json.blob.type,'application/json');assert.equal(JSON.parse(await json.blob.text()).project.bottomMode,'adhesive');
  createDrawerFromUI('Nový prázdný šuplík',504,378);assert.equal(saved().tools.length,0);assert.match($('#board-area').textContent,/Začněte/);
  action('library');assert.ok(win.document.querySelectorAll('.library-item').length>=8);click('[data-modal-close]');
  action('help');assert.ok(win.document.querySelectorAll('.modal-body a[target=_blank]').length>=4);click('[data-modal-close-extra]');
  await win.happyDOM.close();
});
