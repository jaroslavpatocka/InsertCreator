import test from 'node:test';
import assert from 'node:assert/strict';
import {fittingFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {blankProject} from '../dist/model.js';
import {validateLayout,exportSTL,exportFitSTL} from '../dist/geometry.js';

// A wide recess connected to the outside through a 1 mm mouth.
const points=[[0,0],[9.5,0],[9.5,4],[5,4],[5,15],[15,15],[15,4],[10.5,4],[10.5,0],[20,0],[20,20],[0,20]].map(([x,y])=>({x,y}));
const tool=()=>({id:'notched',name:'Notched tool',points:structuredClone(points),x:10,y:10,rotation:0,depth:10,moduleId:'module',fingerGrips:[]});
function inside(point,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}

test('clearance closing a narrow recess makes one pocket without an interior island',()=>{
  const source=tool(),before=structuredClone(source),pocket=pocketOutline(source,.8);
  assert.ok(inside({x:20,y:20},pocket),'the sealed recess is part of the pocket');
  assert.ok(points.every(p=>inside({x:p.x+10,y:p.y+10},pocket)),'clearance retains the whole measured tool');
  assert.deepEqual(source,before,'pocket preparation must preserve the measured contour');
});

test('an open recess is preserved when clearance does not close its mouth',()=>{
  for(const clearance of [0,.2]){
    const pocket=pocketOutline(tool(),clearance);
    assert.equal(inside({x:20,y:20},pocket),false,'an accessible recess must not be filled');
    assert.equal(inside({x:11,y:20},pocket),true);
  }
});

test('automatic finger grips remain compatible with a recess sealed by clearance',()=>{
  const source=tool(),before=structuredClone(source);
  source.fingerGrips=fittingFingerGrips(source);
  assert.ok(source.fingerGrips.length>0);
  assert.ok(inside({x:20,y:20},pocketOutline(source,.8)));
  assert.deepEqual(source.points,before.points);
});

test('sealed recesses work with either winding, rotation and translated placement',()=>{
  for(const reverse of [false,true])for(const rotation of [0,37,90,217]){
    const source={...tool(),points:reverse?[...points].reverse():points,x:73,y:121,rotation},before=structuredClone(source);
    const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rotated=points.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));
    const minX=Math.min(...rotated.map(p=>p.x)),minY=Math.min(...rotated.map(p=>p.y));
    const world=p=>({x:p.x*c-p.y*s-minX+source.x,y:p.x*s+p.y*c-minY+source.y});
    const pocket=pocketOutline(source,.8);
    assert.ok(inside(world({x:10,y:10}),pocket),'the sealed recess stays filled after rotation');
    assert.ok(points.every(p=>inside(world(p),pocket)),'the rotated pocket retains all measured points');
    assert.deepEqual(source,before);
  }
});

test('clearance still rejects malformed outlines producing separate outer components',()=>{
  const source={...tool(),points:[[0,0],[40,40],[0,40],[40,0],[50,20]].map(([x,y])=>({x,y}))};
  assert.throws(()=>pocketOutline(source,.8),/Vůle nevytvořila jednu jednoznačnou kapsu nástroje/);
});

test('sealed-recess pockets pass layout validation and export closed printable meshes',()=>{
  const project={...blankProject(),width:84,height:84,printMode:'solid',modules:[{id:'module',name:'Module',x:0,y:0,width:42,height:42,sizeMode:'manual',locked:false}],tools:[tool()]};
  const before=structuredClone(project);
  assert.deepEqual(validateLayout(project),[]);
  for(const exportMesh of [exportSTL,exportFitSTL]){
    const bytes=exportMesh(project),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
    assert.ok(count>0);assert.equal(bytes.byteLength,84+50*count);
  }
  assert.deepEqual(project,before,'exports must preserve the project and original contour');
});
