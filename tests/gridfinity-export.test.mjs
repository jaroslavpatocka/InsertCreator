import test from 'node:test';
import assert from 'node:assert/strict';
import {gridfinityLayout,gridfinityFreeCells,planBaseplateTiles,baseplateTriangles,exportBaseplateSTL} from '../dist/gridfinity-baseplate.js';
import {gridfinityPlugSTL} from '../dist/print-batch.js';
import {executeManufacturingTask} from '../dist/manufacturing-worker.js';
import {blankProject,validateProject} from '../dist/model.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

const plate=(width,height,extra={})=>({width,height,grid:42,...extra});
const size=triangles=>{const points=triangles.flat(),span=axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]));return[span(0),span(1),span(2)].map(v=>Math.round(v*1000)/1000);};
const decode=bytes=>{const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);assert.equal(bytes.byteLength,84+count*50);return Array.from({length:count},(_,i)=>[0,1,2].map(v=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+v*12+axis*4,true))));};
function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){const length=view.getUint32(offset+18,true),name=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+name+extra;files.set(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+name)),bytes.subarray(start,start+length));offset=start+length;}
  return files;
}
const tool=(id,moduleId,x,y)=>({id,name:id,points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],x,y,rotation:0,depth:8,moduleId,fingerGrips:[],locked:false});
const project=(modules,tools,extra={})=>validateProject({...blankProject(),id:'g',name:'g',width:168,height:126,grid:42,bottomMode:'grid',bedWidth:220,bedHeight:220,modules,tools,...extra});
const full=project([{id:'all',name:'All',x:0,y:0,width:168,height:126,sizeMode:'manual',locked:false}],[tool('t','all',20,20)]);
const exported=async source=>{const result=await executeManufacturingTask('export',source,{package:true,bundle:true,moduleIds:source.modules.map(module=>module.id)});return unzip(result.zip);};

test('a drawer larger than whole cells gets a solid strip up to the 0.25 mm wall gap',()=>{
  const p=plate(130,100),layout=gridfinityLayout(p);
  assert.deepEqual([layout.columns,layout.rows],[3,2]);assert.deepEqual(layout.remainder,{right:4,bottom:16});assert.deepEqual(layout.expansion,{right:3.75,bottom:15.75});
  const triangles=baseplateTriangles(p);validatePrintMesh(triangles);assert.ok(trianglesVolume(triangles)>0);
  assert.deepEqual(size(triangles),[129.75,99.75,5]);
  const stl=decode(exportBaseplateSTL(p));validatePrintMesh(stl);assert.deepEqual(size(stl),[129.75,99.75,5]);
  assert.equal(Math.min(...stl.flat().map(point=>point[1])),0,'the physical mesh is anchored on its real height');
});

test('whole cells and remainders within the wall gap stay plain plates',()=>{
  assert.deepEqual(gridfinityLayout(plate(126,84)).expansion,{right:0,bottom:0});assert.deepEqual(size(baseplateTriangles(plate(126,84))),[126,84,5]);
  assert.deepEqual(gridfinityLayout(plate(126.25,84.1)).expansion,{right:0,bottom:0});assert.deepEqual(size(baseplateTriangles(plate(126.25,84.1))),[126,84,5]);
});

test('only edge tiles carry the strip and the last tile fits the bed with it',()=>{
  const p=plate(130,100,{limitToBed:true,bedWidth:126,bedHeight:120}),plan=planBaseplateTiles(p);
  for(const tile of plan.tiles){
    const edgeX=tile.x+tile.columns===plan.layout.columns,edgeY=tile.y+tile.rows===plan.layout.rows;
    assert.equal(tile.extendRight,edgeX?3.75:0);assert.equal(tile.extendBottom,edgeY?15.75:0);
    const width=tile.columns*42+tile.extendRight,height=tile.rows*42+tile.extendBottom;
    assert.ok(plan.rotated?height<=126&&width<=120:width<=126&&height<=120,`tile ${width} x ${height} fits`);
    validatePrintMesh(baseplateTriangles(p,{tile}));assert.deepEqual(size(baseplateTriangles(p,{tile})).slice(0,2),[width,height]);
  }
  assert.ok(plan.tiles.length>1,'three columns plus the strip do not fit a 126 mm bed in one piece');
  assert.equal(plan.tiles.reduce((sum,tile)=>sum+tile.columns*tile.rows,0),6);
});

test('a bed that cannot take the strip even with one cell is refused',()=>{
  assert.throws(()=>planBaseplateTiles(plate(80,42,{limitToBed:true,bedWidth:42,bedHeight:42})),/dilatační/);
});

test('free cells follow the real footprint of a stepped module',()=>{
  const stepped={id:'s',name:'S',x:0,y:0,width:84,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]};
  assert.equal(gridfinityFreeCells({...plate(168,126),modules:[stepped]}),12-3);
  assert.equal(gridfinityFreeCells({...plate(168,126),modules:[]}),12);
  assert.equal(gridfinityFreeCells(full),0);
});

test('the plug is one closed 1x1 model level with the surface of a module in the same print mode',()=>{
  // Solid modules are flat at the insert height; light ones are a plate with walls only around pockets.
  for(const [extra,height] of [[{printMode:'solid'},24.75],[{printMode:'light'},7.15],[{printMode:'solid',multiMaterial:{enabled:true}},24.75],[{printMode:'solid',connectors:true},24.75]]){
    const mesh=decode(gridfinityPlugSTL(project([],[],extra)));validatePrintMesh(mesh);
    const [x,y,z]=size(mesh);assert.ok(x>41&&x<=42&&y>41&&y<=42,`footprint ${x} x ${y}`);assert.equal(z,height);
  }
});

test('every Gridfinity export contains the raster and the plug, even without free cells',async()=>{
  const files=await exported(full),names=[...files.keys()];
  assert.ok(names.some(name=>/^gridfinity\/zakladna-001-4x3\.stl$/.test(name)));assert.ok(names.includes('gridfinity/zatka-1x1.stl'));
  const assembly=JSON.parse(new TextDecoder().decode(files.get('assembly.json')));
  assert.equal(assembly.gridfinity.plug.freeCells,0);assert.equal(assembly.gridfinity.plug.file,'gridfinity/zatka-1x1.stl');assert.equal(assembly.gridfinity.baseplate.tiles.length,1);
  assert.match(new TextDecoder().decode(files.get('README.txt')),/vytiskněte 0×/);
  validatePrintMesh(decode(files.get('gridfinity/zatka-1x1.stl')));
});

test('free cells come from the whole drawer when only one module is exported, and the strip reaches the manifest',async()=>{
  const source=project([{id:'a',name:'A',x:0,y:0,width:84,height:84,sizeMode:'manual',locked:false},{id:'b',name:'B',x:84,y:0,width:42,height:42,sizeMode:'manual',locked:false}],[tool('t','a',20,20)],{width:172,height:130});
  const result=await executeManufacturingTask('export',source,{package:true,bundle:true,moduleIds:['a']}),files=unzip(result.zip),assembly=JSON.parse(new TextDecoder().decode(files.get('assembly.json')));
  assert.equal(assembly.gridfinity.plug.freeCells,12-5);assert.deepEqual(assembly.gridfinity.baseplate.expansion,{right:3.75,bottom:3.75});
  const [tile]=assembly.gridfinity.baseplate.tiles;assert.deepEqual(tile.sizeMm,{width:171.75,height:129.75});assert.equal(tile.assemblyTransform[7],.25);
  assert.deepEqual(size(decode(files.get(tile.file))),[171.75,129.75,5]);
});

test('other bottoms export no Gridfinity files',async()=>{
  const files=await exported({...full,bottomMode:'plain'});
  assert.equal([...files.keys()].some(name=>name.startsWith('gridfinity/')),false);
  assert.equal(JSON.parse(new TextDecoder().decode(files.get('assembly.json'))).gridfinity,undefined);
});

test('the standalone baseplate export keeps its file names and gains the strip',async()=>{
  const result=await executeManufacturingTask('baseplate',{...full,width:172,height:130},{});
  assert.ok(result.files.some(file=>/^gridfinity-001-4x3\.stl$/.test(file.name)));assert.deepEqual(result.manifest.expansion,{right:3.75,bottom:3.75});assert.equal(result.manifest.tiles[0].assemblyTransform[7],.25);
});
