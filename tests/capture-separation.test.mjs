import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {createCanvas,ImageData,loadImage} from '@napi-rs/canvas';
import {slantedScrewdriversPhoto,parallelScrewdriversPhoto} from './fixtures/tool-photos.mjs';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
const canvases=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);
  if(canvas.width!==element.width)canvas.width=element.width;
  if(canvas.height!==element.height)canvas.height=element.height;
  return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const ctx=actual(this).getContext('2d');
  return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((image,...args)=>target.drawImage(image instanceof win.HTMLCanvasElement?actual(image):image,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});
};

const workers=new Set(),created=[],phases=[],results=[];
class BrowserWorker{
  constructor(url){
    created.push(String(url));
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>{
      if(data.type==='progress')phases.push(data.phase);
      if(data.result)results.push({count:data.result.contours.length,quality:data.result.quality,diagnostics:data.result.diagnostics});
      this.onmessage?.({data});
    });
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));
    this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
// Exercise the real file-input path; only the browser's PNG decoder is adapted.
let decodedFiles=0;
globalThis.createImageBitmap=async file=>{
  assert.match(file.name,/\.png$/);decodedFiles++;
  return loadImage(Buffer.from(await file.arrayBuffer()));
};
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,message,timeout=35000){
  const started=performance.now();
  while(!predicate()){
    if(performance.now()-started>timeout)throw Error(`${message}: ${$('.modal-body')?.textContent}; ${JSON.stringify(results.at(-1))}`);
    await pause(5);
  }
}
function a4Photograph(fixture){
  // A landscape A4 at 4 px/mm, fully visible on a dark, matte tabletop.
  const pxPerMm=4,sheetWidth=297*pxPerMm,sheetHeight=210*pxPerMm;
  const canvas=createCanvas(1440,1040),ctx=canvas.getContext('2d');
  ctx.fillStyle='#62685f';ctx.fillRect(0,0,canvas.width,canvas.height);
  const sheetX=(canvas.width-sheetWidth)/2,sheetY=(canvas.height-sheetHeight)/2;
  ctx.fillStyle='#fafaf8';ctx.fillRect(sheetX,sheetY,sheetWidth,sheetHeight);
  const tools=createCanvas(fixture.width,fixture.height);
  tools.getContext('2d').putImageData(new ImageData(fixture.data,fixture.width,fixture.height),0,0);
  ctx.drawImage(tools,sheetX+(sheetWidth-fixture.width)/2,sheetY+(sheetHeight-fixture.height)/2);
  return {file:new win.File([canvas.toBuffer('image/png')],'tools-on-a4.png',{type:'image/png'}),pxPerMm};
}
function contourLength(tool){
  let maximum=0;
  for(let i=0;i<tool.points.length;i++)for(let j=i+1;j<tool.points.length;j++)maximum=Math.max(maximum,Math.hypot(tool.points[i].x-tool.points[j].x,tool.points[i].y-tool.points[j].y));
  return maximum;
}

test('uploaded A4 photos add complete, separate tools through real ONNX recognition',{timeout:100000},async t=>{
  t.after(async()=>{
    await Promise.all([...workers].map(worker=>worker.terminate()));
    delete globalThis.Worker;delete globalThis.createImageBitmap;
    await win.happyDOM.close();
  });
  for(const [name,makeFixture,count] of [
    ['six slanted screwdrivers',slantedScrewdriversPhoto,6],
    ['two screwdrivers with a 2px handle gap',()=>parallelScrewdriversPhoto({gap:2}),2]
  ])await t.test(name,{timeout:45000},async t=>{
    const fixture=makeFixture(),photo=a4Photograph(fixture),added=[];
    const beforeDecode=decodedFiles,beforeInference=phases.filter(phase=>phase==='inference').length;
    const modal=openCapture({onAdd:tools=>added.push(...tools)});
    t.after(()=>modal.close());
    const input=$('#gallery-file');assert.ok(input);
    Object.defineProperty(input,'files',{value:[photo.file],configurable:true});
    input.dispatchEvent(new win.Event('change'));
    await waitFor(()=>$('#capture-add')||$('#retake-missing'),'uploaded photo did not finish');
    assert.equal(decodedFiles,beforeDecode+1,'the actual PNG upload must be decoded');
    assert.equal($('#retake-missing'),null,'the complete A4 sheet must calibrate automatically');
    assert.ok(phases.filter(phase=>phase==='inference').length>beforeInference,'real ONNX inference must execute for each upload');
    assert.ok(created.some(url=>url.endsWith('/neural-worker.js')));
    assert.ok(created.some(url=>url.endsWith('/recognize-worker.js')));
    const diagnostic=JSON.stringify({result:results.at(-1),message:$('.recognition-status')?.textContent,reasons:$('.issue-box')?.textContent});
    assert.equal($('#capture-add')?.disabled,false,diagnostic);
    assert.equal(win.document.querySelectorAll('#trace-items input[type=checkbox]:checked').length,count,diagnostic);
    assert.equal($('#calibration-canvas'),null);
    assert.equal(win.document.querySelector('input[type=range]'),null);
    assert.equal($('#trace-threshold'),null);assert.equal($('#trace-smoothing'),null);
    $('#capture-add').click();
    await waitFor(()=>!$('#modal-root').children.length,'capture must close after adding');
    assert.equal(added.length,count,'onAdd must receive every detected tool');
    for(const tool of added){
      assert.ok(tool.points.length>8,'a shaft and a handle need a complete contour');
      assert.ok(tool.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0));
    }
    const lengths=added.map(contourLength).sort((a,b)=>a-b);
    const expected=fixture.tools.map(tool=>tool.length/photo.pxPerMm).sort((a,b)=>a-b);
    for(let i=0;i<count;i++)assert.ok(Math.abs(lengths[i]-expected[i])<4,`full shaft length ${lengths[i].toFixed(2)}mm, expected ${expected[i]}mm`);
    t.diagnostic(`uploaded A4 + real workers: ${count} tools, lengths (mm)=${JSON.stringify(lengths)}`);
  });
});
