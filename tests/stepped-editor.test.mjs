import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {rotateModule,duplicateModule,moveModule} from '../dist/module-edit.js';
import {resizeModule,validateLayout,exportSVG,exportDXF,exportSTL} from '../dist/geometry.js';
import {moduleOutline} from '../dist/module-footprint.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const rectangle=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} should equal ${b}`);
const fixture=()=>validateProject({...blankProject(),width:420,height:252,grid:42,clearance:0,limitToBed:false,printMode:'solid',bottomMode:'plain',modules:[{id:'stepped',name:'Schodový',x:42,y:42,width:126,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1}],sizeMode:'auto'}],tools:[{id:'one',name:'13 mm',moduleId:'stepped',points:rectangle(0,0,12,24),x:50,y:50,rotation:0,depth:8,fingerGrips:[],nominalSize:{value:13,unit:'mm'},sizeLabel:'13 mm'}]});

test('stepped modules retain canonical cells through JSON and four whole-module quarter turns',()=>{
  const source=fixture(),before=structuredClone(source);let next=source;
  for(let i=0;i<4;i++){next=rotateModule(next,'stepped');assert.deepEqual(validateLayout(next),[]);next=validateProject(JSON.parse(JSON.stringify(next)));}
  assert.deepEqual(next.modules,source.modules);
  for(const field of ['x','y','rotation'])close(next.tools[0][field],source.tools[0][field]);
  assert.deepEqual(next.tools[0].points,source.tools[0].points);assert.deepEqual(next.tools[0].fingerGrips,[]);assert.equal(next.tools[0].sizeLabel,'13 mm');assert.deepEqual(source,before);
});

test('moving and duplicating stepped modules preserve real cells, and the copy owns independent geometry',()=>{
  const source=fixture(),before=structuredClone(source),moved=moveModule(source,'stepped',{x:84,y:42});
  assert.deepEqual(moved.modules[0].cells,source.modules[0].cells);assert.equal(moved.tools[0].x,source.tools[0].x+42);assert.deepEqual(validateLayout(moved),[]);
  const copied=duplicateModule(source,'stepped'),copy=copied.modules.at(-1);
  assert.deepEqual(copy.cells,copied.modules[0].cells);assert.notEqual(copy.cells,copied.modules[0].cells);assert.notEqual(copy.cells[0],copied.modules[0].cells[0]);
  copy.cells[0].x=99;assert.equal(copied.modules[0].cells[0].x,0);assert.deepEqual(source,before);
});

test('explicit module resize restores a rectangular footprint without scaling tool contours',()=>{
  const source=fixture(),next=resizeModule(source,'stepped',{width:168,height:84}),module=next.modules[0];
  assert.equal(Object.hasOwn(module,'cells'),false);assert.equal(Object.hasOwn(module,'shape'),false);assert.equal(module.width,168);assert.equal(module.height,84);
  assert.deepEqual(next.tools[0].points,source.tools[0].points);assert.equal(next.tools[0].rotation,source.tools[0].rotation);assert.deepEqual(validateLayout(next),[]);
  assert.equal(source.modules[0].shape,'stepped');
});

test('a module actually nested in a stepped notch exports the same real boundaries to SVG, DXF and manifold STL',()=>{
  const p={...blankProject(),width:84,height:84,limitToBed:false,printMode:'solid',bottomMode:'plain',modules:[{id:'L',x:0,y:0,width:84,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]},{id:'notch',x:42,y:42,width:42,height:42}],tools:[]};
  assert.deepEqual(validateLayout(p),[]);
  const svg=exportSVG(p),modulePaths=svg.match(/<g id="modules"[^]*?<\/g>/)[0];
  assert.match(modulePaths,/<path d="/);assert.match(modulePaths,/41\.75,41\.75/);assert.equal((modulePaths.match(/L/g)||[]).length,5);assert.match(modulePaths,/<rect x="42\.25" y="42\.25"/);
  const dxf=exportDXF(p).split(/\r?\n/),counts=[];
  for(let i=0;i<dxf.length;i+=2)if(dxf[i]==='90')counts.push(+dxf[i+1]);assert.deepEqual(counts,[6,4]);
  const bytes=exportSTL(p),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=[];
  for(let i=0;i<view.getUint32(80,true);i++)triangles.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));
  validatePrintMesh(triangles);
  const area=poly=>Math.abs(poly.reduce((sum,a,i)=>{const b=poly[(i+1)%poly.length];return sum+a.x*b.y-b.x*a.y;},0)/2),expected=p.modules.reduce((sum,m)=>sum+area(moduleOutline(m,p.grid,{inset:.25})),0)*p.insertHeight;
  const volume=triangles.reduce((sum,[a,b,c])=>sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0);close(volume,expected);
});
