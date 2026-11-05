import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {pocketOutline,transformedPoints,validateLayout,exportSVG,exportDXF,exportSTL,exportFitSTL} from '../dist/geometry.js';
import {preparePrintBatch,planPrintBatch} from '../dist/print-batch.js';
import {moduleParts} from '../dist/preview-mesh.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const rectangle=[{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}];
const margins=[1.5,0,2,0,.8];
const fixture=()=>validateProject({...blankProject(),id:'margin-manufacturing',width:378,height:126,clearance:.8,wall:2.4,
  printMode:'solid',bottomMode:'plain',limitToBed:false,bedWidth:70,bedHeight:70,connectors:false,
  modules:[{id:'wide',pocketMargin:1.5},{id:'zero',pocketMargin:0},{id:'legacy'}].map((m,i)=>({...m,name:m.id,x:i*126,y:0,width:126,height:84,sizeMode:'manual'})),
  tools:[{id:'inherit',moduleId:'wide',x:15},{id:'override-zero',moduleId:'wide',x:55,pocketMargin:0},{id:'override-two',moduleId:'wide',x:95,pocketMargin:2},
    {id:'module-zero',moduleId:'zero',x:141},{id:'legacy-default',moduleId:'legacy',x:267}].map(t=>({...t,name:t.id,points:rectangle,y:20,rotation:0,depth:8,fingerGrips:[]}))});
const bounds=p=>({x:Math.min(...p.map(q=>q.x)),y:Math.min(...p.map(q=>q.y)),maxX:Math.max(...p.map(q=>q.x)),maxY:Math.max(...p.map(q=>q.y))});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.0002,`${actual} != ${expected}`);
function checkBounds(actual,tool,margin,anchor=0){near(actual.x,tool.x-margin);near(actual.maxX,tool.x+10+margin);near(actual.y,anchor?anchor-(tool.y+20+margin):tool.y-margin);near(actual.maxY,anchor?anchor-(tool.y-margin):tool.y+20+margin);}
const decode=bytes=>{const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:view.getUint32(80,true)},(_,i)=>Array.from({length:3},(_,j)=>Array.from({length:3},(_,c)=>view.getFloat32(84+i*50+12+j*12+c*4,true))));};
const transform=(mesh,m)=>mesh.map(triangle=>triangle.map(([x,y,z])=>[m[0]*x+m[1]*y+m[2]*z+m[3],m[4]*x+m[5]*y+m[6]*z+m[7],m[8]*x+m[9]*y+m[10]*z+m[11]]));
function materialAt(mesh,x,y,z){
  const heights=[];
  for(const [a,b,c] of mesh){
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const height=u*a[2]+v*b[2]+w*c[2];if(height>z+1e-5&&!heights.some(previous=>Math.abs(previous-height)<1e-5))heights.push(height);
  }
  return heights.length%2===1;
}
function checkCavities(mesh,project,{origin={x:0,y:0},anchor=project.height,z=16,tools=project.tools}={}){
  for(const tool of tools){
    const margin=margins[project.tools.findIndex(t=>t.id===tool.id)],x=tool.x-origin.x,y=anchor-(tool.y-origin.y+10);
    assert.equal(materialAt(mesh,x+5,y,z),false,`${tool.id}: measured tool interior is a cavity`);
    assert.equal(materialAt(mesh,x+10+(margin?margin*.6:.2),y,z),margin===0,`${tool.id}: effective per-side allowance`);
    assert.equal(materialAt(mesh,x+10+margin+.3,y,z),true,`${tool.id}: outer supporting wall remains`);
  }
}

test('module inheritance and tool overrides agree in raw dimensions, pocket polygons, SVG and DXF',()=>{
  const project=fixture(),before=structuredClone(project);assert.deepEqual(validateLayout(project),[]);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project);
  const svg=exportSVG(project),paths=new Map([...svg.matchAll(/<path id="([^"]+)"[^>]* d="([^"]+)"/g)].map(([,id,d])=>{const numbers=d.match(/-?\d+(?:\.\d+)?/g).map(Number);return[id,Array.from({length:numbers.length/2},(_,i)=>({x:numbers[i*2],y:numbers[i*2+1]}))];}));
  const lines=exportDXF(project).trim().split(/\r?\n/),dxf=[];
  for(let i=0;i<lines.length-1;i+=2)if(lines[i]==='0'&&lines[i+1]==='LWPOLYLINE'){
    const points=[];let layer='';
    for(i+=2;i<lines.length&&lines[i]!=='0';i+=2){if(lines[i]==='8')layer=lines[i+1];if(lines[i]==='10')points.push({x:Number(lines[i+1]),y:Number(lines[i+3])});}
    i-=2;if(layer==='POCKETS')dxf.push(points);
  }
  assert.equal(dxf.length,project.tools.length);assert.equal(paths.size,project.tools.length);
  project.tools.forEach((tool,i)=>{
    checkBounds(bounds(pocketOutline(tool,project)),tool,margins[i]);checkBounds(bounds(paths.get(tool.id)),tool,margins[i]);checkBounds(bounds(dxf[i]),tool,margins[i],project.height);
    checkBounds(bounds(transformedPoints(tool)),tool,0,'');checkBounds(bounds(pocketOutline(tool,0)),tool,0);
    assert.ok(svg.includes(`data-pocket-margin-mm="${margins[i]}"`));
  });
  assert.deepEqual(project,before,'all manufacturing formats are non-mutating');
});

test('whole and selected STL plus cheap fit rings use each actual pocket allowance',()=>{
  const project=fixture(),whole=decode(exportSTL(project));validatePrintMesh(whole);checkCavities(whole,project);
  for(const tool of project.tools)assert.equal(materialAt(whole,tool.x+5,project.height-tool.y-10,10),true,'the requested pocket keeps its floor');
  for(const module of project.modules){
    const mesh=decode(exportSTL(project,{moduleId:module.id}));validatePrintMesh(mesh);
    checkCavities(mesh,project,{origin:module,anchor:module.height,tools:project.tools.filter(t=>t.moduleId===module.id)});
  }
  const fit=decode(exportFitSTL(project));validatePrintMesh(fit);checkCavities(fit,project,{z:.5});
});

test('cut batch and batch-backed 3D preview retain the same per-tool cavities',async()=>{
  const project=fixture(),before=structuredClone(project),batch=await preparePrintBatch(project);assert.ok(batch.parts.length>project.modules.length);
  const assembled=batch.parts.flatMap(part=>{const mesh=decode(batch.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);return transform(mesh,part.assemblyTransform);});
  checkCavities(assembled,project);
  const plan=planPrintBatch(project),preview=project.modules.flatMap(module=>moduleParts(project,module,project.tools,plan)).flatMap(part=>transform(decode(part.bytes),part.matrix));
  checkCavities(preview,project);assert.deepEqual(project,before);
});
