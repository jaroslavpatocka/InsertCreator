import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {bounds,pocketOutline,validateLayout,exportSTL,autoArrange} from '../dist/geometry.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {rotateModule,rotateModuleFree} from '../dist/module-edit.js';
import {createCustomModule,updateCustomModule,customPocketPoints,customModuleOptions,isCustomModule} from '../dist/custom-module.js';
import {pocketLayoutOutline,pocketFloorOutlines,pocketWallOutset} from '../dist/pocket-wall.js';

const polygon=[{x:0,y:0},{x:60,y:0},{x:60,y:20},{x:25,y:20},{x:25,y:60},{x:0,y:60}];
const drawer=extra=>({...blankProject(),printMode:'solid',limitToBed:false,...extra});
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);
function mesh(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
  assert.equal(bytes.byteLength,84+50*count);
  const triangles=Array.from({length:count},(_,i)=>[0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true))));
  validatePrintMesh(triangles);return triangles;
}
const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2);

test('custom module creation preserves existing data, exact requested millimetres and explicit zero margin',()=>{
  const occupied={id:'existing',name:'Existing',x:0,y:0,width:84,height:84,locked:true,sizeMode:'manual'},project=drawer({modules:[occupied],clearance:3}),before=structuredClone(project);
  const result=createCustomModule(project,{name:'My tray',pocketName:'Universal',label:'BITS',width:100,height:90,pocketWidth:62.5,pocketHeight:48.25,depth:9,shape:'rectangle',pocketMargin:0});
  assert.deepEqual(project,before);assert.deepEqual(result.project.modules[0],occupied);assert.equal(result.placed,true);
  const module=result.project.modules[1],tool=result.project.tools[0];
  assert.equal(module.width,100);assert.equal(module.height,90);assert.equal(module.sizeMode,'manual');assert.equal(tool.depth,9);assert.equal(tool.customPocket,true);assert.equal(tool.sizeLabel,'BITS');
  const outline=pocketOutline(tool,result.project);near(Math.max(...outline.map(p=>p.x))-Math.min(...outline.map(p=>p.x)),62.5);near(Math.max(...outline.map(p=>p.y))-Math.min(...outline.map(p=>p.y)),48.25);
  assert.equal(tool.pocketMargin,0);assert.equal(module.pocketMargin,0);assert.equal(result.project.clearance,3);assert.deepEqual(validateLayout(result.project),[]);
});

for(const shape of ['rectangle','rounded-rect','ellipse','polygon']){
  test(`${shape} remains editable after save/reload and regular auto placement`,()=>{
    const result=createCustomModule(drawer(),{shape,cornerRadius:6,points:polygon}),saved=validateProject(JSON.parse(JSON.stringify(result.project)));
    assert.equal(isCustomModule(saved,result.moduleId),true);
    const options=customModuleOptions(saved,result.moduleId);assert.equal(options.shape,shape);if(shape==='rounded-rect')near(options.cornerRadius,6);
    const arranged={...saved,...autoArrange(saved)};assert.deepEqual(validateLayout(arranged),[]);assert.equal(isCustomModule(arranged,result.moduleId),true);
    assert.deepEqual(arranged.tools[0].points,saved.tools[0].points);
  });
  for(const printMode of ['solid','light'])test(`${shape} exports a closed ${printMode} manufacturing mesh at the requested depth`,()=>{
    const result=createCustomModule(drawer({printMode}),{shape,cornerRadius:6,points:polygon,depth:9}),module=result.project.modules[0],tool=result.project.tools[0],triangles=mesh(exportSTL(result.project));
    assert.ok(triangles.length>10);assert.ok(trianglesVolume(triangles)>0);
    if(printMode==='solid'){
      const expected=(module.width-.5)*(module.height-.5)*result.project.insertHeight-area(tool.points)*tool.depth;
      near(trianglesVolume(triangles),expected,.4);
      assert.ok(triangles.some(triangle=>triangle.every(vertex=>Math.abs(vertex[2]-(result.project.insertHeight-tool.depth))<1e-5)),'actual pocket floor is at requested depth');
    }else{
      near(Math.max(...triangles.flat().map(vertex=>vertex[2])),result.project.base+tool.depth,.001);
      assert.ok(triangles.some(triangle=>triangle.every(vertex=>Math.abs(vertex[2]-result.project.base)<1e-5)),'actual pocket floor remains on the light base');
    }
  });
}

test('custom labels enter the existing physical label plan and change the manufactured STL',()=>{
  const result=createCustomModule(drawer(),{name:'Bits',label:'BITS'}),plan=planSizeLabels(result.project);
  assert.equal(result.project.sizeLabels,true);assert.equal(plan.labels.length,1);assert.equal(plan.skipped.length,0);assert.equal(plan.labels[0].toolId,result.toolId);
  const plain=mesh(exportSTL({...result.project,sizeLabels:false})),labeled=mesh(exportSTL(result.project));
  assert.ok(trianglesVolume(labeled)<trianglesVolume(plain),'engraved text removes real material');
  const restored=validateProject(result.project);assert.equal(restored.tools[0].sizeLabel,'BITS');assert.equal(restored.tools[0].customPocket,true);
});

test('editing a rotated custom pocket preserves identity, location, features, style and neighbouring modules',()=>{
  const added=createCustomModule(drawer(),{shape:'rectangle',label:'A'}),originalTool=added.project.tools[0];
  originalTool.fingerGrips=[{id:'grip',x:0,y:30,radius:6}];originalTool.pocketMagnets=[{id:'magnet',x:30,y:30,diameter:6,height:1.2}];originalTool.labelStyle={size:4,rotation:0,color:'#aabbcc'};
  const rotated=rotateModule(added.project,added.moduleId,90),before=structuredClone(rotated),old=rotated.tools[0],result=updateCustomModule(rotated,added.moduleId,{name:'Renamed',depth:8,label:'B'}),tool=result.project.tools[0];
  assert.deepEqual(rotated,before);assert.equal(tool.id,old.id);assert.equal(tool.moduleId,old.moduleId);assert.equal(tool.rotation,old.rotation);near(tool.x,old.x);near(tool.y,old.y);
  assert.deepEqual(tool.fingerGrips,old.fingerGrips);assert.deepEqual(tool.pocketMagnets,old.pocketMagnets);assert.deepEqual(tool.labelStyle,old.labelStyle);assert.equal(tool.depth,8);assert.equal(tool.sizeLabel,'B');
  assert.deepEqual(validateLayout(result.project),[]);mesh(exportSTL(result.project));
});

test('shell resizing keeps the pocket at the same offset from its module centre',()=>{
  const added=createCustomModule(drawer(),{shape:'rectangle'}),result=updateCustomModule(added.project,added.moduleId,{width:120,height:110,pocketWidth:50,pocketHeight:40}),module=result.project.modules[0],box=bounds(result.project.tools[0]);
  near(box.x+box.width/2,module.x+module.width/2);near(box.y+box.height/2,module.y+module.height/2);assert.deepEqual(validateLayout(result.project),[]);
});

test('reopening a custom pocket respects a margin later inherited from the drawer',()=>{
  const added=createCustomModule(drawer({clearance:1.5}));delete added.project.tools[0].pocketMargin;delete added.project.modules[0].pocketMargin;
  const options=customModuleOptions(added.project,added.moduleId);assert.equal(options.pocketMargin,1.5);
  const edited=updateCustomModule(added.project,added.moduleId,{depth:8});assert.equal(edited.project.tools[0].pocketMargin,1.5);
  assert.deepEqual(pocketOutline(edited.project.tools[0],edited.project),pocketOutline(added.project.tools[0],added.project));
});

test('unchanged Save after a free rotation retains exact project bytes and global hidden label preference',()=>{
  for(const shape of ['rectangle','rounded-rect','ellipse','polygon']){
    const added=createCustomModule(drawer(),{shape,points:polygon,label:'M6'}),rotated=validateProject(rotateModuleFree(added.project,added.moduleId,37,{keepInside:true}));
    rotated.sizeLabels=false;
    const edited=updateCustomModule(rotated,added.moduleId,customModuleOptions(rotated,added.moduleId));
    assert.equal(JSON.stringify(edited.project),JSON.stringify(rotated),shape);
    const changed=updateCustomModule(rotated,added.moduleId,{label:'M8'});assert.equal(changed.project.sizeLabels,true);
  }
});

test('arbitrary polygon uses real points without preview rescaling and normalizes only the stored contour',()=>{
  const points=polygon.map(p=>({x:p.x-7,y:p.y+11})),result=createCustomModule(drawer(),{shape:'polygon',points,pocketWidth:90,pocketHeight:90});
  assert.deepEqual(customPocketPoints({shape:'polygon',points,pocketWidth:90,pocketHeight:90}),points);assert.deepEqual(result.project.tools[0].points,polygon);
  assert.deepEqual(validateProject(result.project).tools[0].points,polygon);
});

test('invalid dimensions, walls, depth, crossing or touching polygons fail without changing the project',()=>{
  const project=drawer(),before=structuredClone(project),invalid=[{width:NaN},{height:null},{pocketMargin:-1},{depth:18},{width:61,shape:'rectangle',pocketWidth:60},{shape:'rounded-rect',cornerRadius:40},{shape:'polygon',points:[{x:0,y:0},{x:40,y:40},{x:0,y:40},{x:40,y:0}]},{shape:'polygon',points:[{x:0,y:0},{x:30,y:0},{x:30,y:30},{x:15,y:0},{x:0,y:30}]}];
  for(const options of invalid){assert.throws(()=>createCustomModule(project,options));assert.deepEqual(project,before);}
  const added=createCustomModule(project),snapshot=structuredClone(added.project);
  assert.throws(()=>updateCustomModule(added.project,added.moduleId,{width:20}));assert.deepEqual(added.project,snapshot);
  added.project.modules[0].locked=true;assert.throws(()=>updateCustomModule(added.project,added.moduleId,{depth:7}),/odemkn/);
});

test('growth into neighbours and new overflow are rejected atomically',()=>{
  const first=createCustomModule(drawer()),second=createCustomModule(first.project),before=structuredClone(second.project);
  assert.throws(()=>updateCustomModule(second.project,first.moduleId,{width:160}));assert.deepEqual(second.project,before);
  assert.throws(()=>updateCustomModule(first.project,first.moduleId,{width:600}));
});

test('full drawers keep an intact parked custom module, and allow editing its draft in place',()=>{
  const project=drawer({width:84,height:84}),first=createCustomModule(project),second=createCustomModule(first.project);
  assert.equal(second.placed,false);const module=second.project.modules.find(item=>item.id===second.moduleId);assert.ok(module.x>=project.width);
  const edited=updateCustomModule(second.project,second.moduleId,{name:'Parked',depth:8});assert.equal(edited.placed,false);assert.equal(edited.project.tools.find(tool=>tool.id===edited.toolId).depth,8);
  assert.equal(validateProject(edited.project).modules.length,2);
});

test('Gridfinity custom shells require the physical 42 mm raster',()=>{
  const project=drawer({bottomMode:'grid'}),before=structuredClone(project);
  assert.throws(()=>createCustomModule(project,{width:85}),/42 mm/);assert.deepEqual(project,before);
  const result=createCustomModule(project,{width:126,height:84});assert.equal(result.placed,true);mesh(exportSTL(result.project));
});

for(const pocketWall of [null,{type:'draft',value:10},{type:'chamfer',value:2},{type:'roundTop',value:2},{type:'roundBottom',value:2}]){
  test(`custom ${pocketWall?.type??'vertical'} wall persists, reopens and survives unrelated edits without changing its outline`,()=>{
    const added=createCustomModule(drawer(),{shape:'rectangle',pocketWall,depth:8,pocketMargin:.8}),saved=validateProject(JSON.parse(JSON.stringify(added.project))),tool=saved.tools[0];
    assert.deepEqual(tool.pocketWall??null,pocketWall);assert.deepEqual(customModuleOptions(saved,added.moduleId).pocketWall,pocketWall);
    const edited=updateCustomModule(saved,added.moduleId,{name:'New name'});assert.deepEqual(edited.project.tools[0].pocketWall??null,pocketWall);assert.deepEqual(edited.project.tools[0].points,tool.points);
    const widest=pocketLayoutOutline(tool,saved),span=extentWidth(widest);near(span,60+2*(.8+pocketWallOutset(tool)),.002);
    const floor=pocketFloorOutlines(tool,saved);assert.equal(floor.length,1);near(extentWidth(floor[0]),pocketWall?.type==='roundBottom'?57.6:61.6,.002);
    const noOp=updateCustomModule(saved,added.moduleId,customModuleOptions(saved,added.moduleId));assert.equal(JSON.stringify(noOp.project),JSON.stringify(saved));
    const rotated=validateProject(rotateModuleFree(saved,added.moduleId,37,{keepInside:true})),reopened=updateCustomModule(rotated,added.moduleId,customModuleOptions(rotated,added.moduleId));assert.equal(JSON.stringify(reopened.project),JSON.stringify(rotated));
    const cleared=updateCustomModule(saved,added.moduleId,{pocketWall:null});assert.equal(Object.hasOwn(cleared.project.tools[0],'pocketWall'),false);
    const vertical=updateCustomModule(saved,added.moduleId,{pocketWall:{type:'vertical'}});assert.equal(Object.hasOwn(vertical.project.tools[0],'pocketWall'),false);
  });
}
const extentWidth=points=>Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));

test('wall expansion is included exactly once in shell walls and connector reservations',()=>{
  const project=drawer(),before=structuredClone(project);
  assert.throws(()=>createCustomModule(project,{shape:'rectangle',pocketWidth:78,pocketWall:{type:'chamfer',value:1}}),/stěnu/);
  const accepted=createCustomModule(project,{shape:'rectangle',depth:9,pocketWall:{type:'draft',value:45}});assert.deepEqual(validateLayout(accepted.project),[]);
  assert.throws(()=>createCustomModule(project,{shape:'rectangle',depth:9,pocketMargin:.8,pocketWall:{type:'draft',value:45}}),/stěnu/);
  const connectorProject=drawer({connectors:true}),connectorBefore=structuredClone(connectorProject);createCustomModule(connectorProject,{shape:'rectangle',width:100,height:100,pocketWidth:70,pocketHeight:60});
  assert.throws(()=>createCustomModule(connectorProject,{shape:'rectangle',width:100,height:100,pocketWidth:70,pocketHeight:60,pocketWall:{type:'roundTop',value:2}}),/stěnu/);
  const withRoom=createCustomModule(connectorProject,{shape:'rectangle',width:110,height:110,pocketWidth:70,pocketHeight:60,pocketWall:{type:'roundTop',value:2}});assert.deepEqual(validateLayout(withRoom.project),[]);
  assert.deepEqual(project,before);assert.deepEqual(connectorProject,connectorBefore);
});

test('wall dimensions, depth changes and collapsed round-bottom floors reject atomically',()=>{
  const project=drawer(),before=structuredClone(project);
  for(const pocketWall of [{type:'draft',value:0},{type:'draft',value:46},{type:'chamfer',value:13},{type:'roundTop',value:13},{type:'roundBottom',value:13},{type:'unknown',value:1}]){
    assert.throws(()=>createCustomModule(project,{pocketWall,depth:12}));assert.deepEqual(project,before);
  }
  assert.throws(()=>createCustomModule(project,{shape:'rectangle',pocketWidth:4,pocketHeight:40,pocketWall:{type:'roundBottom',value:2}}),/Zaoblené dno/);
  const added=createCustomModule(project,{pocketWall:{type:'roundTop',value:4},depth:8}),snapshot=structuredClone(added.project);
  assert.throws(()=>updateCustomModule(added.project,added.moduleId,{depth:3}));assert.deepEqual(added.project,snapshot);
});
