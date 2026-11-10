import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {createCustomModule} from '../dist/custom-module.js';
import {rotateModuleFree} from '../dist/module-edit.js';
import {transformedPoints,validateLayout} from '../dist/geometry.js';
import {modulePadding} from '../dist/module-footprint.js';
import {pocketLayoutOutline} from '../dist/pocket-wall.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} differs from ${b}`);
const fixture=pocketWall=>{
  const added=createCustomModule({...blankProject(),width:504,height:378,printMode:'solid',limitToBed:false},{name:'Profiled module',shape:'rectangle',width:126,height:84,pocketWidth:76,pocketHeight:24,depth:8,pocketMargin:0,pocketWall,label:'M6'});
  return{...added,project:validateProject(added.project)};
};
const rotate=(module,point,degrees)=>{
  const cx=module.x+module.width/2,cy=module.y+module.height/2,a=degrees*Math.PI/180;
  return{x:cx+(point.x-cx)*Math.cos(a)-(point.y-cy)*Math.sin(a),y:cy+(point.x-cx)*Math.sin(a)+(point.y-cy)*Math.cos(a)};
};
function wallFits(project){
  const module=project.modules[0],padding=modulePadding(project),outline=pocketLayoutOutline(project.tools[0],project);
  for(const point of outline){
    assert.ok(point.x>=module.x+padding-.001&&point.x<=module.x+module.width-padding+.001,'widest pocket X leaves its physical wall');
    assert.ok(point.y>=module.y+padding-.001&&point.y<=module.y+module.height-padding+.001,'widest pocket Y leaves its physical wall');
  }
  assert.deepEqual(validateLayout(project),[]);
}

test('free rotation grows the real draft-wall envelope while the vertical baseline stays unchanged',()=>{
  const plain=fixture(null),sloped=fixture({type:'draft',value:45}),before=structuredClone(sloped.project);
  const vertical=rotateModuleFree(plain.project,plain.moduleId,45,{keepInside:true}),next=rotateModuleFree(sloped.project,sloped.moduleId,45,{keepInside:true});
  assert.deepEqual([vertical.modules[0].width,vertical.modules[0].height],[126,84]);
  // The widest opening crosses a negative raster edge; absolute-edge rounding preserves its rigid frame.
  assert.deepEqual([next.modules[0].width,next.modules[0].height],[126,168]);wallFits(next);
  assert.equal(next.tools[0].id,sloped.toolId);assert.equal(next.modules[0].id,sloped.moduleId);assert.equal(next.tools[0].customPocket,true);assert.equal(next.tools[0].sizeLabel,'M6');
  assert.deepEqual(next.tools[0].points,before.tools[0].points);assert.deepEqual(next.tools[0].pocketWall,before.tools[0].pocketWall);assert.deepEqual(sloped.project,before);
});

for(const pocketWall of [{type:'draft',value:45},{type:'chamfer',value:2},{type:'roundTop',value:2},{type:'roundBottom',value:2}]){
  test(`${pocketWall.type} rotation keeps every raw vertex rigid and the saved wall profile intact`,()=>{
    const source=fixture(pocketWall),before=structuredClone(source.project),preview=rotateModuleFree(source.project,source.moduleId,45,{validate:false}),next=rotateModuleFree(source.project,source.moduleId,45,{keepInside:true});
    const dx=next.modules[0].x-preview.modules[0].x,dy=next.modules[0].y-preview.modules[0].y;
    const original=transformedPoints(source.project.tools[0]),actual=transformedPoints(next.tools[0]);
    for(let i=0;i<original.length;i++){const expected=rotate(source.project.modules[0],original[i],45);near(actual[i].x,expected.x+dx);near(actual[i].y,expected.y+dy);}
    assert.deepEqual(next.tools[0].points,source.project.tools[0].points);assert.deepEqual(next.tools[0].pocketWall,pocketWall);wallFits(next);
    const saved=validateProject(JSON.parse(JSON.stringify(next)));assert.deepEqual(saved.tools[0].pocketWall,pocketWall);assert.deepEqual(source.project,before);
    assert.deepEqual(rotateModuleFree(source.project,source.moduleId,0),source.project);assert.deepEqual(rotateModuleFree(source.project,source.moduleId,360),source.project);
  });
}

test('small repeated wall-profile rotations never accumulate old raster slack',()=>{
  const source=fixture({type:'draft',value:45}),points=structuredClone(source.project.tools[0].points);let next=source.project;
  for(const angle of [...Array(25).fill(1),...Array(25).fill(-1)]){
    next=rotateModuleFree(next,source.moduleId,angle,{keepInside:true});wallFits(next);
    const outline=pocketLayoutOutline(next.tools[0],next),xs=outline.map(p=>p.x),ys=outline.map(p=>p.y),padding=modulePadding(next),module=next.modules[0];
    assert.ok(module.width<Math.max(...xs)-Math.min(...xs)+2*padding+2*next.grid+.001);
    assert.ok(module.height<Math.max(...ys)-Math.min(...ys)+2*padding+2*next.grid+.001);
    assert.ok(module.width<=210&&module.height<=210);assert.deepEqual(next.tools[0].points,points);assert.deepEqual(next.tools[0].pocketWall,{type:'draft',value:45});
  }
  near(next.tools[0].rotation,0);
});

test('an enlarged wall envelope cannot rotate through a neighbour or save an invalid preview',()=>{
  const source=fixture({type:'draft',value:45});source.project.modules.push({id:'neighbour',name:'Neighbour',x:0,y:84,width:126,height:42,sizeMode:'manual',locked:true});
  const before=structuredClone(source.project);assert.deepEqual(validateLayout(source.project),[]);
  const preview=rotateModuleFree(source.project,source.moduleId,45,{validate:false,keepInside:true});assert.ok(validateLayout(preview).some(issue=>issue.type==='overlap'&&issue.ids.includes('neighbour')));
  assert.throws(()=>rotateModuleFree(source.project,source.moduleId,45,{keepInside:true}));assert.deepEqual(source.project,before);assert.deepEqual(preview.modules[1],before.modules[1]);
  source.project.modules[0].locked=true;const locked=structuredClone(source.project);assert.throws(()=>rotateModuleFree(source.project,source.moduleId,1,{keepInside:true}),/odemkn/);assert.deepEqual(source.project,locked);
});
