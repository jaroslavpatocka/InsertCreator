import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {mergeOverlappingModules} from '../dist/module-merge.js';
import {autoArrange,exportSTL,validateLayout} from '../dist/geometry.js';
import {smartArrange} from '../dist/smart-layout.js';
import {moduleArea,moduleOutline} from '../dist/module-footprint.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {buildPrintTriangles,validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';
import {planJoints} from '../dist/module-joints.js';
import {preparePrintBatch} from '../dist/print-batch.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const cells=()=>[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:0,y:2}];
function fixture(extra={}){
  return validateProject({...blankProject(),id:'merge-export',name:'Merged manufacturing',width:252,height:210,
    printMode:'solid',bottomMode:'plain',wall:2.4,base:2.4,insertHeight:20,clearance:2,limitToBed:false,
    modules:[
      {id:'A',name:'Vertical tool',unit:'mm',x:0,y:0,width:126,height:126,shape:'stepped',cells:cells(),pocketMargin:.8},
      {id:'B',name:'Horizontal tool',unit:'in',x:42,y:0,width:126,height:126,shape:'stepped',cells:cells(),pocketMargin:0},
      {id:'notch-neighbour',name:'Keep the notch',x:84,y:42,width:84,height:84,sizeMode:'manual'}
    ],
    tools:[
      {id:'vertical',name:'Vertical measured tool',unit:'mm',moduleId:'A',points:rectangle(14,70),x:14,y:14,rotation:0,depth:8,
        fingerGrips:[{id:'manual-grip',x:14,y:32,radius:4}],pocketMagnets:[{id:'manual-magnet',x:7,y:50,diameter:4,height:1.5}]},
      {id:'horizontal',name:'Horizontal measured tool',unit:'in',moduleId:'B',points:rectangle(72,14),x:70,y:14,rotation:0,depth:10,fingerGrips:[]}
    ],...extra});
}
const close=(actual,expected,tolerance=.005,label='')=>assert.ok(Math.abs(actual-expected)<tolerance,`${label}: ${actual} should equal ${expected}`);
function decodeSTL(data){
  const bytes=new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(bytes.length,84+view.getUint32(80,true)*50,'binary STL has complete triangle records');
  return Array.from({length:view.getUint32(80,true)},(_,i)=>[0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));
}
// Read actual horizontal surfaces at one XY coordinate; a pocket floor and its
// underlying solid base produce [0,floor], while the nominal empty notch has none.
function horizontalSurfaces(triangles,x,y){
  const z=[];
  for(const [a,b,c] of triangles){
    if(Math.abs(a[2]-b[2])>1e-5||Math.abs(a[2]-c[2])>1e-5)continue;
    const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(denominator)<1e-8)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)z.push(a[2]);
  }
  return [...new Set(z.map(value=>Math.round(value*10000)/10000))].sort((a,b)=>a-b);
}
function oneConnectedSurface(triangles){
  const vertices=new Map(),parent=triangles.map((_,i)=>i);
  const find=index=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index];}return index;};
  for(const [index,triangle] of triangles.entries())for(const vertex of triangle){
    const key=vertex.map(value=>Math.round(value*10000)).join(',');
    if(vertices.has(key))parent[find(index)]=find(vertices.get(key));else vertices.set(key,index);
  }
  assert.equal(new Set(parent.map((_,index)=>find(index))).size,1,'the exported merged body is one connected surface');
}

test('merged stepped STL retains the real notch, both pocket floors, manual grip, magnet and inherited zero margin',()=>{
  const source=fixture(),before=structuredClone(source),merged=mergeOverlappingModules(source,['A']);
  assert.deepEqual(source,before);assert.deepEqual(validateLayout(merged),[]);
  const module=merged.modules.find(module=>module.id==='A');
  assert.equal(merged.modules.length,2);assert.equal(module.cells.length,8);assert.equal(moduleArea(module,42),8*42*42);
  assert.deepEqual(merged.modules.find(module=>module.id==='notch-neighbour'),source.modules[2]);
  assert.equal(merged.tools.find(tool=>tool.id==='horizontal').pocketMargin,0,'zero inherited by the removed module stays zero');
  const snapshot=structuredClone(merged),mesh=decodeSTL(exportSTL(merged,{moduleId:'A',checkBed:false}));
  validatePrintMesh(mesh);oneConnectedSurface(mesh);
  const sample=(x,y)=>horizontalSurfaces(mesh,x-module.x,module.height-(y-module.y));
  assert.deepEqual(sample(21,25),[0,12],'the vertical pocket stays at its original world position and depth');
  assert.deepEqual(sample(105,21),[0,10],'the horizontal pocket keeps its separate depth');
  assert.deepEqual(sample(13.6,25),[0,12],'the surviving module still supplies its 0.8 mm margin');
  assert.deepEqual(sample(69.6,21),[0,20],'a zero-margin pocket must not inherit the surviving module margin');
  assert.deepEqual(sample(31,46),[0,12],'the manual finger bay remains connected at its original location');
  const magnet=sample(21,64);assert.equal(magnet.length,2);close(magnet[0],0);close(magnet[1],10.3);
  assert.deepEqual(sample(105,70),[],'the untouched neighbouring module is not swallowed by a bounding rectangle');
  assert.deepEqual(sample(5,5),[0,20]);assert.deepEqual(merged,snapshot,'STL export never rewrites the merged project');
});

test('merged Gridfinity body puts real feet only under the occupied union cells and remains watertight',()=>{
  const source=fixture({bottomMode:'grid'}),merged=mergeOverlappingModules(source,['A']),module=merged.modules.find(module=>module.id==='A');
  const tools=merged.tools.filter(tool=>tool.moduleId==='A').map(tool=>({...tool,poly:pocketOutline(tool,merged)}));
  const mesh=buildPrintTriangles(merged,[module],tools);validatePrintMesh(mesh);oneConnectedSurface(mesh);
  const ground=mesh.filter(triangle=>triangle.every(vertex=>Math.abs(vertex[2])<1e-6));
  assert.ok(ground.length>0);
  const floor=moduleOutline(module,42);
  assert.ok(floor.length>4,'the union remains a stepped footprint');
  for(const cell of module.cells){
    const x=module.x+(cell.x+.5)*42,y=module.y+(cell.y+.5)*42;
    assert.ok(horizontalSurfaces(ground,x,y).includes(0),`occupied cell ${cell.x},${cell.y} has a real foot`);
  }
  assert.deepEqual(horizontalSurfaces(mesh,105,70),[],'no base slab or foot fills the neighbouring notch');
  const binary=decodeSTL(exportSTL(merged,{moduleId:'A',checkBed:false}));validatePrintMesh(binary);oneConnectedSurface(binary);
});

test('open-wall manufacturing retains each pocket depth with every supported underside after shell merging',()=>{
  for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const merged=mergeOverlappingModules(fixture({printMode:'light',bottomMode}),['A']),before=structuredClone(merged);
    const module=merged.modules.find(module=>module.id==='A'),mesh=decodeSTL(exportSTL(merged,{moduleId:'A',checkBed:false}));
    validatePrintMesh(mesh);oneConnectedSurface(mesh);
    const top=(x,y)=>Math.max(...horizontalSurfaces(mesh,x-module.x,module.height-(y-module.y)));
    const floor=top(21,25);
    close(top(11.5,25)-floor,8,.01,'vertical wall height');
    close(top(68.8,21)-top(105,21),10,.01,'horizontal wall height');
    close(top(21,64),floor-1.7,.01,'the blind pocket magnet retains its depth under the tool floor');
    assert.deepEqual(horizontalSurfaces(mesh,105-module.x,module.height-(70-module.y)),[],bottomMode+' does not fill the empty notch');
    assert.deepEqual(merged,before,bottomMode+' manufacturing does not rewrite the layout');
  }
});

test('JSON reload and actual Auto/Smart planning preserve a manually merged group while placing another tool',async()=>{
  const merged=mergeOverlappingModules(fixture(),['A']),restored=validateProject(JSON.parse(JSON.stringify(merged)));
  assert.deepEqual(restored.modules,merged.modules);assert.deepEqual(restored.tools,merged.tools);
  const group=structuredClone(restored.modules.find(module=>module.id==='A')),members=structuredClone(restored.tools.filter(tool=>tool.moduleId==='A'));
  const source={...restored,tools:[...restored.tools,{id:'incoming',name:'Place another tool',points:rectangle(10,18),x:0,y:0,rotation:0,depth:8,moduleId:null,fingerGrips:[]}]},before=structuredClone(source);
  for(const result of [autoArrange(source),await smartArrange(source,{mode:'compact',moduleShape:'stepped'})]){
    const next={...source,modules:result.modules,tools:result.tools};
    assert.deepEqual(next.modules.find(module=>module.id==='A'),group);
    assert.deepEqual(next.tools.filter(tool=>tool.moduleId==='A'),members);
    assert.ok(next.tools.find(tool=>tool.id==='incoming').moduleId,'the test exercises real placement beside the fixed group');
    assert.deepEqual(validateLayout(next),[]);
  }
  assert.deepEqual(source,before);
});

test('joint planning uses only the surviving module and regenerates real outer seams without a removed-module reference',()=>{
  const merged=mergeOverlappingModules(fixture(),['A']),project={...merged,connectors:true,bedWidth:220,bedHeight:220};
  const tools=project.tools.map(tool=>({...tool,poly:pocketOutline(tool,project)})),plan=planJoints(project,project.modules,tools);
  assert.ok(plan.joints.length>0,'the retained neighbouring module still receives actual outer joints');
  assert.equal(plan.byModule.has('B'),false);
  assert.ok(plan.joints.every(joint=>joint.owner!==joint.host&&[joint.owner,joint.host].every(id=>['A','notch-neighbour'].includes(id))));
  const module=project.modules.find(module=>module.id==='A'),mesh=buildPrintTriangles(project,[module],tools.filter(tool=>tool.moduleId==='A'),{x:0,y:0},{joints:plan.byModule});
  validatePrintMesh(mesh);oneConnectedSurface(mesh);
});

test('a merged body larger than the bed is cut into closed printable parts with exact pocket and magnet assembly positions',async()=>{
  const merged=mergeOverlappingModules(fixture(),['A']),project={...merged,bedWidth:84,bedHeight:84},before=structuredClone(project);
  const result=await preparePrintBatch(project,{moduleIds:['A']});
  assert.ok(result.parts.length>1,'the merged shell genuinely requires multiple print-bed pieces');
  assert.ok(result.parts.every(part=>part.moduleId==='A'),'the unchanged notch neighbour is not exported or absorbed');
  const assembly=[];
  for(const part of result.parts){
    const file=result.files.find(file=>file.name===part.file),mesh=decodeSTL(file.data),matrix=part.assemblyTransform;
    validatePrintMesh(mesh);
    const xs=mesh.flatMap(triangle=>triangle.map(vertex=>vertex[0])),ys=mesh.flatMap(triangle=>triangle.map(vertex=>vertex[1]));
    assert.ok(Math.max(...xs)-Math.min(...xs)<=84.001&&Math.max(...ys)-Math.min(...ys)<=84.001,'every real part fits the requested bed');
    assert.equal(matrix.length,16);
    assembly.push(...mesh.map(triangle=>triangle.map(point=>[
      matrix[0]*point[0]+matrix[1]*point[1]+matrix[2]*point[2]+matrix[3],
      matrix[4]*point[0]+matrix[5]*point[1]+matrix[6]*point[2]+matrix[7],
      matrix[8]*point[0]+matrix[9]*point[1]+matrix[10]*point[2]+matrix[11]
    ])));
  }
  const whole=decodeSTL(exportSTL(project,{moduleId:'A',checkBed:false}));
  close(trianglesVolume(assembly),trianglesVolume(whole),.15,'splitting preserves real material volume');
  const sample=(x,y)=>horizontalSurfaces(assembly,x,project.height-y);
  assert.deepEqual(sample(105,21),[0,10],'the horizontal pocket reassembles in the original drawer frame');
  assert.deepEqual(sample(31,46),[0,12],'the finger bay keeps its world position across the cut');
  const magnet=sample(21,64);assert.equal(magnet.length,2);close(magnet[1],10.3);
  assert.deepEqual(sample(105,70),[],'the neighbouring notch remains empty after reassembly');
  assert.deepEqual(project,before,'print-bed cutting never alters the merged editor project');
});
