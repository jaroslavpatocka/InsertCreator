import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,blankProject} from '../dist/model.js';
import {createDemoProject,autoArrange} from '../dist/geometry.js';
test('JSON round trip retains geometry, locks and metric settings',()=>{
  const p={...createDemoProject(),id:'demo'};p.modules[0].locked=true;p.tools[0].locked=true;
  const restored=validateProject({schemaVersion:1,project:JSON.parse(JSON.stringify(p))});
  assert.deepEqual(restored.tools.map(t=>t.points),p.tools.map(t=>t.points));assert.equal(restored.modules[0].locked,true);assert.equal(restored.clearance,.8);
});
test('invalid, oversized and duplicate-ID imports reject explicitly',()=>{
  assert.throws(()=>validateProject({}),/projekt/);
  assert.throws(()=>validateProject({...blankProject(),width:NaN}),/šířka/);
  const p=createDemoProject();p.tools.push(p.tools[0]);assert.throws(()=>validateProject(p),/Duplicitní/);
  const q=createDemoProject();q.tools[0].points[0].x=Infinity;assert.throws(()=>validateProject(q),/bod X/);
});
test('many unplaced tools remain reloadable without dropping the project',()=>{
  const base=createDemoProject().tools.find(t=>t.id==='tool-screwdriver');
  const p={...blankProject(),width:42,height:42,tools:Array.from({length:80},(_,i)=>({...base,id:'t'+i,moduleId:null,locked:false}))};
  const arranged=autoArrange(p);assert.equal(arranged.unplaced.length,80);
  assert.doesNotThrow(()=>validateProject({...p,...arranged}));
});
