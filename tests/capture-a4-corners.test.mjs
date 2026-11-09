import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const originalBitmap=globalThis.createImageBitmap,canvases=new WeakMap(),rasters=new WeakMap(),labels=new WeakMap(),sourceHashes=new WeakMap(),posted=[],captures=new Map();
const digest=data=>createHash('sha256').update(data).digest('hex');
function actual(element){if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;}
win.HTMLCanvasElement.prototype.getContext=function(type){
 if(type!=='2d')return null;const element=this,ctx=actual(element).getContext('2d');
 return new Proxy(ctx,{get(target,key){if(typeof target[key]!=='function')return target[key];return(...args)=>{
  if(key==='clearRect')labels.set(element,[]);
  if(key==='fillText')labels.get(element)?.push(args);
  if(key==='drawImage'){
   const source=args[0];if(element.id==='calibration-canvas'){rasters.set(element,{zoom:args[3]/source.width,x:args[1],y:args[2]});sourceHashes.set(element,digest(actual(source).getContext('2d').getImageData(0,0,source.width,source.height).data));}
   if(source instanceof win.HTMLCanvasElement)args[0]=actual(source);
  }
  return target[key](...args);
 };},set:(target,key,value)=>(target[key]=value,true)});
};
win.HTMLCanvasElement.prototype.setPointerCapture=function(id){captures.set(id,this);};
win.HTMLCanvasElement.prototype.hasPointerCapture=function(id){return captures.get(id)===this;};
win.HTMLCanvasElement.prototype.releasePointerCapture=function(id){if(captures.get(id)===this)captures.delete(id);};
// Pixel-only worker truth. It measures the dark physical rectangle in the actual
// rectified raster and never constructs a contour from runtime pxPerMm.
globalThis.Worker=class{
 constructor(url){this.url=String(url);this.closed=false;}
 postMessage(message){queueMicrotask(()=>{
  if(this.closed)return;
  if(this.url.includes('neural-worker'))return this.onmessage?.({data:{type:'error',id:message.id,message:'Independent A4 raster fixture'}});
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let y=0;y<message.image.height;y++)for(let x=0;x<message.image.width;x++){
   const at=(y*message.image.width+x)*4,data=message.image.data;
   if(Math.max(data[at],data[at+1],data[at+2])<60){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  }
  posted.push({width:message.image.width,height:message.image.height,scale:message.options.pxPerMm,kind:message.options.kind,hash:digest(message.image.data)});
  const points=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  this.onmessage?.({data:{result:{contours:Number.isFinite(x0)?[{points}]:[],mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
 });}
 terminate(){this.closed=true;}
};
const {openCapture}=await import('../dist/capture.js'),{setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js'),{getToolDimensions}=await import('../dist/tool-dimensions.js'),{detectPaper}=await import('../dist/trace.js'),{exportSVG}=await import('../dist/geometry.js'),{blankProject,validateProject}=await import('../dist/model.js');
const $=selector=>win.document.querySelector(selector),pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn,message){const start=performance.now();while(!fn()){if(performance.now()-start>8000)throw Error('Timed out '+message+': '+$('.modal-body')?.textContent);await pause();}}
function change(selector,value,type='change'){const element=$(selector);assert.ok(element,selector);element.value=value;element.dispatchEvent(new win.Event(type,{bubbles:true}));}
const rect={left:80,top:40,width:500,height:450};
const sizeCanvas=()=>{const canvas=$('#calibration-canvas');assert.ok(canvas);canvas.getBoundingClientRect=()=>rect;canvas.dispatchEvent(new win.PointerEvent('pointermove',{clientX:330,clientY:265,pointerId:99,pointerType:'mouse',isPrimary:true,buttons:0}));return canvas;};
const view=()=>rasters.get($('#calibration-canvas'));
const client=point=>({clientX:rect.left+(point.x*view().zoom+view().x)/2,clientY:rect.top+(point.y*view().zoom+view().y)/2});
function pointer(type,point,options={}){const event=new win.PointerEvent(type,{...client(point),pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true,...options});$('#calibration-canvas').dispatchEvent(event);return event;}
const key=(key,extra={})=>$('#calibration-canvas').dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
function place(index,point,options={}){if(index!==null)$(`[data-a4-point="${index}"]`).click();pointer('pointerdown',point,options);pointer('pointerup',point,options);}
function marker(index){const canvas=$('#calibration-canvas'),row=labels.get(canvas).find(row=>row[0]===String(index+1));return{x:(row[1]-36-view().x)/view().zoom,y:(row[2]+36-view().y)/view().zoom};}
const near=(a,b,message,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a} vs ${b}`);
function photo({landscape=false,missing=false}={}){
 const bitmap=createCanvas(1000,900),ctx=bitmap.getContext('2d'),width=landscape?594:420,height=landscape?420:594;
 ctx.fillStyle=missing?'#b8b8b8':'#888';ctx.fillRect(0,0,1000,900);ctx.fillStyle=missing?'#b8b8b8':'#eee';ctx.fillRect(200,150,width,height);
 // The photographed tool is independently 100 x 20 mm at 2 px/mm.
 ctx.fillStyle='#222';ctx.fillRect(260,310,200,40);bitmap.close=()=>{};
 return{bitmap,corners:[{x:200,y:150},{x:200+width,y:150},{x:200+width,y:150+height},{x:200,y:150+height}]};
}
async function openPhoto({landscape=false,missing=false,reference='a4-manual',onAdd=()=>{}}={}){
 const fixture=photo({landscape,missing});globalThis.createImageBitmap=async()=>fixture.bitmap;
 const modal=openCapture({onAdd});change('#photo-reference',reference);
 const input=$('#gallery-file');Object.defineProperty(input,'files',{configurable:true,value:[new win.File(['independent A4 raster'],'a4.jpg',{type:'image/jpeg'})]});await input.onchange();
 await waitFor(()=>$('#calibration-canvas')||$('#trace-canvas'),'photo opens');if($('#calibration-canvas'))sizeCanvas();return{...fixture,modal};
}
const confirmed=()=>[...win.document.querySelectorAll('[data-a4-point]')].map(button=>button.dataset.placed);

test('manual A4 corners calibrate the original photo through the real capture DOM',{timeout:60000},async t=>{
 t.after(async()=>{delete globalThis.Worker;if(originalBitmap)globalThis.createImageBitmap=originalBitmap;else delete globalThis.createImageBitmap;setLang('cs',{save:false});setAppUnit('mm',{save:false});await win.happyDOM.close();});
 await t.test('missing detection requires four explicit corners and moves the active corner in order',async()=>{
  setLang('cs',{save:false});const fixture=photo({missing:true});assert.equal(detectPaper(fixture.bitmap.getContext('2d').getImageData(0,0,1000,900)),null,'the photograph has no detectable paper edge');
  posted.length=0;const f=await openPhoto({missing:true,reference:'a4'});try{
   assert.deepEqual(confirmed(),['false','false','false','false']);assert.equal($('#ruler-distance'),null);assert.equal($('#a4-orientation').value,'portrait');
   assert.match($('[data-a4-point="0"]').textContent,/Levý horní/);assert.equal($('[data-a4-point="0"]').style.minHeight,'44px');
   assert.equal($('[data-calibration-view="zoom-in"]').style.minHeight,'44px');assert.equal($('#a4-orientation').style.minHeight,'44px');
   $('#capture-continue').click();assert.match($('#capture-error').textContent,/Chybí roh 1/);assert.equal(posted.length,0);
   f.corners.forEach((p,i)=>{assert.equal($(`[data-a4-point="${i}"]`).getAttribute('aria-pressed'),'true');place(null,p,{pointerType:['mouse','pen','touch','mouse'][i]});});
   assert.deepEqual(confirmed(),['true','true','true','true']);assert.match($('#a4-corner-status').textContent,/4 ze 4/);
   $('#use-ruler').click();assert.ok($('#ruler-distance'));$('#use-a4').click();sizeCanvas();assert.deepEqual(confirmed(),['true','true','true','true']);f.corners.forEach((p,i)=>{near(marker(i).x,p.x,'ruler roundtrip preserves original corner X');near(marker(i).y,p.y,'ruler roundtrip preserves original corner Y');});
  }finally{f.modal.close();}
 });
 await t.test('zoom, CSS offset, cancellation, keyboard and a second touch preserve exact source corner positions',async()=>{
  const f=await openPhoto({missing:true});try{
   const initial={...marker(0)};pointer('pointerdown',{x:260,y:250},{pointerType:'touch'});pointer('pointermove',{x:280,y:260},{pointerType:'touch'});pointer('pointercancel',{x:280,y:260},{pointerType:'touch'});
   assert.deepEqual(confirmed(),['false','false','false','false']);near(marker(0).x,initial.x,'cancel restores X');near(marker(0).y,initial.y,'cancel restores Y');
   $('[data-calibration-view="zoom-in"]').click();const beforePan={...view()};pointer('pointerdown',{x:500,y:450},{button:2,buttons:2});pointer('pointermove',{x:520,y:460},{button:2,buttons:2});pointer('pointerup',{x:520,y:460},{button:2,buttons:0});assert.notDeepEqual(view(),beforePan);
   place(0,{x:300,y:300},{pointerType:'pen'});$('[data-calibration-view="fit"]').click();near(marker(0).x,300,'CSS offset and zoom preserve source X');near(marker(0).y,300,'CSS offset and zoom preserve source Y');
   key('1');key('ArrowRight',{shiftKey:true});near(marker(0).x,310,'Shift moves ten source pixels');
   const before={...marker(0)};pointer('pointerdown',before,{pointerType:'touch'});pointer('pointermove',{x:330,y:320},{pointerType:'touch'});pointer('pointerdown',{x:650,y:350},{pointerType:'touch',pointerId:2,isPrimary:false});
   pointer('pointermove',{x:750,y:400},{pointerType:'touch',pointerId:2,isPrimary:false});pointer('pointerup',{x:750,y:400},{pointerType:'touch',pointerId:2,isPrimary:false});pointer('pointerup',{x:330,y:320},{pointerType:'touch'});assert.ok(view().zoom>1);
   $('[data-calibration-view="fit"]').click();near(marker(0).x,before.x,'pinch rolls back the point preview X');near(marker(0).y,before.y,'pinch rolls back the point preview Y');
   pointer('pointerdown',before);pointer('pointermove',{x:400,y:400});win.dispatchEvent(new win.Event('blur'));near(marker(0).x,before.x,'window blur rolls back X');near(marker(0).y,before.y,'window blur rolls back Y');
   key('2');key('Enter');assert.equal($('[data-a4-point="1"]').dataset.placed,'true','Enter explicitly confirms the selected corner');
  }finally{f.modal.close();}
 });
 await t.test('crossed and collinear quads are rejected before recognition and all edited points survive',async()=>{
  setLang('en',{save:false});posted.length=0;const f=await openPhoto({missing:true});try{
   const crossed=[f.corners[0],f.corners[2],f.corners[1],f.corners[3]];crossed.forEach((p,i)=>place(i,p));$('#capture-continue').click();assert.match($('#capture-error').textContent,/must not cross/);assert.equal(posted.length,0);assert.ok($('#calibration-canvas'));assert.deepEqual(confirmed(),['true','true','true','true']);
   const line=[{x:200,y:300},{x:400,y:300},{x:600,y:300},{x:800,y:300}];line.forEach((p,i)=>place(i,p));$('#capture-continue').click();assert.match($('#capture-error').textContent,/straight line/);line.forEach((p,i)=>near(marker(i).x,p.x,'invalid quad retains edited points'));assert.equal(posted.length,0);
  }finally{f.modal.close();setLang('cs',{save:false});}
 });
 for(const landscape of [false,true])await t.test(`${landscape?'landscape':'portrait'} A4 uses independent raster millimetres and discards earlier recognition drafts after refinement`,async()=>{
  setLang(landscape?'en':'cs',{save:false});setAppUnit(landscape?'in':'mm',{save:false});posted.length=0;let added;
  const f=await openPhoto({landscape,missing:landscape,onAdd:tools=>added=tools});try{
   assert.ok($('#calibration-canvas'),'explicit manual entry waits for confirmation');assert.equal(posted.length,0);assert.equal($('#a4-orientation').value,'portrait');
   if(landscape)change('#a4-orientation','landscape');
   assert.match($('#a4-orientation').textContent,/210 × 297 mm/);assert.match($('#a4-orientation').textContent,/297 × 210 mm/);
   f.corners.forEach((p,i)=>place(i,p,{pointerType:'touch'}));const originalHash=sourceHashes.get($('#calibration-canvas'));
   $('#capture-continue').click();await waitFor(()=>$('#capture-pocket-shape'),'first A4 recognition');assert.ok(posted.every(run=>run.kind!=='reference'),'A4 calibration must not switch to ruler mode; light-background preparation may select its own worker kind');const firstRuns=posted.length;
   change('[data-name="0"]','Old recognition draft','input');change('[data-depth="0"]','invalid','input');
   $('#capture-calibration-back').click();sizeCanvas();assert.equal(sourceHashes.get($('#calibration-canvas')),originalHash);assert.equal($('#a4-orientation').value,landscape?'landscape':'portrait');f.corners.forEach((p,i)=>{near(marker(i).x,p.x,'return preserves original-photo corner X');near(marker(i).y,p.y,'return preserves original-photo corner Y');});
   // Refine one source pixel, then restore the independently known physical corner.
   place(1,{x:f.corners[1].x-1,y:f.corners[1].y});place(1,f.corners[1]);
   $('#capture-continue').click();await waitFor(()=>$('#capture-pocket-shape'),'refined A4 recognition');assert.ok(posted.length>firstRuns);assert.notEqual($('[data-name="0"]').value,'Old recognition draft');assert.equal($('[data-depth="0"]').value,'');
   change('#capture-pocket-shape','measured');change('#capture-pocket-margin','0 mm','input');$('#capture-add').click();await waitFor(()=>added,'physical import');
   assert.equal(added.length,1);const dimensions=getToolDimensions(added[0]);near(dimensions.length,100,'physical length in millimetres',.7);near(dimensions.width,20,'physical width in millimetres',.7);
   const project=validateProject({...blankProject(),width:210,height:126,limitToBed:false,modules:[{id:'module',x:0,y:0,width:210,height:126,sizeMode:'manual',pocketMargin:0}],tools:[{...added[0],id:'physical-tool',moduleId:'module',x:20,y:20,fingerGrips:[]}]});
   const svg=exportSVG(project),path=svg.match(/<path id="physical-tool"[^>]* d="([^"]+)"/)?.[1];assert.ok(path);assert.match(svg,/<svg[^>]*width="210mm"/);
   const exported=[...path.matchAll(/(?:M|L)(-?[\d.]+),(-?[\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])})),svgDimensions=getToolDimensions({points:exported});near(svgDimensions.length,100,'SVG physical length',.7);near(svgDimensions.width,20,'SVG physical width',.7);
   t.diagnostic(`${landscape?'297x210':'210x297'} A4: actual imported ${dimensions.length.toFixed(3)} x ${dimensions.width.toFixed(3)} mm; pixel-only worker`);
  }finally{f.modal.close();setLang('cs',{save:false});setAppUnit('mm',{save:false});}
 });
 await t.test('successful automatic A4 stays automatic and returns to editable original A4 corners',async()=>{
  posted.length=0;const f=await openPhoto({reference:'a4'});try{
   await waitFor(()=>$('#capture-calibration-back'),'automatic result');assert.equal($('#calibration-canvas'),null);assert.ok(posted.length>=1);assert.match($('#capture-calibration-back').textContent,/Upravit rohy A4/);
   $('#capture-calibration-back').click();sizeCanvas();assert.ok($('#a4-orientation'));assert.equal($('#ruler-distance'),null);assert.deepEqual(confirmed(),['true','true','true','true']);
  }finally{f.modal.close();}
 });
});
