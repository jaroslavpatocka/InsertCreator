import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';

const workers=new Set(),created=[];
class BrowserWorker{
  constructor(url){
    created.push(String(url));
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>this.onmessage?.({data}));
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));
    this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
const {recognizeTools}=await import('../dist/recognize.js');

function fixture(){
  const width=480,height=480,data=new Uint8ClampedArray(width*height*4),truth=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4,light=242+x*.009+y*.004;data.set([light,light+1,light-1,255],p);
  }
  return {width,height,data,truth};
}
function paint(im,x,y,w,h,color){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=yy*im.width+xx;im.data.set([...color,255],i*4);im.truth[i]=1;}}
function tools(){
  const im=fixture();
  paint(im,200,40,14,215,[65,71,76]);paint(im,180,245,54,135,[159,40,35]);paint(im,187,255,8,110,[184,63,56]);
  paint(im,320,80,18,255,[60,66,72]);paint(im,304,80,50,30,[67,72,75]);paint(im,309,316,40,38,[66,70,74]);
  return im;
}
function iou(a,b){let union=0,intersection=0;for(let i=0;i<a.length;i++){union+=+(a[i]||b[i]);intersection+=+(a[i]&&b[i]);}return union?intersection/union:0;}

test('actual recognition workers combine real U2Netp with measured contours and cancellation',{timeout:45000},async t=>{
  t.after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;});
  await t.test('two tools are recognized automatically with accurate calibrated dimensions',async()=>{
    const im=tools(),events=[],result=await recognizeTools(im,{pxPerMm:2,kind:'paper',onProgress:event=>events.push(event)});
    assert.equal(result.neuralModel,'u2netp');assert.ok(events.some(event=>event.phase==='inference'),'actual neural worker must execute inference');
    assert.ok(created.some(url=>url.endsWith('/neural-worker.js')));assert.ok(created.some(url=>url.endsWith('/recognize-worker.js')));
    assert.equal(result.quality.status,'ready',JSON.stringify({quality:result.quality,diagnostics:result.diagnostics}));assert.equal(result.contours.length,2);
    const contours=[...result.contours].sort((a,b)=>b.height-a.height),expected=[{width:27,height:170},{width:25,height:137}];
    for(let i=0;i<2;i++){assert.ok(Math.abs(contours[i].width/2-expected[i].width)<1.5,`width ${contours[i].width/2}mm`);assert.ok(Math.abs(contours[i].height/2-expected[i].height)<1.5,`height ${contours[i].height/2}mm`);}
    assert.ok(iou(result.mask,im.truth)>.9,JSON.stringify(result.diagnostics));assert.ok(im.data.byteLength>0,'worker transfer must not detach the caller photo');
    t.diagnostic(`real workers: ${result.contours.length} contours, mask IoU=${iou(result.mask,im.truth).toFixed(3)}, method=${result.method}`);
  });
  await t.test('a blank sheet fails the photo quality check despite real model output',async()=>{
    const result=await recognizeTools(fixture(),{pxPerMm:2});assert.equal(result.neuralModel,'u2netp');assert.equal(result.quality.status,'retake',JSON.stringify(result));assert.equal(result.contours.length,0);
  });
  await t.test('cancelling during actual inference stops workers and rejects with AbortError',async()=>{
    const controller=new AbortController();let inferenceStarted=false;const started=performance.now();
    await assert.rejects(recognizeTools(tools(),{pxPerMm:2,signal:controller.signal,onProgress:event=>{if(event.phase==='inference'){inferenceStarted=true;controller.abort();}}}),{name:'AbortError'});
    assert.ok(inferenceStarted,'cancellation must occur while a real inference is active');assert.ok(performance.now()-started<5000);
  });
});
