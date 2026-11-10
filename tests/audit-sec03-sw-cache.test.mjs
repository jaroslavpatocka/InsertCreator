// SEC-03: the service worker must never retain local API status or no-store responses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
const mobile=source.includes("const CACHE_PREFIX='insertcreator-mobile:'");
const origin='https://sw-api-cache.invalid';
const scope=origin+(mobile?'/mobil/':'/');

function worker(responseFor){
  const handlers=new Map(),puts=[];
  const context=vm.createContext({
    URL,Response,location:{origin},
    self:{registration:{scope},addEventListener:(type,handler)=>handlers.set(type,handler),skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    caches:{open:async()=>({addAll:async()=>{},put:async request=>{puts.push(request.url);},match:async()=>undefined}),keys:async()=>[],delete:async()=>true},
    fetch:async request=>responseFor(new URL(request.url))
  });
  new vm.Script(source).runInContext(context);
  return{puts,async dispatch(url,method='GET'){
    const waits=[];let response;
    handlers.get('fetch')({request:{url,method},waitUntil:p=>waits.push(p),respondWith:p=>{response=p;}});
    const result=response===undefined?undefined:await response;await Promise.all(waits);
    return{intercepted:response!==undefined,result};
  }};
}
const status=()=>new Response(JSON.stringify({busy:true,jobId:'synthetic',progress:{completed:1,total:2,width:1261,height:860}}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

test('local API status requests are neither intercepted nor cached',async()=>{
  const instance=worker(status);
  for(const path of ['/api/background/status',scope.slice(origin.length)+'api/background/status']){
    const {intercepted}=await instance.dispatch(origin+path);
    assert.equal(intercepted,false,path);
  }
  const post=await instance.dispatch(origin+'/api/background/remove','POST');
  assert.equal(post.intercepted,false);
  assert.equal(instance.puts.length,0);
});

test('no-store responses are passed through without being cached; static assets still cache',async()=>{
  const instance=worker(url=>url.pathname.endsWith('private.json')?new Response('{}',{headers:{'Cache-Control':'private, no-store'}}):new Response('asset'));
  const priv=await instance.dispatch(scope+'private.json');
  assert.equal(priv.intercepted,true);
  assert.equal(await priv.result.text(),'{}');
  const asset=await instance.dispatch(scope+'style.css');
  assert.equal(await asset.result.text(),'asset');
  assert.deepEqual(instance.puts,[scope+'style.css']);
});
