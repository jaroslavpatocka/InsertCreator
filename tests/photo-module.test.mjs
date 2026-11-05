import test from 'node:test';
import assert from 'node:assert/strict';
import {addPhotoModule} from '../dist/photo-module.js';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout,transformedPoints,pocketOutline,exportSTL} from '../dist/geometry.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const rect=(id,x,y,width=15,height=35,extra={})=>({id,name:id,x,y,rotation:0,depth:8,points:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],fingerGrips:[],...extra});
const drawer=extra=>({...blankProject(),limitToBed:false,...extra});
const relative=tools=>tools.map(tool=>({id:tool.id,x:tool.x-tools[0].x,y:tool.y-tools[0].y,rotation:tool.rotation,points:tool.points}));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function assertSameLayout(actual,source){
  assert.equal(actual.length,source.length);
  const dx=actual[0].x-source[0].x,dy=actual[0].y-source[0].y;
  for(let i=0;i<source.length;i++){
    assert.equal(actual[i].id,source[i].id);assert.equal(actual[i].rotation,source[i].rotation);
    assert.deepEqual(actual[i].points,source[i].points);close(actual[i].x-source[i].x,dx);close(actual[i].y-source[i].y,dy);
    transformedPoints(source[i]).forEach((p,j)=>{const q=transformedPoints(actual[i])[j];close(q.x-p.x,dx);close(q.y-p.y,dy);});
  }
}

test('one photo module preserves scattered positions, angles, dimensions and tool order without moving existing modules',()=>{
  const existing={id:'fixed',name:'Existing',x:0,y:0,width:84,height:84,locked:false,sizeMode:'manual'};
  const project=drawer({modules:[existing]}),tools=[rect('right',240.5,180,15,35,{rotation:27}),rect('left',120,220,20,30,{rotation:-45}),rect('top',140,110)];
  const before=structuredClone({project,tools}),result=addPhotoModule(project,tools,{name:'Photo',moduleId:'photo'});
  assert.equal(result.placed,true);assert.equal(result.moduleId,'photo');assert.deepEqual(result.unplaced,[]);
  assert.equal(result.project.modules.length,2);assert.deepEqual(result.project.modules[0],existing);
  const module=result.project.modules[1];assert.equal(module.grouped,true);assert.equal(module.sizeMode,'manual');assert.equal(module.locked,false);
  assert.equal(module.width%project.grid,0);assert.equal(module.height%project.grid,0);assert.ok(module.x>=84||module.y>=84);
  assertSameLayout(result.project.tools,tools);assert.deepEqual(validateLayout(result.project),[]);assert.deepEqual({project,tools},before);
});

test('saved project and subsequent automatic placement keep the complete photo module rigid',()=>{
  const tools=[rect('a',-20,30,10,40,{rotation:90}),rect('b',70,-10,20,30,{rotation:13})];
  const result=addPhotoModule(drawer(),tools),saved=validateProject(JSON.parse(JSON.stringify(result.project)));
  const arranged=autoArrange({...saved,modules:[...saved.modules,{id:'filler',name:'Filler',x:0,y:0,width:42,height:42,locked:true,sizeMode:'manual'}]});
  assert.equal(arranged.modules.filter(module=>module.id===result.moduleId).length,1);
  assertSameLayout(arranged.tools,tools);assert.deepEqual(validateLayout({...saved,...arranged}),[]);
  assert.deepEqual(relative(saved.tools),relative(result.project.tools));
});

test('a full 80-tool photograph keeps every calibrated offset and all tools share a single module',()=>{
  const tools=Array.from({length:80},(_,i)=>rect(`tool-${i}`,300+(i%10)*35+(i%3)*.3,200+Math.floor(i/10)*45,12,25,{rotation:i%2?3:0}));
  const result=addPhotoModule(drawer(),tools),saved=validateProject(result.project);
  assert.equal(result.placed,true);assert.equal(saved.modules.length,1);assert.equal(new Set(saved.tools.map(tool=>tool.moduleId)).size,1);
  assertSameLayout(saved.tools,tools);assert.deepEqual(validateLayout(saved),[]);
  assertSameLayout(autoArrange(saved).tools,tools);
});

test('stepped module empty cells remain usable without intersection of real material',()=>{
  const occupied={id:'step',name:'Step',x:0,y:0,width:84,height:84,shape:'stepped',cells:[{x:0,y:0},{x:0,y:1},{x:1,y:0}],locked:true,sizeMode:'manual'};
  const result=addPhotoModule(drawer({width:84,height:84,modules:[occupied]}),[rect('small',100,100,5,5)]);
  assert.equal(result.placed,true);const module=result.project.modules[1];assert.equal(module.width,42);assert.equal(module.height,42);assert.equal(module.x,42);assert.equal(module.y,42);
  assert.deepEqual(validateLayout(result.project),[]);
});

test('a layout that does not fit stays as exactly one reloadable parked module without shrinking or splitting',()=>{
  const tools=[rect('a',0,0),rect('b',180,100)],project=drawer({width:84,height:84});
  const result=addPhotoModule(project,tools);
  assert.equal(result.placed,false);assert.deepEqual(result.unplaced,['a','b']);assert.equal(result.project.modules.length,1);
  assert.ok(result.project.modules[0].x>=project.width);assertSameLayout(result.project.tools,tools);
  const saved=validateProject(result.project);assertSameLayout(saved.tools,tools);assert.equal(saved.modules[0].sizeMode,'manual');
});

test('printer-bed limits do not split or rotate an otherwise fitting photo module',()=>{
  const tools=[rect('a',0,0),rect('b',180,100)],result=addPhotoModule(drawer({limitToBed:true,bedWidth:50,bedHeight:50}),tools);
  assert.equal(result.placed,true);assert.equal(result.project.modules.length,1);assertSameLayout(result.project.tools,tools);
  assert.ok(result.project.modules[0].width>50&&result.project.modules[0].height>50);
});

test('clearance, finger grips and connector reserve are included without changing their local geometry',()=>{
  const tools=[rect('gripped',50,30,30,70,{fingerGrips:[{id:'grip',x:0,y:35,radius:9}]}),rect('b',160,60)];
  const result=addPhotoModule(drawer({connectors:true}),tools),module=result.project.modules[0];
  assertSameLayout(result.project.tools,tools);assert.deepEqual(result.project.tools[0].fingerGrips,tools[0].fingerGrips);
  for(const tool of result.project.tools)for(const point of pocketOutline(tool,result.project.clearance)){
    assert.ok(point.x>=module.x+13.65-1e-7);assert.ok(point.y>=module.y+13.65-1e-7);
    assert.ok(point.x<=module.x+module.width-13.65+1e-7);assert.ok(point.y<=module.y+module.height-13.65+1e-7);
  }
  assert.deepEqual(validateLayout(result.project),[]);
});

test('overlap, insufficient wall, invalid coordinates, excessive dimensions and duplicate IDs fail atomically',()=>{
  const project=drawer(),before=structuredClone(project);
  for(const tools of [[rect('a',0,0),rect('b',0,0)],[rect('a',0,0),rect('b',17,0)],[rect('a',NaN,0)],[rect('a',0,0),rect('a',100,100)],[rect('a',0,0),rect('b',3000,0)]]){
    const input=structuredClone(tools);assert.throws(()=>addPhotoModule(project,tools),error=>!!error.i18n);
    assert.deepEqual(project,before);assert.deepEqual(tools,input);
  }
  const a=addPhotoModule(project,[rect('a',0,0)],{moduleId:'photo'});
  assert.throws(()=>addPhotoModule(a.project,[rect('a',100,100)]),/identifikátor/);
  assert.equal(addPhotoModule(a.project,[rect('b',100,100)],{moduleId:'photo'}).moduleId,'photo-2');
});

test('STL exports a closed positive-volume module and reflects every asymmetric pocket consistently into physical Y',()=>{
  const tools=[rect('top-left',0,0,25,10,{points:[{x:0,y:0},{x:25,y:0},{x:25,y:3},{x:8,y:3},{x:8,y:10},{x:0,y:10}]}),rect('bottom-right',75,60,10,20)];
  const result=addPhotoModule(drawer({printMode:'solid'}),tools),bytes=exportSTL(result.project,{moduleId:result.moduleId,checkBed:false}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=[];
  for(let i=0;i<view.getUint32(80,true);i++)triangles.push([0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true))));
  validatePrintMesh(triangles);
  const volume=triangles.reduce((sum,[a,b,c])=>sum+(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0);assert.ok(volume>0);
  const module=result.project.modules[0],pocketBottom=result.project.insertHeight-8;
  for(const tool of result.project.tools)for(const point of pocketOutline(tool,result.project.clearance)){
    const expected=[point.x,module.height-point.y,pocketBottom];
    assert.ok(triangles.some(triangle=>triangle.some(vertex=>vertex.every((coordinate,c)=>Math.abs(coordinate-expected[c])<.002))),'physical pocket vertex remains at its reflected source position');
  }
});
