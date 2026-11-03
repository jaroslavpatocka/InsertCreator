import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {exportSTL,validateLayout,pocketOutline} from '../dist/geometry.js';
import {stitchContour,alignedStitchContour,strictStitchContour} from './fixtures/stitch-contour.mjs';

function projectFor(printMode,{withGrips=true,mixed=false,contour=stitchContour}={}){
  const source=structuredClone(contour),module=source.module;
  const tool={...source.tool,points:source.points,moduleId:module.id,locked:false};
  if(!withGrips)delete tool.fingerGrips;
  const tools=[tool];
  if(mixed)tools.push(
    {id:'plain-pocket',name:'Plain second pocket',points:[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}],x:20,y:300,rotation:0,depth:7,moduleId:module.id,fingerGrips:[]},
    {id:'custom-grip-pocket',name:'Custom grip pocket',points:[{x:0,y:0},{x:20,y:0},{x:20,y:80},{x:0,y:80}],x:85,y:360,rotation:0,depth:13,moduleId:module.id,fingerGrips:[{id:'custom-grip',x:0,y:40,radius:6}]}
  );
  return{...blankProject(),...source.settings,id:'print-stitch-regression',printMode,bottomMode:'plain',limitToBed:false,modules:[module],tools};
}

function inspectManufacturingSTL(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),edges=new Map();let volume=0,minArea=Infinity,minZ=Infinity,maxZ=-Infinity,minX=Infinity,maxX=-Infinity;
  assert.equal(bytes.length,84+count*50);assert.ok(count>0);
  for(let i=0;i<count;i++){
    const offset=84+i*50,normal=[0,1,2].map(c=>view.getFloat32(offset+c*4,true));
    const vertices=[0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(offset+12+j*12+c*4,true))),[a,b,c]=vertices;
    assert.equal(new Set(vertices.map(point=>point.join(','))).size,3,'a serialized facet must not collapse to A,A,B after float32 rounding');
    assert.ok(vertices.flat().every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-5,'every exported facet must have a real unit normal');
    const u=b.map((value,j)=>value-a[j]),v=c.map((value,j)=>value-a[j]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],twiceArea=Math.hypot(...cross);
    assert.ok(twiceArea>1e-12,'serialized triangles must have nonzero area');minArea=Math.min(minArea,twiceArea/2);
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(const point of vertices){minZ=Math.min(minZ,point[2]);maxZ=Math.max(maxZ,point[2]);minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);}
    for(let j=0;j<3;j++){
      // Compare the actual serialized float32 vertices, without tolerance-based
      // welding that could hide a four-face edge or a missing boundary interval.
      const from=vertices[j].join(','),to=vertices[(j+1)%3].join(','),key=from<to?from+'|'+to:to+'|'+from,edge=edges.get(key)||{count:0,winding:0};
      edge.count++;edge.winding+=from<to?1:-1;edges.set(key,edge);
    }
  }
  for(const [key,edge] of edges){assert.equal(edge.count,2,'edge must belong to exactly two triangles: '+key);assert.equal(edge.winding,0,'adjacent triangles must traverse the edge in opposite directions: '+key);}
  assert.ok(volume>0,'the watertight surface must bound a positively oriented solid');
  return{count,volume,minArea,minZ,maxZ,minX,maxX};
}

test('the reduced source contour exports a watertight solid and light model across near-collinear stitch intervals',()=>{
  // The original 536-point source and this 16-point reduction both reproduced
  // five count-four edges in solid mode and ten in light mode before the fix.
  assert.equal(stitchContour.points.length,16);
  const volumes={};
  for(const printMode of ['solid','light']){
    const project=projectFor(printMode),snapshot=structuredClone(project);assert.deepEqual(validateLayout(project),[]);
    const mesh=inspectManufacturingSTL(exportSTL(project));volumes[printMode]=mesh.volume;
    assert.equal(mesh.minZ,0);assert.ok(Math.abs(mesh.maxZ-(printMode==='solid'?20:12.4))<.0001);assert.deepEqual(project,snapshot,'export must not simplify or move the measured contour or grips');
  }
  assert.ok(volumes.light<volumes.solid,'light construction must retain its actual material saving');
});

test('different pocket depths and mixed default, deleted and custom finger bays preserve closed boundaries',()=>{
  for(const printMode of ['solid','light']){
    const project=projectFor(printMode,{mixed:true}),snapshot=structuredClone(project);assert.deepEqual(validateLayout(project),[]);
    const mesh=inspectManufacturingSTL(exportSTL(project));assert.ok(Math.abs(mesh.maxZ-(printMode==='solid'?20:15.4))<.0001);
    assert.deepEqual(project,snapshot);assert.deepEqual(project.tools.map(tool=>tool.depth),[10,7,13]);assert.deepEqual(project.tools[1].fingerGrips,[]);
  }
});

test('the same raw contour remains unchanged and watertight when finger cutouts are absent',()=>{
  for(const printMode of ['solid','light']){
    const project=projectFor(printMode,{withGrips:false}),snapshot=structuredClone(project);assert.deepEqual(validateLayout(project),[]);
    const mesh=inspectManufacturingSTL(exportSTL(project));assert.ok(mesh.volume>0);assert.deepEqual(project,snapshot);assert.equal(Object.hasOwn(project.tools[0],'fingerGrips'),false);
  }
});

test('an aligned near-collinear contour at large world coordinates cannot leave float32-collapsed stitch fans',()=>{
  // Reduced from a separate 442-point observed contour. Large absolute Y is
  // deliberate: a fan center can round onto an adjacent vertex in binary STL.
  assert.equal(alignedStitchContour.points.length,13);
  for(const printMode of ['solid','light']){
    const project=projectFor(printMode,{contour:alignedStitchContour}),snapshot=structuredClone(project);assert.ok(project.tools[0].y>350);assert.deepEqual(validateLayout(project),[]);
    const mesh=inspectManufacturingSTL(exportSTL(project));assert.deepEqual(project,snapshot);
    if(printMode==='solid'){
      const module=project.modules[0],polygon=pocketOutline(project.tools[0],project.clearance),pocketArea=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0))/2;
      const expected=(module.width-.5)*(module.height-.5)*project.insertHeight-pocketArea*project.tools[0].depth;
      assert.ok(Math.abs(mesh.volume-expected)<1,'discarding collapsed fans must preserve the intended solid volume');
    }
  }
});

test('nearby distinct contour edges do not become false T-junctions in a uniform module export',()=>{
  // Reduced from an independently observed 536-point contour in an 84x294 mm
  // module. The former broad matching tolerance created three count-four edges
  // even after opposite faces and collapsed float32 facets were handled.
  assert.equal(strictStitchContour.points.length,32);
  for(const printMode of ['light','solid']){
    const project=projectFor(printMode,{contour:strictStitchContour}),snapshot=structuredClone(project),module=project.modules[0];
    assert.equal(module.x,168);assert.equal(module.width,84);assert.equal(module.height,294);assert.deepEqual(validateLayout(project),[]);
    const mesh=inspectManufacturingSTL(exportSTL(project,{moduleId:module.id}));
    assert.equal(mesh.minX,.25);assert.equal(mesh.maxX,83.75,'selected-module STL must retain its local export origin');
    assert.deepEqual(project,snapshot);assert.equal(Object.hasOwn(project.tools[0],'fingerGrips'),false);
  }
});
