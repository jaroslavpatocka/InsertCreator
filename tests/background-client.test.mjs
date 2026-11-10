import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {removePhotoBackground,backgroundServiceStatus,MAX_BACKGROUND_PIXELS} from '../dist/background-client.js';
import {setLang,errorText} from '../dist/i18n.js';

const image=()=>({width:3,height:2,data:new Uint8ClampedArray([10,20,30,255,40,50,60,128,70,80,90,0,100,110,120,200,130,140,150,255,160,170,180,64])});
const nativeHeaders=()=>new Headers({'Content-Type':'application/octet-stream','X-Background-Model':'birefnet-lite-1024','X-Background-Method':'native-tiles','X-Background-Job':'fixture-job','X-Image-Width':'fixture-width','X-Image-Height':'fixture-height'});
const response=(alpha=[255,128,255,0,32,255],options={})=>new Response(new Uint8Array(alpha),{status:200,headers:nativeHeaders(),...options});
function fixture(t,fetch){const previous=globalThis.fetch,location=globalThis.location,window=globalThis.window;globalThis.fetch=async(url,init)=>{const value=await fetch(url,init);if(init?.method==='POST')for(const[key,sentinel,requestKey]of[['x-background-job','fixture-job','X-Background-Job'],['x-image-width','fixture-width','X-Image-Width'],['x-image-height','fixture-height','X-Image-Height']])if(value?.headers?.get(key)===sentinel)value.headers.set(key,init.headers[requestKey]);return value;};delete globalThis.location;delete globalThis.window;setLang('cs',{save:false});t.after(()=>{globalThis.fetch=previous;if(location===undefined)delete globalThis.location;else globalThis.location=location;if(window===undefined)delete globalThis.window;else globalThis.window=window;setLang('cs',{save:false});});}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const serviceStatus=(overrides={})=>({available:true,execution:'local-computer',model:'birefnet-lite-1024',busy:true,maxPixels:64000000,...overrides});
function heartbeat(t){const previousSet=globalThis.setInterval,previousClear=globalThis.clearInterval,active=new Map();let next=0;globalThis.setInterval=(callback,ms)=>{assert.equal(ms,1000);active.set(++next,callback);return next;};globalThis.clearInterval=id=>active.delete(id);t.after(()=>{globalThis.setInterval=previousSet;globalThis.clearInterval=previousClear;});return{fire:()=>{for(const callback of [...active.values()])callback();},get active(){return active.size;}};}

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
  let next;fixture(t,async()=>next);for(const value of [response([1,2,3]),response([1,2,3,4,5,6,7]),response(undefined,{headers:{'Content-Type':'text/html','X-Background-Model':'birefnet-lite-1024'}}),response(undefined,{headers:{'Content-Type':'application/octet-stream'}}),{ok:true,headers:nativeHeaders(),arrayBuffer:async()=>new Uint8Array(6)}]){next=value;await assert.rejects(removePhotoBackground(image()),error=>error.code==='background-invalid-response');}
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
  let complete;fixture(t,async()=>({ok:true,headers:nativeHeaders(),arrayBuffer:()=>new Promise(resolve=>complete=resolve)}));const controller=new AbortController(),pending=removePhotoBackground(image(),{signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});complete(new Uint8Array(6).buffer);await tick();
});

test('a progress callback can cancel before upload and callback errors do not break the operation',async t=>{
  let calls=0;fixture(t,async()=>{calls++;return response();});const controller=new AbortController();await assert.rejects(removePhotoBackground(image(),{signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});assert.equal(calls,0);const output=await removePhotoBackground(image(),{onProgress:()=>{throw new Error('UI callback');}});assert.equal(output.image.width,3);
});

test('capability status is explicit, validates its schema and uses only the same-origin status path',async t=>{
  const expected={available:true,execution:'local-computer',model:'birefnet-lite-1024',busy:false,maxPixels:64000000};let calls=0,next=expected;fixture(t,async(url,init)=>{calls++;assert.equal(url,'/api/background/status');assert.equal(init.method,'GET');assert.equal(init.mode,'same-origin');assert.equal(init.redirect,'error');return Response.json(next);});await import('../dist/background-client.js?no-automatic-probe');assert.equal(calls,0);assert.deepEqual(await backgroundServiceStatus(),expected);next={...expected,available:false,busy:true,reason:'Model is not installed.'};assert.deepEqual(await backgroundServiceStatus(),next);next={...expected,execution:'cloud'};await assert.rejects(backgroundServiceStatus(),error=>error.code==='background-invalid-response');
});

test('actual local HTTP transport sends binary headers/body and receives source-sized alpha without external routes',async t=>{
  const nativeFetch=globalThis.fetch,seen=[],server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push({path:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks)});res.writeHead(200,{'Content-Type':'application/octet-stream','X-Background-Model':'birefnet-lite-1024','X-Background-Method':'native-tiles','X-Background-Job':req.headers['x-background-job'],'X-Image-Width':req.headers['x-image-width'],'X-Image-Height':req.headers['x-image-height']});res.end(Buffer.from([255,128,255,0,32,255]));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fixture(t,nativeFetch);globalThis.location={origin:`http://127.0.0.1:${server.address().port}`};t.after(()=>new Promise(resolve=>server.close(resolve)));const photo=image(),result=await removePhotoBackground(photo);assert.equal(seen.length,1);assert.equal(seen[0].path,'/api/background/remove');assert.equal(seen[0].headers['x-image-width'],'3');assert.equal(seen[0].headers['x-image-height'],'2');assert.deepEqual([...seen[0].body],[...photo.data]);assert.equal(result.image.data[7],64);assert.equal(result.method,'native-tiles');assert.equal(result.jobId,seen[0].headers['x-background-job']);
});

test('a native image larger than 1400 in both axes and above four megapixels is sent byte-exact and every source alpha is returned without resize',async t=>{
  heartbeat(t);assert.equal(MAX_BACKGROUND_PIXELS,64000000);const width=2301,height=1801,count=width*height,data=new Uint8ClampedArray(count*4),alpha=new Uint8Array(count);for(let p=0;p<count;p++){data[p*4]=p%251;data[p*4+1]=(p>>>3)%256;data[p*4+2]=17;data[p*4+3]=p%256;alpha[p]=(p*31)%256;}let body,job;
  fixture(t,async(url,init)=>{assert.equal(url,'/api/background/remove');assert.equal(init.headers['X-Image-Width'],String(width));assert.equal(init.headers['X-Image-Height'],String(height));assert.equal(init.body.byteLength,count*4);assert.equal(Buffer.compare(Buffer.from(init.body.buffer,init.body.byteOffset,init.body.byteLength),Buffer.from(data.buffer)),0);body=init.body;job=init.headers['X-Background-Job'];return response(alpha);});
  const result=await removePhotoBackground({width,height,data});assert.equal(result.image.width,width);assert.equal(result.image.height,height);assert.equal(result.image.data.length,count*4);assert.notEqual(result.image.data.buffer,data.buffer);assert.notEqual(result.image.data.buffer,body.buffer);assert.equal(result.jobId,job);assert.equal(result.method,'native-tiles');for(let p=0;p<count;p++){const at=p*4;if(result.image.data[at]!==p%251||result.image.data[at+1]!==((p>>>3)%256)||result.image.data[at+2]!==17||result.image.data[at+3]!==Math.round((p%256)*alpha[p]/255))assert.fail('Source pixel was resized or changed at '+p);assert.equal(data[at+3],p%256);}
});

test('native method, exact source dimensions and job response markers are mandatory, never a silent older global resize',async t=>{
  let mutate;fixture(t,async()=>{const value=response();mutate(value.headers);return value;});for(const [change,code]of [[headers=>headers.delete('x-background-method'),'background-native-required'],[headers=>headers.set('x-background-method','global-resize'),'background-native-required'],[headers=>headers.set('x-image-width','1400'),'background-invalid-response'],[headers=>headers.set('x-image-height','1400'),'background-invalid-response'],[headers=>headers.set('x-background-job','another-job'),'background-invalid-response']]){mutate=change;await assert.rejects(removePhotoBackground(image()),error=>error.code===code);}
});

test('tile polling reports only matching native job/frame counters, with one in-flight poll and no invented percentage',async t=>{
  const timer=heartbeat(t),events=[],polls=[];let finishPost,job;
  fixture(t,(url,init)=>{if(init.method==='POST'){job=init.headers['X-Background-Job'];return new Promise(resolve=>finishPost=resolve);}assert.equal(url,'/api/background/status');assert.equal(init.mode,'same-origin');assert.equal(init.redirect,'error');return new Promise(resolve=>polls.push({resolve,signal:init.signal}));});
  const pending=removePhotoBackground(image(),{onProgress:value=>events.push(value)});timer.fire();timer.fire();assert.equal(polls.length,1);polls[0].resolve(Response.json(serviceStatus({jobId:job,progress:{completed:2,total:7,width:3,height:2}})));await tick();assert.equal(events.at(-1).completed,2);assert.equal(events.at(-1).total,7);assert.equal(events.at(-1).indeterminate,false);
  timer.fire();assert.equal(polls.length,2);polls[1].resolve(Response.json(serviceStatus({jobId:'a-foreign-job',progress:{completed:6,total:7,width:3,height:2}})));await tick();assert.equal(events.at(-1).indeterminate,true);assert.ok(!events.some(value=>value.completed===6));
  timer.fire();polls[2].resolve(Response.json(serviceStatus({jobId:job,progress:{completed:5,total:7,width:30,height:20}})));await tick();assert.equal(events.at(-1).indeterminate,true);assert.ok(!events.some(value=>value.completed===5));finishPost(response());await pending;const count=events.length;assert.equal(timer.active,0);timer.fire();await tick();assert.equal(events.length,count);assert.ok(events.every(value=>!Object.hasOwn(value,'progress')));
});

test('malformed, idle, missing-owner and regressing tile progress stays indeterminate without failing a valid result',async t=>{
  const timer=heartbeat(t),events=[];let finishPost,job,next;
  fixture(t,(url,init)=>{if(init.method==='POST'){job=init.headers['X-Background-Job'];return new Promise(resolve=>finishPost=resolve);}return Response.json(next);});const pending=removePhotoBackground(image(),{onProgress:value=>events.push(value)});
  next=serviceStatus({jobId:job,progress:{completed:3,total:7,width:3,height:2}});timer.fire();await tick();assert.equal(events.at(-1).completed,3);
  for(const value of [serviceStatus({jobId:job,progress:{completed:2,total:7,width:3,height:2}}),serviceStatus({jobId:job,progress:{completed:8,total:7,width:3,height:2}}),serviceStatus({progress:{completed:4,total:7,width:3,height:2}}),serviceStatus({jobId:job,busy:false,progress:{completed:7,total:7,width:3,height:2}})]){next=value;timer.fire();await tick();assert.equal(events.at(-1).indeterminate,true);assert.equal(events.at(-1).completed,undefined);}
  finishPost(response());const result=await pending;assert.equal(result.method,'native-tiles');assert.equal(timer.active,0);
});

test('abort cancels a pending status body and suppresses late poll/POST completions and further heartbeat work',async t=>{
  const timer=heartbeat(t),events=[];let finishPost,finishJson,pollSignal,job;
  fixture(t,(url,init)=>{if(init.method==='POST'){job=init.headers['X-Background-Job'];return new Promise(resolve=>finishPost=resolve);}pollSignal=init.signal;return{ok:true,headers:new Headers({'Content-Type':'application/json'}),json:()=>new Promise(resolve=>finishJson=resolve)};});const controller=new AbortController(),pending=removePhotoBackground(image(),{signal:controller.signal,onProgress:value=>events.push(value)});timer.fire();await tick();assert.equal(typeof finishJson,'function');controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(pollSignal.aborted,true);assert.equal(timer.active,0);const count=events.length;finishJson(serviceStatus({jobId:job,progress:{completed:7,total:7,width:3,height:2}}));finishPost(response());timer.fire();await tick();assert.equal(events.length,count);
});

test('a successful POST closes an unfinished status read before it can emit stale post-completion progress',async t=>{
  const timer=heartbeat(t),events=[];let finishPost,finishJson,pollSignal,job;
  fixture(t,(url,init)=>{if(init.method==='POST'){job=init.headers['X-Background-Job'];return new Promise(resolve=>finishPost=resolve);}pollSignal=init.signal;return{ok:true,headers:new Headers({'Content-Type':'application/json'}),json:()=>new Promise(resolve=>finishJson=resolve)};});const pending=removePhotoBackground(image(),{onProgress:value=>events.push(value)});timer.fire();await tick();finishPost(response());await pending;assert.equal(pollSignal.aborted,true);assert.equal(timer.active,0);const count=events.length;finishJson(serviceStatus({jobId:job,progress:{completed:7,total:7,width:3,height:2}}));await tick();assert.equal(events.length,count);assert.equal(events.at(-1).completed,undefined);
});

test('optional status progress is validated as integer counters within a valid native source frame',async t=>{
  let next;fixture(t,async()=>Response.json(next));const good=serviceStatus({jobId:'job-test',method:'native-tiles',progress:{completed:4,total:8,width:6000,height:4000}});next=good;assert.deepEqual(await backgroundServiceStatus(),good);
  for(const progress of [null,{completed:-1,total:8,width:3,height:2},{completed:9,total:8,width:3,height:2},{completed:1.5,total:8,width:3,height:2},{completed:1,total:0,width:3,height:2},{completed:1,total:8,width:3.5,height:2},{completed:1,total:8,width:64000001,height:1}]){next={...good,progress};await assert.rejects(backgroundServiceStatus(),error=>error.code==='background-invalid-response');}next={...good,jobId:'bad/job'};await assert.rejects(backgroundServiceStatus(),error=>error.code==='background-invalid-response');
});

test('same-size simultaneous requests have distinct job ownership markers',async t=>{
  const jobs=[];fixture(t,async(url,init)=>{jobs.push(init.headers['X-Background-Job']);return response();});await Promise.all([removePhotoBackground(image()),removePhotoBackground(image())]);assert.equal(new Set(jobs).size,2);assert.ok(jobs.every(value=>/^[A-Za-z0-9_-]{1,64}$/.test(value)));
});

test('a foreign-origin HTTP redirect is rejected before any source pixels reach the target server',async t=>{
  const nativeFetch=globalThis.fetch;let targetRequests=0;const target=createServer((req,res)=>{targetRequests++;req.resume();res.end();});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));const redirect=createServer((req,res)=>{req.resume();res.writeHead(307,{Location:`http://127.0.0.1:${target.address().port}/foreign`});res.end();});await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));fixture(t,nativeFetch);globalThis.location={origin:`http://127.0.0.1:${redirect.address().port}`};t.after(()=>Promise.all([new Promise(resolve=>redirect.close(resolve)),new Promise(resolve=>target.close(resolve))]));await assert.rejects(removePhotoBackground(image()),error=>error.code==='background-unavailable');assert.equal(targetRequests,0);
});
