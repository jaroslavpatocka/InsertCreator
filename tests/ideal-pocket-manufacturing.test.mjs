import test from 'node:test';
import assert from 'node:assert/strict';
import {fitIdealPocket} from '../dist/ideal-pocket.js';
import {pocketFitSignature} from '../dist/pocket-fit-meta.js';
import {blankProject,validateProject} from '../dist/model.js';
import {exportSTL,exportSVG,validateLayout,pocketOutline} from '../dist/geometry.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

// Independent handwritten physical truth: an asymmetric C jaw, a narrow
// shaft, and a wider end. The opening must remain material in the insert.
const source=[{x:0,y:5},{x:4,y:0},{x:12,y:0},{x:18,y:6},{x:22,y:9},
  {x:30,y:9},{x:31,y:8.7},{x:32,y:9},{x:84,y:9},{x:90,y:5},
  {x:100,y:5},{x:106,y:11},{x:106,y:21},{x:100,y:27},{x:90,y:27},
  {x:84,y:23},{x:22,y:23},{x:18,y:27},{x:12,y:32},{x:4,y:32},
  {x:0,y:27},{x:0,y:22},{x:10,y:22},{x:14,y:18},{x:14,y:14},
  {x:10,y:10},{x:0,y:10}];
const bounds=points=>({x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))});
function inside(point,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}
function decode(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:view.getUint32(80,true)},(_,i)=>Array.from({length:3},(_,j)=>Array.from({length:3},(_,c)=>view.getFloat32(84+i*50+12+j*12+c*4,true))));
}
function materialAt(mesh,x,y,z){
  const heights=[];
  for(const [a,b,c] of mesh){
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const height=u*a[2]+v*b[2]+w*c[2];
    if(height>z+1e-5&&!heights.some(previous=>Math.abs(previous-height)<1e-5))heights.push(height);
  }
  return heights.length%2===1;
}
function drawer(points,margin,rotation=0){
  return validateProject({...blankProject(),id:'ideal-manufacturing',width:252,height:252,
    clearance:0,wall:2.4,printMode:'solid',bottomMode:'plain',limitToBed:false,
    modules:[{id:'module',name:'Smooth pocket',x:0,y:0,width:252,height:252,sizeMode:'manual',pocketMargin:margin}],
    tools:[{id:'tool',name:'C-jaw wrench',moduleId:'module',x:55,y:55,rotation,depth:8,points,fingerGrips:[],
      pocketFit:{mode:'ideal',signature:pocketFitSignature(points)}}]});
}

test('the ideal manufacturing outline and explicit zero survive JSON without losing the open jaw',()=>{
  const original=structuredClone(source),fit=fitIdealPocket(source),b=bounds(fit.points),points=fit.points.map(p=>({x:p.x-b.x0,y:p.y-b.y0}));
  assert.deepEqual(source,original);
  assert.equal(inside({x:5,y:16},fit.points),false,'a broad open jaw must not become a round head');
  const project=drawer(points,0),before=structuredClone(project);
  assert.equal(project.tools[0].pocketFit?.mode,'ideal','JSON metadata must retain the generated pocket mode');
  assert.equal(project.modules[0].pocketMargin,0,'zero means no additional mm margin');
  const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project})));
  assert.deepEqual(restored,project);assert.deepEqual(project,before);
  const actual=bounds(pocketOutline(restored.tools[0],restored)),shape=bounds(points);
  assert.ok(Math.abs(actual.x1-actual.x0-(shape.x1-shape.x0))<.001);
  assert.ok(Math.abs(actual.y1-actual.y0-(shape.y1-shape.y0))<.001);
});

test('SVG exports the same ideal pocket and adds the chosen per-side mm margin exactly once',()=>{
  const fit=fitIdealPocket(source),b=bounds(fit.points),points=fit.points.map(p=>({x:p.x-b.x0,y:p.y-b.y0}));
  const zero=drawer(points,0),expanded=drawer(points,.8),base=bounds(pocketOutline(zero.tools[0],zero)),outer=bounds(pocketOutline(expanded.tools[0],expanded));
  assert.ok(Math.abs((outer.x1-outer.x0)-(base.x1-base.x0)-1.6)<.002);
  assert.ok(Math.abs((outer.y1-outer.y0)-(base.y1-base.y0)-1.6)<.002);
  for(const project of [zero,expanded]){
    const before=structuredClone(project),svg=exportSVG(project),d=svg.match(/<path id="tool"[^>]* d="([^"]+)"/)?.[1];
    assert.ok(d,'the actual exported pocket path must exist');
    const parsed=[...d.matchAll(/(?:M|L)(-?[\d.]+),(-?[\d.]+)/g)].map(m=>({x:Number(m[1]),y:Number(m[2])})),expected=pocketOutline(project.tools[0],project);
    assert.equal(parsed.length,expected.length);
    parsed.forEach((p,i)=>assert.ok(Math.hypot(p.x-expected[i].x,p.y-expected[i].y)<.001));
    assert.deepEqual(project,before,'export cannot modify the stored pocket');
  }
});

test('actual STL fits independent tool samples, preserves the jaw and floor at rotated placements and both margins',()=>{
  const fit=fitIdealPocket(source),origin=bounds(fit.points),points=fit.points.map(p=>({x:p.x-origin.x0,y:p.y-origin.y0}));
  for(const margin of [0,.8])for(const rotation of [0,37,183]){
    const project=drawer(points,margin,rotation),before=structuredClone(project);
    assert.deepEqual(validateLayout(project),[]);
    const mesh=decode(exportSTL(project));validatePrintMesh(mesh);assert.ok(trianglesVolume(mesh)>0);assert.deepEqual(project,before);
    const radians=rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),rotate=p=>({x:c*p.x-s*p.y,y:s*p.x+c*p.y});
    const turned=points.map(rotate),minimum=bounds(turned),world=p=>{const q=rotate({x:p.x-origin.x0,y:p.y-origin.y0});return{x:q.x-minimum.x0+55,y:252-(q.y-minimum.y0+55)};};
    let checked=0;
    for(let y=.731;y<32;y+=2.9)for(let x=.913;x<106;x+=4.1){
      const sample={x,y};if(!inside(sample,source))continue;const p=world(sample);
      assert.equal(materialAt(mesh,p.x,p.y,16),false,`tool sample obstructed at ${x},${y}; rotation${rotation}; margin${margin}`);
      assert.equal(materialAt(mesh,p.x,p.y,10),true,'the full requested pocket depth still has its floor');checked++;
    }
    assert.ok(checked>100);
    const jaw=world({x:5,y:16});assert.equal(materialAt(mesh,jaw.x,jaw.y,16),true,'the meaningful jaw opening remains filled insert material');
    assert.equal(materialAt(mesh,20,232,16),true,'distant module material remains solid');
  }
});
