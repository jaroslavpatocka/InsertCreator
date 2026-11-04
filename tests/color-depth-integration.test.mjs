// Real catalogue contours at the historical import depth limit must fail and repair
// consistently in manufacturing and the worker-backed 3D preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {catalogItems} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {blankProject} from '../dist/model.js';
import {bounds,validateLayout} from '../dist/geometry.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {requiredInsertHeight} from '../dist/print-material.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const ids=['combination-wrench-27mm','socket-3-8in-21mm','ratchet-3-8in'];
function importedProject(){
  const project={...blankProject(),width:1100,height:850,multiMaterial:{enabled:true,floorThickness:1},tools:[],modules:[]};let x=0;
  for(const id of ids){
    const item=catalogItems().find(item=>item.id===id),tool=catalogTool(item),box=bounds(tool);
    const module={id:id+'-module',name:tool.name,x,y:0,width:Math.ceil((box.width+24)/42)*42,height:Math.ceil((box.height+24)/42)*42};
    project.modules.push(module);
    // This is the old editor/import limit, before the additional floor colour is considered.
    project.tools.push({...tool,id,moduleId:module.id,x:x+12,y:12,depth:Math.min(tool.depth,project.insertHeight-project.base),fingerGrips:[]});
    x+=module.width+42;
  }
  return project;
}
function decode(data){
  const bytes=new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=[];
  for(let i=0;i<view.getUint32(80,true);i++)triangles.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));
  return triangles;
}
const high=mesh=>mesh.reduce((top,triangle)=>triangle.reduce((top,point)=>Math.max(top,point[2]),top),-Infinity);
function request(worker,message){
  return new Promise((resolve,reject)=>{
    const clear=()=>{clearTimeout(timer);worker.removeListener('message',done);worker.removeListener('error',failed);};
    const done=data=>{clear();resolve(data);},failed=error=>{clear();reject(error);};
    const timer=setTimeout(()=>failed(Error('mesh worker did not finish')),10000);
    worker.once('message',done);worker.once('error',failed);worker.postMessage(message);
  });
}

test('the old catalogue depth limit reproduces the named floor-inlay failures without changing the project',async()=>{
  const project=importedProject(),before=JSON.stringify(project),batch=previewBatch(project);
  assert.deepEqual(project.tools.map(tool=>tool.depth),[17,17.6,17.6]);assert.deepEqual(validateLayout(project),[]);
  for(const module of project.modules)assert.throws(()=>moduleMesh(project,module.id,batch),error=>error.message.includes(module.name)&&/vložku dna příliš hluboká/.test(error.message));
  await assert.rejects(preparePrintBatch(project),/Očkoplochý klíč 27 mm/);
  assert.equal(JSON.stringify(project),before,'failed preview/export cannot silently alter physical pocket depths');
});

test('explicitly raising the insert preserves catalogue pocket seating and yields closed colour print parts',async()=>{
  const original=importedProject(),before=JSON.stringify(original),project={...structuredClone(original),insertHeight:requiredInsertHeight(original)};
  assert.equal(project.insertHeight,21);assert.deepEqual(project.tools,original.tools);assert.deepEqual(project.modules,original.modules);
  const batch=previewBatch(project);
  for(const module of project.modules){const mesh=moduleMesh(project,module.id,batch);assert.ok(mesh.facets>0);assert.deepEqual(mesh.ranges.map(range=>range.zone),['body','floor']);}
  const result=await preparePrintBatch(project);assert.equal(result.parts.length,5,'the oversized wrench and ratchet remain split only for printing');
  for(const file of result.files.filter(file=>file.name.endsWith('.stl')))validatePrintMesh(decode(file.data));
  for(const tool of project.tools){
    const parts=result.parts.filter(part=>part.moduleId===tool.moduleId),files=zone=>parts.flatMap(part=>part.colorFiles[zone]?[result.files.find(file=>file.name===part.colorFiles[zone])]:[]);
    const bodyTop=Math.max(...files('body').map(file=>high(decode(file.data)))),floorTop=Math.max(...files('floor').map(file=>high(decode(file.data))));
    assert.ok(Math.abs(bodyTop-floorTop-tool.depth)<.0001,'the repaired model retains the requested tool seating depth');
  }
  assert.equal(JSON.stringify(original),before);
});

test('the actual mesh worker rejects deep colour floors and accepts the same explicit height repair',{timeout:15000},async()=>{
  const project=importedProject(),worker=new Worker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(new URL('../dist/mesh-worker.js',import.meta.url))}});
  try{
    const invalid=await request(worker,{id:1,type:'mesh',project,moduleId:project.modules[0].id,projectKey:'invalid',lang:'cs',unit:'mm'});
    assert.equal(invalid.id,1);assert.match(invalid.error.message,/Očkoplochý klíč 27 mm/);
    const fixed={...project,insertHeight:requiredInsertHeight(project)},actual=await request(worker,{id:2,type:'mesh',project:fixed,moduleId:fixed.modules[0].id,projectKey:'fixed',lang:'cs',unit:'mm'});
    assert.equal(actual.error,undefined);assert.ok(actual.result.facets>0);
    const expected=moduleMesh(fixed,fixed.modules[0].id,previewBatch(fixed));
    assert.deepEqual(actual.result.vertices,expected.vertices);assert.deepEqual(actual.result.ranges,expected.ranges);
  }finally{await worker.terminate();}
});
