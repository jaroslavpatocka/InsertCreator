import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkRotate,bulkMove,bulkDelete,bulkSetDepth,bulkLock} from '../dist/bulk-edit.js';
import {blankProject,clone,validateProject} from '../dist/model.js';
import {bounds,validateLayout} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';
import {setCoherence} from '../dist/tool-sets.js';

const points=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const module=(id,x=0,y=0,extra={})=>({id,name:id,x,y,width:126,height:126,sizeMode:'manual',locked:false,...extra});
const tool=(id,moduleId,x=40,y=20,extra={})=>({id,name:id,moduleId,x,y,points:points(20,60),rotation:0,depth:8,locked:false,...extra});
const drawer=()=>validateProject({...blankProject(),width:588,height:420,limitToBed:false,modules:[module('a'),module('b',168)],tools:[tool('one','a'),tool('two','b',208)]});
const unchanged=(source,before)=>assert.deepEqual(source,before,'source was not mutated');
const assertValid=p=>assert.deepEqual(validateLayout(p),[]);

test('bulk rotate all and subset keeps manual dimensions, outline centres, depths and units',()=>{
  const p=drawer();p.unit='in';p.tools[0].unit='mm';p.modules[0].unit='in';const before=clone(p);
  const one=bulkRotate(p,['one']),all=bulkRotate(p,new Set(['one','two']));
  assert.equal(one.tools[0].rotation,90);assert.equal(one.tools[1].rotation,0);
  assert.deepEqual(one.modules,p.modules,'manual footprint preserved');
  for(const t of all.tools){const b=bounds(t),old=bounds(p.tools.find(x=>x.id===t.id));assert.ok(Math.abs(b.x+b.width/2-old.x-old.width/2)<1e-7);assert.ok(Math.abs(b.y+b.height/2-old.y-old.height/2)<1e-7);assert.equal(t.depth,8);assert.equal(t.rotation,90);}
  assert.equal(all.unit,'in');assert.equal(all.tools[0].unit,'mm');assert.deepEqual(all.tools[0].points,p.tools[0].points);assertValid(one);assertValid(all);unchanged(p,before);
});

test('automatic rotated modules resize safely and manual ones stay fixed',()=>{
  const p=drawer();p.modules[0].sizeMode='auto';const before=clone(p);
  const next=bulkRotate(p,['one']);assert.equal(next.modules[0].width,84);assert.equal(next.modules[0].height,42);assert.equal(next.modules[0].sizeMode,'auto');assertValid(next);unchanged(p,before);
});

test('rotation fails atomically if a manual footprint cannot contain the result',()=>{
  const p=drawer();p.modules[0].width=42;p.tools[0].x=10;const before=clone(p);assertValid(p);
  assert.throws(()=>bulkRotate(p,['one','two']),error=>!!error.i18n);unchanged(p,before);
});

test('rotating a partial shared group rejects a pocket collision without rotating any other selected tool',()=>{
  const p=drawer();p.modules[0].grouped=true;p.tools.push(tool('sibling','a',70,20));const before=clone(p);assertValid(p);
  assert.throws(()=>bulkRotate(p,['one','two']),error=>!!error.i18n);unchanged(p,before);
});

test('shared module moves every sibling and preserves their relative geometry even for a partial selection',()=>{
  const p=drawer();p.modules[0].grouped=true;p.tools.push(tool('sibling','a',70,20));const before=clone(p);
  const next=bulkMove(p,['one'],{dx:0,dy:84});
  assert.equal(next.modules[0].y,84);assert.equal(next.tools.find(t=>t.id==='one').y,104);assert.equal(next.tools.find(t=>t.id==='sibling').y,104);
  assert.deepEqual(next.tools.find(t=>t.id==='two'),p.tools.find(t=>t.id==='two'));
  for(const t of next.tools.filter(t=>t.moduleId==='a')){const old=p.tools.find(x=>x.id===t.id);assert.deepEqual(t.points,old.points);assert.equal(t.x,old.x);assert.equal(t.rotation,old.rotation);}
  assertValid(next);unchanged(p,before);
});

test('moving all selected modules is checked in the final state; collisions and leaving the drawer roll back',()=>{
  const p=drawer(),before=clone(p);
  const next=bulkMove(p,['one','two'],{dx:168,dy:0});assertValid(next);assert.equal(next.modules[0].x,168);assert.equal(next.modules[1].x,336);
  for(const vector of [{dx:168,dy:0},{dx:-42,dy:0},{dx:0,dy:420}]){assert.throws(()=>bulkMove(p,['one'],vector),error=>!!error.i18n);unchanged(p,before);}
});

test('any locked touched module or sibling prevents move and rotate for the whole selection',()=>{
  for(const lock of ['module','tool','sibling']){
    const p=drawer();if(lock==='module')p.modules[1].locked=true;else if(lock==='tool')p.tools[1].locked=true;else p.tools.push(tool('locked sibling','a',70,20,{locked:true}));
    const before=clone(p);
    assert.throws(()=>bulkMove(p,['one','two'],{dx:0,dy:42}),/odemkněte/);assert.throws(()=>bulkRotate(p,['one','two']),/odemkněte/);unchanged(p,before);
  }
});

test('lock and unlock expand to every pocket in the touched module',()=>{
  const p=drawer();p.tools.push(tool('sibling','a',70,20));const before=clone(p);
  const locked=bulkLock(p,['one'],true);
  assert.equal(locked.modules[0].locked,true);assert.ok(locked.tools.filter(t=>t.moduleId==='a').every(t=>t.locked));assert.equal(locked.modules[1].locked,false);assert.equal(locked.tools[1].locked,false);
  const unlocked=bulkLock(locked,['sibling'],false);assert.deepEqual(unlocked,p);unchanged(p,before);
});

test('depth changes only selected tools, permits position locks and rejects every invalid depth atomically',()=>{
  const p=drawer();p.modules[0].locked=true;p.tools[0].locked=true;const before=clone(p);
  const next=bulkSetDepth(p,['one'],12.7);assert.equal(next.tools[0].depth,12.7);assert.equal(next.tools[1].depth,8);assert.deepEqual(next.modules,p.modules);assertValid(next);
  for(const depth of [0,.49,18,NaN,Infinity,null,true]){assert.throws(()=>bulkSetDepth(p,['one','two'],depth),error=>!!error.i18n);unchanged(p,before);}
  assert.equal(bulkSetDepth(p,['one'],p.insertHeight-p.base).tools[0].depth,p.insertHeight-p.base);
});

test('delete selected tools cleans set membership and metadata, removes only newly empty modules, preserves blanks',()=>{
  const p=drawer();p.modules.push(module('blank',336));p.modules[0].grouped=true;p.tools.push(tool('sibling','a',70,20));
  p.toolSets=[{id:'shared',name:'Shared',toolIds:['one','sibling'],layout:'shared'},{id:'single',name:'Single',toolIds:['two'],layout:'auto'}];
  Object.assign(p.modules[0],{setId:'shared',setLayout:'shared'});Object.assign(p.modules[1],{setId:'single',setLayout:'uniform',locked:true});p.tools[1].locked=true;const before=clone(p);
  const next=bulkDelete(p,['one','two']);assert.deepEqual(next.tools.map(t=>t.id),['sibling']);assert.deepEqual(next.modules.map(m=>m.id),['a','blank']);assert.deepEqual(next.toolSets,[{id:'shared',name:'Shared',toolIds:['sibling'],layout:'shared'}]);assert.equal(next.modules[0].setId,'shared');assertValid(next);unchanged(p,before);
  const empty=bulkDelete(next,['sibling']);assert.deepEqual(empty.modules.map(m=>m.id),['blank']);assert.deepEqual(empty.toolSets,[]);assertValid(empty);
});

test('delete does not discard an unrelated empty filler with set metadata from a legacy project',()=>{
  const p=drawer();p.modules.push(module('blank',336,0,{setId:'old',setLayout:'shared'}));p.toolSets=[{id:'old',name:'Old',toolIds:['one'],layout:'shared'}];
  const next=bulkDelete(p,['one']);const blank=next.modules.find(m=>m.id==='blank');assert.ok(blank);assert.equal(blank.setId,undefined);assert.equal(blank.setLayout,undefined);assert.deepEqual(next.toolSets,[]);
});

test('uniform sets remain uniform when all rotate together and release to auto after a partial rotation',()=>{
  const src={...blankProject(),width:588,height:420,limitToBed:false};
  const p=addToolGroup(src,[tool('one',null,0,0),tool('two',null,0,0)],{toolSet:{id:'uniform',name:'Set',layout:'uniform'}}).project;
  assertValid(p);assert.deepEqual(setCoherence(p,p.toolSets).satisfied,['uniform']);
  // Manual square footprints leave room for either heading without moving neighbours.
  p.modules.forEach((m,i)=>Object.assign(m,{x:i*168,y:0,width:126,height:126,sizeMode:'manual'}));p.tools.forEach((t,i)=>Object.assign(t,{x:i*168+40,y:20,rotation:0}));
  const all=bulkRotate(p,['one','two']);assert.equal(all.toolSets[0].layout,'uniform');assert.deepEqual(setCoherence(all,all.toolSets).satisfied,['uniform']);
  const part=bulkRotate(p,['one']);assert.equal(part.toolSets[0].layout,'auto');assert.equal(p.toolSets[0].layout,'uniform');assertValid(part);
});

test('unrelated existing geometry or depth errors do not prevent editing a valid selection',()=>{
  const p=drawer();p.modules.push(module('invalid',600));p.tools.push(tool('invalid tool','invalid',620,20,{depth:40}));const before=clone(p);
  const moved=bulkMove(p,['one'],{dx:0,dy:42});assert.equal(moved.modules[0].y,42);
  const depth=bulkSetDepth(p,['one'],10);assert.equal(depth.tools[0].depth,10);assert.equal(depth.tools.at(-1).depth,40);unchanged(p,before);
});

test('automatic rotation preserves an existing depth warning rather than changing or blocking it',()=>{
  const p=drawer();p.modules[0].sizeMode='auto';p.tools[0].depth=40;const before=clone(p);
  const next=bulkRotate(p,['one']);assert.equal(next.tools[0].rotation,90);assert.equal(next.tools[0].depth,40);
  assert.deepEqual(validateLayout(next).map(i=>i.type),['depth']);unchanged(p,before);
});

test('invalid selections and vectors fail without mutation; empty selection returns an independent copy',()=>{
  const p=drawer(),before=clone(p);
  for(const action of [()=>bulkMove(p,['missing'],{dx:0,dy:1}),()=>bulkMove(p,['one'],{dx:NaN,dy:0}),()=>bulkRotate(p,['one'],Infinity),()=>bulkLock(p,['one'],'yes'),()=>bulkDelete(p,null)])assert.throws(action,error=>!!error.i18n);
  const empty=bulkRotate(p,[]);assert.deepEqual(empty,p);assert.notEqual(empty,p);unchanged(p,before);
});

test('Gridfinity move keeps its metric 42 mm grid regardless of displayed inches',()=>{
  const p=drawer();p.unit='in';p.bottomMode='grid';const before=clone(p);
  assertValid(bulkMove(p,['one','two'],{dx:0,dy:42}));assert.throws(()=>bulkMove(p,['one'],{dx:0,dy:25.4}),/násobcích 42/);unchanged(p,before);
});
