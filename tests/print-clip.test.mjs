import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {buildPrintTriangles,validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const fixture=(extra={})=>{
  const module={id:'original',name:'Original body',x:42,y:42,width:252,height:126};
  const tools=[8,12,16].map((depth,index)=>({id:'tool-'+index,name:'Tool '+index,moduleId:module.id,points:rectangle(60,60),x:54+index*84,y:55,rotation:0,depth,sizeLabel:String(10+index)+' mm',fingerGrips:[{id:'grip-'+index,x:0,y:30,radius:7}]}));
  return{...blankProject(),width:420,height:252,clearance:0,limitToBed:false,printMode:'solid',bottomMode:'plain',sizeLabels:true,modules:[module],tools,...extra};
};
const prepared=p=>p.tools.map(tool=>({...tool,poly:pocketOutline(tool,p.clearance)}));
const close=(a,b,tolerance=.05)=>assert.ok(Math.abs(a-b)<tolerance,`${a} should equal ${b}`);
function occupied(mesh,x,y,z){
  const heights=new Set();
  for(const [a,b,c] of mesh){
    const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
    if(u<-.000001||v<-.000001||w<-.000001)continue;const hit=u*a[2]+v*b[2]+w*c[2];if(hit>z+1e-6)heights.add(Math.round(hit*1e5));
  }
  return heights.size%2===1;
}

test('clipped Z sections cap every cut and reassemble the exact solid/light body, pockets, grips, feet, magnets and labels',()=>{
  for(const printMode of ['solid','light'])for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const p=fixture({printMode,bottomMode}),before=structuredClone(p),tools=prepared(p),original=buildPrintTriangles(p,p.modules,tools),parts=[];
    const labelPlan=planSizeLabels(p,p.modules,tools);assert.ok(labelPlan.labels.length>0);
    for(let y=42;y<168;y+=84)for(let x=42;x<294;x+=84){
      const clip={x,y,width:84,height:Math.min(84,168-y)},mesh=buildPrintTriangles(p,p.modules,tools,{x:0,y:0},{clip,labelPlan});
      validatePrintMesh(mesh);assert.ok(mesh.length);assert.ok(mesh.every(t=>t.every(v=>v[0]>=clip.x-1e-6&&v[0]<=clip.x+clip.width+1e-6&&v[1]>=clip.y-1e-6&&v[1]<=clip.y+clip.height+1e-6)));parts.push(...mesh);
    }
    close(trianglesVolume(parts),trianglesVolume(original),.08);
    for(let y=47.17;y<165;y+=23.7)for(let x=47.27;x<291;x+=29.3)for(const z of [.55,1.85,3.65,6.17,14.27,19.81])assert.equal(occupied(parts,x,y,z),occupied(original,x,y,z),`${printMode}/${bottomMode} occupancy at ${x},${y},${z}`);
    assert.deepEqual(p,before);
  }
});

test('a cut through an engraved label or a blind magnet hole is closed with no lost material',()=>{
  for(const bottomMode of ['plain','magnet']){
    const p=fixture({bottomMode}),tools=prepared(p),label=planSizeLabels(p,p.modules,tools).labels[0],x=bottomMode==='magnet'?47.75:label.x+label.width/2;
    const cuts=[{x:42,y:42,width:x-42,height:126},{x,y:42,width:294-x,height:126}],meshes=cuts.map(clip=>buildPrintTriangles(p,p.modules,tools,{x:0,y:0},{clip}));
    for(const mesh of meshes)validatePrintMesh(mesh);
    close(meshes.reduce((sum,mesh)=>sum+trianglesVolume(mesh),0),trianglesVolume(buildPrintTriangles(p,p.modules,tools)),.05);
  }
});

test('Gridfinity cuts retain full feet and count the per-part foot budget rather than the oversized original',()=>{
  const p=fixture({bottomMode:'grid',sizeLabels:false,tools:[],modules:[{id:'large',x:0,y:0,width:882,height:840}]});
  assert.throws(()=>buildPrintTriangles(p,p.modules,[]),/400/);
  const mesh=buildPrintTriangles(p,p.modules,[],{x:0,y:0},{clip:{x:0,y:0,width:84,height:84}});validatePrintMesh(mesh);assert.ok(mesh.length);
  assert.ok(mesh.every(t=>t.every(v=>v[0]>=0&&v[0]<=84&&v[1]>=0&&v[1]<=84)));
  assert.throws(()=>buildPrintTriangles(p,p.modules,[],{x:0,y:0},{clip:{x:21,y:0,width:84,height:84}}),/42 mm/);
  for(const clip of [{x:0,y:0,width:0,height:84},{x:NaN,y:0,width:84,height:84}])assert.throws(()=>buildPrintTriangles(p,p.modules,[],{x:0,y:0},{clip}));
});

test('a stepped body keeps its missing cells when independently cut tiles are assembled',()=>{
  const p=fixture({sizeLabels:false,tools:[],modules:[{id:'step',x:42,y:42,width:126,height:126,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:0,y:2}]}]}),original=buildPrintTriangles(p,p.modules,[]),meshes=[];
  for(let y=42;y<168;y+=42)for(let x=42;x<168;x+=42){const mesh=buildPrintTriangles(p,p.modules,[],{x:0,y:0},{clip:{x,y,width:42,height:42}});if(mesh.length){validatePrintMesh(mesh);meshes.push(mesh);}}
  assert.equal(meshes.length,6);close(meshes.reduce((sum,mesh)=>sum+trianglesVolume(mesh),0),trianglesVolume(original));
});
