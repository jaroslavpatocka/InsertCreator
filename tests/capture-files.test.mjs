import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
const originalImage=globalThis.Image,originalBitmap=globalThis.createImageBitmap,originalCreateURL=URL.createObjectURL,originalRevokeURL=URL.revokeObjectURL;
const canvases=new WeakMap(),draws=[],reads=[],contexts=[],revoked=[];let readFailure=null,contextUnavailable=false;
const checksum=data=>createHash('sha256').update(data).digest('hex');
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  contexts.push({width:this.width,height:this.height});if(contextUnavailable)return null;
  const element=this,ctx=actual(element).getContext('2d');
  return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((image,...args)=>{draws.push({width:element.width,height:element.height,sourceWidth:image.width,sourceHeight:image.height});return target.drawImage(image instanceof win.HTMLCanvasElement?actual(image):image,...args);}):key==='getImageData'?((...args)=>{if(readFailure)throw readFailure;const pixels=target.getImageData(...args);reads.push({width:element.width,height:element.height,rect:args,checksum:checksum(pixels.data)});return pixels;}):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});
};
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');setLang('cs',{save:false});setAppUnit('mm',{save:false});
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn){const started=performance.now();while(!fn()){if(performance.now()-started>1000)throw Error('File decoder was not invoked');await pause();}}
function whiteBitmap(width=240,height=240){const bitmap=createCanvas(width,height),ctx=bitmap.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);return bitmap;}
function detailedBitmap(width,height){const bitmap=whiteBitmap(width,height),ctx=bitmap.getContext('2d'),detail=ctx.createImageData(19,17);for(let y=0;y<17;y++)for(let x=0;x<19;x++){const p=(y*19+x)*4;detail.data.set([(x+y)%2?251:3,(x*43+y*17)%256,(x*7+y*53)%256,255],p);}ctx.putImageData(detail,Math.floor(width/2)-9,Math.floor(height/2)-8);return bitmap;}
function file(name,type='image/jpeg'){return new win.File(['photo bytes'],name,{type});}
function submit(photo){const input=$('#gallery-file');Object.defineProperty(input,'files',{configurable:true,value:[photo]});return input.onchange();}
function setup(){
  draws.length=0;reads.length=0;contexts.length=0;revoked.length=0;readFailure=null;contextUnavailable=false;globalThis.Image=originalImage;
  URL.createObjectURL=()=> 'blob:capture-file-test';URL.revokeObjectURL=url=>revoked.push(url);
  return openCapture({onAdd:()=>assert.fail('An undecoded or uncalibrated image must not add tools')});
}

test('photo file handling attempts native HEIC and validates the decoded image',{timeout:15000},async t=>{
  t.after(async()=>{globalThis.Image=originalImage;if(originalBitmap)globalThis.createImageBitmap=originalBitmap;else delete globalThis.createImageBitmap;URL.createObjectURL=originalCreateURL;URL.revokeObjectURL=originalRevokeURL;await win.happyDOM.close();});
  await t.test('HEIC with missing MIME is attempted natively and the full camera bitmap is released',async()=>{
    const modal=setup(),bitmap=whiteBitmap();let nativeCalls=0,closed=0,fallbackCalls=0;
    bitmap.close=()=>closed++;
    globalThis.createImageBitmap=async(photo,options)=>{nativeCalls++;assert.equal(photo.name,'CAMERA.HEIC');assert.equal(options.imageOrientation,'from-image');return bitmap;};
    globalThis.Image=class{constructor(){fallbackCalls++;throw Error('Native HEIC should succeed first');}};
    await submit(file('CAMERA.HEIC',''));
    assert.equal(nativeCalls,1);assert.equal(fallbackCalls,0);assert.equal(closed,1);
    assert.ok($('#calibration-canvas')&&$('#a4-orientation'),'Decoded white photo should reach manual A4 calibration, not a codec error');
    assert.doesNotMatch($('.modal-body').textContent,/nedokáže otevřít HEIC/);modal.close();
  });
  await t.test('HEIC falls back to the browser image decoder when ImageBitmap cannot read it',async()=>{
    const modal=setup();let fallbackCalls=0;
    globalThis.createImageBitmap=async()=>{throw Error('ImageBitmap codec unavailable');};
    globalThis.Image=class{constructor(){const bitmap=whiteBitmap();bitmap.decode=async()=>{fallbackCalls++;};return bitmap;}};
    await submit(file('camera.heif','image/heif'));
    assert.equal(fallbackCalls,1);assert.ok($('#calibration-canvas')&&$('#a4-orientation'));assert.deepEqual(revoked,['blob:capture-file-test']);modal.close();
  });
  await t.test('unsupported HEIC gives a concrete JPG fallback after both native attempts',async()=>{
    const modal=setup();let first=0,second=0;
    globalThis.createImageBitmap=async()=>{first++;throw Error('codec unavailable');};
    globalThis.Image=class{decode(){second++;return Promise.reject(Error('The source image could not be decoded'));}};
    await submit(file('camera.heic','image/heic'));
    assert.equal(first,1);assert.equal(second,1);assert.match($('#capture-error').textContent,/HEIC.*JPG/);
    assert.doesNotMatch($('#capture-error').textContent,/The source image/);assert.equal($('#gallery-pick').disabled,false);assert.deepEqual(revoked,['blob:capture-file-test']);modal.close();
  });
  await t.test('closing an upload during decode cannot report an error into a later capture session',async()=>{
    const notices=[],modal=setup();modal.close();
    const old=openCapture({onAdd:()=>{},toast:message=>notices.push(message)});let reject;
    globalThis.createImageBitmap=()=>new Promise((_,fail)=>reject=fail);
    const loading=submit(file('camera.heic','image/heic'));await waitFor(()=>reject);old.close();
    const next=openCapture({onAdd:()=>{}});reject(Error('late codec failure'));await loading;
    assert.deepEqual(notices,[]);assert.ok($('#gallery-pick'));assert.equal($('#capture-error').hidden,true);next.close();
  });
  await t.test('large valid photos preserve native dimensions and byte-exact one-pixel source details',async()=>{
    const modal=setup(),bitmap=detailedBitmap(2800,2100),expected=checksum(bitmap.getContext('2d').getImageData(0,0,2800,2100).data);let closed=0;bitmap.close=()=>closed++;
    const reference=$('#photo-reference');reference.value='a4-manual';reference.onchange();
    globalThis.createImageBitmap=async()=>bitmap;
    await submit(file('drawer.jpg'));
    assert.deepEqual(draws[0],{width:2800,height:2100,sourceWidth:2800,sourceHeight:2100},'decode copies the original camera raster without resampling');
    assert.ok(draws.length>=2&&draws.every(draw=>draw.width===2800&&draw.height===2100&&draw.sourceWidth===2800&&draw.sourceHeight===2100),'manual A4 calibration keeps the original source frame');
    assert.deepEqual(reads[0],{width:2800,height:2100,rect:[0,0,2800,2100],checksum:expected},'independent full-raster checksum catches lost or interpolated one-pixel details');
    assert.equal($('#calibration-canvas').width,2800);assert.equal($('#calibration-canvas').height,2100);
    assert.equal(closed,1);assert.ok($('#calibration-canvas')&&$('#a4-orientation'));modal.close();
  });
  await t.test('non-images and oversized files are rejected before decoding',async()=>{
    const modal=setup();let calls=0;globalThis.createImageBitmap=async()=>{calls++;return whiteBitmap();};
    await submit(file('project.json','application/json'));assert.match($('#capture-error').textContent,/fotografii/);
    const large=file('camera.jpg');Object.defineProperty(large,'size',{value:20*1024*1024+1});await submit(large);assert.match($('#capture-error').textContent,/20 MB/);assert.equal(calls,0);modal.close();
  });
  await t.test('invalid decoded dimensions fail before canvas drawing with a readable message',async()=>{
    const modal=setup();globalThis.createImageBitmap=async()=>({width:NaN,height:0});
    await submit(file('broken.png','image/png'));
    assert.match($('#capture-error').textContent,/platné rozlišení/);assert.equal(draws.length,0);modal.close();
  });
  await t.test('a valid narrow native crop is preserved rather than rejected for its hypothetical resized width',async()=>{
    const modal=setup(),bitmap=detailedBitmap(100,10000),expected=checksum(bitmap.getContext('2d').getImageData(0,0,100,10000).data);let closed=0;bitmap.close=()=>closed++;
    const reference=$('#photo-reference');reference.value='a4-manual';reference.onchange();globalThis.createImageBitmap=async()=>bitmap;
    await submit(file('narrow.jpg'));
    assert.equal($('#capture-error').hidden,true);assert.equal($('#calibration-canvas').width,100);assert.equal($('#calibration-canvas').height,10000);assert.deepEqual(draws[0],{width:100,height:10000,sourceWidth:100,sourceHeight:10000});assert.deepEqual(reads[0],{width:100,height:10000,rect:[0,0,100,10000],checksum:expected});assert.equal(closed,1);modal.close();
  });
  await t.test('an originally undersized dimension remains an explicit error before drawing',async()=>{
    const modal=setup();let closed=0;for(const[width,height]of[[99,10000],[10000,99]]){globalThis.createImageBitmap=async()=>({width,height,close:()=>closed++});await submit(file('too-small.jpg'));assert.match($('#capture-error').textContent,/příliš malá/);assert.equal($('#calibration-canvas'),null);assert.equal(draws.length,0);}assert.equal(closed,2);modal.close();
  });
  await t.test('more than 64 megapixels is rejected without allocating or drawing a smaller fallback canvas',async()=>{
    const modal=setup();let closed=0;globalThis.createImageBitmap=async()=>({width:8001,height:8000,close:()=>closed++});await submit(file('over-limit.jpg'));assert.match($('#capture-error').textContent,/64 megapixelů/);assert.equal(draws.length,0);assert.equal(contexts.length,0);assert.equal($('#calibration-canvas'),null);assert.equal(closed,1);modal.close();
  });
  await t.test('a failed ordinary image decode remains an error after both native decoders, without invented pixels',async()=>{
    const modal=setup();let native=0,fallback=0;globalThis.createImageBitmap=async()=>{native++;throw Error('Invalid image bytes');};globalThis.Image=class{decode(){fallback++;return Promise.reject(Error('Invalid image bytes'));}};await submit(file('broken.jpg'));assert.equal(native,1);assert.equal(fallback,1);assert.match($('#capture-error').textContent,/nepodařilo otevřít/);assert.equal(draws.length,0);assert.equal($('#calibration-canvas'),null);modal.close();
  });
  await t.test('a native canvas allocation failure is explicit and never falls back to reduced pixels',async()=>{
    const modal=setup(),bitmap=whiteBitmap(2800,2100);let closed=0,native=0;bitmap.close=()=>closed++;globalThis.createImageBitmap=async()=>{native++;return bitmap;};contextUnavailable=true;
    try{await submit(file('no-canvas-memory.jpg'));assert.match($('#capture-error').textContent,/plném rozlišení/);assert.deepEqual(contexts,[{width:2800,height:2100}]);assert.equal(draws.length,0);assert.equal(native,1);assert.equal(closed,1);assert.equal($('#calibration-canvas'),null);}finally{contextUnavailable=false;modal.close();}
  });
  await t.test('an out-of-memory pixel read fails without retrying decode or allocating a downsampled fallback',async()=>{
    const modal=setup(),bitmap=whiteBitmap(2800,2100);let closed=0,native=0;bitmap.close=()=>closed++;globalThis.createImageBitmap=async()=>{native++;return bitmap;};readFailure=new RangeError('Out of memory');
    try{await submit(file('read-memory.jpg'));assert.match($('#capture-error').textContent,/Out of memory/);assert.deepEqual(contexts,[{width:2800,height:2100}]);assert.deepEqual(draws,[{width:2800,height:2100,sourceWidth:2800,sourceHeight:2100}]);assert.equal(native,1);assert.equal(closed,1);assert.equal($('#calibration-canvas'),null);}finally{readFailure=null;modal.close();}
  });
});
