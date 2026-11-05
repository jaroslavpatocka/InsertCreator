import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {bounds,pocketOutline,validateLayout,exportSTL} from '../dist/geometry.js';
import {growModuleForMargins} from '../dist/pocket-growth.js';
import {addPhotoModule} from '../dist/photo-module.js';
import {containsPocketWalls,modulePadding} from '../dist/module-footprint.js';
import {planJoints} from '../dist/module-joints.js';

const rect=(id,x,y,width=30,height=20,extra={})=>({id,name:id,moduleId:'m',x,y,rotation:0,depth:8,points:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],fingerGrips:[],...extra});
const drawer=(extra={})=>({...blankProject(),width:400,height:300,grid:10,limitToBed:false,
  modules:[{id:'m',name:'Photographed arrangement',x:0,y:0,width:80,height:40,sizeMode:'manual',grouped:true,pocketMargin:4}],
  tools:[rect('left',10,10),rect('right',45,10)],...extra});
const center=tool=>{const b=bounds(tool);return{x:b.x+b.width/2,y:b.y+b.height/2};};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const width=(tool,project)=>{const points=pocketOutline(tool,project);return Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));};
const localized=error=>error instanceof Error&&!!error.i18n;
function unchangedShape(actual,before){
  assert.equal(actual.id,before.id);assert.equal(actual.moduleId,before.moduleId);assert.equal(actual.rotation,before.rotation);assert.equal(actual.depth,before.depth);
  assert.deepEqual(actual.points,before.points);assert.deepEqual(actual.fingerGrips,before.fingerGrips);assert.deepEqual(actual.pocketMagnets,before.pocketMagnets);
}
function atomicFailure(project){
  const before=structuredClone(project);
  assert.throws(()=>growModuleForMargins(project,'m'),localized);
  assert.deepEqual(project,before,'an unsuccessful edit cannot partially move tools or enlarge their module');
}

test('increased module margin enlarges its container and restores safe walls without repacking',()=>{
  const project=drawer(),before=structuredClone(project);
  assert.ok(validateLayout(project).some(issue=>issue.type==='overlap'),'the enlarged pockets initially touch or overlap');
  const result=growModuleForMargins(project,'m'),module=result.modules[0];
  assert.deepEqual(validateLayout(result),[]);assert.deepEqual(project,before);
  assert.ok(module.width>before.modules[0].width);assert.ok(module.height>=before.modules[0].height);
  assert.equal(module.width%project.grid,0);assert.equal(module.height%project.grid,0);assert.equal(module.x,0);assert.equal(module.y,0);
  assert.equal(module.grouped,true);assert.equal(module.sizeMode,'manual');assert.equal(module.pocketMargin,4);
  result.tools.forEach((tool,i)=>unchangedShape(tool,before.tools[i]));
  assert.ok(result.tools[0].x<result.tools[1].x);close(result.tools[0].y,result.tools[1].y);
});

test('the enlarged pockets and minimum internal wall produce a closed manufacturing STL',()=>{
  const result=growModuleForMargins(drawer(),'m'),bytes=exportSTL(result,{moduleId:'m',checkBed:false}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=view.getUint32(80,true);
  assert.ok(triangles>0);assert.equal(bytes.length,84+triangles*50);
});

test('three photographed tool centers retain one common scale, directions, order and rotations',()=>{
  const project=drawer({modules:[{id:'m',x:0,y:0,width:60,height:60,sizeMode:'manual',grouped:true,pocketMargin:4}],
    tools:[rect('top-left',10,10,20,20),rect('top-right',35,10,20,20,{rotation:90}),rect('bottom-left',10,35,20,20,{rotation:180})]}),before=structuredClone(project);
  const result=growModuleForMargins(project,'m'),source=before.tools.map(center),actual=result.tools.map(center),factor=(actual[1].x-actual[0].x)/(source[1].x-source[0].x);
  assert.ok(factor>1);assert.deepEqual(validateLayout(result),[]);
  for(let i=1;i<source.length;i++){
    close(actual[i].x-actual[0].x,(source[i].x-source[0].x)*factor);
    close(actual[i].y-actual[0].y,(source[i].y-source[0].y)*factor);
  }
  result.tools.forEach((tool,i)=>unchangedShape(tool,before.tools[i]));assert.deepEqual(project,before);
});

test('a safe larger margin keeps every position and existing module dimension exactly unchanged',()=>{
  const project=drawer({modules:[{id:'m',x:0,y:0,width:120,height:70,sizeMode:'manual',grouped:true,pocketMargin:4}],
    tools:[rect('left',20,20,20,20),rect('right',70,20,20,20)]});
  assert.deepEqual(validateLayout(project),[]);assert.deepEqual(growModuleForMargins(project,'m'),project);
});

test('an individual tool margin grows only its module and preserves inherited and zero margins',()=>{
  const project=drawer({modules:[{id:'m',x:0,y:0,width:80,height:40,sizeMode:'manual',grouped:true,pocketMargin:.8}],
    tools:[rect('own',10,10,30,20,{pocketMargin:6}),rect('zero',45,10,30,20,{pocketMargin:0})]}),before=structuredClone(project);
  const result=growModuleForMargins(project,'m');
  assert.deepEqual(validateLayout(result),[]);assert.equal(result.modules[0].pocketMargin,.8);assert.equal(result.tools[0].pocketMargin,6);assert.equal(result.tools[1].pocketMargin,0);
  close(width(result.tools[0],result),42);close(width(result.tools[1],result),30);assert.deepEqual(project,before);
});

test('single-tool outer-wall expansion respects the 42 mm Gridfinity grid without changing the tool contour',()=>{
  const project=drawer({width:252,height:252,grid:42,bottomMode:'grid',modules:[{id:'m',x:0,y:0,width:42,height:84,sizeMode:'manual',pocketMargin:6}],
    tools:[rect('long',8,8,26,68)]}),before=structuredClone(project),result=growModuleForMargins(project,'m'),module=result.modules[0];
  assert.deepEqual(validateLayout(result),[]);assert.ok(module.width>42||module.height>84);
  for(const value of [module.x,module.y,module.width,module.height])assert.equal(value%42,0);
  unchangedShape(result.tools[0],before.tools[0]);assert.deepEqual(project,before);
});

test('unrelated modules and tools retain their positions and settings while the selected module grows',()=>{
  const project=drawer(),other={id:'fixed',name:'Fixed',x:200,y:100,width:60,height:60,sizeMode:'manual',locked:true,pocketMargin:2};
  project.modules.push(other);project.tools.push(rect('other',220,120,15,15,{moduleId:'fixed',locked:true}));
  const before=structuredClone(project),result=growModuleForMargins(project,'m');
  assert.deepEqual(validateLayout(result),[]);assert.deepEqual(result.modules[1],before.modules[1]);assert.deepEqual(result.tools[2],before.tools[2]);assert.equal(result.clearance,before.clearance);
});

test('an adjacent module that fills the available expansion space blocks the edit atomically',()=>{
  const project=drawer({width:100,height:40});
  project.modules.push({id:'neighbor',name:'Neighbor',x:80,y:0,width:20,height:40,sizeMode:'manual',locked:true});
  atomicFailure(project);
});

test('drawer limits block an impossible growth without moving, rotating or parking tools',()=>{
  atomicFailure(drawer({width:80,height:40}));
});

test('module and member locks prevent automatic growth atomically',()=>{
  const moduleLocked=drawer();moduleLocked.modules[0].locked=true;atomicFailure(moduleLocked);
  const toolLocked=drawer();toolLocked.tools[0].locked=true;atomicFailure(toolLocked);
});

test('coincident tool centers cannot be repaired by changing their photographed arrangement',()=>{
  const project=drawer();project.tools[1].x=project.tools[0].x;project.tools[1].y=project.tools[0].y;atomicFailure(project);
});

test('photo import can opt into safer margin spacing while keeping one module and the photographed arrangement',()=>{
  const fixed={id:'fixed',name:'Existing',x:0,y:0,width:100,height:100,locked:true,sizeMode:'manual'},project=drawer({modules:[fixed],tools:[]});
  const tools=[rect('a',100,100,30,20,{pocketMargin:4}),rect('b',135,100,30,20,{pocketMargin:4})],before=structuredClone({project,tools});
  assert.throws(()=>addPhotoModule(project,tools,{moduleId:'photo'}),localized,'strict imports retain the exact-spacing rejection');
  const result=addPhotoModule(project,tools,{moduleId:'photo',growMargins:true});
  assert.equal(result.placed,true);assert.deepEqual(result.unplaced,[]);assert.deepEqual(validateLayout(result.project),[]);
  assert.deepEqual(result.project.modules[0],fixed);assert.equal(result.project.modules.length,2);assert.equal(result.project.modules[1].grouped,true);
  assert.deepEqual(result.project.tools.map(tool=>tool.moduleId),['photo','photo']);
  result.project.tools.forEach((tool,i)=>unchangedShape(tool,{...tools[i],moduleId:'photo'}));
  assert.ok(result.project.tools[1].x-result.project.tools[0].x>tools[1].x-tools[0].x);close(result.project.tools[1].y-result.project.tools[0].y,0);
  assert.deepEqual({project,tools},before);
});

test('an 80-tool photograph with a large margin stays in one safely enlarged module without scaling any tool',()=>{
  const project=drawer({width:1000,height:800,grid:42,modules:[],tools:[]}),tools=Array.from({length:80},(_,i)=>rect(`tool-${i}`,500+(i%10)*20,200+Math.floor(i/10)*26,12,18,{rotation:i%2?180:0,pocketMargin:8}));
  const before=structuredClone({project,tools}),result=addPhotoModule(project,tools,{moduleId:'photo-80',growMargins:true});
  assert.equal(result.placed,true);assert.equal(result.project.modules.length,1);assert.equal(result.project.tools.length,80);assert.deepEqual(validateLayout(result.project),[]);
  const source=tools.map(center),actual=result.project.tools.map(center),factor=(actual[1].x-actual[0].x)/(source[1].x-source[0].x);
  assert.ok(factor>1);for(let i=0;i<tools.length;i++){
    unchangedShape(result.project.tools[i],{...tools[i],moduleId:'photo-80'});
    close(actual[i].x-actual[0].x,(source[i].x-source[0].x)*factor);close(actual[i].y-actual[0].y,(source[i].y-source[0].y)*factor);
  }
  assert.deepEqual({project,tools},before);
});

test('right and bottom edge growth extends left/up and keeps an already safe tool position exactly',()=>{
  const project=drawer({width:100,height:100,modules:[{id:'m',x:60,y:60,width:40,height:40,sizeMode:'manual',pocketMargin:6}],tools:[rect('corner',64,64,27,27)]}),before=structuredClone(project);
  const result=growModuleForMargins(project,'m'),module=result.modules[0];
  assert.deepEqual(validateLayout(result),[]);assert.ok(module.x<60&&module.y<60);assert.equal(module.x+module.width,100);assert.equal(module.y+module.height,100);
  assert.equal(result.tools[0].x,64);assert.equal(result.tools[0].y,64);unchangedShape(result.tools[0],before.tools[0]);assert.deepEqual(project,before);
});

test('a stepped container can grow around unchanged contours and preserve every neighbor',()=>{
  const project=drawer({width:252,height:252,grid:42,modules:[{id:'m',x:0,y:0,width:84,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],sizeMode:'manual',grouped:true,pocketMargin:10},
    {id:'neighbor',x:126,y:0,width:42,height:84,locked:true,sizeMode:'manual'}],tools:[rect('across-top',6,6,60,25)]}),before=structuredClone(project);
  const result=growModuleForMargins(project,'m');
  assert.deepEqual(validateLayout(result),[]);unchangedShape(result.tools[0],before.tools[0]);assert.deepEqual(result.modules[1],before.modules[1]);
  assert.ok(result.modules[0].width>=84&&result.modules[0].height>=84);assert.deepEqual(project,before);
});

test('safe photo spacing just above the wall minimum remains exactly identical with margin growth enabled',()=>{
  const project=drawer({modules:[],tools:[]}),tools=[rect('near-a',100,100,15,15,{moduleId:null,pocketMargin:2}),rect('near-b',121.405,100,15,15,{moduleId:null,pocketMargin:2})],before=structuredClone({project,tools});
  const strict=addPhotoModule(project,tools,{moduleId:'near-safe'}),result=addPhotoModule(project,tools,{moduleId:'near-safe',growMargins:true});
  assert.deepEqual(validateLayout(result.project),[]);assert.deepEqual(result,strict,'a valid 2.405 mm wall must not be widened or cause module growth');
  assert.deepEqual({project,tools},before);
});

test('spacing inside an existing stepped footprint preserves its occupied cells and a neighbor in the notch',()=>{
  const project=drawer({width:168,height:126,grid:42,modules:[{id:'m',x:0,y:0,width:84,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],sizeMode:'manual',grouped:true,pocketMargin:2},
    {id:'notch-neighbor',x:42,y:42,width:42,height:42,sizeMode:'manual',locked:true}],tools:[rect('upper',7,7,15,15),rect('lower',7,27,15,15)]}),before=structuredClone(project);
  assert.ok(validateLayout(project).some(issue=>issue.type==='overlap'&&issue.ids.includes('upper')&&issue.ids.includes('lower')));
  const result=growModuleForMargins(project,'m');
  assert.deepEqual(validateLayout(result),[]);assert.deepEqual(result.modules,before.modules,'the existing stepped footprint already contains the safely spread tools');
  assert.ok(result.tools[1].y-result.tools[0].y>20);close(result.tools[1].x-result.tools[0].x,0);
  result.tools.forEach((tool,i)=>unchangedShape(tool,before.tools[i]));assert.deepEqual(project,before);
});

test('margin growth preserves a real connector by reserving socket space even when basic wall validation passes',()=>{
  const project=drawer({width:252,height:168,grid:42,connectors:true,
    modules:[{id:'a',x:0,y:0,width:84,height:84,sizeMode:'manual',locked:true},{id:'b',x:84,y:0,width:84,height:84,sizeMode:'manual',pocketMargin:.8}],
    tools:[rect('connector-neighbor',99,15,30,54,{moduleId:'b'})]});
  const original=planJoints(project,project.modules,project.tools);assert.equal(original.joints.length,1);assert.equal(original.skipped,0);
  project.modules[1].pocketMargin=10;const before=structuredClone(project),module=project.modules[1];
  assert.deepEqual(validateLayout(project),[],'ordinary outside-wall checks do not detect the lost socket reserve');
  assert.equal(containsPocketWalls(module,pocketOutline(project.tools[0],project),modulePadding(project)-.25,project.grid),false);
  const blocked=planJoints(project,project.modules,project.tools);assert.equal(blocked.joints.length,0);assert.equal(blocked.skipped,1);
  const result=growModuleForMargins(project,'b'),grown=result.modules[1],plan=planJoints(result,result.modules,result.tools);
  assert.deepEqual(validateLayout(result),[]);assert.equal(plan.joints.length,1);assert.equal(plan.skipped,0);
  assert.equal(containsPocketWalls(grown,pocketOutline(result.tools[0],result),modulePadding(result)-.25,result.grid),true);
  assert.ok(grown.width>module.width||grown.height>module.height);assert.deepEqual(result.modules[0],before.modules[0]);
  unchangedShape(result.tools[0],before.tools[0]);assert.deepEqual(project,before);
});
