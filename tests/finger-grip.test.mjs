import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleOutline,fittingFingerGrips} from '../dist/finger-grip.js';
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

test('asymmetric wrench heads cannot pull automatic grips away from the middle of the shaft',()=>{
  const wrench=points([[0,-25],[28,-25],[35,-8],[195,-8],[202,-48],[240,-48],[240,48],[202,48],[195,8],[35,8],[28,25],[0,25],[0,12],[17,12],[17,-12],[0,-12]]);
  for(const contourAngle of [0,37,129]){
    const angle=contourAngle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),contour=wrench.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));
    const tool={id:'asymmetric-wrench',points:contour,x:84,y:42,rotation:73,fingerGrips:[{id:'manual',x:0,y:0,radius:12}]},before=clone(tool);
    for(const radius of [7,9,14]){
      const grips=automaticFingerGrips(tool,{radius}),local=grips.map(g=>({x:g.x*c+g.y*s,y:-g.x*s+g.y*c}));
      assert.ok(local.every(g=>Math.abs(g.x-120)<.001),'both opposed grips must sit halfway along the actual 240 mm contour');
      assert.ok(local[0].y*local[1].y<0,'grips must face each other across the shaft');
      assert.ok(grips.every(g=>g.radius===radius&&inside(g,contour)),'radius stays in millimetres and centres stay on real material');
      assert.ok(area(pocketOutline({...tool,fingerGrips:grips},0))>area(contour));
    }
    assert.deepEqual(tool,before,'automatic placement does not overwrite stored manual grips');
  }
});

test('central concave sections use a filled branch and malformed silhouettes fail safely',()=>{
  const u=points([[0,0],[10,0],[10,180],[40,180],[40,0],[50,0],[50,200],[0,200]]),tool={id:'central-concave',points:u};
  const grips=automaticFingerGrips(tool);
  assert.ok(grips.every(g=>inside(g,u)&&Math.abs(g.y-100)<.001),'a hollow middle must use one real side branch at the longitudinal midpoint');
  assert.ok(area(pocketOutline({...tool,fingerGrips:grips},0))>area(u));
  for(const contour of [points([[0,0],[40,40],[0,40],[40,0]]),points([[0,0],[40,40],[0,40],[40,0],[50,20]]),[{x:0,y:0},{x:NaN,y:20},{x:20,y:0}]]){
    const invalid={id:'malformed',points:contour},before=structuredClone(invalid);
    assert.throws(()=>automaticFingerGrips(invalid));assert.deepEqual(invalid,before);
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

test('an outline that touches itself becomes one simple polygon that can take finger grips',()=>{
  // A notch whose tip touches the opposite side: the vertex (50,0) is visited twice, as in a pixel contour.
  const pinched=[{x:0,y:0},{x:50,y:0},{x:50,y:60},{x:52,y:60},{x:50,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}];
  assert.throws(()=>automaticFingerGrips({id:'p',name:'p',points:pinched,x:0,y:0,rotation:0}));
  const points=simpleOutline(pinched),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  assert.deepEqual([Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)],[0,100,0,200],'the size stays the same');
  assert.equal(automaticFingerGrips({id:'p',name:'p',points,x:0,y:0,rotation:0}).length,2);
});

test('a simple outline passes through unchanged in shape',()=>{
  const square=[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}],points=simpleOutline(square);
  assert.equal(points.length,4);assert.equal(Math.max(...points.map(p=>p.x)),40);
});

test('without room in the middle a tool gets a longer pocket at its widest part',()=>{
  // A fork: in the central band a circle would bridge the slot and enclose it, so the usual grips are impossible.
  const fork={id:'fork',points:points([[0,-30],[60,-30],[60,-15],[200,-15],[200,-3],[60,-3],[60,3],[200,3],[200,15],[60,15],[60,30],[0,30]]),x:0,y:0,rotation:0};
  assert.throws(()=>automaticFingerGrips(fork));
  const grips=fittingFingerGrips(fork);
  assert.equal(grips.length,6);assert.equal(new Set(grips.map(g=>g.id)).size,6);
  assert.ok(grips.every(g=>g.x<=75),'the pocket sits at the wide handle, not on the prongs');
  assert.deepEqual(validateFingerGrips(grips).length,6);
  assert.ok(pocketOutline({...fork,fingerGrips:grips},.8).length>3,'one connected pocket');
});

test('the usual grips stay the first choice and a hopeless outline is added without grips',()=>{
  const tool={id:'plain',points:rectangle};
  assert.deepEqual(fittingFingerGrips(tool),automaticFingerGrips(tool));
  const crossed={id:'bow',points:points([[0,0],[100,100],[100,0],[0,100]])};
  assert.deepEqual(fittingFingerGrips(crossed),[]);
});
