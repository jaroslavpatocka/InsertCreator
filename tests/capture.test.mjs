import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
// A real rendering pause exposes cancellation while processing awaits the next frame.
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),20);
globalThis.cancelAnimationFrame=clearTimeout;
const canvases=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const ctx=actual(this).getContext('2d');
  return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((image,...args)=>target.drawImage(image instanceof win.HTMLCanvasElement?actual(image):image,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});
};
const workers=new Set(),neuralPhases=[];
class BrowserWorker{
  constructor(url){
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>{if(data.type==='progress')neuralPhases.push(data.phase);this.onmessage?.({data});});
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.click();};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,message='capture state',timeout=16000){const started=performance.now();while(!fn()){if(performance.now()-started>timeout)throw new Error('Timed out: '+message+'; '+($('.modal-body')?.textContent||''));await pause(3);}}
const bounds=tool=>({width:Math.max(...tool.points.map(p=>p.x))-Math.min(...tool.points.map(p=>p.x)),height:Math.max(...tool.points.map(p=>p.y))-Math.min(...tool.points.map(p=>p.y))});

test('capture A4 flow uses real neural workers without user calibration or contour controls',{timeout:45000},async t=>{
  let added=[];
  t.after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;await win.happyDOM.close();});
  await t.test('actual complex sample raster is automatically calibrated and added in mm',async()=>{
    openCapture({onAdd:tools=>{added.push(...tools);}});click('#sample-scan');
    await waitFor(()=>$('#trace-items input[type=checkbox]'),'automatic ready result');
    assert.ok(neuralPhases.includes('inference'),'genuine neural worker must run');assert.equal(win.document.querySelectorAll('#trace-items input[type=checkbox]').length,2);assert.equal($('#capture-add').disabled,false);assert.match($('.recognition-status').textContent,/Rozpoznáno automaticky/);
    assert.equal($('#calibration-canvas'),null);assert.equal(win.document.querySelector('input[type=range]'),null);assert.equal($('#trace-threshold'),null);assert.equal($('#trace-smoothing'),null);assert.equal($('#contour-svg'),null);
    click('#capture-add');await waitFor(()=>!$('#modal-root').children.length,'capture closes after adding');assert.equal(added.length,2);
    const sizes=added.map(bounds).sort((a,b)=>b.height-a.height),expected=[{width:46.8,height:203.4},{width:23.5,height:149.6}];
    for(let i=0;i<2;i++){assert.ok(Math.abs(sizes[i].width-expected[i].width)<2,`sample width ${sizes[i].width}mm`);assert.ok(Math.abs(sizes[i].height-expected[i].height)<2,`sample height ${sizes[i].height}mm`);assert.ok(added[i].points.length>10);assert.ok(added[i].points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.y>=0));}
    t.diagnostic('actual A4 sample + real neural workers: '+JSON.stringify(sizes));
  });
  await t.test('reset during the initial processing frames cannot resurrect a stale result',async()=>{
    const modal=openCapture({onAdd:tools=>added.push(...tools)});click('#sample-scan');await waitFor(()=>$('#cancel-processing'),'processing frame');click('#cancel-processing');
    assert.ok($('#sample-scan'));await pause(180);assert.ok($('#sample-scan'),'cancelled run must remain on upload');assert.equal($('#capture-add'),null,'old processing must not replace reset with a result');assert.equal(added.length,2);modal.close();
  });
  await t.test('reset during real inference leaves upload usable and cannot add stale tools',async()=>{
    const initial=neuralPhases.filter(phase=>phase==='inference').length,modal=openCapture({onAdd:tools=>added.push(...tools)});click('#sample-scan');
    await waitFor(()=>neuralPhases.filter(phase=>phase==='inference').length>initial,'real active inference');click('#cancel-processing');assert.ok($('#sample-scan'));await pause(250);
    assert.ok($('#sample-scan'));assert.equal($('#capture-add'),null);assert.equal($('#trace-canvas'),null);assert.equal(added.length,2);modal.close();
  });
});
