// The user's 256 mm print-bed settings must keep exact coloured manufacturing
// meshes printable after the explicit height correction, with depth errors named.
import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {catalogSets} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {addToolGroup} from '../dist/set-module.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {requiredInsertHeight} from '../dist/print-material.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

let fixture;
function project(){
  if(fixture)return structuredClone(fixture);
  const set=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm');
  const tools=set.tools.map((item,index)=>{
    const tool={...catalogTool(item),id:'wrench-'+index,locked:false,moduleId:null,depth:Math.min(item.depth,17.6)};
    tool.fingerGrips=automaticFingerGrips(tool,{radius:9});return tool;
  });
  const base={...blankProject(),width:1100,height:850,insertHeight:20,bedWidth:256,bedHeight:256,limitToBed:true,
    printMode:'light',bottomMode:'plain',sizeLabels:true,connectors:true,jointClearance:.2,
    multiMaterial:{enabled:true,floor:true,text:true,floorThickness:.6}};
  fixture=addToolGroup(base,tools,{name:'Wrenches 6–32',arrangement:'ordered',order:'asc',checkManufacturing:false,
    toolSet:{id:'wrenches',name:'Wrenches 6–32',layout:'shared'}}).project;
  return structuredClone(fixture);
}
function decode(data){
  const bytes=new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),triangles=[];
  for(let i=0;i<view.getUint32(80,true);i++)triangles.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));
  return triangles;
}
const high=mesh=>mesh.reduce((max,triangle)=>triangle.reduce((max,point)=>Math.max(max,point[2]),max),-Infinity);

test('the real 26-wrench colour export names its invalid pocket before preparing a partial result',{timeout:120000},async()=>{
  const source=project(),before=JSON.stringify(source);
  assert.equal(requiredInsertHeight(source),20.6);
  await assert.rejects(preparePrintBatch(source),error=>
    /vložku dna příliš hluboká|výška vložky/.test(error.message)&&source.tools.some(tool=>error.message.includes(tool.name)));
  assert.equal(JSON.stringify(source),before,'a failed export cannot alter stored dimensions, contours or layout');
});

test('the corrected 756 by 630 wrench module exports twelve closed coloured parts on a 256 mm bed',{timeout:120000},async()=>{
  const source=project();source.insertHeight=requiredInsertHeight(source);const before=JSON.stringify(source);
  assert.deepEqual(source.modules.map(module=>[module.width,module.height]),[[756,630]]);
  const result=await preparePrintBatch(source);assert.equal(result.parts.length,12);assert.ok(result.manifest.joints.cutCount>0);
  const files=new Map(result.files.map(file=>[file.name,file.data]));let floorTop=-Infinity,bodyTop=-Infinity,textParts=0;
  for(const part of result.parts){
    assert.ok(part.colorFiles.body);
    for(const [zone,name] of Object.entries(part.colorFiles)){
      const mesh=decode(files.get(name));validatePrintMesh(mesh);
      if(zone==='body')bodyTop=Math.max(bodyTop,high(mesh));
      if(zone==='floor')floorTop=Math.max(floorTop,high(mesh));
      if(zone==='text')textParts++;
      for(const triangle of mesh)for(const point of triangle){assert.ok(point[0]>=-1e-5&&point[0]<=256+1e-5);assert.ok(point[1]>=-1e-5&&point[1]<=256+1e-5);}
    }
  }
  assert.ok(textParts>0,'printed labels remain in the colour export');
  assert.ok(Math.abs(bodyTop-floorTop-Math.max(...source.tools.map(tool=>tool.depth)))<1e-4,'the colour inlay preserves tool seating depth');
  assert.equal(JSON.stringify(source),before);
});
