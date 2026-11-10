import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createBackgroundServer,resolveBackgroundConfig,BACKGROUND_MODEL,MAX_PIXELS,BACKGROUND_SERVICE_MARKER} from '../scripts/background-server.mjs';

async function fixture(t,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'insertcreator-background-test-'));await fs.mkdir(path.join(root,'mobil'));await fs.writeFile(path.join(root,'index.html'),'local desktop');await fs.writeFile(path.join(root,'mobil/index.html'),'local mobile');await fs.writeFile(path.join(root,'app.js'),'export const local=true;');
 const server=createBackgroundServer({distRoot:root,config:{available:true},...options});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});return{url,server,root};
}
const headers=(width,height)=>({'Content-Type':'application/octet-stream','X-Image-Width':String(width),'X-Image-Height':String(height)});
const rgba=Uint8Array.from([10,20,30,255,90,80,70,128,50,60,70,0,1,2,3,255,0,255,0,255,255,0,255,255]);
const waitUntil=async predicate=>{const end=Date.now()+1500;while(!predicate()){if(Date.now()>end)throw Error('condition timeout');await new Promise(resolve=>setTimeout(resolve,5));}};

test('status reports explicit local computer, availability and fixed limits without paths',async t=>{
 const{url}=await fixture(t,{config:{available:false,reason:'Model chybí.',python:'private-path'}});const response=await fetch(url+'/api/background/status'),status=await response.json();assert.equal(response.status,200);assert.deepEqual(status,{available:false,execution:'local-computer',model:BACKGROUND_MODEL,busy:false,maxPixels:MAX_PIXELS,reason:'Model chybí.'});assert.equal(response.headers.get('access-control-allow-origin'),null);
 assert.equal((await fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4)})).status,503);
});
test('RGBA binary input retains source dimensions/order and response is exact alpha bytes',async t=>{
 let calls=0;const{url}=await fixture(t,{jobRunner:async({width,height,rgba:body,signal})=>{calls++;assert.equal(width,3);assert.equal(height,2);assert.equal(signal.aborted,false);assert.deepEqual(new Uint8Array(body),rgba);return{alpha:Uint8Array.from([0,64,128,192,254,255])};}});
 const response=await fetch(url+'/api/background/remove',{method:'POST',headers:headers(3,2),body:rgba});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('x-background-model'),BACKGROUND_MODEL);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),Uint8Array.from([0,64,128,192,254,255]));assert.equal(calls,1);
});
test('invalid dimensions, byte lengths, media and oversized images never invoke model',async t=>{
 let calls=0;const{url}=await fixture(t,{jobRunner:async()=>{calls++;return{alpha:new Uint8Array(1)};}});
 for(const[w,h,body,status]of [[0,1,new Uint8Array(0),400],[-1,1,new Uint8Array(0),400],['1.5',2,new Uint8Array(0),400],[2001,2000,new Uint8Array(0),413],[2,2,new Uint8Array(12),400]])assert.equal((await fetch(url+'/api/background/remove',{method:'POST',headers:headers(w,h),body})).status,status);
 assert.equal((await fetch(url+'/api/background/remove',{method:'POST',headers:{...headers(1,1),'Content-Type':'image/png'},body:new Uint8Array(4)})).status,415);assert.equal(calls,0);
});
test('same-origin guard rejects cross-site requests and hostile host before inference',async t=>{
 let calls=0;const{url}=await fixture(t,{jobRunner:async()=>{calls++;return{alpha:new Uint8Array(1)};}});
 assert.equal((await fetch(url+'/api/background/remove',{method:'POST',headers:{...headers(1,1),Origin:'https://unrelated.example'},body:new Uint8Array(4)})).status,403);
 const hostileHost=await new Promise((resolve,reject)=>{const request=http.request(url+'/api/background/status',{headers:{Host:'unrelated.example'}},res=>{res.resume();resolve(res.statusCode);});request.on('error',reject);request.end();});assert.equal(hostileHost,403);assert.equal(calls,0);
 assert.equal((await fetch(url+'/api/background/status',{headers:{Origin:url}})).status,200);
});
test('one active request exposes busy and rejects a second before model invocation',async t=>{
 let finish,started=false,calls=0;const{url}=await fixture(t,{jobRunner:async()=>{calls++;started=true;await new Promise(resolve=>finish=resolve);return{alpha:Uint8Array.of(255)};}});
 const first=fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4)});await waitUntil(()=>started);assert.equal((await(await fetch(url+'/api/background/status')).json()).busy,true);
 const second=await fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4)});assert.equal(second.status,429);assert.equal(calls,1);finish();assert.equal((await first).status,200);assert.equal((await(await fetch(url+'/api/background/status')).json()).busy,false);
});
test('client abort reaches only its owned job and releases service for another request',async t=>{
 let started=false,aborted=false,calls=0;const{url}=await fixture(t,{jobRunner:async({signal})=>{calls++;if(calls>1)return{alpha:Uint8Array.of(123)};started=true;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}});
 const control=new AbortController(),first=fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4),signal:control.signal});await waitUntil(()=>started);control.abort();await assert.rejects(first);await waitUntil(()=>aborted);
 const next=await fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4)});assert.equal(next.status,200);assert.equal(calls,2);
});
test('timeout cancels job, returns504 and prevents late alpha success',async t=>{
 let aborted=false;const{url}=await fixture(t,{timeoutMs:25,jobRunner:async({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}))});
 const response=await fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4)});assert.equal(response.status,504);assert.equal(aborted,true);assert.equal((await(await fetch(url+'/api/background/status')).json()).busy,false);
});
test('invalid worker output cannot become a successful image response',async t=>{
 const{url}=await fixture(t,{jobRunner:async()=>({alpha:new Uint8Array(3)})});const response=await fetch(url+'/api/background/remove',{method:'POST',headers:headers(1,1),body:new Uint8Array(4)});assert.equal(response.status,500);assert.match((await response.json()).error,/alfu/);
});
test('static server serves only dist desktop/mobile and supportsHEAD',async t=>{
 const{url}=await fixture(t);assert.equal(await(await fetch(url+'/')).text(),'local desktop');assert.equal(await(await fetch(url+'/mobil/')).text(),'local mobile');const head=await fetch(url+'/app.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.match(head.headers.get('content-type'),/javascript/);assert.equal((await fetch(url+'/app.js',{method:'POST',body:'wrong'})).status,405);
});
test('static path traversal and hidden files are inaccessible',async t=>{
 const{url}=await fixture(t);for(const suffix of ['/..%2fprivate.txt','/%5c..%5cprivate.txt','/.background/model.onnx','/%00index.html']){const response=await fetch(url+suffix);assert.equal(response.status,403);}
 assert.equal((await fetch(url+'/api/not-real')).status,404);
});
test('chunked oversized payload receives413 before model invocation',async t=>{
 let called=false;const{url}=await fixture(t,{jobRunner:async()=>{called=true;return{alpha:new Uint8Array(1)};}});
 const status=await new Promise((resolve,reject)=>{const request=http.request(url+'/api/background/remove',{method:'POST',headers:headers(1,1)},res=>{res.resume();resolve(res.statusCode);});request.on('error',reject);request.write(new Uint8Array(8));request.end();});assert.equal(status,413);assert.equal(called,false);
});
test('fresh checkout without configured model has explicit unavailable status',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'insertcreator-background-config-'));try{const config=await resolveBackgroundConfig({root,env:{INSERTCREATOR_BG_MODEL:path.join(root,'absent.onnx')}});assert.equal(config.available,false);assert.match(config.reason,/model/i);}finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
test('available local service marks root and mobile app HTML before startup with exact GET/HEAD lengths',async t=>{
 const{url,root}=await fixture(t),original='<!doctype html><html><head><title>Šuplík</title></head><body>app</body></html>';
 await fs.writeFile(path.join(root,'index.html'),original);await fs.writeFile(path.join(root,'mobil/index.html'),original);
 for(const suffix of ['/','/index.html','/mobil/','/mobil/index.html']){
  const get=await fetch(url+suffix),body=await get.text();assert.equal(get.status,200);assert.equal(body,original.replace('<head>','<head>\n'+BACKGROUND_SERVICE_MARKER));assert.equal(Number(get.headers.get('content-length')),Buffer.byteLength(body));assert.equal(get.headers.get('cache-control'),'no-store');
  const head=await fetch(url+suffix,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),get.headers.get('content-length'));
 }
 assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),original);assert.equal(await fs.readFile(path.join(root,'mobil/index.html'),'utf8'),original);
});
test('unavailable service leaves original app HTML bytes and initial mode untouched',async t=>{
 const{url,root}=await fixture(t,{config:{available:false}}),original='<!doctype html><html><head><title>Žádný model</title></head><body>auto</body></html>';
 await fs.writeFile(path.join(root,'index.html'),original);const response=await fetch(url+'/'),body=await response.text();assert.equal(body,original);assert.equal(Number(response.headers.get('content-length')),Buffer.byteLength(original));assert.equal(body.includes('insertcreator-background-service'),false);
});
