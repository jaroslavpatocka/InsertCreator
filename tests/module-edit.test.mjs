import test from 'node:test';
import assert from 'node:assert/strict';
import {moveModule,rotateModule,duplicateModule} from '../dist/module-edit.js';
import {blankProject,validateProject,clone} from '../dist/model.js';
import {bounds,validateLayout} from '../dist/geometry.js';

const points=[{x:0,y:0},{x:20,y:0},{x:20,y:80},{x:0,y:80}];
const fixture=()=>validateProject({...blankProject(),width:840,height:630,limitToBed:true,bedWidth:220,bedHeight:220,
  modules:[{id:'source',name:'Sada',x:42,y:42,width:294,height:168,sizeMode:'manual',grouped:true,setId:'set',setLayout:'shared',unit:'in'},
    {id:'filler',name:'Výplň',x:420,y:0,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'one',name:'Klíč 10',x:75,y:80},{id:'two',name:'Klíč 13',x:205,y:80}].map(tool=>({...tool,points:clone(points),moduleId:'source',rotation:0,depth:8,unit:'mm',fingerGrips:[{id:tool.id+'-grip',x:1.2,y:40,radius:8}]})),
  toolSets:[{id:'set',name:'Sada klíčů',toolIds:['one','two'],layout:'shared',arrangement:'ordered',order:'asc'}]});
const own=(project,moduleId)=>project.tools.filter(tool=>tool.moduleId===moduleId);
const valid=project=>assert.deepEqual(validateLayout(project),[]);
const immutable=(project,before)=>assert.deepEqual(project,before);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('absolute module movement includes every pocket and preserves all relative positions and printer settings',()=>{
  const project=fixture(),before=clone(project);valid(project);
  const next=moveModule(project,'source',{x:84,y:126});valid(next);
  assert.deepEqual([next.modules[0].x,next.modules[0].y],[84,126]);
  for(const tool of next.tools){const old=project.tools.find(item=>item.id===tool.id);assert.equal(tool.x-old.x,42);assert.equal(tool.y-old.y,84);assert.deepEqual(tool.points,old.points);assert.deepEqual(tool.fingerGrips,old.fingerGrips);}
  assert.deepEqual(next.modules[1],before.modules[1]);assert.deepEqual(next.toolSets,before.toolSets);
  assert.deepEqual([next.limitToBed,next.bedWidth,next.bedHeight],[true,220,220]);immutable(project,before);
});

test('whole-module quarter turns preserve its top-left, real local geometry, members and four-turn round trip',()=>{
  const project=fixture(),before=clone(project),turned=rotateModule(project,'source');valid(turned);
  assert.deepEqual([turned.modules[0].x,turned.modules[0].y,turned.modules[0].width,turned.modules[0].height],[42,42,168,294]);
  assert.deepEqual(turned.modules[1],project.modules[1]);assert.deepEqual(turned.toolSets,project.toolSets);
  assert.deepEqual(turned.tools.map(tool=>tool.rotation),[90,90]);
  for(const tool of turned.tools){const old=project.tools.find(item=>item.id===tool.id);assert.deepEqual(tool.points,old.points);assert.deepEqual(tool.fingerGrips,old.fingerGrips);assert.equal(tool.depth,old.depth);}
  let next=project;for(let i=0;i<4;i++)next=rotateModule(next,'source');
  assert.deepEqual(next.modules,project.modules);
  for(const tool of next.tools){const old=project.tools.find(item=>item.id===tool.id);close(tool.x,old.x);close(tool.y,old.y);assert.equal(tool.rotation,old.rotation);}
  valid(next);immutable(project,before);
});

test('module errors, collisions, invalid angles and locked members reject atomically',()=>{
  for(const command of [project=>moveModule(project,'source',{x:800,y:0}),project=>moveModule(project,'source',{x:NaN,y:0}),project=>rotateModule(project,'source',45)]){
    const project=fixture(),before=clone(project);assert.throws(()=>command(project));immutable(project,before);
  }
  const collision=fixture();collision.tools.push({...clone(collision.tools[0]),id:'blocker',name:'Blocker',moduleId:'filler',x:453,y:20,points:[{x:0,y:0},{x:20,y:0},{x:20,y:30},{x:0,y:30}],fingerGrips:[]});
  valid(collision);const collisionBefore=clone(collision);
  assert.throws(()=>moveModule(collision,'source',{x:420,y:0}),/překrývají|stěnu/);immutable(collision,collisionBefore);
  for(const lock of ['module','tool']){
    const project=fixture();if(lock==='module')project.modules[0].locked=true;else project.tools[0].locked=true;
    const before=clone(project);assert.throws(()=>moveModule(project,'source',{x:84,y:42}),/odemkněte/);assert.throws(()=>rotateModule(project,'source'),/odemkněte/);immutable(project,before);
  }
  const project=fixture(),same=moveModule(project,'source',{x:42,y:42}),zero=rotateModule(project,'source',360);
  assert.deepEqual(same,project);assert.notEqual(same,project);assert.deepEqual(zero,project);assert.notEqual(zero,project);
});

test('duplication copies full-set metadata with fresh IDs and independent contours while retaining a locked original',()=>{
  const project=fixture();project.modules[0].locked=true;project.tools[0].locked=true;const before=clone(project);
  const next=duplicateModule(project,'source'),copy=next.modules.at(-1),tools=own(next,copy.id);valid(next);
  assert.notEqual(copy.id,'source');assert.equal(copy.locked,false);assert.match(copy.name,/kopie/);assert.equal(copy.unit,'in');
  assert.deepEqual(next.modules.slice(0,-1),project.modules);assert.deepEqual(next.tools.slice(0,project.tools.length),project.tools);
  assert.equal(tools.length,2);assert.ok(tools.every(tool=>tool.locked===false&&!project.tools.some(old=>old.id===tool.id)));
  const set=next.toolSets.at(-1);assert.notEqual(set.id,'set');assert.equal(copy.setId,set.id);assert.equal(copy.setLayout,'shared');
  assert.deepEqual(set.toolIds,tools.map(tool=>tool.id));assert.equal(set.arrangement,'ordered');assert.equal(set.order,'asc');
  for(let i=0;i<tools.length;i++){
    assert.deepEqual(tools[i].points,project.tools[i].points);assert.notEqual(tools[i].points,next.tools[i].points,'copies must not alias original contours');
    assert.notEqual(tools[i].fingerGrips,next.tools[i].fingerGrips);assert.notEqual(tools[i].fingerGrips[0].id,project.tools[i].fingerGrips[0].id);
    assert.equal(tools[i].depth,project.tools[i].depth);assert.equal(tools[i].fingerGrips[0].radius,8);
    close(tools[i].x-copy.x,project.tools[i].x-project.modules[0].x);close(tools[i].y-copy.y,project.tools[i].y-project.modules[0].y);
  }
  tools[0].points[0].x=5;assert.equal(next.tools[0].points[0].x,0);immutable(project,before);
});

test('a partial set copy is unassigned and a full drawer refuses duplication without side effects',()=>{
  const project=fixture();project.toolSets[0].toolIds.push('outside');project.tools.push({...clone(project.tools[0]),id:'outside',moduleId:'filler',x:445,y:5,points:[{x:0,y:0},{x:20,y:0},{x:20,y:30},{x:0,y:30}],fingerGrips:[]});
  const next=duplicateModule(project,'source'),copy=next.modules.at(-1);valid(next);
  assert.equal(copy.setId,undefined);assert.equal(copy.setLayout,undefined);assert.deepEqual(next.toolSets,project.toolSets);
  const full={...fixture(),width:336,height:210,modules:[fixture().modules[0]]},before=clone(full);
  assert.throws(()=>duplicateModule(full,'source'),/volné místo/);immutable(full,before);
});

test('blank modules, unrelated errors and Gridfinity grid constraints are handled independently of bed dimensions',()=>{
  const project=fixture(),before=clone(project);const moved=moveModule(project,'filler',{x:420,y:126});valid(moved);assert.deepEqual(moved.tools,project.tools);
  const rotated=rotateModule(project,'filler');assert.deepEqual(rotated.tools,project.tools);valid(rotated);
  const copied=duplicateModule(project,'filler');valid(copied);assert.equal(own(copied,copied.modules.at(-1).id).length,0);
  const invalid=fixture();invalid.modules.push({id:'bad',name:'Mimo',x:900,y:0,width:42,height:42,sizeMode:'manual'});
  const edited=moveModule(invalid,'source',{x:84,y:126});assert.ok(validateLayout(edited).every(issue=>issue.ids.includes('bad')));
  const grid={...fixture(),bottomMode:'grid'};valid(moveModule(grid,'source',{x:84,y:84}));assert.throws(()=>moveModule(grid,'source',{x:85,y:84}),/násobcích 42/);
  immutable(project,before);
});
