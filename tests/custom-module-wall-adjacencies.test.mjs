import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {createCustomModule} from '../dist/custom-module.js';
import {addPhotoModule} from '../dist/photo-module.js';
import {exportSTL,validateLayout} from '../dist/geometry.js';
import {validatePrintMesh} from '../dist/print-geometry.js';
import {openPocketMagnetDialog,planPocketMagnets} from '../dist/tool-magnet-ui.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const project=()=>({...blankProject(),width:420,height:336,printMode:'solid',clearance:0});
function mesh(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
  assert.equal(bytes.byteLength,84+50*count);
  const triangles=Array.from({length:count},(_,i)=>[0,1,2].map(v=>[0,1,2].map(axis=>view.getFloat32(84+50*i+12+12*v+4*axis,true))));
  validatePrintMesh(triangles);return triangles;
}
function horizontalHeights(triangles,x,y){
  const values=[];
  for(const [a,b,c] of triangles){
    if(Math.abs(a[2]-b[2])>1e-5||Math.abs(a[2]-c[2])>1e-5)continue;
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-9)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d;
    if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)values.push(a[2]);
  }
  return [...new Set(values.map(value=>Math.round(value*1e5)/1e5))].sort((a,b)=>a-b);
}
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<.005,`${message}: ${actual}, expected ${expected}`);

test('preserved photo layout sizes its shell around the widest profile, while vertical remains the original size',()=>{
  for(const pocketWall of [null,{type:'draft',value:45}]){
    const source=project(),tool={id:'photographed',name:'Photographed tool',points:rectangle(70,20),x:17,y:23,rotation:0,depth:7,pocketMargin:0,fingerGrips:[],...(pocketWall?{pocketWall}:{})};
    const before=structuredClone(source),beforeTool=structuredClone(tool),added=addPhotoModule(source,[tool],{growMargins:true});
    assert.equal(added.placed,true);assert.equal(added.project.modules[0].width,pocketWall?126:84);assert.equal(added.project.modules[0].height,42);
    assert.deepEqual(added.project.tools[0].points,tool.points);assert.equal(added.project.tools[0].rotation,0);
    assert.deepEqual(validateLayout(added.project),[]);assert.deepEqual(source,before);assert.deepEqual(tool,beforeTool);
    const restored=validateProject(JSON.parse(JSON.stringify(added.project)));assert.deepEqual(restored.tools[0].pocketWall??null,pocketWall);
    mesh(exportSTL(restored,{moduleId:added.moduleId,checkBed:false}));
  }
});

test('manual magnets reject the rounded floor rim atomically and a valid floor magnet survives JSON and actual STL export',()=>{
  const made=createCustomModule(project(),{width:126,height:126,pocketWidth:60,pocketHeight:40,shape:'rectangle',depth:7,pocketMargin:0,pocketWall:{type:'roundBottom',value:2}}),before=structuredClone(made.project);
  assert.throws(()=>planPocketMagnets(made.project,made.toolId,[{id:'rim',x:5,y:20,diameter:6,height:1}]),/blízko stěny|mimo dno/);
  assert.deepEqual(made.project,before,'a rejected plan changes no project state');
  const planned=planPocketMagnets(made.project,made.toolId,[{id:'safe',x:8,y:20,diameter:6,height:1}]);
  const restored=validateProject(JSON.parse(JSON.stringify(planned.project))),tool=restored.tools[0],module=restored.modules[0];
  assert.deepEqual(tool.pocketWall,{type:'roundBottom',value:2});assert.deepEqual(tool.pocketMagnets,[{id:'safe',x:8,y:20,diameter:6,height:1}]);assert.deepEqual(validateLayout(restored),[]);
  const triangles=mesh(exportSTL(restored,{moduleId:made.moduleId,checkBed:false}));
  const heights=horizontalHeights(triangles,tool.x-module.x+8.13,module.height-(tool.y-module.y+20.07));
  close(heights.at(-1),11.8,'the actual blind hole is 1.2 mm below the 13 mm pocket floor');
  assert.deepEqual(made.project,before);
});

test('vertical floor magnet near the original rim keeps the legacy placement and geometry',()=>{
  const made=createCustomModule(project(),{width:126,height:126,pocketWidth:60,pocketHeight:40,shape:'rectangle',depth:7,pocketMargin:0});
  const planned=planPocketMagnets(made.project,made.toolId,[{id:'legacy',x:5,y:20,diameter:6,height:1}]);
  assert.deepEqual(validateLayout(planned.project),[]);assert.equal(planned.project.tools[0].pocketWall,undefined);
  mesh(exportSTL(planned.project,{moduleId:made.moduleId,checkBed:false}));
});

test('manual magnets can occupy separate surviving floor islands',()=>{
  const points=[{x:0,y:0},{x:30,y:0},{x:30,y:14},{x:50,y:14},{x:50,y:0},{x:80,y:0},{x:80,y:30},{x:50,y:30},{x:50,y:16},{x:30,y:16},{x:30,y:30},{x:0,y:30}];
  const made=createCustomModule(project(),{width:126,height:84,shape:'polygon',points,pocketWidth:80,pocketHeight:30,depth:7,pocketMargin:0,pocketWall:{type:'roundBottom',value:2}});
  const planned=planPocketMagnets(made.project,made.toolId,[{id:'left',x:15,y:15,diameter:6,height:1},{id:'right',x:65,y:15,diameter:6,height:1}]);
  assert.deepEqual(validateLayout(planned.project),[]);assert.equal(planned.project.tools[0].pocketMagnets.length,2);
});

test('manual magnet preview draws the actual reduced floor rather than the original contour',async t=>{
  const win=new Window({url:'http://localhost:5173'});win.document.write('<div id="modal-root"></div>');
  const previous={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};
  globalThis.window=win;globalThis.document=win.document;globalThis.requestAnimationFrame=fn=>{fn();return 1;};
  t.after(async()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}await win.happyDOM.close();});
  const made=createCustomModule(project(),{width:126,height:126,pocketWidth:60,pocketHeight:40,shape:'rectangle',depth:7,pocketMargin:0,pocketWall:{type:'roundBottom',value:2}});
  const modal=openPocketMagnetDialog({project:made.project,tool:made.project.tools[0],unit:'mm',onSave:()=>{},errorText:error=>error.message});
  const d=modal.body.querySelector('.grip-pocket').getAttribute('d'),numbers=d.match(/-?\d+(?:\.\d+)?/g).map(Number),xs=numbers.filter((_,index)=>index%2===0),ys=numbers.filter((_,index)=>index%2===1);
  close(Math.min(...xs),2,'floor preview inset X');close(Math.max(...xs),58,'floor preview far X');close(Math.min(...ys),2,'floor preview inset Y');close(Math.max(...ys),38,'floor preview far Y');
  modal.close();
});
