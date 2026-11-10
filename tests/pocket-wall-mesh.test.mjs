import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {buildColorZones,buildPrintTriangles,printConfig,trianglesVolume,validatePrintMesh} from '../dist/print-geometry.js';

// Independent expectations: a 40 x 20 mm rectangular pocket and closed-form wall profiles.
const W=40,D=20,X0=22,Y0=32,STEP=.2,PERIMETER=2*(W+D);
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const project=(printMode,extra={})=>({...blankProject(),width:200,height:200,limitToBed:false,printMode,bottomMode:'plain',insertHeight:25,sizeLabels:false,
  modules:[{id:'m',name:'M',x:0,y:0,width:84,height:84,sizeMode:'manual'}],...extra});
const pocket=(depth,pocketWall,extra={})=>({id:'t',name:'Pocket',moduleId:'m',poly:rect(X0,Y0,W,D),depth,pocketWall,...extra});
const build=(p,tools,options)=>buildPrintTriangles(p,p.modules,tools,{x:0,y:0},options);

function closed(mesh){
  validatePrintMesh(mesh);
  const edges=new Map(),key=p=>p.map(v=>Math.round(Math.fround(v)*1e5)).join(',');
  for(const t of mesh)for(let i=0;i<3;i++){const a=key(t[i]),b=key(t[(i+1)%3]),k=a<b?a+'|'+b:b+'|'+a;edges.set(k,(edges.get(k)||0)+(a<b?1:-1)*1e6+1);}
  for(const value of edges.values())assert.equal(value,2,'every edge has exactly two facets with opposite winding');
}
// Area of the rectangle offset by d: round joins outside, sharp corners inside.
const area=d=>d>=0?W*D+PERIMETER*d+Math.PI*d*d:(W+2*d)*(D+2*d);
const profile={
  draft:(a,depth)=>h=>h*Math.tan(a*Math.PI/180),
  chamfer:(c,depth)=>h=>Math.max(0,h-(depth-c)),
  roundTop:(r,depth)=>h=>{const d=h-(depth-r);return d<=0?0:r-Math.sqrt(r*r-d*d);},
  roundBottom:(r,depth)=>h=>h>=r?0:-(r-Math.sqrt(r*r-(r-h)*(r-h))),
};
// A terrace lies between the smooth profile and the profile one step lower (both in height and width).
function removedBounds(offsetAt,depth){
  let upper=0,lower=0;const n=20000,dz=depth/n;
  for(let i=0;i<n;i++){const h=(i+.5)*dz,d=offsetAt(h);upper+=area(d)*dz;lower+=area(Math.max(offsetAt(Math.max(0,h-STEP)),d-STEP))*dz;}
  return{lower,upper};
}
const pocketVertices=(mesh,z)=>mesh.flat().filter(p=>Math.abs(p[2]-z)<1e-6&&p[0]>X0-12&&p[0]<X0+W+12&&p[1]>Y0-12&&p[1]<Y0+D+12);
const extent=points=>({minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))});
const WALLS=[{type:'draft',value:10},{type:'chamfer',value:3},{type:'roundTop',value:3},{type:'roundBottom',value:3}];

test('every wall profile yields a closed mesh in solid and light mode',()=>{
  for(const printMode of ['solid','light'])for(const wall of WALLS){
    const mesh=build(project(printMode),[pocket(10,wall)]);
    closed(mesh);assert.ok(mesh.length<40000,`${printMode}/${wall.type}: ${mesh.length} triangles`);
  }
});

test('solid pockets remove the analytic profile volume within one terrace step',()=>{
  const p=project('solid'),cfg=printConfig(p),block=83.5*83.5*cfg.height,depth=10;
  const vertical=block-trianglesVolume(build(p,[pocket(depth,null)]));
  assert.ok(Math.abs(vertical-W*D*depth)<1e-3,'vertical pocket is an exact prism');
  for(const wall of WALLS){
    const removed=block-trianglesVolume(build(p,[pocket(depth,wall)])),{lower,upper}=removedBounds(profile[wall.type](wall.value,depth),depth);
    // Round joins are polygonised inside the true arc; allow that small chord loss.
    assert.ok(removed>lower-2&&removed<upper+.5,`${wall.type}: removed ${removed.toFixed(2)} outside ${lower.toFixed(2)}..${upper.toFixed(2)}`);
  }
  // Chamfer c adds about perimeter*c^2/2 plus the corner cones.
  const c=3,chamfer=block-trianglesVolume(build(p,[pocket(depth,{type:'chamfer',value:c})]))-vertical,smooth=PERIMETER*c*c/2+Math.PI*c**3/3;
  assert.ok(chamfer<smooth+.5&&chamfer>smooth-(PERIMETER+2*Math.PI*c)*c*STEP/2-1,`chamfer adds ${chamfer.toFixed(2)} mm3 (smooth ${smooth.toFixed(2)})`);
});

test('a drafted pocket opens by depth*tan(angle) and keeps its floor',()=>{
  for(const printMode of ['solid','light']){
    const p=project(printMode),cfg=printConfig(p),depth=20,angle=10,mesh=build(p,[pocket(depth,{type:'draft',value:angle})]);closed(mesh);
    const floorZ=printMode==='solid'?cfg.height-depth:cfg.effectiveBaseMm,topZ=floorZ+depth,grow=depth*Math.tan(angle*Math.PI/180);
    // The light floor plane also holds the outer edge of the wall ring; keep the pocket outline only.
    const floor=extent(pocketVertices(mesh,floorZ).filter(q=>q[0]>X0-1e-3&&q[0]<X0+W+1e-3&&q[1]>Y0-1e-3&&q[1]<Y0+D+1e-3));
    assert.ok(Math.abs(floor.minX-X0)<1e-4&&Math.abs(floor.maxX-X0-W)<1e-4&&Math.abs(floor.minY-Y0)<1e-4&&Math.abs(floor.maxY-Y0-D)<1e-4,'floor equals the outline');
    if(printMode==='solid'){
      const top=extent(pocketVertices(mesh,topZ));
      for(const value of [X0-top.minX,top.maxX-X0-W,Y0-top.minY,top.maxY-Y0-D])assert.ok(value<=grow+1e-4&&value>grow-STEP-1e-4,`top opening grows ${value} (expected ${grow})`);
    }else{
      // The light wall ring keeps the full wall outside the widest section.
      const top=extent(pocketVertices(mesh,topZ).filter(p=>p[0]>X0+W));
      assert.ok(top.maxX-(X0+W)>=cfg.wall+grow-STEP-1e-4&&top.maxX-(X0+W)<=cfg.wall+grow+1e-3,`ring reaches ${top.maxX-X0-W}`);
    }
  }
});

test('a round-bottom pocket has its floor at the set depth, shrunk by the radius',()=>{
  for(const printMode of ['solid','light']){
    const p=project(printMode),cfg=printConfig(p),depth=10,r=3,mesh=build(p,[pocket(depth,{type:'roundBottom',value:r})]);closed(mesh);
    const floorZ=printMode==='solid'?cfg.height-depth:cfg.effectiveBaseMm;
    if(printMode==='solid')assert.equal(Math.min(...mesh.flat().filter(q=>q[0]>X0&&q[0]<X0+W&&q[1]>Y0&&q[1]<Y0+D).map(q=>q[2])),floorZ);
    const floor=extent(pocketVertices(mesh,floorZ).filter(q=>q[0]>X0-1e-6&&q[0]<X0+W+1e-6&&q[1]>Y0-1e-6&&q[1]<Y0+D+1e-6));
    assert.ok(Math.abs(floor.minX-X0-r)<1e-4&&Math.abs(X0+W-floor.maxX-r)<1e-4&&Math.abs(floor.minY-Y0-r)<1e-4&&Math.abs(Y0+D-floor.maxY-r)<1e-4,'floor shrinks by the radius');
    if(printMode==='solid'){const top=extent(pocketVertices(mesh,cfg.height));assert.ok(Math.abs(top.minX-X0)<1e-4&&Math.abs(top.maxX-X0-W)<1e-4,'top edge unchanged');}
  }
});

test('floor inlays use the floor section and colour zones stay closed',()=>{
  for(const printMode of ['solid','light']){
    const p=project(printMode,{multiMaterial:{enabled:true,floorThickness:1}}),r=3;
    const zones=buildColorZones(p,p.modules,[pocket(10,{type:'roundBottom',value:r})],{x:0,y:0});
    for(const zone of zones)closed(zone.mesh);
    const floor=zones.find(zone=>zone.zone==='floor');
    assert.ok(Math.abs(trianglesVolume(floor.mesh)-(W-2*r)*(D-2*r)*1)<1e-3,'inlay has the shrunk floor area');
    const draft=buildColorZones(p,p.modules,[pocket(10,{type:'draft',value:15})],{x:0,y:0});
    for(const zone of draft)closed(zone.mesh);
    assert.ok(Math.abs(trianglesVolume(draft.find(zone=>zone.zone==='floor').mesh)-W*D)<1e-3,'draft inlay keeps the floor outline');
  }
});

test('split cuts, pocket magnets, Gridfinity feet and labels work with profiled pockets',()=>{
  const clip={x:0,y:0,width:42,height:84};
  for(const printMode of ['solid','light'])for(const wall of WALLS){
    closed(build(project(printMode),[pocket(10,wall)],{clip}));
    closed(build(project(printMode,{bottomMode:'grid'}),[pocket(10,wall)],{clip}));
    const p=project(printMode,{bottomMode:'magnet',sizeLabels:true}),tools=[pocket(10,wall,{pocketMagnets:[{id:'pm',x:20,y:10,diameter:6,height:2}],nominalSize:{value:13,unit:'mm'},points:rect(0,0,W,D),x:X0,y:Y0,rotation:0,fingerGrips:[]})];
    assert.equal(planSizeLabels(p,p.modules,tools).labels.length,1,'the size label is placed');
    closed(build(p,tools));
  }
});

test('profiles are validated against the pocket depth',()=>{
  assert.throws(()=>build(project('solid'),[pocket(4,{type:'roundTop',value:5})]),/hloubka kapsy|depth/i);
  assert.throws(()=>build(project('solid'),[pocket(10,{type:'draft',value:60})]),/stěny kapsy|wall/i);
});

test('vertical walls keep the original mesh',()=>{
  for(const printMode of ['solid','light']){
    const p=project(printMode),meshes=[undefined,null,{type:'vertical'}].map(wall=>build(p,[pocket(10,wall)]));
    const json=meshes.map(mesh=>JSON.stringify(mesh));assert.equal(json[1],json[0]);assert.equal(json[2],json[0]);
    assert.equal(meshes[0].length,printMode==='solid'?44:158);
  }
});
