import test from 'node:test';
import assert from 'node:assert/strict';
import {fillFreeCells,validateModuleFootprint,moduleOutline,localModuleOutline,moduleArea,moduleIntersects,containsPocketWalls,steppedModuleFootprint} from '../dist/module-footprint.js';
import {buildPrintTriangles,validatePrintMesh} from '../dist/print-geometry.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {blankProject} from '../dist/model.js';
import {printPreview} from '../dist/preview3d.js';
import {baseplateTriangles} from '../dist/gridfinity-baseplate.js';

const cells=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];
const stepped=(extra={})=>({id:'L',x:0,y:0,width:84,height:84,shape:'stepped',cells:structuredClone(cells),...extra});
const rectangle=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
const area=poly=>Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
const close=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should equal ${expected}`);
const volume=triangles=>triangles.reduce((sum,[a,b,c])=>sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0);
const project=(module=stepped(),extra={})=>({...blankProject(),grid:42,wall:2.4,clearance:0,base:2.4,insertHeight:20,limitToBed:false,bottomMode:'plain',printMode:'solid',width:168,height:168,modules:[module],tools:[],...extra});
const insideL=(x,y)=>x>=-.001&&y>=-.001&&x<=84.001&&y<=84.001&&(x<=42.001||y<=42.001);

test('free notch cells are filled only where no neighbour stands and never enclose one',()=>{
  const grid=42,ell={id:'L',x:0,y:0,width:126,height:126,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:0,y:2}]};
  const full=fillFreeCells(ell,[],grid);assert.equal(Object.hasOwn(full,'cells'),false);assert.equal(Object.hasOwn(full,'shape'),false);assert.equal(ell.cells.length,5);
  const partial=fillFreeCells(ell,[{id:'n',x:84,y:84,width:42,height:42}],grid);assert.equal(partial.cells.length,8);assert.equal(partial.cells.some(cell=>cell.x===2&&cell.y===2),false);
  const ring={id:'R',x:0,y:0,width:126,height:126,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:0,y:2}]},island={id:'i',x:42,y:42,width:42,height:42};
  assert.equal(fillFreeCells(ring,[island],grid),ring);
  assert.equal(fillFreeCells({id:'plain',x:0,y:0,width:84,height:84},[],grid).cells,undefined);
});

test('stepped footprints validate connected raster cells, reject ambiguous boundaries and leave inputs untouched',()=>{
  const source=stepped({cells:[cells[2],cells[0],cells[1]]}),before=structuredClone(source),valid=validateModuleFootprint(source,42);
  assert.deepEqual(valid,{shape:'stepped',cells});assert.deepEqual(source,before);assert.notEqual(valid.cells,source.cells);
  for(const bad of [
    {cells:[]},{cells:[cells[0],cells[0]]},{cells:[{x:0,y:0},{x:1,y:1}]},{cells:[{x:-1,y:0}]},{cells:[{x:.5,y:0}]},{cells:[{x:'0',y:0}]},
    {width:85},{x:1},{shape:'other'},{cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:2,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2}],width:126,height:126},
    {cells:Array.from({length:4097},(_,x)=>({x,y:0})),width:4097*42,height:42}
  ])assert.throws(()=>validateModuleFootprint(stepped(bad),42),error=>!!error.i18n,JSON.stringify(bad).slice(0,120));
  assert.deepEqual(validateModuleFootprint({width:63.2,height:24,x:1,y:2},42),{},'legacy rectangles need no cell allocation or forced raster origin');
});

test('local/world material outlines and real area agree, including every inset notch edge',()=>{
  const module=stepped({x:42,y:84}),local=localModuleOutline(module,42),world=moduleOutline(module,42);
  assert.equal(local.length,6);close(area(local),3*42*42);close(moduleArea(module,42),3*42*42);
  assert.deepEqual(world,local.map(p=>({x:p.x+42,y:p.y+84})));
  const inset=localModuleOutline(module,42,{inset:.25});assert.equal(inset.length,6);assert.ok(area(inset)<area(local));
  assert.ok(inset.some(p=>p.x===41.75&&p.y===41.75),'the notch inset must follow the concave material corner');
  assert.equal(moduleArea({width:63.2,height:24},42),63.2*24);
});

test('a real neighbouring module fits in the notch while overlapping occupied cells is rejected',()=>{
  const module=stepped(),notch={id:'notch',x:42,y:42,width:42,height:42};
  assert.equal(moduleIntersects(module,notch,42),false);assert.equal(moduleIntersects(notch,module,42),false);
  assert.equal(moduleIntersects(module,{...notch,x:40},42),true);
  assert.equal(moduleIntersects(module,notch,42,{gap:1}),true,'required manufacturing gap still applies to the true notch boundary');
  assert.equal(moduleIntersects(module,{...notch,x:43,y:43,width:40,height:40},42,{gap:1}),false);
  assert.equal(containsPocketWalls(module,rectangle(6,48,12,20),2.4,42),true);
  assert.equal(containsPocketWalls(module,rectangle(50,50,12,20),2.4,42),false,'a pocket in the empty notch is outside the actual module');
  assert.equal(containsPocketWalls(module,rectangle(38,48,3,20),2.4,42),false,'the full wall must fit at the inner notch edge');
});

test('pocket raster hull joins diagonal members, trims only right/bottom and preserves tool coordinates',()=>{
  const module={id:'hull',x:20,y:40,width:120,height:120},p=project(module,{grid:20});
  p.tools=[0,1,2].map(i=>({id:'tool-'+i,moduleId:module.id,poly:rectangle(25+i*20,45+i*20,10,10),depth:8}));
  const before=structuredClone(p),hull=steppedModuleFootprint(p,module);
  assert.equal(hull.shape,'stepped');assert.equal(hull.x,module.x);assert.equal(hull.y,module.y);assert.equal(hull.width,60);assert.equal(hull.height,60);
  assert.ok(moduleArea(hull,20)<60*60);assert.ok(p.tools.every(t=>containsPocketWalls(hull,t.poly,p.wall,20)));
  assert.deepEqual(validateModuleFootprint(hull,20).cells,hull.cells);assert.deepEqual(p,before);
});

test('raster hull fills enclosed holes and uses a rectangular fallback for empty or excessive candidates',()=>{
  const module={id:'ring',x:0,y:0,width:60,height:60},p=project(module,{grid:20});
  p.tools=Array.from({length:9},(_,i)=>({x:i%3,y:Math.floor(i/3)})).filter(p=>p.x!==1||p.y!==1).map((cell,i)=>({id:'ring-'+i,moduleId:'ring',poly:rectangle(cell.x*20+5,cell.y*20+5,10,10),depth:8}));
  const filled=steppedModuleFootprint(p,module);assert.equal(filled.cells,undefined);assert.equal(filled.width,60);assert.equal(filled.height,60);
  assert.deepEqual(steppedModuleFootprint(project(module),module),module);
  const excessive={id:'large',x:0,y:0,width:3000,height:3000};assert.deepEqual(steppedModuleFootprint(project(excessive,{grid:10}),excessive),excessive);
});

test('actual stepped solid and light manufacturing meshes are closed and have the expected material volume',()=>{
  const module=stepped(),p=project(module),pocket={id:'pocket',moduleId:module.id,poly:rectangle(8,8,12,20),depth:8};
  const plain=buildPrintTriangles(p,[module],[pocket]);validatePrintMesh(plain);
  close(volume(plain),area(moduleOutline(module,42,{inset:.25}))*20-12*20*8,.02);
  assert.ok(plain.every(triangle=>insideL(...triangle.reduce((sum,v)=>[sum[0]+v[0]/3,sum[1]+v[1]/3],[0,0]))),'no real triangle may cover the nominal empty notch');
  const light=buildPrintTriangles({...p,printMode:'light'},[module],[]);validatePrintMesh(light);close(volume(light),area(moduleOutline(module,42,{inset:.25}))*2.4,.02);
  assert.throws(()=>buildPrintTriangles(p,[module],[{...pocket,poly:rectangle(50,50,12,20)}]),/schodového/);
});

test('Gridfinity stepped meshes put actual feet only under occupied cells, while magnet pockets remain in material',()=>{
  const module=stepped(),p=project(module),gridMesh=buildPrintTriangles({...p,bottomMode:'grid'},[module],[]);validatePrintMesh(gridMesh);
  assert.ok(gridMesh.every(triangle=>triangle.every(v=>insideL(v[0],v[1]))),'an empty notch must not contain a fourth Gridfinity foot');
  assert.ok(gridMesh.some(triangle=>triangle.some(v=>v[2]===0)));
  const magnetProject={...p,bottomMode:'magnet'},magnetMesh=buildPrintTriangles(magnetProject,[module],[]);validatePrintMesh(magnetMesh);
  assert.ok(magnetMesh.every(triangle=>triangle.every(v=>insideL(v[0],v[1]))));
  const top=20+Math.max(2.4,2.2+1.2)-2.4,r=6.2/2,circleArea=48*r*r*Math.sin(2*Math.PI/48)/2;
  close(volume(magnetMesh),area(moduleOutline(module,42,{inset:.25}))*top-4*circleArea*2.2,.05);
});

test('printed label plaques stay inside the real stepped material rather than its empty bounding-box notch',()=>{
  const module=stepped(),p=project(module,{sizeLabels:true,tools:[{id:'label',name:'Klíč',sizeLabel:'13 mm',moduleId:'L',poly:rectangle(8,8,14,65),points:rectangle(0,0,14,65),x:8,y:8,rotation:0,depth:8}]}),plan=planSizeLabels(p);
  assert.equal(plan.labels.length,1);assert.ok(plan.labels.every(label=>containsPocketWalls(module,label.plate,p.wall+.25,42,{inset:0})));
  const mesh=buildPrintTriangles(p,[module],p.tools);validatePrintMesh(mesh);
});

test('the 3D fallback traces the actual stepped boundary when manufacturing geometry is invalid',()=>{
  const module=stepped(),p=project(module,{tools:[{id:'invalid',name:'Invalid',moduleId:'L',points:rectangle(0,0,12,20),x:8,y:8,depth:100}]}),preview=printPreview(p,null,null);
  assert.equal(preview.stats.invalidModules,1);const wire=preview.html.match(/data-invalid-module="true"[^]*?<path d="([^"]+)"/);
  assert.ok(wire);assert.equal((wire[1].match(/M/g)||[]).length,18,'six footprint edges create six bottom, top and vertical wire segments');
});

test('Gridfinity 3D uses the real baseplate surface with assembly offset and no editable module identity',()=>{
  const p=project(undefined,{width:84,height:84,bottomMode:'grid',modules:[]}),before=structuredClone(p),preview=printPreview(p,null,null);
  assert.match(preview.html,/data-baseplate="true"/);assert.doesNotMatch(preview.html,/data-module=/);assert.equal(preview.stats.invalidModules,0);
  assert.ok(preview.stats.triangles>0&&preview.stats.triangles<baseplateTriangles(p).length);assert.ok(preview.stats.triangles<2500);close(preview.frame.center[2],2.25);
  const selected=printPreview(p,null,'__gridfinity-baseplate');assert.equal(selected.html,preview.html,'the baseplate cannot become a selected tool module');
  assert.deepEqual(p,before);
  const normalSize=printPreview({...p,width:504,height:378},null,null);
  assert.equal(normalSize.stats.triangles,0);assert.equal(normalSize.stats.invalidModules,0);assert.match(normalSize.html,/data-baseplate="true"/);assert.ok(normalSize.html.length<100000,'the default drawer reference must not expand into megabytes of triangle SVG');
  const withModule=printPreview({...p,width:504,height:378,modules:[{id:'solid',x:0,y:0,width:42,height:42}]},null,null);
  assert.ok(withModule.html.indexOf('data-baseplate="true"')<withModule.html.indexOf('data-module="solid"'),'opaque modules must occlude the socket wire reference drawn beneath them');
  const large=printPreview({...p,width:882,height:882},null,null);
  assert.equal(large.stats.triangles,0);assert.equal(large.stats.invalidModules,0);assert.ok(large.warnings.some(warning=>warning.includes('400')));assert.match(large.html,/data-baseplate="true"/);
});
