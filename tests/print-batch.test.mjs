import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePrintBatch,buildPrintPart} from '../dist/print-batch.js';
import {blankProject} from '../dist/model.js';
import {exportSTL,zipFiles} from '../dist/geometry.js';
import {buildPrintTriangles,validatePrintMesh,trianglesVolume,encodeSTL} from '../dist/print-geometry.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {catalogSets} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {addToolGroup} from '../dist/set-module.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {magnetPocketCenters} from '../dist/magnet-pockets.js';
import {alignedStitchContour} from './fixtures/stitch-contour.mjs';

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
  const module=source.modules.find(module=>module.id===id),original=decode(exportSTL(source,{moduleId:id,checkBed:false})).map(t=>t.map(p=>[p[0]+module.x,p[1]+source.height-module.y-module.height,p[2]])),assembled=[];
  const parts=result.parts.filter(part=>part.moduleId===id);assert.ok(parts.length);
  for(const part of parts){
    const file=result.files.find(file=>file.name===part.file),mesh=decode(file.data),box=bounds(mesh);validatePrintMesh(mesh);close(box.min[0],0,1e-5);close(box.min[1],0,1e-5);
    assert.ok(box.max[0]<=source.bedWidth+1e-5&&box.max[1]<=source.bedHeight+1e-5);assert.equal(part.offset.z,0);assert.equal(part.assemblyTransform.length,16);assert.equal(part.layoutTransform.length,16);assert.equal(part.count,parts.length);
    assert.equal(part.assemblyTransform[0]*part.assemblyTransform[5]-part.assemblyTransform[1]*part.assemblyTransform[4],1,'physical assembly uses only proper rotations and translation');
    assert.equal(part.layoutTransform[0]*part.layoutTransform[5]-part.layoutTransform[1]*part.layoutTransform[4],-1,'mapping back to screen layout changes coordinate handedness');
    const physicalVertices=transform(mesh,part.assemblyTransform).flat(),layoutVertices=transform(mesh,part.layoutTransform).flat();
    for(let index=0;index<physicalVertices.length;index++){const physical=physicalVertices[index],layout=layoutVertices[index];close(physical[0],layout[0],1e-5);close(physical[1],source.height-layout[1],1e-5);close(physical[2],layout[2],1e-5);}
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
  const box=bounds(assembled);for(const [actual,expected] of [...box.min.map((v,i)=>[v,[.25,source.height-671.75,0][i]]),...box.max.map((v,i)=>[v,[503.75,source.height-.25,25.65][i]])])close(actual,expected,.0002);
  // This actual "9 mm" engraving crosses the 42 mm Gridfinity boundary. The
  // normal 210 mm batch tiles do not intersect any glyph in this exact layout.
  const label=labels.find(label=>label.toolId==='wrench-3');assert.ok(label.polygons.some(poly=>Math.min(...poly.map(p=>p.y))<42&&Math.max(...poly.map(p=>p.y))>42));
  const prepared=source.tools.map(tool=>({...tool,poly:pocketOutline(tool,source.clearance)})),labelPlan=planSizeLabels(source,source.modules,prepared);
  const clips=[{x:84,y:0,width:42,height:84},{x:84,y:0,width:42,height:42},{x:84,y:42,width:42,height:42}],meshes=clips.map(clip=>buildPrintTriangles(source,source.modules,prepared,{x:84,y:0},{clip,labelPlan}));
  for(const mesh of meshes)validatePrintMesh(mesh);close(trianglesVolume(meshes[1])+trianglesVolume(meshes[2]),trianglesVolume(meshes[0]),.03);assert.equal(JSON.stringify(source),before);
  t.diagnostic(`${result.parts.length} actual Gridfinity parts, ${labels.length} printed labels: ${Math.round(performance.now()-started)}ms`);
});

// Count intersections above a point with horizontal surface triangles. At the
// head centre the ray avoids all curve vertices, and double crossings through
// material above a socket correctly leave its base cavity empty.
function materialAt(mesh,[x,y,z]){
  let crossings=0;
  for(const [a,b,c] of mesh){
    if(Math.abs(a[2]-b[2])>1e-5||Math.abs(a[2]-c[2])>1e-5||a[2]<=z+1e-5)continue;
    const cross=(p,q)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]),s=[cross(a,b),cross(b,c),cross(c,a)];
    if(s.every(v=>v>=-1e-8)||s.every(v=>v<=1e-8))crossings++;
  }
  return crossings%2===1;
}

test('an asymmetric pocket has the same handedness as the layout on the actual upper STL surface before and after a print rotation',async()=>{
  const outline=[{x:0,y:0},{x:50,y:0},{x:50,y:12},{x:15,y:12},{x:15,y:80},{x:0,y:80}];
  for(const rotation of [0,90]){
    const module={id:'handed',x:42,y:42,width:84,height:126},tool={id:'L',moduleId:'handed',name:'Asymmetric L',points:outline,x:54,y:60,rotation:0,depth:8,fingerGrips:[]};
    const source=fixture({width:504,height:504,clearance:0,modules:[module],tools:[tool],bedWidth:rotation?150:100,bedHeight:rotation?100:150}),before=JSON.stringify(source),result=await preparePrintBatch(source),part=result.parts[0],mesh=decode(result.files.find(file=>file.name===part.file).data);
    assert.equal(result.parts.length,1);assert.equal(part.rotationForPrinting,rotation);validatePrintMesh(mesh);
    // Independent screen-to-print probes: top-of-layout is +Y on the physical
    // part. Neither assembly matrix nor the manufacturing helper supplies them.
    const stlPoint=([x,y])=>rotation?[y-module.y-.25,x-module.x-.25,19]:[x-module.x-.25,module.y+module.height-.25-y,19];
    assert.equal(materialAt(mesh,stlPoint([tool.x+40.13,tool.y+5.37])),false,'upper-right arm is an open pocket in the physical top view');
    assert.equal(materialAt(mesh,stlPoint([tool.x+40.13,tool.y+74.63])),true,'lower-right region remains material, detecting a whole-model reflection');
    assert.equal(result.manifest.schemaVersion,2);assert.equal(result.manifest.coordinates,'physical-world');assert.deepEqual(result.manifest.layoutSize,{width:source.width,height:source.height});assert.equal(JSON.stringify(source),before);
    assertReassembly(source,result,module.id);
  }
});

test('near-collinear stitch fans retain strict serialized topology after physical normalization and both print rotations',()=>{
  for(const printMode of ['solid','light'])for(const rotation of [0,90]){
    const fixture=structuredClone(alignedStitchContour),module=fixture.module,tool={...fixture.tool,points:fixture.points,moduleId:module.id},source={...blankProject(),...fixture.settings,printMode,bottomMode:'plain',modules:[module],tools:[tool],bedWidth:rotation?600:200,bedHeight:rotation?200:600},before=JSON.stringify(source);
    const part=buildPrintPart(source,module,[{...tool,poly:pocketOutline(tool,source.clearance)}],{key:'numeric-regression',row:0,column:0,clip:null}),mesh=decode(encodeSTL(part.mesh)),edges=new Map();
    assert.equal(part.rotation,rotation);validatePrintMesh(mesh);
    for(const triangle of mesh){
      const keys=triangle.map(point=>point.join(','));assert.equal(new Set(keys).size,3,'a physical Float32 facet must not collapse after the last affine');
      const [a,b,c]=triangle,u=b.map((value,index)=>value-a[index]),v=c.map((value,index)=>value-a[index]);assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-12,'the serialized physical facet retains a real surface');
      for(let index=0;index<3;index++){const a=keys[index],b=keys[(index+1)%3],key=a<b?a+'|'+b:b+'|'+a,edge=edges.get(key)||{count:0,winding:0};edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);}
    }
    for(const edge of edges.values()){assert.equal(edge.count,2,'every actual Float32 edge has exactly two faces without tolerance welding');assert.equal(edge.winding,0);}
    close(trianglesVolume(mesh),trianglesVolume(part.mesh),.05);assert.equal(JSON.stringify(source),before);
  }
});

for(const [width,height,printMode,bottomMode] of [[168,84,'solid','plain'],[84,168,'light','adhesive'],[168,168,'solid','plain'],[168,168,'light','plain']])test(`${printMode} ${bottomMode} ${width} by ${height} cut parts contain real complementary base joints and exact assembly transforms`,async()=>{
  const source=fixture({width:504,height:504,connectors:true,bedWidth:100,bedHeight:100,printMode,bottomMode,modules:[{id:'cut',name:'Cut with puzzle',x:42,y:42,width,height,locked:true}],tools:[]}),before=JSON.stringify(source),result=await preparePrintBatch(source),world=new Map();
  assert.equal(result.parts.length,width===height?4:2);assert.equal(result.manifest.joints.cutCount,width===height?4:1);assert.equal(result.manifest.joints.unjoined.length,0);assert.equal(JSON.stringify(source),before);
  for(const part of result.parts){
    const mesh=decode(result.files.find(file=>file.name===part.file).data),box=bounds(mesh);validatePrintMesh(mesh);
    close(box.min[0],0,1e-5);close(box.min[1],0,1e-5);assert.ok(box.max[0]<=100&&box.max[1]<=100);assert.equal(part.rotationForPrinting,0);
    world.set(part.key,transform(mesh,part.layoutTransform));
  }
  for(const joint of result.manifest.joints.connections){
    const point=[joint.at.x+(joint.axis==='x'?5.77:.137),joint.at.y+(joint.axis==='y'?5.77:.137),source.base/2],owner=world.get(joint.owner),host=world.get(joint.host);
    assert.equal(materialAt(owner,point),true,'the exported male head extends past the original cut');
    assert.equal(materialAt(host,point),false,'the neighbouring exported base has its complementary socket');
    assert.equal(materialAt(owner,[point[0],point[1],source.base+.1]),false,'the tab stops at the base surface');
    if(printMode==='solid')assert.equal(materialAt(host,[point[0],point[1],source.base+.1]),true,'a socket does not remove the upper body');
  }
});

test('cut joints respect awkward bed sizes, rotation, labels and pocket floors, with unchanged source data',async()=>{
  for(const jointClearance of [.1,.3,.5]){
    const source=fixture({width:504,height:504,connectors:true,jointClearance,bedWidth:95,bedHeight:76,printMode:'light',sizeLabels:true,modules:[{id:'awkward',x:42,y:42,width:168,height:126,locked:true}],tools:[{id:'tool',moduleId:'awkward',name:'Tool',points:rectangle(32,22),x:62,y:62,rotation:0,depth:8,sizeLabel:'13',fingerGrips:[]}]}),before=JSON.stringify(source),result=await preparePrintBatch(source);
    assert.ok(result.manifest.joints.cutCount>0);assert.equal(result.manifest.joints.clearance,jointClearance);assert.equal(JSON.stringify(source),before);
    for(const part of result.parts){const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);const box=bounds(mesh);assert.ok(box.max[0]<=95.00001&&box.max[1]<=76.00001);}
  }
});

test('adjustable per-side clearance changes the actual STL socket while leaving its male head fixed',async()=>{
  const widths=[];
  for(const jointClearance of [.1,.3,.5]){
    const source=fixture({width:504,height:504,connectors:true,jointClearance,bedWidth:100,bedHeight:100,modules:[{id:'fit',x:0,y:0,width:168,height:84}],tools:[]}),result=await preparePrintBatch(source),joint=result.manifest.joints.connections[0],world=new Map(result.parts.map(part=>[part.key,transform(decode(result.files.find(file=>file.name===part.file).data),part.layoutTransform)]));
    const at=distance=>[joint.at.x+9.75+distance,joint.at.y+.137,source.base/2],owner=world.get(joint.owner),host=world.get(joint.host);
    assert.equal(materialAt(owner,at(jointClearance-.03)),false,'the male head never grows with clearance');
    assert.equal(materialAt(host,at(jointClearance-.03)),false,'the socket includes the selected radial clearance');
    assert.equal(materialAt(host,at(jointClearance+.05)),true,'material resumes just past the selected socket');
    widths.push(bounds(owner).max[0]);
  }
  assert.deepEqual(widths,[widths[0],widths[0],widths[0]]);
});

test('blocked cut seams remain explicit in assembly and disabled or unsupported connectors preserve ordinary cuts',async()=>{
  const source=fixture({width:504,height:504,connectors:true,bedWidth:100,bedHeight:100,modules:[{id:'blocked',x:0,y:0,width:168,height:84}],tools:[{id:'crossing',moduleId:'blocked',name:'Crosses seam',points:rectangle(40,74),x:70,y:5,rotation:0,depth:8,fingerGrips:[]}]}),before=JSON.stringify(source),result=await preparePrintBatch(source);
  assert.equal(result.manifest.joints.cutCount,0);assert.equal(result.manifest.joints.unjoined.length,1);assert.equal(result.manifest.joints.unjoined[0].reason,'no-safe-site');assert.equal(result.manifest.joints.skipped,1);assert.equal(JSON.stringify(source),before);
  for(const part of result.parts)validatePrintMesh(decode(result.files.find(file=>file.name===part.file).data));
  for(const bottomMode of ['plain','grid']){
    const p={...source,bottomMode,connectors:bottomMode!=='plain',tools:[]},r=await preparePrintBatch(p);
    if(bottomMode==='plain')assert.equal(r.manifest.joints,undefined);else assert.equal(r.manifest.joints.count,0);
    assertReassembly(p,r,'blocked');
  }
});

for(const printMode of ['solid','light'])test(`${printMode} magnetic bottoms retain real puzzle tabs, sockets, blind magnet pockets and their roofs in whole and cut modules`,async()=>{
  const cases=[
    {modules:[{id:'cut',x:42,y:42,width:168,height:168}],bedWidth:100,bedHeight:100},
    {modules:[{id:'stepped',x:42,y:42,width:168,height:168,cells:Array.from({length:4},(_,y)=>Array.from({length:y<2?4:2},(_,x)=>({x,y}))).flat()}],bedWidth:100,bedHeight:100},
    {modules:[{id:'rotate',x:42,y:42,width:252,height:84}],bedWidth:100,bedHeight:150},
    {modules:[{id:'left',x:0,y:0,width:84,height:84},{id:'right',x:84,y:0,width:84,height:84}],bedWidth:100,bedHeight:100}
  ];
  for(const item of cases){
    const tools=item.modules.map(module=>({id:'tool-'+module.id,moduleId:module.id,name:'Tool',points:rectangle(30,30),x:module.x+20,y:module.y+20,rotation:0,depth:8,fingerGrips:[]})),source=fixture({width:504,height:504,...item,tools,printMode,bottomMode:'magnet',connectors:true}),before=JSON.stringify(source),result=await preparePrintBatch(source),world=new Map(),base=Math.max(source.base,source.magnetDepth+1.2);
    assert.ok(result.manifest.joints.count>0);assert.equal(JSON.stringify(source),before);
    for(const part of result.parts){const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);const box=bounds(mesh);assert.ok(box.max[0]<=source.bedWidth+1e-5&&box.max[1]<=source.bedHeight+1e-5);world.set(part.key,transform(mesh,part.layoutTransform));}
    for(const joint of result.manifest.joints.connections){const xy=[joint.at.x+(joint.axis==='x'?5.77:.137),joint.at.y+(joint.axis==='y'?5.77:.137)],owner=world.get(joint.owner),host=world.get(joint.host);assert.equal(materialAt(owner,[...xy,base/2]),true,'the tab survives magnet generation');assert.equal(materialAt(host,[...xy,base/2]),false,'the complementary socket survives magnet generation');assert.equal(materialAt(owner,[...xy,base+.1]),false,'the tab ends at the effective magnetic base height');}
    for(const module of source.modules)for(const center of magnetPocketCenters(source,module)){
      const own=result.parts.filter(part=>part.moduleId===module.id).map(part=>world.get(part.key)),xy=[center.x+.071,center.y+.137];
      assert.equal(own.some(mesh=>materialAt(mesh,[...xy,source.magnetDepth/2])),false,'the actual blind magnet pocket remains empty');
      assert.equal(own.some(mesh=>materialAt(mesh,[...xy,source.magnetDepth+.3])),true,'the roof above the magnet remains solid');
    }
  }
});

test('regular and oversized neighbouring modules export their shared joints together in actual watertight parts',async()=>{
  for(const modules of [[{id:'big',x:0,y:0,width:168,height:84},{id:'b',x:168,y:0,width:84,height:84},{id:'c',x:252,y:0,width:84,height:84}],[{id:'big',x:0,y:0,width:168,height:84},{id:'big2',x:168,y:0,width:168,height:84}]]){
    const source=fixture({width:504,height:504,connectors:true,bedWidth:100,bedHeight:100,modules,tools:[]}),before=JSON.stringify(source),result=await preparePrintBatch(source),world=new Map();
    assert.equal(result.parts.length,4);assert.equal(result.manifest.joints.count,3);assert.equal(result.manifest.joints.unjoined.length,0);
    for(const part of result.parts){const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);const box=bounds(mesh);assert.ok(box.max[0]<=100&&box.max[1]<=100);world.set(part.key,transform(mesh,part.layoutTransform));}
    for(const joint of result.manifest.joints.connections){const point=[joint.at.x+5.77,joint.at.y+.137,source.base/2];assert.equal(materialAt(world.get(joint.owner),point),true);assert.equal(materialAt(world.get(joint.host),point),false);}
    assert.equal(JSON.stringify(source),before);
  }
});

test('parts rotated for a narrow bed retain complementary joints at their exact original world position',async()=>{
  const source=fixture({width:504,height:504,connectors:true,bedWidth:100,bedHeight:150,modules:[{id:'rotate',x:42,y:42,width:252,height:84}],tools:[]}),before=JSON.stringify(source),result=await preparePrintBatch(source),world=new Map();
  assert.equal(result.parts.length,2);assert.equal(result.manifest.joints.cutCount,1);
  for(const part of result.parts){assert.equal(part.rotationForPrinting,90);const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);const box=bounds(mesh);assert.ok(box.max[0]<=100&&box.max[1]<=150);world.set(part.key,transform(mesh,part.layoutTransform));}
  const joint=result.manifest.joints.connections[0],point=[joint.at.x+5.77,joint.at.y+.137,source.base/2];assert.equal(materialAt(world.get(joint.owner),point),true);assert.equal(materialAt(world.get(joint.host),point),false);assert.equal(JSON.stringify(source),before);
});

test('a split stepped body and the module occupying its notch export their reentrant puzzle seams as watertight meshes',async()=>{
  const cells=Array.from({length:4},(_,y)=>Array.from({length:y<2?6:4},(_,x)=>({x,y}))).flat(),source=fixture({width:504,height:504,connectors:true,bedWidth:150,bedHeight:150,modules:[{id:'step',x:0,y:0,width:252,height:168,cells},{id:'notch',x:168,y:84,width:84,height:84}],tools:[]}),before=JSON.stringify(source),result=await preparePrintBatch(source),world=new Map();
  assert.equal(result.parts.length,5);
  for(const part of result.parts){const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);const box=bounds(mesh);assert.ok(box.max[0]<=150&&box.max[1]<=150);world.set(part.key,transform(mesh,part.layoutTransform));}
  const joints=result.manifest.joints.connections.filter(joint=>joint.ownerModuleId==='step'&&joint.hostModuleId==='notch');assert.ok(joints.length>=2);
  for(const joint of joints){const point=[joint.at.x+(joint.axis==='x'?5.77:.137),joint.at.y+(joint.axis==='y'?5.77:.137),source.base/2];assert.equal(materialAt(world.get(joint.owner),point),true);assert.equal(materialAt(world.get(joint.host),point),false);}
  assert.equal(JSON.stringify(source),before);
});

test('a real shared 26-wrench module exports mixed depths, labels and cut joints without exceeding per-part mesh limits',async t=>{
  const set=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm'),tools=set.tools.map((item,index)=>({...catalogTool(item),id:'wrench-'+index,locked:false,moduleId:null}));
  const base={...blankProject(),width:1260,height:840,insertHeight:26,bedWidth:220,bedHeight:220,bottomMode:'plain',printMode:'light',sizeLabels:true,connectors:true};
  const source=addToolGroup(base,tools,{name:'Wrenches 6–32',arrangement:'compact',order:'asc',checkManufacturing:false,toolSet:{id:'wrenches',name:'Wrenches 6–32',layout:'shared'}}).project,before=JSON.stringify(source),started=performance.now(),result=await preparePrintBatch(source);
  assert.equal(result.parts.length,12);assert.ok(result.manifest.joints.cutCount>0);assert.ok(planSizeLabels(source).labels.length>0);assert.equal(JSON.stringify(source),before);
  for(const part of result.parts){const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);assert.ok(mesh.length<=120000);const box=bounds(mesh);assert.ok(box.max[0]<=220&&box.max[1]<=220);}
  t.diagnostic(`${result.parts.length} actual plain-base parts, ${result.manifest.joints.cutCount} cut joints: ${Math.round(performance.now()-started)}ms`);
});
