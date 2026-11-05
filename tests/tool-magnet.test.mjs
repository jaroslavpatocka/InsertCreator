import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {exportDXF,exportSVG,exportSTL,pocketOutline,printStats,validateLayout} from '../dist/geometry.js';
import {buildColorZones,buildPrintTriangles,validatePrintMesh} from '../dist/print-geometry.js';
import {magnetFloorNeed,maxPocketDepth,moduleMagnetLift,requiredInsertHeight} from '../dist/print-material.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {automaticPocketMagnets,magnetHoleDepth,magnetHoleDiameter,pocketMagnetHoles,pocketMagnetProblem,validatePocketMagnets} from '../dist/tool-magnet.js';
import {resizeToolDimensions} from '../dist/tool-dimensions.js';
import {smoothToolContour} from '../dist/tool-contour.js';
import {scaleTool} from '../dist/set-module.js';
import {bulkSetDepth} from '../dist/bulk-edit.js';

const square=size=>[{x:0,y:0},{x:size,y:0},{x:size,y:size},{x:0,y:size}];
const magnet=(x=20,y=20,extra={})=>({id:`m-${x}-${y}`,x,y,diameter:6,height:2,...extra});
const fixture=(extra={},tool={})=>({...blankProject(),width:84,height:84,printMode:'solid',modules:[{id:'mod',name:'Module',x:0,y:0,width:84,height:84}],tools:[{id:'t',name:'Holder',moduleId:'mod',points:square(40),x:20,y:20,depth:10,pocketMagnets:[magnet()],...tool}],...extra});
const prepared=project=>project.tools.map(tool=>({...tool,poly:pocketOutline(tool,project.clearance)}));
const mesh=(project,options)=>buildPrintTriangles(project,project.modules,prepared(project),{x:0,y:0},options);

// Odd crossings of an upward ray from (x,y,z): the point lies inside the solid.
function solidAt(triangles,x,y,z){
  const heights=[];
  for(const [a,b,c] of triangles){
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const height=u*a[2]+v*b[2]+w*c[2];
    if(height>z+1e-5&&!heights.some(previous=>Math.abs(previous-height)<1e-5))heights.push(height);
  }
  return heights.length%2===1;
}
// Slightly off-centre probes avoid rays through the fan vertices of a triangulated circle.
const CX=40.13,CY=40.07;

test('magnets survive project validation, follow the contour origin and reject bad sizes',()=>{
  const project=validateProject(fixture({}, {points:square(40).map(p=>({x:p.x+5,y:p.y+7})),pocketMagnets:[magnet(25,27)]}));
  assert.deepEqual(project.tools[0].pocketMagnets,[{id:'m-25-27',x:20,y:20,diameter:6,height:2}]);
  for(const bad of [[magnet(20,20,{diameter:1})],[magnet(20,20,{height:21})],[magnet(),magnet()],Array.from({length:13},(_,i)=>magnet(i,0))])assert.throws(()=>validatePocketMagnets(bad));
  assert.equal(magnetHoleDiameter(magnet()),6.2);assert.equal(magnetHoleDepth(magnet()),2.2);
});

test('hole positions rotate with the pocket and stay on the same point of the tool',()=>{
  const tool={id:'t',points:[{x:0,y:0},{x:60,y:0},{x:60,y:20},{x:0,y:20}],x:10,y:10,rotation:90,pocketMagnets:[magnet(50,10)]};
  const [hole]=pocketMagnetHoles(tool),pocket=pocketOutline(tool,0);
  assert.ok(Math.abs(hole.x-20)<1e-9&&Math.abs(hole.y-60)<1e-9,JSON.stringify(hole));
  assert.equal(pocketMagnetProblem(tool,pocket),null);
});

test('solid floor gets a blind round hole of the magnet size plus fit',()=>{
  const project=fixture(),triangles=mesh(project),floor=20-10;
  validatePrintMesh(triangles);
  // The hole hangs 2.2 mm below the 10 mm pocket floor; 7.8 mm of material remains.
  assert.equal(solidAt(triangles,CX,CY,floor-1),false);
  assert.equal(solidAt(triangles,CX,CY,floor-2.2+.05),false);
  assert.equal(solidAt(triangles,CX,CY,floor-2.2-.05),true);
  assert.equal(solidAt(triangles,CX,CY,.5),true);
  // Just beyond the Ø 6.2 hole the floor is still solid.
  assert.equal(solidAt(triangles,CX+3.3,CY,floor-1),true);
  assert.equal(solidAt(triangles,CX+2.9,CY,floor-1),false);
});

test('the height requirement counts the magnet under the pocket and repairs a shallow insert',()=>{
  const project=fixture({insertHeight:12},{depth:10}),tool=project.tools[0];
  assert.ok(Math.abs(magnetFloorNeed(project,tool)-3.4)<1e-9);
  assert.equal(requiredInsertHeight(project),13.4);
  assert.equal(maxPocketDepth(project,tool),8.6);
  assert.equal(maxPocketDepth(project),9.6);
  assert.ok(validateLayout(project).some(issue=>issue.type==='depth'&&issue.ids.includes('t')));
  assert.throws(()=>mesh(project),/Holder/);
  const repaired={...project,insertHeight:requiredInsertHeight(project)};
  assert.equal(validateLayout(repaired).length,0);
  const triangles=mesh(repaired);validatePrintMesh(triangles);
  assert.equal(solidAt(triangles,CX,CY,1.3),false);
  assert.equal(solidAt(triangles,CX,CY,1.1),true);
});

test('a default floor without a magnet keeps every existing limit',()=>{
  const project=fixture({},{pocketMagnets:[]});
  assert.equal(requiredInsertHeight(project),12.4);assert.equal(maxPocketDepth(project,project.tools[0]),17.6);
  assert.equal(moduleMagnetLift({...project,printMode:'light'},project.tools),0);
});

test('light mode thickens the base of the whole module and keeps the pocket depth',()=>{
  const project=fixture({printMode:'light',modules:[{id:'mod',name:'Module',x:0,y:0,width:168,height:84}],width:168},{depth:10});
  project.tools.push({id:'plain',name:'Plain',moduleId:'mod',points:square(30),x:90,y:20,depth:16.8});
  const lift=moduleMagnetLift(project,project.tools);
  assert.ok(Math.abs(lift-1)<1e-9);
  // The plain neighbour shares the raised base: 16.8 + 3.4 mm, not 16.8 + 2.4 mm.
  assert.equal(requiredInsertHeight(project),20.2);
  assert.ok(validateLayout(project).some(issue=>issue.type==='depth'&&issue.ids.includes('plain')));
  const tall={...project,insertHeight:20.2},triangles=mesh(tall);validatePrintMesh(triangles);
  assert.equal(solidAt(triangles,CX,CY,3.4-.1),false);
  assert.equal(solidAt(triangles,CX,CY,1.3),false);
  assert.equal(solidAt(triangles,CX,CY,1.1),true);
  // The wall still rises exactly by the pocket depth above the thicker floor.
  assert.equal(solidAt(triangles,18.5,40,3.4+10-.1),true);
  assert.equal(solidAt(triangles,18.5,40,3.4+10+.1),false);
  // Open floor next to the pockets has the same thicker base.
  assert.equal(solidAt(triangles,75,70,3.3),true);
  assert.equal(solidAt(triangles,75,70,3.5),false);
});

test('light labels sit on the thickened base',()=>{
  const project=fixture({printMode:'light',sizeLabels:true,width:168,modules:[{id:'mod',name:'Module',x:0,y:0,width:168,height:84}]},{sizeLabel:'12'});
  const {labels}=planSizeLabels(project);
  assert.equal(labels.length,1);assert.ok(Math.abs(labels[0].baseTop-3.4)<1e-6);
  validatePrintMesh(mesh(project));
});

test('a hole above a bottom magnet clears it, while a separated hole does not pay for it',()=>{
  const bottom={bottomMode:'magnet'},far=fixture(bottom);
  assert.ok(Math.abs(magnetFloorNeed(far,far.tools[0])-3.4)<1e-9);
  // The module corner magnet sits at 5.75, 5.75 world: move a pocket over it.
  const stacked=fixture({...bottom,modules:[{id:'mod',name:'Module',x:0,y:0,width:84,height:84}]},{points:square(30),x:4,y:4,pocketMagnets:[magnet(4,4)]});
  assert.ok(magnetFloorNeed(stacked,stacked.tools[0])>5.5);
  assert.ok(requiredInsertHeight({...stacked,tools:stacked.tools.map(t=>({...t,depth:15}))})>=19);
});

test('colour floor inlay has the same hole and the body is carved below it',()=>{
  const project=fixture({multiMaterial:{enabled:true,floorThickness:.6}});
  const zones=buildColorZones(project,project.modules,prepared(project),{x:0,y:0}),body=zones.find(z=>z.zone==='body').mesh,floor=zones.find(z=>z.zone==='floor').mesh;
  validatePrintMesh(body);validatePrintMesh(floor);
  assert.equal(solidAt(floor,CX,CY,9.7),false);assert.equal(solidAt(floor,30,30,9.7),true);
  assert.equal(solidAt(body,CX,CY,9.3),false);assert.equal(solidAt(body,CX,CY,10-2.2-.1),true);
  // A magnet shorter than the inlay leaves the body floor uncut.
  const thin=fixture({multiMaterial:{enabled:true,floorThickness:1.5}},{pocketMagnets:[magnet(20,20,{height:1})]});
  const thinZones=buildColorZones(thin,thin.modules,prepared(thin),{x:0,y:0});
  validatePrintMesh(thinZones[0].mesh);validatePrintMesh(thinZones[1].mesh);
  assert.equal(solidAt(thinZones[0].mesh,CX,CY,8.4),true);
  assert.equal(solidAt(thinZones[1].mesh,CX,CY,9.3),false);
});

test('holes reach all print paths: gridfinity, cut tiles, joints and fit test',async()=>{
  const grid=fixture({bottomMode:'grid'});
  const gridMesh=mesh(grid);validatePrintMesh(gridMesh);
  assert.equal(solidAt(gridMesh,CX,CY,4.75+10-1),false);
  for(const printMode of ['solid','light']){
    const wide=fixture({printMode,width:336,bedWidth:120,bedHeight:120,connectors:true,modules:[{id:'mod',name:'Module',x:0,y:0,width:252,height:84}]},{points:[{x:0,y:0},{x:200,y:0},{x:200,y:30},{x:0,y:30}],pocketMagnets:[magnet(100,15),magnet(30,15)]});
    const result=await preparePrintBatch(wide);
    assert.ok(result.parts.length>1,'module must be cut');
  }
  const fit=mesh(fixture(),{fit:true});assert.ok(fit.length>0);
});

test('a hole leaving the floor or merging with another one is a layout issue',()=>{
  const wall=fixture({},{pocketMagnets:[magnet(1,1)]});
  assert.ok(validateLayout(wall).some(issue=>issue.type==='overlap'&&/stěn/.test(issue.message)));
  const merged=fixture({},{pocketMagnets:[magnet(20,20),magnet(23,20)]});
  assert.ok(validateLayout(merged).some(issue=>issue.type==='overlap'&&/blízko/.test(issue.message)));
  assert.equal(validateLayout(fixture()).length,0);
});

test('automatic placement stays in the pocket, spreads along the tool and reports impossible sizes',()=>{
  const long={id:'long',points:[{x:0,y:0},{x:150,y:0},{x:150,y:20},{x:0,y:20}],x:0,y:0};
  const [one]=automaticPocketMagnets(long,{diameter:8,height:3,clearance:.8});
  assert.ok(Math.abs(one.x-75)<8&&Math.abs(one.y-10)<3);assert.equal(one.diameter,8);assert.equal(one.height,3);
  const three=automaticPocketMagnets(long,{diameter:8,height:3,count:3,clearance:.8}).sort((a,b)=>a.x-b.x);
  assert.equal(three.length,3);assert.ok(three[0].x<45&&three[2].x>105);
  assert.equal(pocketMagnetProblem({...long,pocketMagnets:three},pocketOutline(long,.8)),null);
  // Non-convex L-shape: the centroid is outside, every hole must stay on real floor.
  const ell={id:'ell',points:[{x:0,y:0},{x:90,y:0},{x:90,y:15},{x:15,y:15},{x:15,y:90},{x:0,y:90}],x:0,y:0};
  const placed=automaticPocketMagnets(ell,{count:2,clearance:0});
  assert.equal(pocketMagnetProblem({...ell,pocketMagnets:placed},pocketOutline(ell,0)),null);
  assert.throws(()=>automaticPocketMagnets({id:'n',points:[{x:0,y:0},{x:60,y:0},{x:60,y:4},{x:0,y:4}]},{diameter:10}),/nevejdou/);
  assert.throws(()=>automaticPocketMagnets(long,{diameter:18,count:12,clearance:0}),/nevejdou/);
});

test('scaling and resizing a tool move the hole centres and keep the real magnet size',()=>{
  const tool={id:'t',name:'T',points:[{x:0,y:0},{x:100,y:0},{x:100,y:30},{x:0,y:30}],x:0,y:0,depth:10,pocketMagnets:[magnet(50,15)]};
  const scaled=scaleTool(tool,2);assert.deepEqual([scaled.pocketMagnets[0].x,scaled.pocketMagnets[0].y,scaled.pocketMagnets[0].diameter],[100,30,6]);
  const longer=resizeToolDimensions(tool,{length:200});assert.ok(Math.abs(longer.pocketMagnets[0].x-100)<1e-6);assert.equal(longer.pocketMagnets[0].height,2);
});

test('bulk depth cannot sink a pocket into its magnet floor',()=>{
  const project=fixture();
  assert.throws(()=>bulkSetDepth(project,['t'],17.5),/17,6|16,6|Hloubka/);
  assert.equal(bulkSetDepth(project,['t'],16.6).tools[0].depth,16.6);
});

test('2D exports and print stats describe the holes',()=>{
  const project=fixture();
  assert.match(exportSVG(project),/id="magnets"[^]*<circle/);
  assert.match(exportDXF(project),/\r\nMAGNETS\r\n/);
  assert.equal(/MAGNETS/.test(exportDXF(fixture({},{pocketMagnets:[]}))),false);
  assert.ok(printStats(project).notes.some(note=>/magnet/i.test(note)));
  assert.ok(exportSTL(project).byteLength>84);
});

test('light models with a floor inlay build all colour zones at the reported height',async()=>{
  for(const floorThickness of [.6,2]){
    const project=fixture({printMode:'light',multiMaterial:{enabled:true,floorThickness}}),tall={...project,insertHeight:requiredInsertHeight(project)};
    assert.equal(validateLayout(tall).length,0);
    const zones=buildColorZones(tall,tall.modules,prepared(tall),{x:0,y:0}),body=zones.find(z=>z.zone==='body').mesh,floor=zones.find(z=>z.zone==='floor').mesh;
    validatePrintMesh(body);validatePrintMesh(floor);
    const top=Math.max(3.4-floorThickness,2.4)+floorThickness;
    assert.equal(solidAt(floor,CX,CY,top-.1),false);assert.equal(solidAt(floor,30,30,top-.1),true);
    assert.equal(solidAt(body,CX,CY,top-2.2-.1),true);
    assert.ok((await preparePrintBatch(tall)).parts.length>0);
  }
});

test('an invalid contour stays a layout issue, also for its light neighbour',()=>{
  const flat=[{x:0,y:0},{x:10,y:10},{x:20,y:20}];
  for(const printMode of ['solid','light']){
    const project=fixture({printMode},{points:flat});
    project.tools.push({id:'ok',name:'Ok',moduleId:'mod',points:square(10),x:60,y:60,depth:5,pocketMagnets:[magnet(5,5,{diameter:3,height:1})]});
    assert.ok(validateLayout(project).some(issue=>issue.ids.includes('t')));
    assert.ok(requiredInsertHeight(project)>0);
  }
});

test('a magnet does not put an untouched solid tool under its stricter check',()=>{
  const project=fixture({bottomMode:'magnet',width:168,modules:[{id:'mod',name:'Module',x:0,y:0,width:168,height:84}],multiMaterial:{enabled:true,floorThickness:2}},{depth:5});
  project.tools.push({id:'plain',name:'Plain',moduleId:'mod',points:square(30),x:100,y:20,depth:16.5});
  assert.equal(validateLayout(project).filter(issue=>issue.ids.includes('plain')).length,0);
});

test('light labels stay inside the insert over a thickened base',()=>{
  const project=fixture({printMode:'light',sizeLabels:true,width:168,modules:[{id:'mod',name:'Module',x:0,y:0,width:168,height:84}]},{depth:.5,sizeLabel:'12',pocketMagnets:[magnet(20,20,{height:5})]});
  const tall={...project,insertHeight:requiredInsertHeight(project)},{labels}=planSizeLabels(tall);
  for(const label of labels)assert.ok(label.top<=tall.insertHeight+1e-6);
});

test('a height inside the layout tolerance always builds',()=>{
  const triangles=mesh(fixture({insertHeight:13.3995}));validatePrintMesh(triangles);
});

test('limits stay fast for thousands of light tools with magnets',()=>{
  const tools=Array.from({length:3000},(_,i)=>({id:'t'+i,name:'T',moduleId:'m'+i%30,points:square(40),x:0,y:0,depth:5,pocketMagnets:[magnet()]}));
  const project={...fixture({printMode:'light'}),tools,modules:Array.from({length:30},(_,i)=>({id:'m'+i,name:'M',x:0,y:0,width:84,height:84}))},start=performance.now();
  assert.ok(requiredInsertHeight(project)>8);
  assert.ok(performance.now()-start<500);
});

test('smoothing a contour keeps the hole on the same point of the tool',()=>{
  const wobble=Array.from({length:80},(_,i)=>({x:5+60*i/79,y:7+(i%2)*.05})).concat([{x:65,y:47},{x:5,y:47}]);
  const project=fixture({},{points:wobble,pocketMagnets:[magnet(35,27)]});
  const before=pocketMagnetHoles(project.tools[0])[0],next=smoothToolContour(project,'t'),after=pocketMagnetHoles(next.tools[0])[0];
  assert.ok(Math.hypot(before.x-after.x,before.y-after.y)<.2);
});
