import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {encodeSTL} from '../dist/print-geometry.js';
import {printStats} from '../dist/geometry.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {mergePrintStats,moduleMesh,packParts,previewBatch} from '../dist/preview-mesh.js';
import {createMeshPool,meshKeys} from '../dist/mesh-client.js';
import {boundsFor,previewFrame} from '../dist/preview3d.js';
import {createGLPreview} from '../dist/webgl-preview.js';

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const project=(extra={})=>({...blankProject(),id:'p',width:252,height:168,printMode:'solid',bottomMode:'plain',
  modules:[{id:'a',name:'A',x:0,y:0,width:84,height:84,locked:true,sizeMode:'manual'},{id:'b',name:'B',x:84,y:0,width:84,height:84,locked:true,sizeMode:'manual'}],
  tools:[{id:'t',name:'Klíč',points:rect(40,20),x:20,y:30,rotation:0,depth:8,moduleId:'a',fingerGrips:[]},{id:'u',name:'Bit',points:rect(30,20),x:110,y:30,rotation:0,depth:8,moduleId:'b',fingerGrips:[]}],...extra});

test('packed vertices keep the placement matrix and group each colour zone',()=>{
  const triangle=[[[0,0,0],[1,0,0],[0,1,0]]],shift=[1,0,0,10,0,1,0,20,0,0,1,30,0,0,0,1],parts=[{bytes:encodeSTL(triangle),matrix:shift,zone:'text'},{bytes:encodeSTL(triangle),matrix:shift,zone:'body'}];
  const mesh=packParts(parts);
  assert.equal(mesh.facets,2);assert.deepEqual(mesh.ranges,[{zone:'body',first:0,count:3},{zone:'text',first:3,count:3}]);
  assert.deepEqual([...mesh.vertices.slice(0,6)],[10,20,30,0,0,1]);
});

test('a module mesh matches the print faces in plain and colour mode',()=>{
  const plain=project(),mesh=moduleMesh(plain,'a',null);assert.ok(mesh.facets>0);assert.equal(mesh.vertices.length,mesh.facets*18);
  const colored=project({multiMaterial:{enabled:true}}),parts=moduleMesh(colored,'a',previewBatch(colored));
  assert.deepEqual(parts.ranges.map(range=>range.zone),['body','floor']);
});

test('a module above the former 120 000 triangle limit is not refused',()=>{
  const ring=Array.from({length:420},(_,k)=>({x:6+6*Math.cos(k/420*Math.PI*2),y:6+6*Math.sin(k/420*Math.PI*2)}));
  const tools=Array.from({length:60},(_,i)=>({id:`r${i}`,name:'R',points:ring,x:6+(i%10)*20,y:6+Math.floor(i/10)*20,rotation:0,depth:8,moduleId:'big',fingerGrips:[]}));
  const big=project({modules:[{id:'big',name:'Big',x:0,y:0,width:210,height:126,locked:true,sizeMode:'manual'}],tools});
  assert.ok(moduleMesh(big,'big',null).facets>120000);
});

test('project totals add up per module, so no whole-drawer mesh is needed',()=>{
  const p=project(),whole=printStats(p,{checkBed:false}),merged=mergePrintStats(p.modules.map(module=>printStats(p,{moduleId:module.id,checkBed:false})));
  assert.ok(Math.abs(whole.volumeMm3-merged.volumeMm3)<1);assert.equal(whole.heightMm,merged.heightMm);assert.equal(whole.triangles,merged.triangles);
  assert.equal(mergePrintStats([]),null);
});

test('editing one module leaves the other mesh key alone; colours never change a key',()=>{
  const base=meshKeys(project()),moved=project();moved.tools[0].x=22;const next=meshKeys(moved);
  assert.notEqual(base.modules.get('a'),next.modules.get('a'));assert.equal(base.modules.get('b'),next.modules.get('b'));
  const red=meshKeys(project({multiMaterial:{enabled:true,floorColor:'#ff0000'}})),blue=meshKeys(project({multiMaterial:{enabled:true,floorColor:'#0000ff'}}));
  assert.equal(red.projectKey,blue.projectKey);
  const settings=meshKeys(project({insertHeight:30}));assert.notEqual(base.modules.get('b'),settings.modules.get('b'));
  const joined=meshKeys(moved,{sharedLayout:true}),before=meshKeys(project(),{sharedLayout:true});assert.notEqual(joined.modules.get('b'),before.modules.get('b'));
});

function fakeWorkers(){
  const created=[];
  const factory=()=>{const worker={posted:[],postMessage(message){worker.posted.push(message);},reply(result,error){const message=worker.posted.at(-1);worker.onmessage({data:error?{id:message.id,error}:{id:message.id,result}});}};created.push(worker);return worker;};
  return{created,factory};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('the pool shares results, runs big jobs first and drops jobs nobody needs',async()=>{
  const {created,factory}=fakeWorkers(),pool=createMeshPool({factory,size:1}),p={};
  const first=pool.run('mesh','a',p,'a',{weight:1});assert.equal(pool.run('mesh','a',p,'a',{weight:1}),first);
  const small=pool.run('mesh','b',p,'b',{weight:1}),large=pool.run('mesh','c',p,'c',{weight:9}),dropped=pool.run('mesh','d',p,'d',{weight:0});
  let cancelled=false;dropped.catch(error=>cancelled=error.cancelled);
  pool.keep('mesh',['a','b','c']);await flush();assert.equal(cancelled,true);
  const result={vertices:new Float32Array(6),ranges:[]};created[0].reply(result);assert.equal(await first,result);assert.equal(pool.peek('mesh','a'),result);
  assert.equal(created[0].posted.at(-1).moduleId,'c');created[0].reply(result);await large;
  assert.equal(created[0].posted.at(-1).moduleId,'b');created[0].reply(null,{message:'bad',i18n:{cs:'bad'}});
  await assert.rejects(small,error=>error.message==='bad'&&error.i18n.cs==='bad');
  // A failure may be temporary, so the next request for the same key tries again.
  const retried=pool.run('mesh','b',p,'b');assert.equal(created[0].posted.length,4);created[0].reply(result);assert.equal(await retried,result);
});

test('a worker that cannot start marks the pool broken and rejects every job',async()=>{
  const {created,factory}=fakeWorkers(),pool=createMeshPool({factory,size:1}),one=pool.run('mesh','a',{},'a'),two=pool.run('mesh','b',{},'b');
  created[0].onerror({});await assert.rejects(one);await assert.rejects(two);assert.ok(pool.broken);await assert.rejects(pool.run('mesh','c',{},'c'));
});

test('framing depends on the layout only and covers every module and the drawer',()=>{
  const p=project(),bounds=boundsFor(p),frame=previewFrame(bounds.fitSize,{yaw:.7,pitch:.3},{width:1000,height:500});
  assert.ok(Number.isFinite(bounds.fitSize)&&bounds.fitSize>=252);assert.equal(bounds.center[0],126);
  assert.ok(Math.abs(frame.width/frame.height-2)<1e-9);assert.ok(Math.abs(Math.hypot(...frame.towards)-1)<1e-9);
  const moved=project();moved.tools[0].depth=10;assert.deepEqual(boundsFor(moved).center,bounds.center);
});

test('live colours reach the draw call without rebuilding the mesh',async()=>{
  const {createLivePreview}=await import('../dist/preview-live.js'),drawn=[],vertices=new Float32Array(18);
  const handlers={},calls={},gl=new Proxy({},{get:(_,name)=>name in calls?calls[name]:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
  Object.assign(calls,{getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:(_,name)=>name,uniform3fv:(name,value)=>{if(name==='color')drawn.push([...value]);}});
  const canvas={width:1,height:1,className:'',setAttribute(){},addEventListener:(name,fn)=>handlers[name]=fn,getContext:()=>gl};
  const jobs=[],pool={run:(type,key,snapshot,moduleId)=>{jobs.push(moduleId);return Promise.resolve({vertices,ranges:[{zone:'floor',first:0,count:3}],facets:1,parts:1,joints:0,unjoined:0});},keep(){},broken:null};
  const previous=globalThis.Worker;globalThis.Worker=function(){};
  try{
    let changed=0;const live=createLivePreview({createCanvas:()=>canvas,pool,onChange:()=>changed++}),options={activeIds:new Set(),camera:{},viewport:{width:100,height:100}},red=project({multiMaterial:{enabled:true,floorColor:'#ff0000'}});
    live.render(red,options);await flush();assert.ok(changed>0);
    const built=jobs.length;drawn.length=0;live.render(red,options);assert.ok(drawn.some(color=>color[0]===1&&color[2]===0),'red floor');
    const blue=project({multiMaterial:{enabled:true,floorColor:'#0000ff'}});drawn.length=0;live.render(blue,options);
    assert.ok(drawn.some(color=>color[0]===0&&color[2]===1),'blue floor');assert.equal(jobs.length,built);
  }finally{if(previous)globalThis.Worker=previous;else delete globalThis.Worker;}
});

test('a lost WebGL context hands over to SVG and comes back when restored',async()=>{
  const handlers={},gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
  let changes=0;const renderer=createGLPreview({addEventListener:(name,fn)=>handlers[name]=fn,getContext:()=>gl},{wait:1,onStateChange:()=>changes++});
  assert.equal(renderer.failed,false);handlers.webglcontextlost({preventDefault(){}});assert.equal(renderer.failed,false);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(renderer.failed,true);assert.equal(changes,1);
  handlers.webglcontextrestored();assert.equal(renderer.failed,false);assert.equal(changes,2);
});

test('without WebGL the renderer declines, so the SVG preview stays in charge',()=>{
  assert.equal(createGLPreview({getContext:()=>null}),null);
  assert.equal(createGLPreview({getContext(){throw Error('blocked');}}),null);
  assert.equal(createGLPreview({}),null);
});

test('cached size labels equal a fresh plan and follow a change of their module',()=>{
  const p=project({sizeLabels:true});p.tools[0].nominalSize={value:13,unit:'mm'};p.tools[1].nominalSize={value:8,unit:'mm'};
  const first=planSizeLabels(p),again=planSizeLabels(p);assert.equal(first.labels.length,2);
  assert.deepEqual(again.labels.map(label=>[label.toolId,label.x,label.y]),first.labels.map(label=>[label.toolId,label.x,label.y]));
  const shifted={...p,modules:p.modules.map(module=>module.id==='a'?{...module,x:module.x+42}:module),tools:p.tools.map(tool=>tool.id==='t'?{...tool,x:tool.x+42}:tool)};
  assert.notEqual(planSizeLabels(shifted).labels.find(label=>label.toolId==='t').x,first.labels.find(label=>label.toolId==='t').x);
  assert.deepEqual(planSizeLabels({...p,sizeLabels:false}),{labels:[],skipped:[]});
});
