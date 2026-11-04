import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {exportSTL,exportFitSTL,validateLayout} from '../dist/geometry.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {validatePrintMesh} from '../dist/print-geometry.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
// Handwritten asymmetric layout: the lower-right two thirds of the stepped
// module are absent, and the L pocket has a slanted upper arm and lower-left leg.
const chiral=[{x:0,y:0},{x:45,y:5},{x:44,y:12},{x:12,y:8},{x:10,y:25},{x:0,y:23}];
const fixture=()=>({...blankProject(),id:'manufacturing-orientation',width:336,height:252,clearance:0,printMode:'solid',bottomMode:'plain',sizeLabels:true,limitToBed:false,connectors:false,
  modules:[
    {id:'step',name:'Upper left step',x:0,y:0,width:126,height:126,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:0,y:2}],sizeMode:'manual'},
    {id:'horizontal',name:'Upper right',x:168,y:0,width:126,height:42,sizeMode:'manual'},
    {id:'vertical',name:'Lower right',x:210,y:84,width:42,height:126,sizeMode:'manual'}
  ],tools:[
    {id:'chiral',name:'Asymmetric L',moduleId:'step',points:chiral,x:12,y:12,rotation:0,depth:10,fingerGrips:[]},
    {id:'label-0',name:'Horizontal',sizeLabel:'FR2',moduleId:'horizontal',points:rectangle(115,20),x:173,y:10,rotation:0,depth:10,fingerGrips:[]},
    {id:'label-90',name:'Vertical',sizeLabel:'FR2',moduleId:'vertical',points:rectangle(20,115),x:220,y:89,rotation:0,depth:10,fingerGrips:[]}
  ]
});
const decode=bytes=>{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:view.getUint32(80,true)},(_,i)=>Array.from({length:3},(_,j)=>Array.from({length:3},(_,c)=>view.getFloat32(84+i*50+12+j*12+c*4,true))));
};
const transform=(mesh,m)=>mesh.map(triangle=>triangle.map(([x,y,z])=>[m[0]*x+m[1]*y+m[2]*z+m[3],m[4]*x+m[5]*y+m[6]*z+m[7],m[8]*x+m[9]*y+m[10]*z+m[11]]));
const determinant=m=>m[0]*m[5]-m[1]*m[4];
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
function inside(x,y,polygon){
  let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)result=!result;
  }return result;
}
// Independent expected layout polygons, without moduleOutline, pocketOutline or
// the production coordinate helper. The zero-clearance fixture makes the stated
// dimensions the actual cavity dimensions.
const expectedStep=[{x:.25,y:.25},{x:125.75,y:.25},{x:125.75,y:41.75},{x:41.75,y:41.75},{x:41.75,y:125.75},{x:.25,y:125.75}];
const expectedMaterial=(project,x,y,only=null)=>{
  const modules=project.modules.filter(module=>!only||module.id===only);
  const inBody=modules.some(module=>module.id==='step'?inside(x,y,expectedStep):x>module.x+.25&&x<module.x+module.width-.25&&y>module.y+.25&&y<module.y+module.height-.25);
  return inBody&&!project.tools.filter(tool=>!only||tool.moduleId===only).some(tool=>inside(x-tool.x,y-tool.y,tool.points));
};
const stlAtDrawer=(mesh,x,y,projectHeight,z=18)=>materialAt(mesh,x,projectHeight-y,z);

test('whole binary STL has the same handedness as an asymmetric multi-module 2D layout',()=>{
  const project=fixture(),before=structuredClone(project);assert.deepEqual(validateLayout(project),[]);
  const mesh=decode(exportSTL(project));validatePrintMesh(mesh);
  for(let y=4.321;y<project.height;y+=7.7)for(let x=3.713;x<project.width;x+=7.7){
    assert.equal(stlAtDrawer(mesh,x,y,252),expectedMaterial(project,x,y),`physical top at drawer ${x.toFixed(3)},${y.toFixed(3)}`);
  }
  // Explicit chiral features help explain a failure without relying only on a
  // dense raster: no rotation can exchange this leg and the empty step notch.
  for(const [x,y,solid] of [[17,32,false],[48,33,true],[112,18,true],[112,108,false],[18,111,true],[155,20,false],[225,100,false],[180,150,false]]){
    assert.equal(stlAtDrawer(mesh,x,y,252),solid,`declared asymmetric feature ${x},${y}`);
  }
  assert.deepEqual(project,before);
});

test('selected-module STL and 1 mm fit rings preserve the same chiral upper view',()=>{
  const project=fixture();
  for(const module of project.modules){
    const mesh=decode(exportSTL(project,{moduleId:module.id}));validatePrintMesh(mesh);
    for(let y=module.y+3.217;y<module.y+module.height;y+=6.9)for(let x=module.x+3.127;x<module.x+module.width;x+=6.9){
      assert.equal(materialAt(mesh,x-module.x,module.height-(y-module.y),18),expectedMaterial(project,x,y,module.id),`${module.id}: upper view at original ${x},${y}`);
    }
  }
  const fit=decode(exportFitSTL(project,{moduleId:'step'}));validatePrintMesh(fit);
  // Directly stated points on the real L's surrounding wall, its hollow centre,
  // and the open notch. These are not samples of the planner's output polygons.
  for(const [x,y,solid] of [[11,20,true],[16,20,false],[50,15,true],[25,22,true],[48,33,false],[17,32,false]]){
    assert.equal(materialAt(fit,x,126-y,.5),solid,`physical fit ring ${x},${y}`);
  }
});

test('FR2 reads like the layout in whole, selected-module and clipped 90 degree batch STL',async()=>{
  const project=fixture(),mesh=decode(exportSTL(project)),labels=planSizeLabels(project).labels;
  const expected=[['11111','10000','10000','11110','10000','10000','10000'],['11110','10001','10001','11110','10100','10010','10001'],['01110','10001','00001','00010','00100','01000','11111']];
  assert.equal(labels.length,2);assert.deepEqual(labels.map(label=>label.rotation),[0,90]);
  const batch=await preparePrintBatch({...project,bedWidth:76,bedHeight:95}),assembled=batch.parts.flatMap(part=>transform(decode(batch.files.find(file=>file.name===part.file).data),part.assemblyTransform));
  assert.ok(batch.parts.some(part=>part.moduleId==='horizontal'&&part.rotationForPrinting===90),'a labelled module is genuinely cut and rotated for printing');
  for(const label of labels){
    const module=project.modules.find(module=>module.id===label.moduleId),selected=decode(exportSTL(project,{moduleId:module.id}));
    for(const [name,actual,origin,anchor] of [['whole',mesh,{x:0,y:0},252],['selected',selected,module,module.height],['batch',assembled,{x:0,y:0},252]]){
      for(let character=0;character<3;character++)for(let row=0;row<7;row++)for(let col=0;col<5;col++){
        const across=character*3+(col+.5)*.5,down=(row+.5)*.5;
        const x=label.x+.8+(label.rotation?3.5-down:across)-origin.x,y=anchor-(label.y+.8+(label.rotation?across:down)-origin.y);
        assert.equal(materialAt(actual,x,y,19.85),expected[character][row][col]==='0',`${name}/${label.rotation} degrees: glyph ${character}, row ${row}, col ${col}`);
        assert.equal(materialAt(actual,x,y,19.5),true,'engraving retains support');
      }
    }
  }
});

test('clipped STL parts rotated 90 degrees reassemble physically and map back to the original 2D frame',async()=>{
  const project={...fixture(),sizeLabels:false,bedWidth:76,bedHeight:95,
    modules:[{id:'cut',name:'Asymmetric cut module',x:42,y:42,width:168,height:126,sizeMode:'manual'}],
    tools:[{id:'chiral-cut',name:'Asymmetric L',moduleId:'cut',points:chiral,x:54,y:54,rotation:0,depth:10,fingerGrips:[]}]
  },before=structuredClone(project),result=await preparePrintBatch(project),physical=[],layout=[];
  assert.ok(result.parts.length>1);assert.ok(result.parts.some(part=>part.rotationForPrinting===90),'the fixture exercises actual printing rotation');
  assert.ok(result.parts.some(part=>part.clip.width<168||part.clip.height<126),'the fixture exercises real clipping');
  assert.equal(result.manifest.schemaVersion,2);
  for(const part of result.parts){
    const mesh=decode(result.files.find(file=>file.name===part.file).data);validatePrintMesh(mesh);
    assert.ok(part.bounds.width<=76&&part.bounds.height<=95);assert.equal(part.layoutTransform.length,16);
    assert.ok(Math.abs(determinant(part.assemblyTransform)-1)<1e-9,'physical assembly uses rotations/translations, never a reflection');
    assert.ok(Math.abs(determinant(part.layoutTransform)+1)<1e-9,'the explicit screen-layout map changes Y convention');
    physical.push(...transform(mesh,part.assemblyTransform));layout.push(...transform(mesh,part.layoutTransform));
    const printedOrigin=transform([[[0,0,0],[1,0,0],[0,1,0]]],part.assemblyTransform)[0],drawerOrigin=transform([[[0,0,0],[1,0,0],[0,1,0]]],part.layoutTransform)[0];
    for(let i=0;i<3;i++){assert.ok(Math.abs(printedOrigin[i][0]-drawerOrigin[i][0])<1e-5);assert.ok(Math.abs(printedOrigin[i][1]-(252-drawerOrigin[i][1]))<1e-5);}
  }
  for(let y=45.217;y<168;y+=8.9)for(let x=45.127;x<210;x+=8.9){
    const expected=expectedMaterial(project,x,y);
    assert.equal(stlAtDrawer(physical,x,y,252),expected,`physical reassembly top ${x},${y}`);
    assert.equal(materialAt(layout,x,y,18),expected,`independent original-layout inverse ${x},${y}`);
  }
  assert.deepEqual(project,before);
});
