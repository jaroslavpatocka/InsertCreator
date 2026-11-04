import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePrintBatch} from '../dist/print-batch.js';
import {blankProject} from '../dist/model.js';
import {exportSTL,zipFiles} from '../dist/geometry.js';
import {buildPrintTriangles,validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {catalogSets} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {addToolGroup} from '../dist/set-module.js';
import {planSizeLabels} from '../dist/size-labels.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const fixture=(extra={})=>({...blankProject(),id:'batch',width:840,height:420,printMode:'solid',bottomMode:'plain',bedWidth:84,bedHeight:84,modules:[
  {id:'first',name:'První sada',x:42,y:42,width:252,height:126,locked:true,sizeMode:'manual'},
  {id:'second',name:'Druhá sada',x:42,y:210,width:378,height:126,locked:false,sizeMode:'auto'},
  {id:'kept',name:'Beze změny',x:672,y:0,width:84,height:84,locked:true,sizeMode:'manual'}
],tools:[
  {id:'long',name:'Long screwdriver',moduleId:'first',points:rectangle(180,60),x:55,y:55,rotation:0,depth:10,sizeLabel:'PH2',fingerGrips:[{id:'manual',x:0,y:30,radius:7}]},
  ...[0,1,2].map(index=>({id:'second-'+index,name:'Klíč '+index,moduleId:'second',points:rectangle(60,60),x:54+index*126,y:223,rotation:0,depth:8+index*2,nominalSize:{value:index+10,unit:'mm'},fingerGrips:[]})),
  {id:'kept-tool',name:'Keep',moduleId:'kept',points:rectangle(30,30),x:680,y:8,rotation:0,depth:8,fingerGrips:[]}
],...extra});
const decode=data=>{const bytes=new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let i=0;i<view.getUint32(80,true);i++)out.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));return out;};
const bounds=mesh=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const triangle of mesh)for(const p of triangle)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return{min,max};};
const close=(a,b,tolerance=.05)=>assert.ok(Math.abs(a-b)<tolerance,`${a} should equal ${b}`);
const transform=(mesh,m)=>mesh.map(t=>t.map(p=>[m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]]));
function assertReassembly(source,result,id){
  const module=source.modules.find(module=>module.id===id),original=decode(exportSTL(source,{moduleId:id,checkBed:false})).map(t=>t.map(p=>[p[0]+module.x,p[1]+module.y,p[2]])),assembled=[];
  const parts=result.parts.filter(part=>part.moduleId===id);assert.ok(parts.length);
  for(const part of parts){
    const file=result.files.find(file=>file.name===part.file),mesh=decode(file.data),box=bounds(mesh);validatePrintMesh(mesh);close(box.min[0],0,1e-5);close(box.min[1],0,1e-5);
    assert.ok(box.max[0]<=source.bedWidth+1e-5&&box.max[1]<=source.bedHeight+1e-5);assert.equal(part.offset.z,0);assert.equal(part.assemblyTransform.length,16);assert.equal(part.count,parts.length);
    assembled.push(...transform(mesh,part.assemblyTransform));
  }
  close(trianglesVolume(assembled),trianglesVolume(original),.15);const a=bounds(assembled),b=bounds(original);for(let i=0;i<3;i++){close(a.min[i],b.min[i],.0002);close(a.max[i],b.max[i],.0002);}
}

test('one selected batch cuts multiple original modules into actual printable meshes without changing any layout or tool record',async()=>{
  const source=fixture(),before=JSON.stringify(source),result=await preparePrintBatch(source,{moduleIds:['first','second']});
  assert.equal(JSON.stringify(source),before);assert.equal(Object.hasOwn(result,'project'),false);assert.deepEqual(result.moduleIds,['first','second']);
  assert.ok(result.parts.filter(part=>part.moduleId==='first').length>1);assert.ok(result.parts.filter(part=>part.moduleId==='second').length>1);assert.ok(result.parts.every(part=>part.moduleId!=='kept'));
  for(const id of result.moduleIds)assertReassembly(source,result,id);
  assert.equal(result.files.length,result.parts.length+1);assert.deepEqual(JSON.parse(result.files.find(file=>file.name==='assembly.json').data),result.manifest);assert.deepEqual(result.manifest.parts,result.parts);
  assert.equal(result.splitSummary.length,2);const zip=zipFiles(result.files);assert.equal(new DataView(zip.buffer).getUint32(0,true),0x04034b50);
});

test('an oversized individual pocket is physically cut too, while an already fitting locked module exports as one body',async()=>{
  const source=fixture(),before=JSON.stringify(source),long=await preparePrintBatch(source,{moduleIds:['first']}),kept=await preparePrintBatch(source,{moduleIds:['kept']});
  assert.ok(long.parts.length>1);assertReassembly(source,long,'first');assert.equal(kept.parts.length,1);assertReassembly(source,kept,'kept');assert.equal(JSON.stringify(source),before);
});

test('a part fitting only after 90 degree printing rotation carries an exact inverse world transform',async()=>{
  for(const bottomMode of ['plain','grid']){
    const source=fixture({bottomMode,bedWidth:126,bedHeight:84,modules:[{id:'rotated',name:'Rotated for printing',x:42,y:42,width:84,height:126,locked:true}],tools:[{id:'t',name:'Tool',moduleId:'rotated',points:rectangle(30,70),x:50,y:50,rotation:0,depth:8,fingerGrips:[]}]}),before=JSON.stringify(source),result=await preparePrintBatch(source);
    assert.equal(result.parts.length,1);assert.equal(result.parts[0].rotationForPrinting,90);assertReassembly(source,result,'rotated');assert.equal(JSON.stringify(source),before);
  }
});

test('the explicit batch promise respects the bed even when legacy project printer checks are off',async()=>{
  const source=fixture({limitToBed:false}),result=await preparePrintBatch(source,{moduleIds:['first']});assert.ok(result.parts.length>1);assertReassembly(source,result,'first');assert.equal(source.limitToBed,false);
});

test('unselected invalid geometry is ignored, selected errors and malformed selections reject atomically',async()=>{
  const source=fixture();source.tools.find(t=>t.moduleId==='second').depth=99;const before=JSON.stringify(source);
  const result=await preparePrintBatch(source,{moduleIds:['first']});assertReassembly(source,result,'first');
  await assert.rejects(()=>preparePrintBatch(source,{moduleIds:['second']}),/Hloubka|hloubka/);
  for(const moduleIds of [[],['missing'],['first','first'],null,[true]])await assert.rejects(()=>preparePrintBatch(source,{moduleIds}));
  assert.equal(JSON.stringify(source),before);
});

test('cancellation before or between parts leaves the source untouched and returns no partial output',async()=>{
  const source=fixture(),before=JSON.stringify(source),early=new AbortController();early.abort();await assert.rejects(()=>preparePrintBatch(source,{signal:early.signal}),{name:'AbortError'});
  const during=new AbortController();let reached=false;await assert.rejects(()=>preparePrintBatch(source,{moduleIds:['first'],signal:during.signal,onProgress:event=>{if(event.stage==='cutting'&&event.completed>=1){reached=true;during.abort();}}}),{name:'AbortError'});assert.ok(reached);assert.equal(JSON.stringify(source),before);
});

test('the exporter snapshots its input before yielding so a later host edit cannot change prepared geometry',async()=>{
  const source=fixture(),snapshot=structuredClone(source),pending=preparePrintBatch(source,{moduleIds:['first']});source.tools[0].points[1].x+=10;
  const result=await pending;assertReassembly(snapshot,result,'first');assert.equal(source.tools[0].points[1].x,snapshot.tools[0].points[1].x+10);
});

test('Gridfinity export can cut a body with over 400 feet, and excessive output is bounded without omitting parts',async()=>{
  const source=fixture({width:1260,height:1260,bottomMode:'grid',bedWidth:84,bedHeight:84,modules:[{id:'many-feet',name:'420 feet',x:0,y:0,width:882,height:840,locked:true}],tools:[]}),before=JSON.stringify(source),result=await preparePrintBatch(source);
  assert.equal(result.parts.length,110);assert.ok(result.parts.every(part=>part.triangles>0&&part.bounds.width<=84&&part.bounds.height<=84));assert.equal(JSON.stringify(source),before);
  const huge=fixture({width:3000,height:3000,grid:10,bedWidth:50,bedHeight:50,modules:[{id:'huge',x:0,y:0,width:3000,height:3000}],tools:[]}),hugeBefore=JSON.stringify(huge);
  await assert.rejects(()=>preparePrintBatch(huge),/400 tiskových/);assert.equal(JSON.stringify(huge),hugeBefore);
});

test('selected nonfinite geometry rejects before slicing, and far-away valid module coordinates retain local float32 precision',async()=>{
  const invalid=fixture();invalid.modules[0].x=NaN;await assert.rejects(()=>preparePrintBatch(invalid,{moduleIds:['first']}));assert.ok(Number.isNaN(invalid.modules[0].x));
  const source=fixture({width:3000});source.modules[0].x+=2478;source.tools[0].x+=2478;const before=JSON.stringify(source),result=await preparePrintBatch(source,{moduleIds:['first']});assertReassembly(source,result,'first');assert.equal(JSON.stringify(source),before);
});

test('the plain-object snapshot fallback preserves nonfinite numbers for strict validation',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'structuredClone');
  Object.defineProperty(globalThis,'structuredClone',{value:undefined,configurable:true,writable:true});
  try{
    for(const invalid of [NaN,Infinity,-Infinity]){
      const source=fixture();source.modules[0].x=invalid;
      await assert.rejects(()=>preparePrintBatch(source,{moduleIds:['first']}));
      assert.ok(Object.is(source.modules[0].x,invalid));assert.equal(source.tools[0].points[1].x,180);
    }
  }finally{Object.defineProperty(globalThis,'structuredClone',original);}
});

test('the real 26-wrench set with 52 central grips, mixed depths, engraved sizes and Gridfinity feet reassembles unchanged',async t=>{
  const set=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm');assert.ok(set);
  const tools=set.tools.map((item,index)=>({...catalogTool(item),id:'wrench-'+index,locked:false,moduleId:null}));assert.equal(tools.length,26);assert.equal(tools.reduce((sum,tool)=>sum+tool.fingerGrips.length,0),52);assert.ok(new Set(tools.map(tool=>tool.depth)).size>1);
  const base={...blankProject(),width:1260,height:840,insertHeight:26,bedWidth:220,bedHeight:220,bottomMode:'grid',printMode:'light',sizeLabels:true};
  const source=addToolGroup(base,tools,{name:'Wrenches 6–32',arrangement:'compact',order:'asc',checkManufacturing:false,toolSet:{id:'wrenches',name:'Wrenches 6–32',layout:'shared'}}).project,before=JSON.stringify(source);
  const labels=planSizeLabels(source).labels;assert.ok(labels.length>0);
  const started=performance.now(),result=await preparePrintBatch(source);assert.equal(result.parts.length,12);assert.equal(JSON.stringify(source),before);
  const assembled=[];
  for(const part of result.parts){
    const mesh=decode(result.files.find(file=>file.name===part.file).data),box=bounds(mesh);validatePrintMesh(mesh);
    close(box.min[0],0,1e-5);close(box.min[1],0,1e-5);assert.ok(box.max[0]<=220&&box.max[1]<=220);
    assembled.push(...transform(mesh,part.assemblyTransform));
  }
  // Independent integration of the original 2D material slabs and three foot
  // loft intervals, before triangulation. Whole-source STL exceeds its existing
  // 120000-facet guard; slicing must not change that production safety limit.
  close(trianglesVolume(assembled),2670989.687896,.5);
  const box=bounds(assembled);for(const [actual,expected] of [...box.min.map((v,i)=>[v,[.25,.25,0][i]]),...box.max.map((v,i)=>[v,[503.75,671.75,25.65][i]])])close(actual,expected,.0002);
  // This actual "9 mm" engraving crosses the 42 mm Gridfinity boundary. The
  // normal 210 mm batch tiles do not intersect any glyph in this exact layout.
  const label=labels.find(label=>label.toolId==='wrench-3');assert.ok(label.polygons.some(poly=>Math.min(...poly.map(p=>p.y))<42&&Math.max(...poly.map(p=>p.y))>42));
  const prepared=source.tools.map(tool=>({...tool,poly:pocketOutline(tool,source.clearance)})),labelPlan=planSizeLabels(source,source.modules,prepared);
  const clips=[{x:84,y:0,width:42,height:84},{x:84,y:0,width:42,height:42},{x:84,y:42,width:42,height:42}],meshes=clips.map(clip=>buildPrintTriangles(source,source.modules,prepared,{x:84,y:0},{clip,labelPlan}));
  for(const mesh of meshes)validatePrintMesh(mesh);close(trianglesVolume(meshes[1])+trianglesVolume(meshes[2]),trianglesVolume(meshes[0]),.03);assert.equal(JSON.stringify(source),before);
  t.diagnostic(`${result.parts.length} actual Gridfinity parts, ${labels.length} printed labels: ${Math.round(performance.now()-started)}ms`);
});
