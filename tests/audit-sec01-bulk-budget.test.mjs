import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';
import {bulkSetDepth,bulkMoveTools,bulkDelete} from '../dist/bulk-edit.js';

const square=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
const dense=()=>validateProject({...blankProject(),modules:[{id:'m',x:0,y:0,width:210,height:210,sizeMode:'manual'}],tools:Array.from({length:1000},(_,i)=>({id:'t'+i,name:'audit'+i,moduleId:'m',x:20,y:20,points:square,fingerGrips:[]}))},{strict:true});
const isBudgetError=error=>error.i18n?.cs.startsWith('Kontrola sestavy překročila bezpečný limit.');

test('bulk depth edit cannot ignore a global incomplete issue with no affected ids',()=>{
  const project=dense(),before=JSON.stringify(project),issues=validateLayout(project,{affectedIds:['m']});
  assert.equal(issues[0].code,'layout-complexity');assert.deepEqual(issues[0].ids,[]);
  assert.throws(()=>bulkSetDepth(project,['t0'],12),isBudgetError);
  assert.equal(JSON.stringify(project),before,'rejected edit is atomic');
});

test('bulk geometry edit cannot treat the same incomplete old/new layout as safe',()=>{
  const project=dense(),before=JSON.stringify(project);
  assert.throws(()=>bulkMoveTools(project,['t0'],{dx:1,dy:0}),isBudgetError);
  assert.equal(JSON.stringify(project),before,'rejected edit is atomic');
});

test('bulk deletion can recover a complex project when the resulting layout is fully safe',()=>{
  const project=dense(),before=JSON.stringify(project),next=bulkDelete(project,project.tools.map(tool=>tool.id));
  assert.deepEqual(next.tools,[]);assert.deepEqual(next.modules,[]);assert.deepEqual(validateLayout(next),[]);
  assert.equal(JSON.stringify(project),before,'recovery produces a new project');
});
