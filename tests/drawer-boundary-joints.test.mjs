// Puzzle joints belong only between parts; the drawer's outside perimeter must stay flat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';
import {buildPrintPart,planPrintBatch} from '../dist/print-batch.js';

const module=(id,x,y,width,height,extra={})=>({id,name:id,x,y,width,height,sizeMode:'manual',...extra});
const fixture=(width,height,modules,extra={})=>({...blankProject(),width,height,modules,tools:[],connectors:true,printMode:'solid',bedWidth:220,bedHeight:220,...extra});
function assertInternal(project,plan){
  assert.deepEqual(validateLayout(project),[]);
  for(const joint of plan.jointPlan.joints){
    assert.ok(joint.at.x>0&&joint.at.x<project.width,`joint at outside X: ${JSON.stringify(joint)}`);
    assert.ok(joint.at.y>0&&joint.at.y<project.height,`joint at outside Y: ${JSON.stringify(joint)}`);
  }
  // The warning list also contains only actual shared seams, never drawer walls.
  for(const seam of plan.jointPlan.seams){
    const limit=seam.axis==='x'?project.width:project.height;
    assert.ok(seam.line>0&&seam.line<limit,`outside seam: ${JSON.stringify(seam)}`);
  }
  for(const entry of plan.jointPlan.byPart.values())for(const polygon of [...entry.tabs,...entry.sockets])for(const point of polygon){
    assert.ok(point.x>.1&&point.x<project.width-.1,`connector reaches drawer side at X=${point.x}`);
    assert.ok(point.y>.1&&point.y<project.height-.1,`connector reaches drawer side at Y=${point.y}`);
  }
}

test('one module filling the drawer has no joints or missing-joint warnings on its four outside edges',()=>{
  const project=fixture(168,126,[module('only',0,0,168,126)]),plan=planPrintBatch(project);
  assertInternal(project,plan);
  assert.equal(plan.jointPlan.joints.length,0);
  assert.equal(plan.jointPlan.skipped,0);
  assert.deepEqual(plan.jointPlan.seams,[]);
  assert.deepEqual(plan.jointPlan.unjoined,[]);
});

test('four modules touching every drawer corner join only along their interior boundaries',()=>{
  const project=fixture(168,168,[module('nw',0,0,84,84),module('ne',84,0,84,84),module('sw',0,84,84,84),module('se',84,84,84,84)]),plan=planPrintBatch(project);
  assertInternal(project,plan);
  assert.equal(plan.jointPlan.joints.length,4);
  assert.ok(plan.jointPlan.joints.every(joint=>joint.axis==='x'?joint.at.x===84:joint.at.y===84));
});

test('splitting a full-drawer module adds joints on print seams while preserving every drawer edge',()=>{
  const project=fixture(252,168,[module('whole-drawer',0,0,252,168)],{bedWidth:100,bedHeight:100}),plan=planPrintBatch(project);
  assertInternal(project,plan);
  assert.equal(plan.total,6);
  assert.equal(plan.jointPlan.cutCount,7);
  assert.ok(plan.jointPlan.seams.every(seam=>seam.axis==='x'?[84,168].includes(seam.line):seam.line===84));
});

test('stepped modules at the drawer edges join only across the filled interior notch',()=>{
  const project=fixture(84,84,[module('ell',0,0,84,84,{shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}),module('notch',42,42,42,42)]),plan=planPrintBatch(project);
  assertInternal(project,plan);
  assert.equal(plan.jointPlan.joints.length,2);
  assert.ok(plan.jointPlan.joints.every(joint=>joint.axis==='x'?joint.at.x===42:joint.at.y===42));
});

test('modules against opposite drawer walls receive no connector across an empty gap',()=>{
  const project=fixture(252,84,[module('left',0,0,84,84),module('right',168,0,84,84)]),plan=planPrintBatch(project);
  assertInternal(project,plan);
  assert.equal(plan.jointPlan.joints.length,0);
  assert.equal(plan.jointPlan.skipped,0);
  assert.deepEqual(plan.jointPlan.seams,[]);
});

test('a shifted tiled module against the right and bottom walls still has only internal joints',()=>{
  const project=fixture(294,210,[module('shifted',42,42,252,168)],{bedWidth:100,bedHeight:100}),plan=planPrintBatch(project);
  assertInternal(project,plan);
  assert.equal(plan.jointPlan.cutCount,7);
  assert.ok(plan.jointPlan.seams.every(seam=>seam.axis==='x'?[126,210].includes(seam.line):seam.line===126));
});

test('actual manufactured parts keep all connector vertices within the drawer perimeter',()=>{
  const projects=[
    fixture(168,168,[module('nw',0,0,84,84),module('ne',84,0,84,84),module('sw',0,84,84,84),module('se',84,84,84,84)]),
    fixture(252,168,[module('whole-drawer',0,0,252,168)],{bedWidth:100,bedHeight:100}),
    fixture(294,210,[module('shifted',42,42,252,168)],{bedWidth:100,bedHeight:100})
  ];
  let parts=0;
  for(const project of projects){
    const plan=planPrintBatch(project);
    for(const {module,tiles} of plan.plans)for(const tile of tiles){
      const part=buildPrintPart(project,module,[],tile,{jointPlan:plan.jointPlan}),m=part.layoutTransform;parts++;
      for(const triangle of part.mesh)for(const [x,y] of triangle){
        const layoutX=m[0]*x+m[1]*y+m[3],layoutY=m[4]*x+m[5]*y+m[7];
        assert.ok(layoutX>=.25-1e-5&&layoutX<=project.width-.25+1e-5,`printed part crosses outside X: ${layoutX}`);
        assert.ok(layoutY>=.25-1e-5&&layoutY<=project.height-.25+1e-5,`printed part crosses outside Y: ${layoutY}`);
      }
    }
  }
  assert.equal(parts,16);
});
