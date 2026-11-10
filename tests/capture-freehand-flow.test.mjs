import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

// This exercises actual capture/controller/guide/import integration. The worker
// reply is controlled; these tests do not measure recognition or neural quality.
const win=new Window({url:'http://localhost:5180'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const canvases=new WeakMap();
function actual(element){if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;}
win.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')return null;const ctx=actual(this).getContext('2d');return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});};
const original=[{x:200,y:200},{x:500,y:200},{x:500,y:300},{x:200,y:300}];
let status='ready',outlines=[original],scale,recognitionCalls=0,scanSize;
globalThis.Worker=class{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){queueMicrotask(()=>{if(this.terminated)return;if(this.url.endsWith('/tool-neural-worker.js'))return this.onmessage?.({data:instanceWorkerReply(message)});scale=message.options.pxPerMm;scanSize={width:message.image.width,height:message.image.height};recognitionCalls++;this.onmessage?.({data:{result:{...scanSize,contours:outlines.map(points=>({points:structuredClone(points)})),mask:new Uint8Array(message.image.width*message.image.height),quality:{status,reasons:status==='retake'?['Není vidět dostatečně souvislý obrys nástroje.']:[]}}}});});}
  terminate(){this.terminated=true;}
};
const {openCapture}=await import('../dist/capture.js');
const {setLang}=await import('../dist/i18n.js');
const {setAppUnit,parseLength}=await import('../dist/units.js');
const $=selector=>win.document.querySelector(selector);
const pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn,message){const start=performance.now();while(!fn()){if(performance.now()-start>8000)throw Error('Timeout '+message+': '+$('.modal-body')?.textContent);await pause();}}
async function begin({empty=false}={}){status=empty?'retake':'ready';outlines=empty?[]:[original];$('#sample-scan').click();await waitFor(()=>$('[data-contour-action="draw"]')&&$('#capture-add'),'result palette');if(!empty){await waitFor(()=>$('[data-trace-index="0"]'),'recognized draft');const shape=$('#capture-pocket-shape');shape.value='measured';shape.dispatchEvent(new win.Event('change',{bubbles:true}));}assert.ok(scale>0);return{scale,calls:recognitionCalls};}
function field(selector,value,event='input'){const control=$(selector);assert.ok(control,selector);control.value=value;control.dispatchEvent(new win.Event(event,{bubbles:true}));}
function stroke(points,{canvas=$('#trace-canvas'),toClient=p=>({clientX:p.x,clientY:p.y}),pointerType='mouse'}={}){
  const emit=(type,p)=>canvas.dispatchEvent(new win.PointerEvent(type,{...toClient(p),pointerId:1,pointerType,button:0,buttons:type==='pointerup'?0:1,isPrimary:true,bubbles:true,cancelable:true}));emit('pointerdown',points[0]);for(const p of points.slice(1))emit('pointermove',p);emit('pointerup',points.at(-1));
}
const bounds=points=>({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))});
function assertRectangle(tool,widthPx,heightPx,pxPerMm){const b=bounds(tool.points);assert.ok(Math.abs(b.maxX-b.minX-widthPx/pxPerMm)<=.000051,'calibrated tool width');assert.ok(Math.abs(b.maxY-b.minY-heightPx/pxPerMm)<=.000051,'calibrated tool height');assert.equal(tool.points.length,4,'manual straight rectangle has no substitute or extra geometry');}
function action(name){const button=$(`[data-contour-action="${name}"]`);assert.ok(button,`visible ${name}`);assert.equal(button.disabled,false,`${name} is available`);button.click();}
function contrastSample(point){const toggle=$('#trace-mask');assert.ok(toggle,'contrast preview is available');toggle.checked=true;toggle.dispatchEvent(new win.Event('change',{bubbles:true}));const pixel=actual($('#trace-canvas')).getContext('2d').getImageData(point.x,point.y,1,1).data;return(pixel[0]+pixel[1]+pixel[2])/3;}

test('the actual capture flow imports manually drawn outlines without changing photo calibration',{timeout:30000},async t=>{
  t.after(async()=>{delete globalThis.Worker;setLang('cs',{save:false});await win.happyDOM.close();});setLang('cs',{save:false});setAppUnit('mm',{save:false});
  await t.test('a visible New outline tile appends a calibrated tool while retaining the existing candidate',async()=>{
    let added;const modal=openCapture({onAdd:tools=>added=tools});try{
      const before=await begin(),trace=$('#trace-canvas');assert.equal(trace.width,scanSize.width);assert.equal(trace.height,scanSize.height);field('[data-name="0"]','Původní klíč');field('[data-depth="0"]','8 mm');
      const points=[{x:30,y:40},{x:150,y:40},{x:150,y:120},{x:30,y:120},{x:30,y:40}];$('[data-contour-action="draw"]').click();stroke(points);
      await waitFor(()=>$('[data-trace-index="1"]'),'appended manual tool');assert.equal($('#capture-add').disabled,false);assert.match($('.recognition-status').textContent,/potřebují kontrolu/,'manual creation keeps an honest review state');assert.equal(recognitionCalls,before.calls,'drawing uses the existing calibration without another recognition pass');
      assert.equal($('[data-name="0"]').value,'Původní klíč');assert.equal($('[data-depth="0"]').value,'8 mm');$('#capture-add').click();await waitFor(()=>added,'manual outline import');assert.equal(added.length,2);const retained=added.find(tool=>tool.name==='Původní klíč'),drawn=added.find(tool=>tool!==retained);assert.ok(retained&&drawn);assert.equal(retained.depth,8);assertRectangle(retained,300,100,before.scale);assertRectangle(drawn,120,80,before.scale);assert.equal(scale,before.scale);
    }finally{modal.close();}
  });
  await t.test('zero candidates still exposes drawing and a valid drawn outline enables Add',async()=>{
    let added;const modal=openCapture({onAdd:tools=>added=tools});try{
      const before=await begin({empty:true});assert.equal($('[data-trace-index="0"]'),null);assert.equal($('#capture-add').disabled,true);const draw=$('[data-contour-action="draw"]');assert.equal(draw.disabled,false);assert.ok(draw.querySelector('svg'));assert.match(draw.textContent,/Nový obrys/);
      draw.click();stroke([{x:30,y:40},{x:150,y:40},{x:150,y:120},{x:30,y:120},{x:30,y:40}],{pointerType:'pen'});await waitFor(()=>$('[data-trace-index="0"]'),'first manual tool after empty recognition');assert.equal($('#capture-add').disabled,false);assert.match($('.recognition-status').textContent,/potřebují kontrolu/);assert.equal($('#trace-canvas').width,scanSize.width);assert.equal($('#trace-canvas').height,scanSize.height);assert.equal(recognitionCalls,before.calls);$('#capture-add').click();await waitFor(()=>added,'empty-result manual import');assert.equal(added.length,1);assertRectangle(added[0],120,80,before.scale);assert.equal(scale,before.scale);
    }finally{modal.close();}
  });
  await t.test('the guide palette creates a separate drawn tool and preserves the reviewed tool metadata',async()=>{
    let added;const modal=openCapture({onAdd:tools=>added=tools});try{
      const before=await begin();$('#capture-guide-start').click();field('#capture-guide-name','Klíč 17');field('#capture-guide-size-label','17 mm');field('#capture-guide-category','wrenches','change');field('#capture-guide-depth','8 mm');
      const detail=$('#capture-guide-preview');detail.getBoundingClientRect=()=>({left:60,top:20,width:320,height:180});const palette=detail.closest('.capture-guide-panel').querySelector('.capture-contour-detail-tools');assert.ok(palette,'visible editor tools beside the enlarged photo');const draw=palette.querySelector('[data-contour-action="draw"]');assert.equal(draw.disabled,false);draw.click();
      const margin=.8*before.scale,zoom=Math.min(568/(300+2*margin),288/(100+2*margin)),toClient=p=>({clientX:60+(320+zoom*(p.x-350))/2,clientY:20+(180+zoom*(p.y-250))/2});
      stroke([{x:250,y:220},{x:450,y:220},{x:450,y:280},{x:250,y:280},{x:250,y:220}],{canvas:detail,toClient,pointerType:'touch'});await waitFor(()=>$('[data-trace-index="1"]'),'guide-created separate outline');assert.equal($('[data-name="0"]').value,'Klíč 17');assert.equal(recognitionCalls,before.calls);$('#capture-add').click();await waitFor(()=>added,'guide manual import');assert.equal(added.length,2);const retained=added.find(tool=>tool.name==='Klíč 17'),drawn=added.find(tool=>tool!==retained);assert.equal(retained.depth,8);assert.equal(retained.category,'wrenches');assert.equal(retained.sizeLabel,'17 mm');assertRectangle(retained,300,100,before.scale);assertRectangle(drawn,200,60,before.scale);
    }finally{modal.close();}
  });
  await t.test('creating a new outline preserves older point history and rebuilds the contrast mask through Undo and Redo',async()=>{
    let added;const modal=openCapture({onAdd:tools=>added=tools});try{
      const before=await begin();stroke([{x:350,y:200},{x:350,y:160}]);assert.ok(Math.abs(parseLength($('[data-contour-field="width"]').value)-140/before.scale)<.001,'one continuous edge drag edits the original profile');
      action('draw');stroke([{x:30,y:40},{x:150,y:40},{x:150,y:120},{x:30,y:120},{x:30,y:40}]);await waitFor(()=>$('[data-trace-index="1"]'),'new outline');assert.ok(contrastSample({x:45,y:55})<100,'new silhouette is dark in the actual contrast raster');
      action('undo');assert.equal($('[data-trace-index="1"]'),null,'first Undo removes only the newly created tool');assert.ok(Math.abs(parseLength($('[data-contour-field="width"]').value)-140/before.scale)<.001,'the earlier point edit remains');assert.ok(contrastSample({x:45,y:55})>240,'Undo removes the new silhouette from the actual mask');
      action('undo');assert.ok(Math.abs(parseLength($('[data-contour-field="width"]').value)-100/before.scale)<.001,'second Undo restores the original rectangle');
      action('redo');assert.ok(Math.abs(parseLength($('[data-contour-field="width"]').value)-140/before.scale)<.001,'first Redo restores the point edit');action('redo');assert.ok($('[data-trace-index="1"]'),'second Redo restores the new tool');assert.ok(contrastSample({x:45,y:55})<100,'Redo restores the silhouette in the actual mask');
      $('#capture-add').click();await waitFor(()=>added,'history-restored import');assert.equal(added.length,2);const b=bounds(added[0].points);assert.ok(Math.abs(b.maxX-b.minX-300/before.scale)<.000051);assert.ok(Math.abs(b.maxY-b.minY-140/before.scale)<.000051);assert.equal(added[0].points.length,5);assertRectangle(added[1],120,80,before.scale);
    }finally{modal.close();}
  });
  await t.test('Undo of the first manually created tool returns to zero candidates and Redo recovers a calibrated import',async()=>{
    let added;const modal=openCapture({onAdd:tools=>added=tools});try{
      const before=await begin({empty:true});action('draw');stroke([{x:30,y:40},{x:150,y:40},{x:150,y:120},{x:30,y:120},{x:30,y:40}]);await waitFor(()=>$('[data-trace-index="0"]'),'first new outline');action('undo');assert.equal($('[data-trace-index="0"]'),null);assert.equal($('#capture-add').disabled,true,'no tool means there is nothing to import');assert.equal($('[data-contour-action="draw"]').disabled,false,'the empty result is still editable');action('redo');assert.ok($('[data-trace-index="0"]'));assert.equal($('#capture-add').disabled,false);$('#capture-add').click();await waitFor(()=>added,'redo from zero candidates');assert.equal(added.length,1);assertRectangle(added[0],120,80,before.scale);assert.equal(scale,before.scale);
    }finally{modal.close();}
  });
  await t.test('redrawing inside a recognized tool is refused and Add retains the full original silhouette',async()=>{
    let added;const modal=openCapture({onAdd:tools=>added=tools});try{
      const before=await begin();$('[data-trace-index="0"]').dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));action('redraw');stroke([{x:250,y:220},{x:450,y:220},{x:450,y:280},{x:250,y:280},{x:250,y:220}]);assert.equal($('[data-trace-index="1"]'),null);assert.match($('.capture-contour-status').textContent,/Dosažena hrana nástroje/);assert.equal($('[data-contour-action="undo"]').disabled,true,'refused redraw adds no undo step');assert.equal(recognitionCalls,before.calls);$('#capture-add').click();await waitFor(()=>added,'original import after protected redraw');assert.equal(added.length,1);assertRectangle(added[0],300,100,before.scale);
    }finally{modal.close();}
  });
});
