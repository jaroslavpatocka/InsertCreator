import test from 'node:test';
import assert from 'node:assert/strict';
import {fitFunctionalPocket,fitHybridPocket} from '../dist/functional-pocket.js';
import {blankProject,validateProject} from '../dist/model.js';
import {exportSTL,validateLayout} from '../dist/geometry.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

// A deliberately asymmetric, handwritten head/shaft/grip silhouette. The
// cavity checks below sample the measured source, independently of the fit.
const measured=[{x:0,y:7},{x:5,y:1},{x:13,y:0},{x:21,y:5},{x:24,y:9},
  {x:65,y:9},{x:65,y:5},{x:69,y:3},{x:98,y:3},{x:102,y:7},
  {x:102,y:20},{x:98,y:24},{x:69,y:24},{x:65,y:20},{x:65,y:17},
  {x:22,y:17},{x:18,y:23},{x:10,y:25},{x:3,y:20},{x:0,y:14}];
const decode=bytes=>{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:view.getUint32(80,true)},(_,i)=>Array.from({length:3},(_,j)=>Array.from({length:3},(_,c)=>view.getFloat32(84+i*50+12+j*12+c*4,true))));
};
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
function inside(point,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}

for(const [name,fitter] of [['regular',fitFunctionalPocket],['hybrid',fitHybridPocket]])test(`${name} pocket survives JSON and produces a closed STL cavity covering the measured tool at four rotations`,()=>{
  const original=structuredClone(measured),fit=fitter(measured);
  assert.deepEqual(measured,original,'fitting must leave the measurement intact');
  const origin={x:Math.min(...fit.points.map(p=>p.x)),y:Math.min(...fit.points.map(p=>p.y))};
  const points=fit.points.map(p=>({x:p.x-origin.x,y:p.y-origin.y}));
  for(const rotation of [0,37,90,183]){
    const project=validateProject({...blankProject(),id:`functional-stl-${rotation}`,width:252,height:252,
      clearance:0,wall:2.4,printMode:'solid',bottomMode:'plain',limitToBed:false,
      modules:[{id:'module',name:'Functional pocket',x:0,y:0,width:252,height:252,sizeMode:'manual'}],
      tools:[{id:'ratchet',name:'Measured ratchet',moduleId:'module',x:55,y:55,rotation,depth:8,points,fingerGrips:[]}]});
    assert.deepEqual(validateLayout(project),[]);
    const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project})));
    assert.deepEqual(restored,project,'JSON import must retain the exact manufactured polygon');
    const before=structuredClone(restored),mesh=decode(exportSTL(restored));
    validatePrintMesh(mesh);assert.ok(trianglesVolume(mesh)>0);assert.deepEqual(restored,before);
    const radians=rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),rotate=p=>({x:c*p.x-s*p.y,y:s*p.x+c*p.y});
    const turned=points.map(rotate),minimum={x:Math.min(...turned.map(p=>p.x)),y:Math.min(...turned.map(p=>p.y))};
    let checked=0;
    for(let y=1.371;y<24;y+=2.9)for(let x=1.213;x<101;x+=3.7){
      const sample={x,y};if(!inside(sample,measured))continue;
      const p=rotate({x:x-origin.x,y:y-origin.y}),world={x:p.x-minimum.x+55,y:p.y-minimum.y+55};
      assert.equal(materialAt(mesh,world.x,252-world.y,16),false,`${rotation} degrees: measured material must fit at ${x},${y}`);
      assert.equal(materialAt(mesh,world.x,252-world.y,10),true,'the pocket keeps its floor below the requested depth');checked++;
    }
    assert.ok(checked>60,'the independent cavity check must cover all three tool regions');
    assert.equal(materialAt(mesh,20,232,16),true,'material far from the pocket remains solid');
  }
});
