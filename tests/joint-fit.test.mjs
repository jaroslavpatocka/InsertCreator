import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {prepareJointFitTest} from '../dist/joint-fit.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

function decode(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:view.getUint32(80,true)},(_,i)=>Array.from({length:3},(_,j)=>Array.from({length:3},(_,c)=>view.getFloat32(84+i*50+12+j*12+c*4,true))));
}
const worldMesh=(result,id)=>{
  const part=result.parts.find(part=>part.moduleId===id),matrix=part.assemblyTransform;
  return decode(result.files.find(file=>file.name===part.file).data).map(triangle=>triangle.map(([x,y,z])=>[matrix[0]*x+matrix[1]*y+matrix[2]*z+matrix[3],matrix[4]*x+matrix[5]*y+matrix[6]*z+matrix[7],matrix[8]*x+matrix[9]*y+matrix[10]*z+matrix[11]]));
};
function materialAt(triangles,[x,y,z]){
  const heights=[];
  for(const [a,b,c] of triangles){
    const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denominator)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const height=u*a[2]+v*b[2]+w*c[2];if(height>z+1e-5&&!heights.some(value=>Math.abs(value-height)<1e-5))heights.push(height);
  }
  return heights.length%2===1;
}

test('fit test exports two closed production coupons and one mating joint without changing the source',async()=>{
  const source={...blankProject(),name:'Original drawer',width:1200,height:800,base:3.2,bedWidth:50,bedHeight:63,jointClearance:.3,
    printMode:'light',bottomMode:'grid',sizeLabels:true,connectors:false,modules:[{id:'original',x:42,y:42,width:84,height:84}],tools:[{id:'unrelated-source-tool',points:[]}]
  },before=structuredClone(source),result=await prepareJointFitTest(source,{moduleIds:['original']});
  assert.deepEqual(source,before);assert.equal(Object.hasOwn(result,'project'),false);
  assert.equal(result.parts.length,2);assert.equal(result.files.filter(file=>file.name.endsWith('.stl')).length,2);
  assert.equal(result.joints,1);assert.equal(result.manifest.joints.moduleCount,1);assert.equal(result.manifest.joints.cutCount,0);
  assert.equal(result.clearance,.3);assert.equal(result.manifest.joints.clearance,.3);
  assert.deepEqual(result.manifest.bed,{width:50,height:63});
  assert.deepEqual(result.moduleIds,['joint-fit-tab','joint-fit-socket']);
  for(const part of result.parts){
    assert.match(part.file,part.moduleId==='joint-fit-tab'?/tab-clearance-0-3-mm/:/socket-clearance-0-3-mm/);
    const triangles=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(triangles);
    assert.ok(part.bounds.width<=50&&part.bounds.height<=63);assert.ok(Math.abs(part.bounds.heightMm-4.4)<1e-5);
    for(const vertex of triangles.flat()){assert.ok(vertex[0]>=-1e-6&&vertex[1]>=-1e-6);assert.ok(vertex[0]<=50&&vertex[1]<=63);}
  }
  assert.ok(result.parts.find(part=>part.moduleId==='joint-fit-tab').bounds.width>22,'the real male head extends past its nominal body');
  assert.deepEqual(JSON.parse(result.files.find(file=>file.name==='assembly.json').data),result.manifest);
});

test('the test socket physically grows with clearance while its mating tab remains identical',async()=>{
  const source=blankProject(),tight=await prepareJointFitTest({...source,jointClearance:.1}),loose=await prepareJointFitTest({...source,jointClearance:.4});
  const file=(result,id)=>result.files.find(file=>file.name===result.parts.find(part=>part.moduleId===id).file).data;
  assert.deepEqual(file(tight,'joint-fit-tab'),file(loose,'joint-fit-tab'),'clearance changes only the female opening');
  assert.ok(loose.parts.find(part=>part.moduleId==='joint-fit-socket').volumeMm3<tight.parts.find(part=>part.moduleId==='joint-fit-socket').volumeMm3);
  const [joint]=tight.manifest.joints.connections,point=[joint.at.x+5.75,42-(joint.at.y+4.25),source.base/2];
  assert.equal(materialAt(worldMesh(tight,'joint-fit-socket'),point),true,'0.1 mm retains material just outside the socket head');
  assert.equal(materialAt(worldMesh(loose,'joint-fit-socket'),point),false,'0.4 mm removes that material in the actual exported STL');
});

test('a magnet fit coupon matches the raised production base and tab height',async()=>{
  const source={...blankProject(),bottomMode:'magnet',base:2.4,magnetDepth:3.2},before=structuredClone(source),result=await prepareJointFitTest(source);
  const joint=result.manifest.joints.connections[0],mesh=worldMesh(result,'joint-fit-tab'),x=joint.at.x+5.77,y=42-joint.at.y-.137;
  assert.equal(materialAt(mesh,[x,y,4.3]),true,'the tab reaches the same effective 4.4 mm base as the magnet model');
  assert.equal(materialAt(mesh,[x,y,4.5]),false,'the tab stops at the production base height');
  assert.deepEqual(source,before);
});

test('coupon preparation keeps normal printer validation, default clearance and cancellation',async()=>{
  for(const base of [1,20]){
    const result=await prepareJointFitTest({...blankProject(),base,bedWidth:50,bedHeight:50});
    assert.equal(result.clearance,.2);assert.equal(result.parts.length,2);
    assert.ok(result.parts.every(part=>Math.abs(part.bounds.heightMm-Math.max(3,base+1.2))<1e-5));
  }
  for(const patch of [{base:0},{base:21},{base:NaN},{bedWidth:49},{bedHeight:Infinity},{jointClearance:-.1},{jointClearance:1.1},{jointClearance:NaN}]){
    await assert.rejects(()=>prepareJointFitTest({...blankProject(),...patch}));
  }
  const source={...blankProject(),jointClearance:.2},before=structuredClone(source),controller=new AbortController();controller.abort();
  await assert.rejects(()=>prepareJointFitTest(source,{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(source,before);
});
