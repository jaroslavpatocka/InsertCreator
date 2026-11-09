import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
// The application clears its startup placeholder before opening any capture.
win.document.querySelector('#app').replaceChildren();
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),10);
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
const workers=new Set(),progressReports=[],inferenceResults=[];
class BrowserWorker{
  constructor(url){
    this.url=String(url);
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>{
      this.onmessage?.({data});
      if(this.url.endsWith('/tool-neural-worker.js')&&data.type==='result')inferenceResults.push({model:data.model,instances:data.instances?.length});
      const event=data.type==='progress'?data:data.progress;
      const bar=win.document.querySelector('#auto-progress-bar');
      if(event&&bar)progressReports.push({reported:event.progress,bar,value:bar.getAttribute('value'),message:win.document.querySelector('#auto-progress-message')?.textContent});
    });
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));
    this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
setLang('cs',{save:false});setAppUnit('mm',{save:false});
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const pause=()=>new Promise(resolve=>setTimeout(resolve,3));
async function waitFor(fn,message,timeout=90000){const start=performance.now();while(!fn()){if(performance.now()-start>timeout)throw Error('Timed out: '+message+'; '+$('.modal-body')?.textContent);await pause();}}
function submit(){const input=$('#gallery-file');Object.defineProperty(input,'files',{configurable:true,value:[new win.File(['photo'],'tools.jpg',{type:'image/jpeg'})]});return input.onchange();}
function whiteBitmap(){const bitmap=createCanvas(240,240);const ctx=bitmap.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,240,240);return bitmap;}

test('capture loading stays visible, honest and recoverable throughout the photo flow',{timeout:180000},async t=>{
  t.after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;delete globalThis.createImageBitmap;await win.happyDOM.close();});
  await t.test('photo decoding displays an indeterminate animated status before work begins and closes safely',async()=>{
    let decode,closed=0;
    globalThis.createImageBitmap=()=>new Promise(resolve=>decode=resolve);
    const modal=openCapture({onAdd:()=>assert.fail('A pending photo cannot be added')});
    const pending=submit(),status=$('.upload-zone [data-loading-ui]');
    assert.ok(status,'the loading UI must exist synchronously, before the decoder starts');
    assert.equal(decode,undefined);assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-busy'),null);
    assert.match(status.textContent,/Otevírám fotografii/);assert.match(status.textContent,/nikam se neodesílá/);
    assert.equal(status.querySelector('progress').hasAttribute('value'),false,'decoding has no measurable percentage');
    assert.equal($('#photo-reference').disabled,true);assert.equal($('#sample-scan').disabled,true);assert.equal($('#capture-cancel').disabled,false);
    await waitFor(()=>decode,'photo decoder');modal.close();
    const next=openCapture({onAdd:()=>assert.fail('A closed upload cannot add tools')});
    const bitmap=whiteBitmap();bitmap.close=()=>closed++;decode(bitmap);await pending;
    assert.equal(closed,1,'a late decoded bitmap must still be released');assert.ok($('#gallery-pick'));assert.equal($('#capture-error').hidden,true);
    assert.equal($('[data-loading-ui]'),null,'a closed upload must not replace the next modal');next.close();
  });
  await t.test('decode failure removes busy status and permits another photo',async()=>{
    const originalImage=globalThis.Image;
    globalThis.createImageBitmap=async()=>{throw Error('invalid image');};
    globalThis.Image=class{decode(){return Promise.reject(Error('invalid image'));}};
    const createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL;
    URL.createObjectURL=()=> 'blob:capture-loading';URL.revokeObjectURL=()=>{};
    const modal=openCapture({onAdd:()=>{}});
    try{
      await submit();assert.equal($('[data-loading-ui]'),null);assert.equal($('#gallery-pick').disabled,false);assert.equal($('#sample-scan').disabled,false);
      assert.equal($('#capture-error').hidden,false);assert.match($('#capture-error').textContent,/Zkuste jinou fotku/);
    }finally{globalThis.Image=originalImage;URL.createObjectURL=createURL;URL.revokeObjectURL=revokeURL;modal.close();}
  });
  await t.test('real recognition explains its current stage without inventing a total percentage and add failures restore controls',async()=>{
    const added=[];let finishAdd;
    const modal=openCapture({onAdd:tools=>{added.push(tools);return new Promise((resolve,reject)=>finishAdd={resolve,reject});}});
    $('#sample-scan').click();
    assert.match($('.upload-zone [data-loading-ui]').textContent,/Hledám měřítko/,'the sample must also acknowledge work before its raster is generated');
    await waitFor(()=>$('#auto-progress-bar'),'recognition loading');
    assert.equal($('#auto-progress-bar').hasAttribute('value'),false,'rectification starts without a fabricated percentage');
    assert.ok($('#processing-canvas'));assert.ok($('.auto-photo-sweep'));assert.equal($('#cancel-processing').disabled,false);
    await waitFor(()=>$('#trace-items input[type=checkbox]'),'real recognition result');
    assert.ok(progressReports.some(report=>report.reported>0&&report.reported<1),'real workers must report their active stages');
    assert.ok(inferenceResults.some(result=>result.model==='fastsam-s'&&result.instances>0),'the real instance model must return tool proposals');
    assert.ok(new Set(progressReports.map(report=>report.message)).size>2,'the current work must remain visible as recognition advances');
    for(const report of progressReports){
      assert.equal(report.value,null,'parallel worker fractions cannot be represented as a global percentage');
      // Raw worker completion is mapped by the public recognizer before the UI
      // sees it. The UI keeps its honest indeterminate meter during that handoff.
    }
    assert.equal($('[data-loading-ui]'),null,'the ready result must not retain a loading status');
    $('#capture-add').click();
    const button=$('#capture-add');
    assert.equal(button.disabled,true);assert.equal(button.getAttribute('data-loading-busy'),'true');assert.ok(button.querySelector('[data-loading-ui]'));
    assert.equal($('#capture-depth').disabled,true);assert.equal($('#capture-calibration-back').disabled,true);assert.equal($('#retake-photo').disabled,true);
    assert.equal(added.length,0,'the add callback must wait until the busy UI can paint');
    await waitFor(()=>finishAdd,'add callback after a paint opportunity');
    assert.equal(added[0].length,2,'the actual sample contours must reach onAdd');
    finishAdd.reject(Error('Zkušební chyba při přidání'));
    await waitFor(()=>!$('#capture-add').disabled,'retry after adding failed');
    assert.equal($('#capture-add').hasAttribute('data-loading-busy'),false);assert.equal($('#capture-add [data-loading-ui]'),null);assert.equal($('#capture-depth').disabled,false);
    assert.match($('#capture-error').textContent,/Zkušební chyba/);
    finishAdd=null;$('#capture-add').click();await waitFor(()=>finishAdd,'retry callback after a paint opportunity');finishAdd.resolve();await waitFor(()=>!$('#modal-root').children.length,'successful retry');
    assert.equal(added.length,2);modal.close();
  });
  await t.test('closing after add is requested cancels before the synchronous layout callback',async()=>{
    let added=0;
    const modal=openCapture({onAdd:()=>added++});
    $('#sample-scan').click();await waitFor(()=>$('#trace-items input[type=checkbox]'),'ready contours for close-before-add');
    $('#capture-add').click();
    assert.equal($('#capture-add').disabled,true);assert.ok($('#capture-add [data-loading-ui]'));
    assert.equal(added,0);modal.close();
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(added,0,'closing before the paint opportunity must cancel layout work');
    assert.equal($('#modal-root').children.length,0);
  });
  await t.test('cancelling before recognition starts removes every pending status',async()=>{
    const modal=openCapture({onAdd:()=>assert.fail('Cancelled recognition cannot add tools')});
    $('#sample-scan').click();await waitFor(()=>$('#cancel-processing'),'cancellable recognition');$('#cancel-processing').click();
    assert.ok($('#gallery-pick'));assert.equal($('[data-loading-ui]'),null);
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.ok($('#gallery-pick'));assert.equal($('#trace-canvas'),null);assert.equal($('[data-loading-ui]'),null);modal.close();
  });
});
