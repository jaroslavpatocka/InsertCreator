import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {blankProject} from '../dist/model.js';
import {createLivePreview} from '../dist/preview-live.js';
import {createMeshPool} from '../dist/mesh-client.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';

const options={activeIds:new Set(),camera:{},viewport:{width:1000,height:600}};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const result=()=>({vertices:new Float32Array(18),ranges:[{zone:'body',first:0,count:3}],facets:1,parts:1,joints:0,unjoined:0});

function fixture({dense=false,...extra}={}){
  const modules=Array.from({length:5},(_,i)=>({id:`m${i}`,name:`Module ${i}`,x:i*210,y:0,width:210,height:168}));
  const tools=modules.flatMap(module=>Array.from({length:dense?20:1},(_,i)=>({id:`${module.id}-t${i}`,name:'Tool',moduleId:module.id,points:[{x:0,y:0},{x:20,y:0},{x:20,y:15},{x:0,y:15}],x:module.x+12+(i%5)*36,y:12+Math.floor(i/5)*36,rotation:0,depth:8,fingerGrips:[]})));
  return{...blankProject(),width:1100,height:850,printMode:'light',bottomMode:'plain',modules,tools,...extra};
}

function canvas({failUpload=false}={}){
  let uploads=0;
  const gl=new Proxy({},{get:(_,name)=>{
    if(name==='getShaderParameter'||name==='getProgramParameter')return()=>true;
    if(name==='bufferData')return()=>{if(failUpload&&++uploads>1)throw Error('GPU upload rejected');};
    return typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({});
  }});
  return{width:1,height:1,setAttribute(){},addEventListener(){},getContext:()=>gl};
}

function realPool(){
  const workers=[],posted=[],completed=[];
  const factory=()=>{
    const native=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(new URL('../dist/mesh-worker.js',import.meta.url))}});
    workers.push(native);
    const worker={postMessage(data){posted.push({type:data.type,moduleId:data.moduleId,hasBatch:!!data.batch});native.postMessage(data);},terminate:()=>native.terminate()};
    native.on('message',data=>{completed.push(data);worker.onmessage?.({data});});
    native.on('error',error=>worker.onerror?.({message:error.message,preventDefault(){}}));
    native.on('messageerror',()=>worker.onmessageerror?.());
    return worker;
  };
  return{pool:createMeshPool({factory,size:3}),posted,completed,close:()=>Promise.all(workers.map(worker=>worker.terminate()))};
}

async function withWorker(callback){
  const previous=globalThis.Worker;globalThis.Worker=function(){};
  try{await callback();}finally{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;}
}

async function settled(live,project,timeout=15000){
  const start=Date.now();let value;
  do{
    value=live.render(project,{...options,refresh:false});
    if(!value.busy)return value;
    if(Date.now()-start>timeout)assert.fail(`3D preview did not finish: ${value.notice}`);
    await new Promise(resolve=>setTimeout(resolve,10));
  }while(true);
}

test('five real-worker modules finish and returning to 3D reuses the completed meshes',{timeout:20000},async()=>withWorker(async()=>{
  const harness=realPool(),project=fixture({dense:true});let changes=0;
  try{
    const live=createLivePreview({createCanvas:()=>canvas(),pool:harness.pool,onChange:()=>changes++});
    assert.equal(live.render(project,options).stats.ready,0);
    const ready=await settled(live,project);
    assert.equal(ready.stats.ready,5);assert.equal(ready.stats.failed,0);assert.ok(ready.stats.triangles>0);assert.ok(changes>=5);
    assert.equal(harness.posted.filter(job=>job.type==='mesh').length,5);assert.equal(harness.posted.filter(job=>job.type==='plan').length,0);
    assert.equal(live.render(project,options).stats.ready,5);
    assert.equal(live.render(project,{...options,camera:{yaw:.8,pitch:.3}}).stats.ready,5);
    assert.equal(harness.posted.length,5,'camera updates and re-entry reuse worker results');
  }finally{await harness.close();}
}));

test('connected modules share one worker plan and retain the exact printable geometry',{timeout:20000},async()=>withWorker(async()=>{
  const harness=realPool(),project=fixture({connectors:true,printMode:'solid'});
  // Adjacent modules exercise the shared joint plan as well as bed splitting.
  project.modules.forEach((module,i)=>{const delta=i*126-module.x;module.x+=delta;module.width=126;project.tools.filter(tool=>tool.moduleId===module.id).forEach(tool=>tool.x+=delta);});
  try{
    const live=createLivePreview({createCanvas:()=>canvas(),pool:harness.pool});live.render(project,options);
    const ready=await settled(live,project);
    assert.equal(ready.stats.ready,5);assert.equal(ready.stats.failed,0);
    assert.equal(harness.posted.filter(job=>job.type==='plan').length,1,'plan is built once for the whole drawer');
    assert.equal(harness.posted.filter(job=>job.type==='mesh').length,5);
    assert.ok(harness.posted.filter(job=>job.type==='mesh').every(job=>job.hasBatch),'every mesh receives the shared plan');
    const batch=previewBatch(project),expected=project.modules.map(module=>moduleMesh(project,module.id,batch));
    assert.equal(ready.stats.triangles,expected.reduce((sum,mesh)=>sum+mesh.facets,0));
    const completed=harness.completed.filter(message=>message.result?.vertices);
    const actual=completed.map(message=>[...message.result.vertices].join(',')).sort();
    assert.deepEqual(actual,expected.map(mesh=>[...mesh.vertices].join(',')).sort());
  }finally{await harness.close();}
}));

test('a superseded shared plan cannot start meshes for an older scene',async()=>withWorker(async()=>{
  const jobs=[],pool={keep(){},broken:null,run(type,key,project,moduleId,settings){
    let resolve;const promise=new Promise(done=>resolve=done);jobs.push({type,key,project,moduleId,settings,resolve});return promise;
  }};
  const project=fixture({connectors:true}),changed=structuredClone(project);changed.tools[0].depth=9;
  const live=createLivePreview({createCanvas:()=>canvas(),pool});live.render(project,options);live.render(changed,options);
  const plans=jobs.filter(job=>job.type==='plan');assert.equal(plans.length,2);
  plans[0].resolve({batch:{old:true}});await flush();assert.equal(jobs.filter(job=>job.type==='mesh').length,0);
  plans[1].resolve({batch:{current:true}});await flush();const meshes=jobs.filter(job=>job.type==='mesh');assert.equal(meshes.length,5);
  for(const job of meshes){assert.equal(job.project.tools[0].depth,9);job.resolve(result());}
  await flush();assert.equal(live.render(changed,options).stats.ready,5);
}));

test('a GPU upload failure settles the module and notifies the view',async()=>withWorker(async()=>{
  const project=fixture();project.modules=project.modules.slice(0,1);project.tools=project.tools.filter(tool=>tool.moduleId===project.modules[0].id);
  let resolve,changes=0;const promise=new Promise(done=>resolve=done),pool={run:()=>promise,keep(){},broken:null};
  const live=createLivePreview({createCanvas:()=>canvas({failUpload:true}),pool,onChange:()=>changes++});
  live.render(project,options);resolve(result());await flush();
  const failed=live.render(project,{...options,refresh:false});
  assert.ok(changes>0,'a failed upload must refresh the initial 0/N progress notice');
  assert.equal(failed.busy,false);assert.equal(failed.stats.ready,0);assert.equal(failed.stats.failed,1);
  assert.match(failed.notice,/GPU upload rejected/);assert.match(failed.html,/data-invalid-module="true"/);
}));
