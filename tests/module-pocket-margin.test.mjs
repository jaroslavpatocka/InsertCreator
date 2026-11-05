import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareModuleMargins,applyCreatedModuleMargins} from '../dist/module-margin.js';
import {effectivePocketMargin} from '../dist/pocket-margin.js';

const points=[{x:0,y:0},{x:12,y:0},{x:12,y:40},{x:0,y:40}];
const base=()=>({clearance:.8,modules:[{id:'old',pocketMargin:.3}],tools:[{id:'old-tool',moduleId:'old',points}]});
test('one creation margin belongs to new modules while per-tool zero and other overrides survive',()=>{
  const project=base(),incoming=[{id:'inherit',points},{id:'zero',points,pocketMargin:0},{id:'custom',points,pocketMargin:2}],before=structuredClone({project,incoming});
  const prepared=prepareModuleMargins(project,incoming,1.2);
  assert.deepEqual(prepared.tools.map(tool=>tool.pocketMargin),[1.2,0,2]);
  const packed={...project,modules:[...project.modules,{id:'new-a'},{id:'new-b'}],tools:[...project.tools,...prepared.tools.map((tool,index)=>({...tool,moduleId:index===2?'new-b':'new-a'}))]};
  const next=applyCreatedModuleMargins(packed,prepared.plan);
  assert.equal(next.clearance,.8);assert.deepEqual(next.modules[0],project.modules[0]);assert.deepEqual(next.tools[0],project.tools[0]);
  assert.deepEqual(next.modules.slice(1).map(module=>module.pocketMargin),[1.2,1.2]);
  assert.equal(Object.hasOwn(next.tools[1],'pocketMargin'),false);assert.equal(next.tools[2].pocketMargin,0);assert.equal(next.tools[3].pocketMargin,2);
  assert.deepEqual(next.tools.map(tool=>effectivePocketMargin(tool,next)),[.3,1.2,0,2]);
  assert.deepEqual({project,incoming},before);assert.equal(packed.modules[1].pocketMargin,undefined,'finalization never mutates the planner result');
});
test('existing modules never acquire the creation margin and an unplaced tool retains its intended pocket size',()=>{
  const project=base(),prepared=prepareModuleMargins(project,[{id:'mixed',points},{id:'unplaced',points}],1.7);
  const next=applyCreatedModuleMargins({...project,tools:[...project.tools,{...prepared.tools[0],moduleId:'old'},{...prepared.tools[1],moduleId:null}]},prepared.plan);
  assert.deepEqual(next.modules,project.modules);assert.deepEqual(next.tools.map(tool=>effectivePocketMargin(tool,next)),[.3,1.7,1.7]);
});
test('a later module starts independently and zero is a valid shared margin',()=>{
  const project=base(),first=prepareModuleMargins(project,[{id:'first',points}],3),second=prepareModuleMargins(project,[{id:'second',points}],0);
  assert.equal(first.tools[0].pocketMargin,3);assert.equal(second.tools[0].pocketMargin,0);assert.equal(project.clearance,.8);
  for(const invalid of [-1,11,NaN,Infinity,'1',true,null])assert.throws(()=>prepareModuleMargins(project,[{id:'invalid',points}],invalid));
});
