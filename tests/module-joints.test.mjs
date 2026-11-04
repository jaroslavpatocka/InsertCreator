// Optional puzzle joints between printed modules: only on shared edges, away from pockets, and watertight in the export.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planJoints} from '../dist/module-joints.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {validateProject,blankProject} from '../dist/model.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const module=(id,x,y,width=84,height=84,extra={})=>({id,name:id,x,y,width,height,locked:true,sizeMode:'manual',...extra});
const tool=(id,moduleId,x,y,w=30,h=30)=>({id,name:id,moduleId,points:rect(w,h),x,y,rotation:0,depth:8,fingerGrips:[]});
const project=(modules,tools=[],extra={})=>({...blankProject(),id:'joints',width:504,height:378,bottomMode:'plain',printMode:'solid',connectors:true,modules,tools,...extra});
const decode=data=>{const bytes=new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let i=0;i<view.getUint32(80,true);i++)out.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));return out;};
const box=mesh=>{const all=mesh.flat(),range=i=>[Math.min(...all.map(p=>p[i])),Math.max(...all.map(p=>p[i]))];return{x:range(0),y:range(1),z:range(2)};};
const exported=async source=>{const result=await preparePrintBatch(source);const meshes=new Map(result.parts.map(part=>[part.moduleId,decode(result.files.find(file=>file.name===part.file).data)]));return{result,meshes};};

test('neighbours get a tab on the left or upper module and a socket on the other',()=>{
  const p=project([module('a',0,0),module('b',84,0),module('c',0,84)]),plan=planJoints(p,p.modules,[]);
  assert.deepEqual(plan.joints.map(j=>[j.owner,j.host]).sort(),[['a','b'],['a','c']]);
  assert.equal(plan.byModule.get('a').tabs.length,2);assert.equal(plan.byModule.get('b').sockets.length,1);
  assert.equal(plan.byModule.get('a').sockets.length,0,'the first module has nothing to be lowered onto');
  assert.equal(plan.skipped,0);
});

test('only touching modules are joined, and longer edges get more joints',()=>{
  const apart=project([module('a',0,0),module('b',126,0)]);
  assert.equal(planJoints(apart,apart.modules,[]).joints.length,0);
  const long=project([module('a',0,0,84,210,{}),module('b',84,0,84,210)],[],{bedWidth:300,bedHeight:300});
  assert.equal(planJoints(long,long.modules,[]).joints.length,2);
});

test('a joint moves away from a pocket and is reported when no place is left',()=>{
  const moved=project([module('a',0,0),module('b',84,0)],[tool('t','b',89,26,30,30)]),plan=planJoints(moved,moved.modules,moved.tools);
  assert.equal(plan.joints.length,1);assert.ok(Math.abs(plan.joints[0].at.y-42)>10,'the middle of the edge is taken');
  const full=project([module('a',0,0),module('b',84,0)],[tool('t','b',89,5,30,74)]),none=planJoints(full,full.modules,full.tools);
  assert.equal(none.joints.length,0);assert.equal(none.skipped,1);
});

test('stepped modules are joined along their real shared edge',()=>{
  const stepped=module('s',0,0,84,84,{cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}),p=project([stepped,module('n',84,0,84,42)]);
  const plan=planJoints(p,p.modules,[]);assert.equal(plan.joints.length,1);assert.equal(plan.joints[0].at.x,84);assert.ok(plan.joints[0].at.y<42);
});

test('Gridfinity and magnet bottoms take no joints, and modules cut for the printer are left out',()=>{
  for(const bottomMode of ['grid','magnet']){const p=project([module('a',0,0),module('b',84,0)],[],{bottomMode}),plan=planJoints(p,p.modules,[]);assert.equal(plan.unsupported,true);assert.equal(plan.joints.length,0);}
  const p=project([module('big',0,0,420,84),module('b',420,0)],[],{bedWidth:220,bedHeight:220});
  assert.equal(planJoints(p,p.modules,[]).joints.length,0);
});

test('a tab that would push the part over the print bed is left out',()=>{
  const p=project([module('a',0,0,210,84),module('b',210,0)],[],{bedWidth:215,bedHeight:90});
  const plan=planJoints(p,p.modules,[]);assert.equal(plan.joints.length,0);assert.equal(plan.skipped,1);
});

for(const printMode of ['solid','light'])test(`${printMode} export is watertight, with the tab only in the base and a socket in the neighbour`,async()=>{
  const p=project([module('a',0,0),module('b',84,0)],[tool('ta','a',20,20),tool('tb','b',122,20)],{printMode}),plain=await exported({...p,connectors:false}),{result,meshes}=await exported(p);
  assert.equal(result.joints,1);assert.equal(result.manifest.joints.count,1);
  for(const mesh of meshes.values())validatePrintMesh(mesh);
  const owner=box(meshes.get('a')),before=box(plain.meshes.get('a'));
  assert.ok(owner.x[1]-before.x[1]>9,'the tab reaches into the neighbour');
  assert.equal(owner.y[1]-owner.y[0],before.y[1]-before.y[0],'nothing grows sideways');
  const tabTop=Math.max(...meshes.get('a').flat().filter(point=>point[0]>before.x[1]+1).map(point=>point[2]));
  assert.ok(Math.abs(tabTop-p.base)<.001,'the tab is as thick as the base');
  assert.ok(meshes.get('b').length>plain.meshes.get('b').length,'the neighbour has a socket');
  assert.equal(box(meshes.get('b')).x[1]-box(meshes.get('b')).x[0],box(plain.meshes.get('b')).x[1]-box(plain.meshes.get('b')).x[0],'a socket does not change the size');
});

test('the socket is larger than the tab by the clearance, so the parts fit together',()=>{
  const p=project([module('a',0,0),module('b',84,0)]),plan=planJoints(p,p.modules,[]),width=path=>Math.max(...path.map(q=>q.y))-Math.min(...path.map(q=>q.y)),reach=path=>Math.max(...path.map(q=>q.x));
  const tab=plan.byModule.get('a').tabs[0],socket=plan.byModule.get('b').sockets[0];
  assert.ok(Math.abs(width(socket)-width(tab)-.4)<.01);assert.ok(Math.abs(reach(socket)-reach(tab)-.2)<.01);
});

test('the option survives saving and is off by default',()=>{
  assert.equal(validateProject({...blankProject(),connectors:true}).connectors,true);
  assert.equal(validateProject(blankProject()).connectors,false);
});

test('with joints on, automatic modules are large enough for a socket clear of every tool on any side',async()=>{
  const {autoArrange,createDemoProject}=await import('../dist/geometry.js');
  const {modulePadding,JOINT_RESERVE}=await import('../dist/module-footprint.js');
  const base=validateProject(createDemoProject());
  assert.equal(modulePadding(base),base.wall+.25,'without joints the margin stays as it was');
  assert.equal(modulePadding({...base,connectors:true}),base.wall+.25+JOINT_RESERVE);
  assert.equal(modulePadding({...base,connectors:true,bottomMode:'grid'}),base.wall+.25,'Gridfinity takes no joints, so no extra margin');
  const big={...base,connectors:true,width:840,height:840},arranged=autoArrange(big),p={...big,tools:arranged.tools,modules:arranged.modules};
  assert.equal(arranged.unplaced.length,0);
  const plan=planJoints(p,p.modules,p.tools);
  assert.ok(plan.joints.length>0);assert.equal(plan.skipped,0,'every wanted joint has its place');
  const off=autoArrange({...big,connectors:false}),area=list=>list.reduce((sum,m)=>sum+m.width*m.height,0);
  assert.ok(area(arranged.modules)>area(off.modules),'the reserve costs space, so it is applied only when asked for');
});

test('the reserve covers the whole socket with its margin',async()=>{
  const {JOINT_RESERVE}=await import('../dist/module-footprint.js');
  const edge=.25,tab=1.5+8,clearance=.2,margin=1.2;
  assert.ok(edge+JOINT_RESERVE>=edge+tab+clearance+margin);
});
