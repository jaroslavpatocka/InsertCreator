import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';
import {smoothToolContour} from '../dist/tool-contour.js';
import {functionalToolPocket} from '../dist/tool-functional-pocket.js';
import {reshapeModules} from '../dist/space-layout.js';

const square=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
const ratchet=[{x:0,y:0},{x:24,y:0},{x:24,y:20},{x:17,y:20},{x:17,y:65},{x:21,y:65},{x:21,y:110},{x:3,y:110},{x:3,y:65},{x:7,y:65},{x:7,y:20},{x:0,y:20}];
function noisyShaft(){
  const points=[{x:0,y:0},{x:20,y:0}];
  for(let y=1;y<80;y++)points.push({x:20+.22*Math.sin(y*1.8),y});
  points.push({x:20,y:80},{x:0,y:80});
  for(let y=79;y>0;y--)points.push({x:.22*Math.sin(y*1.5),y});
  return points;
}
function dense(points){
  return validateProject({...blankProject(),width:420,height:336,
    modules:[{id:'m',name:'Shared',x:0,y:0,width:252,height:210,sizeMode:'manual',grouped:true}],
    tools:[{id:'target',name:'Target',moduleId:'m',x:40,y:35,depth:8,points},
      ...Array.from({length:1000},(_,i)=>({id:'t'+i,name:'Square '+i,moduleId:'m',x:40,y:35,depth:8,points:square}))]});
}
const incomplete=error=>error?.i18n?.cs?.startsWith('Kontrola sestavy')===true;
test('smoothing refuses an incomplete global layout check before committing a changed outline',()=>{
  const project=dense(noisyShaft()),before=JSON.stringify(project);
  assert.equal(validateLayout(project)[0].code,'layout-complexity');
  assert.throws(()=>smoothToolContour(project,'target'),incomplete);
  assert.equal(JSON.stringify(project),before);
});
test('functional-pocket conversion refuses global complexity instead of filtering its empty IDs',()=>{
  const project=dense(noisyShaft()),before=JSON.stringify(project);
  assert.throws(()=>functionalToolPocket(project,'target','ideal'),incomplete);
  assert.equal(JSON.stringify(project),before);
});
test('module reshaping keeps the original project when the proposed layout cannot be fully checked',()=>{
  const project=dense(square),before=JSON.stringify(project);
  assert.strictEqual(reshapeModules(project,'rectangular'),project);
  assert.equal(JSON.stringify(project),before);
});
