import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {createManufacturingClient} from '../dist/manufacturing-client.js';
import {createManufacturingTaskCache,executeManufacturingTask} from '../dist/manufacturing-worker.js';
import {blankProject} from '../dist/model.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const fixture=()=>({...blankProject(),id:'worker-test',width:252,height:252,printMode:'solid',connectors:true,
  modules:[{id:'a',name:'A',x:0,y:0,width:84,height:84,sizeMode:'manual'},{id:'b',name:'B',x:84,y:0,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'tool',name:'Tool',moduleId:'a',x:20,y:20,points:rectangle(20,24),rotation:0,depth:8,fingerGrips:[]}]});
const analysis=()=>({issues:[],stats:null,printError:'',bedError:'',labels:{count:0,skipped:[]},joints:null,jointError:''});
const preview=()=>({html:'<g/>',viewBox:'0 0 1 1',stats:{triangles:1}});
function fakeWorker(){return{sent:[],terminated:0,postMessage(message){this.sent.push(message);},terminate(){this.terminated++;},emit(data){this.onmessage?.({data});}};}
function realWorker(){
  const native=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:new URL('../dist/manufacturing-worker.js',import.meta.url).href}});
  const worker={postMessage:data=>native.postMessage(data),terminate:()=>native.terminate(),onmessage:null,onerror:null,onmessageerror:null};
  native.on('message',data=>worker.onmessage?.({data}));native.on('error',error=>worker.onerror?.({message:error.message,preventDefault(){}}));native.on('messageerror',()=>worker.onmessageerror?.());
  return worker;
}
const decode=bytes=>{const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:view.getUint32(80,true)},(_,i)=>[0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true))));};
function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){
    assert.equal(view.getUint16(offset+8,true),0);const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+nameLength+extra;
    files.set(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)),bytes.slice(start,start+size));offset=start+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);return files;
}

test('a persistent worker isolates snapshots, ignores stale IDs and retains its completed geometry cache',async()=>{
  const w=fakeWorker();let starts=0;const client=createManufacturingClient({workerFactory:()=>{starts++;return w;}}),input=fixture(),before=structuredClone(input),events=[];
  try{
    const first=client.run('analyze',input,{onProgress:event=>events.push(event)}),id=w.sent[0].id;
    w.sent[0].project.tools[0].x=99;assert.deepEqual(input,before);
    w.emit({type:'progress',id:id+1,event:{progress:.1}});w.emit({type:'result',id:id+1,result:analysis()});assert.deepEqual(events,[]);
    w.emit({type:'progress',id,event:{progress:.4}});w.emit({type:'result',id,result:analysis()});assert.deepEqual(await first,analysis());assert.equal(events.length,1);
    const second=client.run('analyze',input),next=w.sent[1].id;assert.equal(starts,1);assert.equal(w.terminated,0,'completed requests must retain the worker and its cache');
    w.emit({type:'result',id:next,result:analysis()});await second;
  }finally{client.dispose();}
  assert.equal(w.terminated,1);
});

test('cancel and superseding geometry terminate a busy worker and ignore late results',async()=>{
  const workers=[],client=createManufacturingClient({workerFactory:()=>{const w=fakeWorker();workers.push(w);return w;}});
  try{
    const first=client.run('analyze',fixture()).catch(error=>error),old=workers[0],late=old.onmessage;
    const next=client.run('analyze',fixture()),w=workers[1];assert.equal((await first).name,'AbortError');assert.equal(old.terminated,1);
    late({data:{type:'result',id:old.sent[0].id,result:analysis()}});w.emit({type:'result',id:w.sent[0].id,result:analysis()});await next;
    const controller=new AbortController(),last=client.run('export',fixture(),{signal:controller.signal}).catch(error=>error);controller.abort();assert.equal((await last).name,'AbortError');assert.equal(w.terminated,1);
  }finally{client.dispose();}
});

test('preview requests keep one in-flight computation and only the latest queued camera',async()=>{
  const w=fakeWorker(),client=createManufacturingClient({workerFactory:()=>w});
  try{
    const first=client.run('preview',fixture(),{queueLatest:true}).catch(error=>error),one=w.sent[0].id;
    const second=client.run('preview',fixture(),{queueLatest:true,camera:{yaw:1}}).catch(error=>error);
    const last=client.run('preview',fixture(),{queueLatest:true,camera:{yaw:2}});
    assert.equal((await first).name,'AbortError');assert.equal((await second).name,'AbortError');assert.equal(w.sent.length,1);
    w.emit({type:'result',id:one,result:preview()});assert.equal(w.sent.length,2);assert.equal(w.sent[1].options.camera.yaw,2);assert.equal(w.terminated,0);
    w.emit({type:'result',id:w.sent[1].id,result:preview()});await last;
  }finally{client.dispose();}
});

test('worker errors, malformed messages, timeouts and already aborted work settle without hanging',async()=>{
  for(const failure of ['error','messageerror','malformed','timeout']){
    const w=fakeWorker(),client=createManufacturingClient({workerFactory:()=>w,timeoutMs:15}),promise=client.run('analyze',fixture());
    if(failure==='error')w.onerror({preventDefault(){}});if(failure==='messageerror')w.onmessageerror();if(failure==='malformed')w.emit({type:'result',id:w.sent[0].id,result:{}});
    await assert.rejects(promise);assert.equal(w.terminated,1);client.dispose();
  }
  let created=false;const controller=new AbortController();controller.abort();const client=createManufacturingClient({workerFactory:()=>{created=true;return fakeWorker();}});
  await assert.rejects(client.run('analyze',fixture(),{signal:controller.signal}),{name:'AbortError'});assert.equal(created,false);client.dispose();
});

test('bounded fallback yields for loading, rejects large work, and cancels before starting',async()=>{
  const client=createManufacturingClient({workerFactory:()=>null});
  try{
    let rendered=false;setTimeout(()=>rendered=true,0);const result=await client.run('analyze',fixture(),{stats:false});assert.equal(rendered,true);assert.deepEqual(result.issues,[]);
    await assert.rejects(client.run('analyze',{...fixture(),tools:Array.from({length:7},(_,i)=>({...fixture().tools[0],id:'x'+i}))}),/podporou výpočtů na pozadí/);
    const controller=new AbortController(),request=client.run('analyze',fixture(),{signal:controller.signal});controller.abort();await assert.rejects(request,{name:'AbortError'});await pause(2);
  }finally{client.dispose();}
});

test('changing only bed dimensions reuses the exact cached label and volume computations',async()=>{
  const cache=createManufacturingTaskCache(),input={...fixture(),sizeLabels:true},before=structuredClone(input);
  const first=await executeManufacturingTask('analyze',input,{}, {cache});assert.ok(first.stats);const labels=cache.labels,stats=cache.stats,issues=cache.issues,key=cache.key;
  const second=await executeManufacturingTask('analyze',{...input,bedWidth:256,bedHeight:230,updatedAt:Date.now()},{stats:false},{cache});
  assert.equal(cache.key,key);assert.equal(cache.labels,labels);assert.equal(cache.issues,issues);assert.equal(cache.stats,stats);assert.equal(second.stats,first.stats,'cheap refresh retains an already computed volume');assert.deepEqual(input,before);
  const recolored=await executeManufacturingTask('analyze',{...input,multiMaterial:{enabled:false,bodyColor:'#123abc',floorColor:'#456def',textColor:'#fedcba'}},{stats:false},{cache});
  assert.equal(cache.key,key);assert.equal(cache.labels,labels);assert.equal(cache.issues,issues);assert.equal(recolored.stats,stats,'filament HEX colours do not change the geometric volume');
  await executeManufacturingTask('analyze',{...input,base:3},{},{cache});assert.notEqual(cache.key,key);assert.notEqual(cache.stats,stats);
});

test('actual worker transfers closed print files and a bundled colour ZIP without touching source',async()=>{
  const client=createManufacturingClient({workerFactory:realWorker}),input={...fixture(),sizeLabels:true,multiMaterial:{enabled:true,floor:true,text:true}},before=structuredClone(input);
  try{
    const result=await client.run('export',input,{bundle:true,readme:'InsertCreator\nProduction parts',jointNote:'XY clearance 0.20 mm',lang:'en'});
    assert.ok(result.zip instanceof Uint8Array);assert.equal(result.files,undefined);assert.ok(result.manifest.colors);assert.ok(result.parts.length);
    const files=unzip(result.zip);assert.equal(result.fileCount,files.size);assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('projekt.json'))).project,input);
    const readme=new TextDecoder().decode(files.get('README.txt'));assert.match(readme,/filament/i);assert.match(readme,/XY clearance/);
    for(const [name,bytes] of files)if(name.endsWith('.stl'))validatePrintMesh(decode(bytes));
    assert.ok([...files.keys()].some(name=>name.endsWith('.3mf')));assert.deepEqual(input,before);
  }finally{client.dispose();}
});

test('SVG and DXF workers export a valid selected subset while an unselected module is invalid',async()=>{
  const client=createManufacturingClient({workerFactory:realWorker}),input=fixture();
  input.modules.push({id:'outside',name:'Outside',x:300,y:0,width:84,height:84,sizeMode:'manual'});
  input.tools.push({...structuredClone(input.tools[0]),id:'outside-tool',moduleId:'outside',x:320});
  const before=structuredClone(input);
  try{
    for(const operation of ['svg','dxf']){
      const result=await client.run(operation,input,{moduleIds:['a']}),text=new TextDecoder().decode(result.data);
      assert.ok(result.data instanceof Uint8Array);assert.ok(text.length>100);
      if(operation==='svg'){assert.match(text,/id="tool"/);assert.doesNotMatch(text,/outside-tool/);}
      else assert.match(text,/POCKETS/);
      await assert.rejects(client.run(operation,input),/přesahuje|Outside/);
    }
    assert.deepEqual(input,before);
  }finally{client.dispose();}
});

test('baseplate workers package complete closed tiles and the existing physical assembly map',async()=>{
  const client=createManufacturingClient({workerFactory:realWorker}),input={...blankProject(),bottomMode:'grid',width:126,height:126,bedWidth:84,bedHeight:84},before=structuredClone(input);
  try{
    const result=await client.run('baseplate',input,{package:true,extraFiles:[{name:'README.txt',data:'Gridfinity assembly'}]}),files=unzip(result.zip);
    assert.equal(result.manifest.schemaVersion,2);assert.equal(result.manifest.coordinates,'physical-world');assert.equal(result.manifest.tiles.length,4);assert.equal(files.size,6);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('assembly.json'))),result.manifest);
    for(const [name,bytes] of files)if(name.endsWith('.stl'))validatePrintMesh(decode(bytes));
    assert.deepEqual(input,before);
  }finally{client.dispose();}
});

function largeFixture(){
  const circle=Array.from({length:24},(_,i)=>({x:8+8*Math.cos(i*Math.PI/12),y:8+8*Math.sin(i*Math.PI/12)}));
  return{...blankProject(),id:'large-worker',width:504,height:504,bedWidth:500,bedHeight:500,sizeLabels:true,printMode:'light',modules:[{id:'m',name:'95 tools',x:0,y:0,width:420,height:420,sizeMode:'manual'}],tools:Array.from({length:95},(_,i)=>({id:'t'+i,name:'Tool '+i,sizeLabel:String(i+1),moduleId:'m',x:10+(i%10)*42,y:10+Math.floor(i/10)*42,points:circle,rotation:0,depth:5+i%8,fingerGrips:[]}))};
}

test('a real 95-tool worker leaves the main heartbeat running and can be terminated during heavy work',async()=>{
  const client=createManufacturingClient({workerFactory:realWorker}),input=largeFixture(),before=structuredClone(input);let stageTicks=0,computing=false;
  const timer=setInterval(()=>{if(computing)stageTicks++;},2);
  try{
    const result=await client.run('analyze',input,{onProgress:event=>{if(event.progress===.5)computing=true;}});assert.ok(result.stats);assert.ok(stageTicks>=3,'main event-loop timers continue while the worker builds real meshes');assert.deepEqual(input,before);
    const controller=new AbortController();let progress=false;
    const request=client.run('export',input,{signal:controller.signal,onProgress:event=>{if(event.stage==='cutting'&&!progress){progress=true;setTimeout(()=>controller.abort(),5);}}});
    await assert.rejects(request,{name:'AbortError'});assert.equal(progress,true);assert.deepEqual(input,before);
  }finally{clearInterval(timer);client.dispose();}
});
