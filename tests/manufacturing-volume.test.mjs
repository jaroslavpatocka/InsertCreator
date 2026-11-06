import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {executeManufacturingTask} from '../dist/manufacturing-worker.js';

test('main model volume remains available when export will split a module to fit the bed',async()=>{
  const project={...blankProject(),id:'oversized-volume',width:252,height:168,printMode:'solid',bedWidth:60,bedHeight:60,
    modules:[{id:'m',name:'Modul',x:0,y:0,width:168,height:84,sizeMode:'manual'}],
    tools:[{id:'t',name:'Nástroj',moduleId:'m',x:20,y:20,rotation:0,depth:8,fingerGrips:[],points:[{x:0,y:0},{x:20,y:0},{x:20,y:30},{x:0,y:30}]}]};
  const before=structuredClone(project),exportAnalysis=await executeManufacturingTask('analyze',project,{stats:true});
  assert.equal(exportAnalysis.stats,null);assert.ok(exportAnalysis.bedError);
  const modelAnalysis=await executeManufacturingTask('analyze',project,{stats:true,checkBedForStats:false});
  assert.ok(modelAnalysis.stats.volumeCm3>0);assert.deepEqual(modelAnalysis.issues,[]);assert.ok(modelAnalysis.bedError,'The bed warning remains available to export');
  const fitting=await executeManufacturingTask('analyze',{...project,bedWidth:256,bedHeight:256},{stats:true});
  assert.equal(modelAnalysis.stats.volumeCm3,fitting.stats.volumeCm3);assert.deepEqual(project,before);
});
