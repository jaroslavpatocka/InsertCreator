import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticFingerGrips,validateFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {validateProject,blankProject,clone} from '../dist/model.js';

const points=coords=>coords.map(([x,y])=>({x,y}));
const rectangle=points([[0,0],[20,0],[20,100],[0,100]]);
const bounds=polygon=>({minX:Math.min(...polygon.map(p=>p.x)),minY:Math.min(...polygon.map(p=>p.y)),maxX:Math.max(...polygon.map(p=>p.x)),maxY:Math.max(...polygon.map(p=>p.y))});
const area=polygon=>Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
function inside(point,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}

test('automatic grips attach to real filled regions of straight, rotated and concave tools',()=>{
  const shapes=[rectangle,points([[0,0],[14,14],[-56,84],[-70,70]]),points([[0,0],[70,0],[70,12],[12,12],[12,80],[0,80]]),points([[0,0],[15,0],[15,65],[45,65],[45,0],[60,0],[60,80],[0,80]])];
  for(const contour of shapes){
    const tool={id:'automatic-tool',points:contour,x:100,y:200,rotation:37},before=clone(tool),grips=automaticFingerGrips(tool);
    assert.equal(grips.length,2);assert.ok(grips.every(grip=>grip.radius===9&&inside(grip,contour)));
    assert.equal(new Set(grips.map(grip=>grip.id)).size,2);
    assert.deepEqual(automaticFingerGrips(tool),grips,'repeating automatic placement must retain stable IDs and positions');
    assert.deepEqual(automaticFingerGrips({...tool,rotation:91}),grips,'local centers must not be pre-rotated');
    const pocket=pocketOutline({...tool,fingerGrips:grips},0);
    assert.ok(area(pocket)>area(contour)+10,'the circles must add accessible material cutouts outside the measured silhouette');
    assert.deepEqual(tool,before,'automatic placement must not alter measured points or placement');
  }
});

test('rotating grips retains the raw rotated-bounds anchor and actual radius independently of clearance',()=>{
  const tool={id:'rotated',points:points([[10,20],[30,20],[30,100],[10,100]]),x:100,y:200,rotation:90,fingerGrips:[{id:'side',x:9,y:60,radius:9}]},before=clone(tool);
  const pocket=pocketOutline(tool),box=bounds(pocket);
  assert.ok(Math.abs(box.minY-190)<.0002,'the center is (140,199) after rotation, so the real radius reaches Y=190');
  assert.equal(box.minX,100);assert.equal(box.maxX,180);assert.equal(box.maxY,220);
  assert.ok(pocket.some(p=>p.x===180&&p.y===220),'the unaffected original corner must stay in its original place');
  const expanded=bounds(pocketOutline(tool,1));
  assert.ok(Math.abs(expanded.minY-190)<.0002,'clearance must not be added to the finger-circle radius');
  assert.ok(Math.abs(expanded.minX-99)<.02&&Math.abs(expanded.maxX-181)<.02);
  assert.deepEqual(tool,before);
});

test('disconnected, merely tangent and hole-producing circles reject explicitly',()=>{
  const tool={id:'invalid',points:rectangle};
  for(const grip of [{id:'far',x:200,y:200,radius:9},{id:'tangent',x:29,y:50,radius:9}])assert.throws(()=>pocketOutline({...tool,fingerGrips:[grip]}),/navazovat/);
  const u=points([[0,0],[40,0],[40,50],[30,50],[30,10],[10,10],[10,50],[0,50]]);
  assert.throws(()=>pocketOutline({points:u,fingerGrips:[{id:'bridge',x:20,y:42,radius:12}]}),/jednoznačnou/);
});

test('grip validation rejects malformed imports and preserves metric values without mutating input',()=>{
  const valid=[{id:'g',x:-2,y:40,radius:9}],before=clone(valid);
  assert.deepEqual(validateFingerGrips(valid),valid);assert.deepEqual(valid,before);
  for(const value of [null,{},Array.from({length:13},(_,i)=>({...valid[0],id:'g'+i})),[valid[0],valid[0]],[{...valid[0],id:''}],[{...valid[0],x:Infinity}],[{...valid[0],y:6001}],[{...valid[0],radius:1.9}],[{...valid[0],radius:40.1}]])assert.throws(()=>validateFingerGrips(value));
  assert.throws(()=>validateProject({...blankProject(),tools:[{id:'bad',points:rectangle,fingerGrips:[{id:'bad',x:0,y:0,radius:0}]}]}),/poloměr/);
});

test('normalizing negative raw points shifts grip centers identically and preserves their world pocket',()=>{
  const tool={id:'negative',points:points([[-20,-30],[0,-30],[0,70],[-20,70]]),x:42,y:84,rotation:90,fingerGrips:[{id:'side',x:-21,y:20,radius:9}]};
  const project=validateProject({...blankProject(),tools:[tool]}),normalized=project.tools[0];
  assert.deepEqual(normalized.points,rectangle);assert.deepEqual(normalized.fingerGrips,[{id:'side',x:-1,y:50,radius:9}]);
  assert.deepEqual(pocketOutline(normalized,.8),pocketOutline(tool,.8));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project,'JSON reload must not shift grip centers a second time');
});

test('legacy absence and explicit deletion survive JSON and library-style validation without regeneration',()=>{
  const legacy={id:'legacy',points:rectangle},deleted={id:'deleted',points:rectangle,fingerGrips:[]},custom={id:'custom',points:rectangle,fingerGrips:automaticFingerGrips({id:'custom',points:rectangle},{radius:7})};
  const project=validateProject({...blankProject(),tools:[legacy,deleted,custom]});
  for(const restored of [project,validateProject(JSON.parse(JSON.stringify(project))),clone(project)]){
    assert.equal(Object.hasOwn(restored.tools[0],'fingerGrips'),false);
    assert.equal(Object.hasOwn(restored.tools[1],'fingerGrips'),true);assert.deepEqual(restored.tools[1].fingerGrips,[]);
    assert.deepEqual(restored.tools[2].fingerGrips,custom.fingerGrips);
  }
  for(const tool of project.tools){
    const libraryEntry=validateProject({...blankProject(),tools:[clone(tool)]}).tools[0];
    assert.equal(Object.hasOwn(libraryEntry,'fingerGrips'),Object.hasOwn(tool,'fingerGrips'));
    assert.deepEqual(libraryEntry.fingerGrips,tool.fingerGrips);
  }
  assert.deepEqual(pocketOutline(legacy),rectangle);assert.deepEqual(pocketOutline(deleted),rectangle);
});
