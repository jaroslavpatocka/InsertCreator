import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {removePhotoBackground,backgroundServiceStatus,MAX_BACKGROUND_PIXELS} from '../dist/background-client.js';
import {setLang,errorText} from '../dist/i18n.js';

const image=()=>({width:3,height:2,data:new Uint8ClampedArray([10,20,30,255,40,50,60,128,70,80,90,0,100,110,120,200,130,140,150,255,160,170,180,64])});
const response=(alpha=[255,128,255,0,32,255],options={})=>new Response(new Uint8Array(alpha),{status:200,headers:{'Content-Type':'application/octet-stream','X-Background-Model':'birefnet-lite-1024'},...options});
function fixture(t,fetch){const previous=globalThis.fetch,location=globalThis.location,window=globalThis.window;globalThis.fetch=fetch;delete globalThis.location;delete globalThis.window;setLang('cs',{save:false});t.after(()=>{globalThis.fetch=previous;if(location===undefined)delete globalThis.location;else globalThis.location=location;if(window===undefined)delete globalThis.window;else globalThis.window=window;setLang('cs',{save:false});});}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('binary request copies exact RGBA and preserves original RGB and multiplied alpha at unchanged source size',async t=>{
  const photo=image(),before=photo.data.slice(),events=[];let sent;
  fixture(t,async(url,init)=>{sent={url,init};assert.notEqual(init.body.buffer,photo.data.buffer);assert.deepEqual([...init.body],[...before]);photo.data.fill(222);init.body.fill(11);return response();});
  const result=await removePhotoBackground(photo,{onProgress:value=>events.push(value),endpoint:'https://example.invalid/upload'});
  assert.equal(sent.url,'/api/background/remove');assert.equal(sent.init.method,'POST');assert.equal(sent.init.headers['Content-Type'],'application/octet-stream');assert.equal(sent.init.headers['X-Image-Width'],'3');assert.equal(sent.init.headers['X-Image-Height'],'2');assert.equal(sent.init.mode,'same-origin');assert.equal(sent.init.redirect,'error');assert.equal(sent.init.credentials,'same-origin');assert.equal(result.image.width,3);assert.equal(result.image.height,2);assert.deepEqual([...result.image.data].filter((v,i)=>i%4!==3),[...before].filter((v,i)=>i%4!==3));assert.deepEqual([...result.image.data].filter((v,i)=>i%4===3),[255,64,0,0,32,64]);assert.equal(result.model,'birefnet-lite-1024');assert.equal(result.execution,'local-computer');assert.ok(Number.isFinite(result.elapsedMs)&&result.elapsedMs>=0);assert.equal(events[0].stage,'matting');assert.equal(events[0].indeterminate,true);assert.equal(events.at(-1).indeterminate,false);assert.ok(events.every(value=>!Object.hasOwn(value,'progress')&&value.elapsedMs>=0));
});

test('client never changes or detaches caller pixels and accepts only the visible bytes of an RGBA subarray',async t=>{
  const source=new Uint8Array(40).fill(99),data=source.subarray(4,28);data.set(image().data);const before=source.slice();fixture(t,async(url,init)=>{assert.equal(init.body.byteLength,24);assert.deepEqual([...init.body],[...data]);return response();});await removePhotoBackground({width:3,height:2,data});assert.deepEqual(source,before);assert.equal(source.buffer.byteLength,40);
});

test('invalid dimensions, non-byte pixels, incorrect length and oversized images fail before any request',async t=>{
  let calls=0;fixture(t,()=>{calls++;return response();});for(const photo of [null,{width:0,height:2,data:new Uint8Array()},{width:3.5,height:2,data:new Uint8Array(28)},{width:3,height:2,data:new Float32Array(24)},{width:3,height:2,data:new Uint8Array(23)},{width:MAX_BACKGROUND_PIXELS+1,height:1,data:new Uint8Array()}])await assert.rejects(removePhotoBackground(photo),error=>error.code==='background-invalid-image');assert.equal(calls,0);
});

test('wrong mime, missing model, truncated or oversized mask and a wrong response body are rejected',async t=>{
  let next;fixture(t,async()=>next);for(const value of [response([1,2,3]),response([1,2,3,4,5,6,7]),response(undefined,{headers:{'Content-Type':'text/html','X-Background-Model':'birefnet-lite-1024'}}),response(undefined,{headers:{'Content-Type':'application/octet-stream'}}),{ok:true,headers:new Headers({'Content-Type':'application/octet-stream','X-Background-Model':'model'}),arrayBuffer:async()=>new Uint8Array(6)}]){next=value;await assert.rejects(removePhotoBackground(image()),error=>error.code==='background-invalid-response');}
});

test('unavailable, busy, rejected and timed-out service errors are actionable and localized in both languages',async t=>{
  let status=404;fixture(t,async()=>new Response('',{status}));for(const lang of ['cs','en']){setLang(lang,{save:false});for(const code of [404,503,429,400,413,403,504,500]){status=code;await assert.rejects(removePhotoBackground(image()),error=>{assert.equal(error.status,code);const rendered=errorText(error);if(code===404||code===503)assert.match(rendered,lang==='en'?/manual selection/:/ruční výběr/);if(code===429)assert.match(rendered,lang==='en'?/Wait and try again/:/Počkejte/);return true;});}}
});

test('a failed network request has the same manual fallback without leaking low-level server details',async t=>{
  fixture(t,async()=>{throw new TypeError('private backend trace');});await assert.rejects(removePhotoBackground(image()),error=>error.code==='background-unavailable'&&!error.message.includes('backend trace'));
});

test('an already aborted request does not call fetch',async t=>{
  let calls=0;fixture(t,()=>{calls++;return response();});const controller=new AbortController();controller.abort();await assert.rejects(removePhotoBackground(image(),{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});

test('mid-request abort rejects immediately even if a late transport ignores cancellation',async t=>{
  let complete,captured;fixture(t,(url,init)=>{captured=init;return new Promise(resolve=>complete=resolve);});const controller=new AbortController(),events=[],pending=removePhotoBackground(image(),{signal:controller.signal,onProgress:value=>events.push(value)});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(captured.signal,controller.signal);complete(response());await tick();assert.equal(events.length,1);
});

test('abort while reading the alpha body cannot return a partial or stale result',async t=>{
  let complete;fixture(t,async()=>({ok:true,headers:new Headers({'Content-Type':'application/octet-stream','X-Background-Model':'birefnet-lite-1024'}),arrayBuffer:()=>new Promise(resolve=>complete=resolve)}));const controller=new AbortController(),pending=removePhotoBackground(image(),{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});complete(new Uint8Array(6).buffer);await tick();
});

test('a progress callback can cancel before upload and callback errors do not break the operation',async t=>{
  let calls=0;fixture(t,async()=>{calls++;return response();});const controller=new AbortController();await assert.rejects(removePhotoBackground(image(),{signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});assert.equal(calls,0);const output=await removePhotoBackground(image(),{onProgress:()=>{throw new Error('UI callback');}});assert.equal(output.image.width,3);
});

test('capability status is explicit, validates its schema and uses only the same-origin status path',async t=>{
  const expected={available:true,execution:'local-computer',model:'birefnet-lite-1024',busy:false,maxPixels:4000000};let calls=0,next=expected;fixture(t,async(url,init)=>{calls++;assert.equal(url,'/api/background/status');assert.equal(init.method,'GET');assert.equal(init.mode,'same-origin');assert.equal(init.redirect,'error');return Response.json(next);});await import('../dist/background-client.js?no-automatic-probe');assert.equal(calls,0);assert.deepEqual(await backgroundServiceStatus(),expected);next={...expected,available:false,busy:true,reason:'Model is not installed.'};assert.deepEqual(await backgroundServiceStatus(),next);next={...expected,execution:'cloud'};await assert.rejects(backgroundServiceStatus(),error=>error.code==='background-invalid-response');
});

test('actual local HTTP transport sends binary headers/body and receives source-sized alpha without external routes',async t=>{
  const nativeFetch=globalThis.fetch,seen=[],server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push({path:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)});res.writeHead(200,{'Content-Type':'application/octet-stream','X-Background-Model':'birefnet-lite-1024'});res.end(Buffer.from([255,128,255,0,32,255]));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fixture(t,nativeFetch);globalThis.location={origin:`http://127.0.0.1:${server.address().port}`};t.after(()=>new Promise(resolve=>server.close(resolve)));const photo=image(),result=await removePhotoBackground(photo);assert.equal(seen.length,1);assert.equal(seen[0].path,'/api/background/remove');assert.equal(seen[0].headers['x-image-width'],'3');assert.equal(seen[0].headers['x-image-height'],'2');assert.deepEqual([...seen[0].body],[...photo.data]);assert.equal(result.image.data[7],64);
});
