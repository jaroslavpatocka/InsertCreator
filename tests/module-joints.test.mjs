// Optional puzzle joints between printed modules: only on shared edges, away from pockets, and watertight in the export.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planJoints} from '../dist/module-joints.js';
import {preparePrintBatch,planPrintBatch} from '../dist/print-batch.js';
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

test('cut planning joins both axes of a two by two bed split and uses stable part identities',()=>{
  const p=project([module('big',42,42,168,168)],[],{bedWidth:100,bedHeight:100}),before=JSON.stringify(p),{plans,total,jointPlan}=planPrintBatch(p);
  assert.equal(total,4);assert.equal(jointPlan.cutCount,4);assert.equal(jointPlan.moduleCount,0);assert.equal(jointPlan.skipped,0);
  assert.deepEqual(jointPlan.joints.map(j=>j.axis).sort(),['x','x','y','y']);
  const keys=new Set(plans.flatMap(plan=>plan.tiles.map(tile=>tile.key)));
  for(const joint of jointPlan.joints){assert.ok(keys.has(joint.owner));assert.ok(keys.has(joint.host));assert.notEqual(joint.owner,joint.host);}
  assert.equal(JSON.stringify(p),before);
});

test('cut seams use actual stepped material and report narrow remainders and blocked pockets',()=>{
  const cells=Array.from({length:4},(_,y)=>Array.from({length:y<2?4:2},(_,x)=>({x,y}))).flat();
  const stepped=project([module('step',0,0,168,168,{cells})],[],{bedWidth:100,bedHeight:100}),step=planPrintBatch(stepped);
  assert.equal(step.total,3);assert.equal(step.jointPlan.seams.length,2);assert.equal(step.jointPlan.cutCount,2);
  const narrow=project([module('narrow',0,0,173,84)],[],{bedWidth:100,bedHeight:100}),n=planPrintBatch(narrow).jointPlan;
  assert.equal(n.seams.length,2);assert.equal(n.cutCount,1);assert.equal(n.unjoined.length,1);assert.equal(n.unjoined[0].reason,'no-safe-site');assert.equal(n.skipped,1);
  const blocked=project([module('big',0,0,168,84)],[tool('crossing','big',70,5,40,74)],{bedWidth:100,bedHeight:100}),b=planPrintBatch(blocked).jointPlan;
  assert.equal(b.cutCount,0);assert.equal(b.unjoined.length,1);assert.equal(b.skipped,1);
});

test('socket clearance is per side, while all male shapes and reserved print cuts stay fixed',()=>{
  const p=project([module('big',0,0,168,84)],[],{bedWidth:100,bedHeight:100}),plans=[.1,.3,.5].map(jointClearance=>planPrintBatch({...p,jointClearance}));
  const width=path=>Math.max(...path.map(p=>p.y))-Math.min(...path.map(p=>p.y));
  for(const [index,clearance] of [.1,.3,.5].entries()){
    const result=plans[index],joint=result.jointPlan.joints[0],tab=result.jointPlan.byPart.get(joint.owner).tabs[0],socket=result.jointPlan.byPart.get(joint.host).sockets[0];
    assert.equal(result.jointPlan.cutCount,1);assert.ok(Math.abs(width(socket)-width(tab)-2*clearance)<.01);
    assert.deepEqual(result.plans,plans[0].plans);assert.deepEqual(tab,plans[0].jointPlan.byPart.get(joint.owner).tabs[0]);
  }
  for(const clearance of [.1,.3,.5]){
    const q=project([module('a',0,0),module('b',84,0)],[],{jointClearance:clearance}),r=planJoints(q,q.modules,[]),joint=r.joints[0];
    assert.ok(Math.abs(width(r.byModule.get(joint.host).sockets[0])-width(r.byModule.get(joint.owner).tabs[0])-2*clearance)<.01);
  }
});

test('cut-aware joints also cross original module boundaries and coexist with ordinary module joints',()=>{
  for(const modules of [[module('big',0,0,168,84),module('b',168,0),module('c',252,0)],[module('big',0,0,168,84),module('big2',168,0,168,84)]]){
    const p=project(modules,[],{bedWidth:100,bedHeight:100}),before=JSON.stringify(p),{jointPlan}=planPrintBatch(p);
    assert.equal(jointPlan.joints.length,3);assert.equal(jointPlan.unjoined.length,0);assert.equal(jointPlan.skipped,0);
    assert.ok(jointPlan.joints.some(joint=>joint.ownerModuleId==='big'&&joint.hostModuleId===modules[1].id));
    for(const joint of jointPlan.joints){assert.ok(jointPlan.byPart.get(joint.owner).tabs.length);assert.ok(jointPlan.byPart.get(joint.host).sockets.length);}
    if(modules.length===3){assert.equal(jointPlan.moduleCount,1);const b=jointPlan.byPart.get(JSON.stringify(['b',0,0]));assert.equal(b.tabs.length,1);assert.equal(b.sockets.length,1);}
    assert.equal(JSON.stringify(p),before);
  }
});

test('split stepped modules join neighbours inside a reentrant notch despite overlapping part bounding boxes',()=>{
  const cells=Array.from({length:4},(_,y)=>Array.from({length:y<2?6:4},(_,x)=>({x,y}))).flat();
  const p=project([module('step',0,0,252,168,{cells}),module('notch',168,84,84,84)],[],{bedWidth:150,bedHeight:150}),before=JSON.stringify(p),{jointPlan}=planPrintBatch(p);
  const shared=jointPlan.joints.filter(joint=>joint.ownerModuleId==='step'&&joint.hostModuleId==='notch');
  assert.ok(shared.some(joint=>joint.axis==='x'&&joint.at.x===168&&joint.at.y<126));
  assert.ok(shared.some(joint=>joint.axis==='y'&&joint.at.y===84));
  assert.equal(JSON.stringify(p),before);
});
