import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {maxPocketDepth,requiredInsertHeight} from '../dist/print-material.js';
import {preparePrintBatch} from '../dist/print-batch.js';

const fixture=(extra={})=>({...blankProject(),width:168,height:126,printMode:'light',modules:[{id:'m',name:'Module',x:0,y:0,width:168,height:126}],tools:[{id:'t',name:'Deep key',moduleId:'m',points:[{x:0,y:0},{x:24,y:0},{x:24,y:20},{x:0,y:20}],x:8,y:8,rotation:0,depth:17.6,fingerGrips:[]}],...extra});

test('plain and disabled floor settings retain the original pocket depth limit',()=>{
  const plain=fixture();assert.equal(maxPocketDepth(plain),17.6);assert.equal(requiredInsertHeight(plain),20);
  for(const multiMaterial of [{enabled:false,floor:true,floorThickness:2},{enabled:true,floor:false,floorThickness:2}]){
    const p=fixture({multiMaterial});assert.equal(maxPocketDepth(p),17.6);assert.equal(requiredInsertHeight(p),20);
  }
});

test('light inlay reserves its thickness and can repair an old maximum-depth pocket without editing it',async()=>{
  const project=fixture({multiMaterial:{enabled:true,floorThickness:.6}}),snapshot=JSON.stringify(project);
  assert.equal(maxPocketDepth(project),17);assert.equal(requiredInsertHeight(project),20.6);
  assert.equal(JSON.stringify(project),snapshot);
  await assert.rejects(preparePrintBatch(project),/Deep key.*hluboká/);
  const repaired={...project,insertHeight:requiredInsertHeight(project)};
  const result=await preparePrintBatch(repaired);
  assert.ok(result.parts.length>0);assert.equal(repaired.tools[0].depth,17.6);
  assert.equal(maxPocketDepth(repaired),17.6);assert.equal(JSON.stringify(project),snapshot);
});

test('solid floors keep valid deep pockets while thin bases account for their floor reserve',async()=>{
  const solid=fixture({printMode:'solid',multiMaterial:{enabled:true,floorThickness:.6}});
  assert.equal(maxPocketDepth(solid),17.6);assert.equal(requiredInsertHeight(solid),20);
  await preparePrintBatch(solid);
  const thin=fixture({printMode:'solid',base:1,multiMaterial:{enabled:true,floorThickness:.6}});thin.tools[0].depth=19;
  assert.equal(maxPocketDepth(thin),18.8);assert.equal(requiredInsertHeight(thin),20.2);
  await assert.rejects(preparePrintBatch(thin),/Deep key.*hluboká/);
  await preparePrintBatch({...thin,insertHeight:requiredInsertHeight(thin)});
});

test('magnet base compensation preserves the light limit and a conservative reserve in solid mode',async()=>{
  for(const printMode of ['light','solid']){
    const p=fixture({printMode,bottomMode:'magnet',multiMaterial:{enabled:true,floorThickness:2}});
    const limit=maxPocketDepth(p);p.tools[0].depth=limit;
    assert.equal(limit,printMode==='light'?15.6:16.2);
    assert.equal(requiredInsertHeight(p),20);
    await preparePrintBatch(p);
  }
});

test('limits reveal impossible shallow inserts and required heights above the saved-model range',()=>{
  assert.equal(maxPocketDepth(fixture({insertHeight:3,base:2.4,multiMaterial:{enabled:true,floorThickness:2}})),0);
  const huge=fixture({base:20,multiMaterial:{enabled:true,floorThickness:2}});huge.tools[0].depth=99;
  assert.equal(requiredInsertHeight(huge),121);
  assert.equal(maxPocketDepth(fixture({insertHeight:100,base:1})),99);
  assert.equal(requiredInsertHeight(fixture(),[]),3);
});

test('required height ignores unplaced pockets and rounds upwards without touching depth data',()=>{
  const p=fixture({multiMaterial:{enabled:true}});p.tools[0].depth=17.6001;p.tools.push({id:'waiting',moduleId:null,depth:99});
  assert.equal(requiredInsertHeight(p),20.61);
  assert.equal(requiredInsertHeight(p,p.tools),102);
  assert.ok(maxPocketDepth({...p,insertHeight:20.61})>=p.tools[0].depth);
  assert.equal(p.tools[0].depth,17.6001);
});

test('empty modules and entirely unplaced tools have no phantom coloured-pocket height requirement',async()=>{
  const p=fixture({insertHeight:3,multiMaterial:{enabled:true,floorThickness:2}});p.tools=[];
  assert.equal(requiredInsertHeight(p),3);
  await preparePrintBatch(p);
  p.tools=[{id:'waiting',name:'Waiting',moduleId:null,depth:99}];
  assert.equal(requiredInsertHeight(p),3);
  assert.equal(requiredInsertHeight(p,[]),3);
});
