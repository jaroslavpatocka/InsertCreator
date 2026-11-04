import test from 'node:test';
import assert from 'node:assert/strict';
import {magnetPocketCenters} from '../dist/magnet-pockets.js';
import {containsPocketWalls} from '../dist/module-footprint.js';
import {buildPrintTriangles,trianglesVolume,validatePrintMesh} from '../dist/print-geometry.js';
import {blankProject} from '../dist/model.js';

const stepped=()=>({id:'step',x:42,y:42,width:126,height:84,cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1}]});

test('shared magnet placement preserves the four real corner centres and keeps the source immutable',()=>{
  const project={...blankProject(),bottomMode:'magnet'},module={id:'m',x:42,y:84,width:84,height:84},before=structuredClone({project,module});
  assert.deepEqual(magnetPocketCenters(project,module),[{x:47.75,y:89.75,radius:3.1},{x:47.75,y:162.25,radius:3.1},{x:120.25,y:89.75,radius:3.1},{x:120.25,y:162.25,radius:3.1}]);
  assert.deepEqual({project,module},before);
});

test('the stepped policy keeps every magnet and its wall in actual occupied material with distinct safe centres',()=>{
  const project={...blankProject(),bottomMode:'magnet'},module=stepped(),centres=magnetPocketCenters(project,module);
  assert.equal(centres.length,4);assert.deepEqual(centres.map(({x,y})=>[x,y]),[[63,63],[147,63],[105,105],[105,63]]);
  for(const centre of centres){
    const circle=Array.from({length:48},(_,i)=>({x:centre.x+Math.cos(i*Math.PI/24)*centre.radius,y:centre.y+Math.sin(i*Math.PI/24)*centre.radius}));
    assert.equal(containsPocketWalls(module,circle,project.wall,project.grid),true);
  }
  for(let i=0;i<centres.length;i++)for(let j=i+1;j<centres.length;j++)assert.ok(Math.hypot(centres[i].x-centres[j].x,centres[i].y-centres[j].y)>=6.2+project.wall+.5);
});

test('whole and precisely clipped stepped meshes use the same magnet centres and conserve hole geometry',()=>{
  const module=stepped(),project={...blankProject(),width:252,height:210,printMode:'light',bottomMode:'magnet',modules:[module],tools:[]},before=structuredClone(project);
  const whole=buildPrintTriangles(project,[module],[]),parts=[];
  for(const x of [42,84,126])for(const y of [42,84]){
    const mesh=buildPrintTriangles(project,[module],[],{x:0,y:0},{clip:{x,y,width:42,height:42}});if(!mesh.length)continue;validatePrintMesh(mesh);parts.push(mesh);
  }
  assert.ok(Math.abs(parts.reduce((sum,part)=>sum+trianglesVolume(part),0)-trianglesVolume(whole))<.03,'clipping must not select different magnet holes');
  assert.deepEqual(project,before);
});

test('four safely separated magnet pockets are rejected when the module is too small',()=>{
  assert.throws(()=>magnetPocketCenters(blankProject(),{id:'tiny',x:0,y:0,width:16,height:16}),/magnetové kapsy/);
});
