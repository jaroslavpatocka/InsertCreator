import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject,clone} from '../dist/model.js';
import {rotateModuleFree} from '../dist/module-edit.js';
import {transformedPoints,pocketOutline,validateLayout,exportSTL} from '../dist/geometry.js';
import {toolWorldPoint} from '../dist/finger-grip.js';
import {pocketMagnetHoles} from '../dist/tool-magnet.js';
import {validateModuleFootprint,modulePadding} from '../dist/module-footprint.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const closePoint=(a,b)=>{close(a.x,b.x);close(a.y,b.y);};
const fixture=()=>validateProject({...blankProject(),width:840,height:840,limitToBed:false,printMode:'solid',
  modules:[{id:'group',name:'Rigid group',x:168,y:168,width:252,height:168,sizeMode:'manual',grouped:true,pocketMargin:0,unit:'in'},
    {id:'other',name:'Other',x:588,y:168,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'one',name:'Asymmetric',moduleId:'group',points:[{x:0,y:0},{x:60,y:0},{x:60,y:22},{x:38,y:22},{x:38,y:42},{x:0,y:42}],x:190,y:200,rotation:13,depth:8,pocketMargin:.4,
      fingerGrips:[{id:'grip',x:1,y:16,radius:7}],pocketMagnets:[{id:'magnet',x:20,y:14,diameter:6,height:2}],sizeLabel:'17 mm'},
    {id:'two',name:'Other angle',moduleId:'group',points:rect(26,72),x:330,y:220,rotation:-17,depth:10,fingerGrips:[]}],
  toolSets:[{id:'set',name:'Pair',layout:'shared',toolIds:['one','two']}]});
const rotation=(module,degrees)=>{
  const cx=module.x+module.width/2,cy=module.y+module.height/2,a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return point=>({x:cx+(point.x-cx)*c-(point.y-cy)*s,y:cy+(point.x-cx)*s+(point.y-cy)*c});
};
const valid=project=>assert.deepEqual(validateLayout(project),[]);

test('free whole-module rotation moves every asymmetric contour vertex and attachment rigidly about the snapshot centre',()=>{
  const source=fixture(),before=clone(source),rotate=rotation(source.modules[0],45);valid(source);
  const next=rotateModuleFree(source,'group',45);valid(next);
  for(let i=0;i<source.tools.length;i++){
    const old=source.tools[i],tool=next.tools[i],expected=transformedPoints(old).map(rotate),actual=transformedPoints(tool);
    actual.forEach((point,index)=>closePoint(point,expected[index]));
    assert.deepEqual(tool.points,old.points);assert.deepEqual(tool.fingerGrips,old.fingerGrips);assert.deepEqual(tool.pocketMagnets,old.pocketMagnets);
    assert.equal(tool.moduleId,old.moduleId);assert.equal(tool.depth,old.depth);assert.equal(tool.pocketMargin,old.pocketMargin);
  }
  closePoint(toolWorldPoint(next.tools[0])(next.tools[0].fingerGrips[0]),rotate(toolWorldPoint(source.tools[0])(source.tools[0].fingerGrips[0])));
  closePoint(pocketMagnetHoles(next.tools[0])[0],rotate(pocketMagnetHoles(source.tools[0])[0]));
  assert.equal(next.tools[0].sizeLabel,'17 mm');assert.equal(next.modules[0].pocketMargin,0);assert.equal(next.modules[0].unit,'in');
  assert.deepEqual(next.modules[1],source.modules[1]);assert.deepEqual(next.toolSets,source.toolSets);assert.deepEqual(source,before);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))),validateProject(next));
});

test('snapshot-based angles do not accumulate drift and preserve the literal zero state',()=>{
  const source=fixture(),before=clone(source);
  for(const angle of [1,13.25,45,90,180,270,-45,359.5]){
    const next=rotateModuleFree(source,'group',angle),rotate=rotation(source.modules[0],angle);valid(next);
    next.tools.forEach((tool,i)=>transformedPoints(tool).forEach((point,index)=>closePoint(point,rotate(transformedPoints(source.tools[i])[index]))));
    for(const value of ['x','y','width','height'])close(next.modules[0][value]/source.grid,Math.round(next.modules[0][value]/source.grid));
  }
  assert.deepEqual(rotateModuleFree(source,'group',0),source);assert.deepEqual(rotateModuleFree(source,'group',360),source);
  assert.notEqual(rotateModuleFree(source,'group',0),source);assert.deepEqual(source,before);
});

test('free rotation respects locks and rejects invalid angles without changing the source',()=>{
  for(const value of [NaN,Infinity,null,true,'']){
    const source=fixture(),before=clone(source);assert.throws(()=>rotateModuleFree(source,'group',value));assert.deepEqual(source,before);
  }
  for(const lock of ['module','tool']){
    const source=fixture();if(lock==='module')source.modules[0].locked=true;else source.tools[1].locked=true;
    const before=clone(source);assert.throws(()=>rotateModuleFree(source,'group',45),/odemkněte/);assert.deepEqual(source,before);
  }
});

test('invalid rotation is available as a red preview and accepted edits validate the affected shell atomically',()=>{
  const source=fixture();source.modules[1].x=252;source.modules[1].y=126;source.modules[1].width=42;source.modules[1].height=42;
  const before=clone(source);valid(source);
  const preview=rotateModuleFree(source,'group',45,{validate:false});
  assert.ok(validateLayout(preview).some(issue=>issue.type==='overlap'&&issue.ids.includes('group')));
  assert.throws(()=>rotateModuleFree(source,'group',45),/překrývají/);assert.deepEqual(source,before);
  const edge=fixture();edge.height=336;edge.modules[0].y=168;edge.modules[0].height=168;
  assert.throws(()=>rotateModuleFree(edge,'group',90));
  assert.ok(validateLayout(rotateModuleFree(edge,'group',90,{validate:false})).some(issue=>issue.type==='outside'));
});

test('free rotation rebuilds stepped footprints and preserves Gridfinity raster placement',()=>{
  const source=validateProject({...blankProject(),width:504,height:420,limitToBed:false,clearance:0,
    modules:[{id:'group',x:126,y:126,width:126,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1}],sizeMode:'auto'}],
    tools:[{id:'one',name:'Long',moduleId:'group',x:136,y:136,points:rect(90,15),depth:8,fingerGrips:[]},
      {id:'two',name:'Short',moduleId:'group',x:136,y:175,points:rect(15,20),depth:8,fingerGrips:[]}]});
  valid(source);const next=rotateModuleFree(source,'group',45);valid(next);validateModuleFootprint(next.modules[0],next.grid);
  assert.deepEqual(next.tools.map(tool=>tool.points),source.tools.map(tool=>tool.points));
  const grid=rotateModuleFree({...fixture(),bottomMode:'grid'},'group',45);valid(grid);
  for(const value of ['x','y','width','height'])close(grid.modules[0][value]/42,Math.round(grid.modules[0][value]/42));
});

test('empty modules rotate their physical envelope and unrelated layout errors do not block a valid group edit',()=>{
  const source=fixture(),blank=rotateModuleFree(source,'other',45);valid(blank);assert.deepEqual(blank.tools,source.tools);
  assert.ok(blank.modules[1].width>source.modules[1].width);assert.ok(blank.modules[1].height>source.modules[1].height);
  source.modules.push({id:'bad',x:900,y:0,width:42,height:42,sizeMode:'manual'});
  const next=rotateModuleFree(source,'group',45);assert.ok(validateLayout(next).every(issue=>issue.ids.includes('bad')));
});

test('rotated real pockets, finger relief and magnet export to a closed binary STL',()=>{
  const next=rotateModuleFree(fixture(),'group',45),bytes=exportSTL(next),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=[];
  for(let i=0;i<view.getUint32(80,true);i++)triangles.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));
  assert.ok(triangles.length>100);validatePrintMesh(triangles);
});

test('corner rotation near the drawer edge can minimally translate the whole group inside without merging neighbours',()=>{
  const source=validateProject({...blankProject(),limitToBed:false,
    modules:[{id:'group',x:0,y:0,width:168,height:42,sizeMode:'auto'}],
    tools:[{id:'long',name:'Long tool',moduleId:'group',x:8,y:10,rotation:0,points:rect(140,16),depth:8,
      fingerGrips:[{id:'g',x:1,y:8,radius:5}],pocketMagnets:[{id:'m',x:80,y:8,diameter:4,height:2}]}]});
  valid(source);const before=clone(source),strict=rotateModuleFree(source,'group',45,{validate:false});
  assert.ok(strict.modules[0].y<0);assert.throws(()=>rotateModuleFree(source,'group',45));
  const next=rotateModuleFree(source,'group',45,{keepInside:true});valid(next);
  assert.equal(next.modules[0].x,strict.modules[0].x);assert.equal(next.modules[0].y,0);
  const dy=-strict.modules[0].y;close(dy/source.grid,Math.round(dy/source.grid));
  transformedPoints(next.tools[0]).forEach((point,i)=>closePoint(point,{x:transformedPoints(strict.tools[0])[i].x,y:transformedPoints(strict.tools[0])[i].y+dy}));
  assert.deepEqual(next.tools[0].fingerGrips,source.tools[0].fingerGrips);assert.deepEqual(next.tools[0].pocketMagnets,source.tools[0].pocketMagnets);
  assert.deepEqual(source,before);
  const blocked=clone(source);blocked.modules.push({id:'neighbour',name:'Neighbour',x:0,y:126,width:42,height:42,sizeMode:'manual'});valid(blocked);
  const blockedBefore=clone(blocked),preview=rotateModuleFree(blocked,'group',45,{keepInside:true,validate:false});
  assert.equal(preview.modules.length,2);assert.deepEqual(preview.modules[1],blocked.modules[1]);
  assert.throws(()=>rotateModuleFree(blocked,'group',45,{keepInside:true}),/překrývají/);assert.deepEqual(blocked,blockedBefore);
  const tooSmall=clone(source);tooSmall.height=84;
  const invalid=rotateModuleFree(tooSmall,'group',45,{keepInside:true,validate:false});
  assert.ok(invalid.modules[0].height>tooSmall.height);assert.throws(()=>rotateModuleFree(tooSmall,'group',45,{keepInside:true}));
});

test('separate small keyboard or pointer rotations never accumulate raster slack into a growing manual perimeter',()=>{
  let next=validateProject({...blankProject(),width:840,height:840,limitToBed:false,
    modules:[{id:'group',x:168,y:168,width:168,height:84,sizeMode:'manual'}],
    tools:[{id:'long',name:'Long tool',moduleId:'group',x:182,y:202,rotation:0,points:rect(140,16),depth:8,fingerGrips:[]}]});
  const original=clone(next);
  for(const degrees of [...Array(30).fill(1),...Array(30).fill(-1)]){
    next=rotateModuleFree(next,'group',degrees,{keepInside:true});valid(next);
    const module=next.modules[0],points=pocketOutline(next.tools[0],next),xs=points.map(point=>point.x),ys=points.map(point=>point.y),padding=modulePadding(next);
    // Outward rounding can add less than one cell per edge, but no historic slack.
    assert.ok(module.width<Math.max(...xs)-Math.min(...xs)+2*padding+2*next.grid+.001,'manual width stays bounded by current pockets');
    assert.ok(module.height<Math.max(...ys)-Math.min(...ys)+2*padding+2*next.grid+.001,'manual height stays bounded by current pockets');
    assert.ok(module.width<=210&&module.height<=168,'one-degree gestures cannot inflate a small tool to a large tray');
    assert.deepEqual(next.tools[0].points,original.tools[0].points);
  }
  close(next.tools[0].rotation,0);
});
