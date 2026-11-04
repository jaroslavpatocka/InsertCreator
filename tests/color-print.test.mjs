// Multi-colour printing: closed separate parts that fill exactly what the body leaves open, in a 3MF slicers can read.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparePrintBatch} from '../dist/print-batch.js';
import {validateProject,blankProject} from '../dist/model.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';
import {materialConfig,materialSlots} from '../dist/print-material.js';
import {encodeColor3MF} from '../dist/three-mf.js';

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const decode=data=>{const bytes=new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let i=0;i<view.getUint32(80,true);i++)out.push([0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));return out;};
const range=mesh=>{const z=mesh.flat().map(p=>p[2]);return[Math.min(...z),Math.max(...z)];};
const project=(extra={},depth=8)=>({...blankProject(),id:'colors',width:252,height:168,printMode:'solid',bottomMode:'plain',sizeLabels:true,multiMaterial:{enabled:true},
  modules:[{id:'m',name:'Klíče & bity',x:0,y:0,width:168,height:126,locked:true,sizeMode:'manual'}],
  tools:[{id:'t',name:'Klíč',points:rect(60,30),x:30,y:30,rotation:0,depth,moduleId:'m',fingerGrips:[],nominalSize:{value:13,unit:'mm'},sizeLabel:'13'}],...extra});
const stl=(result,zone)=>decode(result.files.find(file=>file.name===result.parts[0].colorFiles[zone]).data);
const text=value=>new TextDecoder().decode(value);
function unzip(bytes){const data=new Uint8Array(bytes),view=new DataView(data.buffer,data.byteOffset,data.byteLength),out={};let p=0;while(view.getUint32(p,true)===0x04034b50){const size=view.getUint32(p+18,true),name=view.getUint16(p+26,true),extra=view.getUint16(p+28,true);out[text(data.subarray(p+30,p+30+name))]=text(data.subarray(p+30+name+extra,p+30+name+extra+size));p+=30+name+extra+size;}return out;}

test('old projects stay single colour and the settings survive saving',()=>{
  assert.equal(materialConfig(blankProject()).enabled,false);
  assert.equal(Object.hasOwn(validateProject(blankProject()),'multiMaterial'),false);
  const saved=validateProject({...blankProject(),multiMaterial:{enabled:true,floorThickness:9,floorColor:'#ABCDEF',textColor:'red',text:false}}).multiMaterial;
  assert.equal(saved.enabled,true);assert.equal(saved.floorThickness,2);assert.equal(saved.floorColor,'#abcdef');assert.equal(saved.textColor,'#ffffff');assert.equal(saved.text,false);
});

test('equal colours share one filament and the body comes first',()=>{
  const slots=materialSlots(materialConfig({multiMaterial:{bodyColor:'#111111',floorColor:'#111111',textColor:'#222222'}}));
  assert.deepEqual(slots.zones,{body:1,floor:1,text:2});assert.deepEqual(slots.colors,['#111111','#222222']);
  assert.deepEqual(materialSlots(materialConfig({multiMaterial:{floor:false,text:false}})).zones,{body:1});
});

for(const printMode of ['solid','light'])test(`${printMode}: body, floor and text are closed solids and the tool keeps its depth`,async()=>{
  const p=project({printMode}),plain=await preparePrintBatch({...p,multiMaterial:{enabled:false}}),result=await preparePrintBatch(p),part=result.parts[0];
  assert.ok(part.file.endsWith('.3mf'));assert.deepEqual(Object.keys(part.colorFiles).sort(),['body','floor','text']);
  const body=stl(result,'body'),floor=stl(result,'floor'),letters=stl(result,'text');
  for(const mesh of [body,floor,letters]){validatePrintMesh(mesh);assert.ok(trianglesVolume(mesh)>0);}
  const thickness=materialConfig(p).floorThickness,[low,high]=range(floor);assert.ok(Math.abs(high-low-thickness)<.001,'the inlay is as thick as set');
  const height=p.insertHeight,top=printMode==='solid'?height:p.base+thickness;
  assert.ok(Math.abs(high-(printMode==='solid'?height-8:top))<.001,'the floor the tool stands on');
  const single=decode(plain.files.find(file=>file.name===plain.parts[0].file).data);
  if(printMode==='solid'){const parts=trianglesVolume(body)+trianglesVolume(floor)+trianglesVolume(letters);assert.ok(Math.abs(parts-trianglesVolume(single)-trianglesVolume(letters))<1,'the inlay replaces the body volume it takes');}
});

test('colour parts are cut together with the body on a small print bed',async()=>{
  const p=project({bedWidth:100,bedHeight:100,limitToBed:true}),result=await preparePrintBatch(p);
  assert.ok(result.parts.length>1);
  for(const part of result.parts)for(const name of Object.values(part.colorFiles))validatePrintMesh(decode(result.files.find(file=>file.name===name).data));
  assert.ok(result.parts.some(part=>part.colorFiles.floor));
});

test('a pocket too deep for the inlay is refused with its name',async()=>{
  const deep=project({printMode:'light'},17.6);await assert.rejects(preparePrintBatch(deep),/Klíč/);
  const thin=project({base:1,multiMaterial:{enabled:true,floorThickness:.6}},19);await assert.rejects(preparePrintBatch(thin),/Klíč/);
});

test('switched off zones leave the body as it was',async()=>{
  const p=project({multiMaterial:{enabled:true,floor:false,text:false}}),plain=await preparePrintBatch({...p,multiMaterial:{enabled:false}}),result=await preparePrintBatch(p);
  assert.deepEqual(Object.keys(result.parts[0].colorFiles),['body']);
  assert.ok(Math.abs(trianglesVolume(stl(result,'body'))-trianglesVolume(decode(plain.files.find(file=>file.name===plain.parts[0].file).data)))<.001);
});

test('the 3MF names parts, keeps filaments and escapes names',()=>{
  const cube=[[[0,0,0],[1,1,0],[1,0,0]]],files=unzip(encodeColor3MF([{name:'Telo',color:'#112233',filament:1,triangles:cube},{name:'Dno <&>',color:'#445566',filament:2,triangles:cube}],{title:'Klíče & bity'}));
  assert.ok(files['[Content_Types].xml']&&files['_rels/.rels']&&files['3D/_rels/3dmodel.model.rels']);
  for(const [element,count] of [['build',1],['item',1],['component',2]])assert.equal((files['3D/3dmodel.model'].match(new RegExp('<'+element+' [^>]*p:UUID','g'))||[]).length,count,element);
  assert.match(files['Metadata/model_settings.config'],/key="name" value="Dno &lt;&amp;&gt;"\/><metadata key="extruder" value="2"/);
  assert.match(files['3D/Objects/object_1.model'],/displaycolor="#445566FF"/);
  assert.match(files['3D/3dmodel.model'],/<metadata name="Application">InsertCreator<\/metadata>/);
  assert.doesNotMatch(files['3D/3dmodel.model'],/Application">BambuStudio/,'claiming to be Bambu Studio crashes its reader');
  assert.equal((files['3D/Objects/object_1.model'].match(/<vertex /g)||[]).length,6,'vertices are shared inside each part');
});

test('the manifest lists filaments and the single colour export is unchanged',async()=>{
  const p=project(),result=await preparePrintBatch(p);
  assert.deepEqual(result.manifest.colors.filaments,['#2f3a45','#e7a039','#ffffff']);assert.deepEqual(result.manifest.colors.zones,{body:1,floor:2,text:3});
  const plain=await preparePrintBatch({...p,multiMaterial:undefined});assert.ok(plain.parts[0].file.endsWith('.stl'));assert.equal(plain.manifest.colors,undefined);
});

for(const printMode of ['solid','light'])test(`${printMode}: Gridfinity feet stay on the body only`,async()=>{
  const module={id:'m',name:'G',x:0,y:0,width:168,height:126,locked:true,sizeMode:'manual'},result=await preparePrintBatch(project({printMode,bottomMode:'grid',modules:[module]}));
  validatePrintMesh(stl(result,'body'));validatePrintMesh(stl(result,'floor'));
  assert.ok(range(stl(result,'floor'))[0]>4.75,'no feet in the inlay');assert.equal(range(stl(result,'body'))[0],0);
});

test('only pockets above a magnet need the magnet reserve',async()=>{
  const module={id:'m',name:'M',x:0,y:0,width:168,height:126,locked:true,sizeMode:'manual'};
  const clear=project({bottomMode:'magnet',modules:[module],multiMaterial:{enabled:true,floorThickness:1}},17.6);
  clear.tools[0].x=50;clear.tools[0].y=45;await preparePrintBatch(clear);
  const over=structuredClone(clear);over.tools[0].x=8;over.tools[0].y=8;await assert.rejects(preparePrintBatch(over),/Klíč/);
});

test('filaments of zones without any geometry are not listed',async()=>{
  const result=await preparePrintBatch(project({sizeLabels:false}));
  assert.deepEqual(result.manifest.colors.zones,{body:1,floor:2});assert.deepEqual(result.manifest.colors.filaments,['#2f3a45','#e7a039']);
});

test('the export dialog statistics see the inlay and refuse the same pocket',async()=>{
  const {printStats}=await import('../dist/geometry.js');
  const p=project({printMode:'light'}),off=printStats({...p,multiMaterial:undefined},{checkBed:false}),on=printStats(p,{checkBed:false});
  assert.ok(on.volumeMm3>off.volumeMm3,'walls rise and the inlay counts');
  assert.throws(()=>printStats(project({printMode:'light'},17.6),{checkBed:false}),/Klíč/);
});
