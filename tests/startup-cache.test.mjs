import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
const mobile=source.includes("const CACHE_PREFIX='insertcreator-mobile:'");
const origin='https://startup-cache.invalid';
const scope=origin+(mobile?'/mobil/':'/');

function worker(){
  const handlers=new Map(),stores=new Map(),calls=[],opened=[],deleted=[];
  let offline=false;
  const cacheFor=name=>{
    if(!stores.has(name))stores.set(name,new Map());
    const items=stores.get(name);
    return{
      addAll:async()=>{},
      put:async(request,response)=>items.set(request.url,response),
      match:async request=>items.get(request.url)?.clone()
    };
  };
  const context=vm.createContext({
    URL,Response,location:{origin},
    self:{registration:{scope},addEventListener:(type,handler)=>handlers.set(type,handler),skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    caches:{open:async name=>{opened.push(name);return cacheFor(name);},keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name);}},
    fetch:async(request,options)=>{
      calls.push({url:request.url,cache:options?.cache});
      if(offline)throw Error('offline');
      // Model the old bug: a default fetch accepts an obsolete, still-fresh
      // HTTP-cache entry although this worker is nominally network-first.
      return new Response(options?.cache==='no-cache'?'current-release':'old-http-cache');
    }
  });
  new vm.Script(source).runInContext(context);
  return{
    calls,opened,deleted,stores,
    offline(){offline=true;},
    async dispatch(path,extra={}){
      const waits=[];
      let response;
      handlers.get('fetch')({request:{url:new URL(path,scope).href,method:'GET',...extra},waitUntil:promise=>waits.push(promise),respondWith:promise=>{response=promise;}});
      const result=response===undefined?undefined:await response;
      await Promise.all(waits);
      return result;
    },
    async activate(){
      const waits=[];handlers.get('activate')({waitUntil:promise=>waits.push(promise)});await Promise.all(waits);
    }
  };
}

test('mutable startup files revalidate stale browser HTTP cache before use',async()=>{
  const instance=worker();
  for(const path of ['preview3d.js','preview-live.js?v=2','vendor/ort/ort.wasm.min.mjs','style.css','index.html','manifest.webmanifest','project.json','navody/']){
    const response=await instance.dispatch(path);
    assert.equal(await response.text(),'current-release',path);
    assert.equal(instance.calls.at(-1).cache,'no-cache',path);
  }
  const navigation=await instance.dispatch('editor',{mode:'navigate'});
  assert.equal(await navigation.text(),'current-release');
});

test('large models, WASM and fonts keep ordinary HTTP caching',async()=>{
  const instance=worker();
  for(const path of ['models/u2netp.onnx','vendor/ort/ort-wasm-simd-threaded.wasm','fonts/dm-sans.ttf']){
    await instance.dispatch(path);
    assert.equal(instance.calls.at(-1).cache,undefined,path);
  }
});

test('offline startup falls back to the current application cache',async()=>{
  const instance=worker();
  assert.equal(await(await instance.dispatch('preview3d.js')).text(),'current-release');
  instance.offline();
  assert.equal(await(await instance.dispatch('preview3d.js')).text(),'current-release');
  assert.equal(new Set(instance.opened).size,1);
});

test('worker cannot intercept the other application or a foreign origin',async()=>{
  const instance=worker();
  const outside=mobile?origin+'/app.js':origin+'/mobil/app.js';
  assert.equal(await instance.dispatch(outside),undefined);
  if(!mobile)assert.equal(await instance.dispatch(origin+'/mobil'),undefined);
  assert.equal(await instance.dispatch('https://other.invalid/app.js'),undefined);
  assert.equal(await instance.dispatch('preview3d.js',{method:'POST'}),undefined);
  assert.equal(instance.calls.length,0);
});

test('activation removes only obsolete caches belonging to this application',async()=>{
  const instance=worker();
  await instance.dispatch('app.js');
  const current=instance.opened[0],old=mobile?current.replace(/[^:]+$/,'old-release'):'insertcreator-v0-release';
  assert.notEqual(old,current,'the obsolete fixture must use a distinct version in the same namespace');
  const foreign=mobile?'insertcreator-v999-desktop':'insertcreator-mobile:'+encodeURIComponent(origin+'/mobil/')+':old';
  instance.stores.set(old,new Map());instance.stores.set(foreign,new Map());instance.stores.set('unrelated-app',new Map());
  await instance.activate();
  assert.deepEqual(instance.deleted,[old]);
  assert.ok(instance.stores.has(current));assert.ok(instance.stores.has(foreign));assert.ok(instance.stores.has('unrelated-app'));
});
