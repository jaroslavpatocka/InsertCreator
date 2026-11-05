import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalToolPocket,pocketFitSignature} from '../dist/tool-functional-pocket.js';
import {fitHybridPocket} from '../dist/functional-pocket.js';
import {blankProject,clone,validateProject} from '../dist/model.js';
import {transformedPoints,validateLayout} from '../dist/geometry.js';

const source=[{x:0,y:0},{x:24,y:0},{x:24,y:20},{x:17,y:20},{x:17,y:65},{x:21,y:65},{x:21,y:110},{x:3,y:110},{x:3,y:65},{x:7,y:65},{x:7,y:20},{x:0,y:20}];
function drawer(){return validateProject({...blankProject(),width:420,height:336,
  modules:[{id:'shared',name:'Tools',x:0,y:0,width:252,height:210,sizeMode:'manual',grouped:true}],
  tools:[{id:'target',name:'Ratchet',points:source,x:40,y:35,rotation:37,depth:8,moduleId:'shared',fingerGrips:[{id:'bay',x:17,y:50,radius:5}],sizeLabel:'13'},
    {id:'other',name:'Other',points:[{x:0,y:0},{x:12,y:0},{x:12,y:60},{x:0,y:60}],x:190,y:35,rotation:0,depth:8,moduleId:'shared',fingerGrips:[]}]});}
function world(tool,point){
  const angle=tool.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rotate=p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}),all=tool.points.map(rotate),q=rotate(point);
  return{x:q.x-Math.min(...all.map(p=>p.x))+tool.x,y:q.y-Math.min(...all.map(p=>p.y))+tool.y};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('saved geometric pocket retains the photo frame, manual finger bay, module, siblings and metadata',()=>{
  for(const rotation of [0,37,90,183]){
    const project=drawer();project.tools[0].rotation=rotation;const before=clone(project),fit=fitHybridPocket(source),next=functionalToolPocket(project,'target');
    assert.deepEqual(project,before);assert.deepEqual(next.modules,project.modules);assert.deepEqual(next.tools[1],project.tools[1]);
    const points=transformedPoints(next.tools[0]);assert.equal(points.length,fit.points.length);
    points.forEach((p,i)=>{const expected=world(project.tools[0],fit.points[i]);close(p.x,expected.x);close(p.y,expected.y);});
    const a=world(project.tools[0],project.tools[0].fingerGrips[0]),b=world(next.tools[0],next.tools[0].fingerGrips[0]);close(a.x,b.x);close(a.y,b.y);
    for(const key of ['id','name','rotation','depth','moduleId','sizeLabel'])assert.deepEqual(next.tools[0][key],project.tools[0][key]);
    assert.deepEqual(validateLayout(next),[]);
    assert.deepEqual(validateProject(next),next,'saved/JSON geometry survives validation');
  }
});

test('saved pocket conversion enforces tool/module locks and missing selections atomically',()=>{
  for(const lock of ['tool','module']){const project=drawer();if(lock==='tool')project.tools[0].locked=true;else project.modules[0].locked=true;const before=clone(project);assert.throws(()=>functionalToolPocket(project,'target'),/odemkněte/);assert.deepEqual(project,before);}
  assert.throws(()=>functionalToolPocket(drawer(),'missing'),/neexistuje/);
});

test('reapplying a saved geometric pocket does not grow it or move its manual grip',()=>{
  const project=drawer(),once=functionalToolPocket(project,'target');
  let current=once;
  for(let i=0;i<10;i++)current=functionalToolPocket(current,'target');
  assert.deepEqual(current,once,'a regular pocket must be stable under repeated conversion');
});

test('generated pocket marker survives JSON, and a later shape edit invalidates it',()=>{
  const input=drawer();input.tools[0].points[1].x+=.31;
  const once=functionalToolPocket(input,'target');
  const restored=validateProject(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(restored.tools[0].pocketFit,once.tools[0].pocketFit);
  assert.deepEqual(functionalToolPocket(restored,'target'),restored);
  const edited=clone(restored),tool=edited.tools[0];tool.points[0].x+=.31;
  assert.notEqual(tool.pocketFit.signature,pocketFitSignature(tool.points));
  const next=functionalToolPocket(edited,'target');
  assert.equal(next.tools[0].pocketFit.signature,pocketFitSignature(next.tools[0].points));
  assert.notDeepEqual(next.tools[0].points,edited.tools[0].points,'modified geometry must be recomputed');
  for(const invalid of [{mode:'invalid',signature:'12345678'},{mode:'hybrid',signature:'spoof'},null]){
    const project=clone(restored);project.tools[0].pocketFit=invalid;
    assert.equal(Object.hasOwn(validateProject(project).tools[0],'pocketFit'),false);
  }
});

test('unsafe geometric expansion fails without moving an existing neighbour or enlarging the module',()=>{
  const project=drawer(),tool=project.tools[0];tool.rotation=0;tool.fingerGrips=[];tool.x=40;tool.y=35;
  // Symmetric end parts expand left of this asymmetric measured C shape.
  tool.points=[{x:0,y:0},{x:30,y:0},{x:30.2,y:9.5},{x:10,y:10},{x:10,y:80},{x:30,y:80},{x:30,y:90},{x:0,y:90}];
  Object.assign(project.tools[1],{x:25,y:36,points:[{x:0,y:0},{x:6,y:0},{x:6,y:5},{x:0,y:5}]});
  assert.deepEqual(validateLayout(project),[]);const before=clone(project);
  assert.throws(()=>functionalToolPocket(project,'target'));assert.deepEqual(project,before);
});
