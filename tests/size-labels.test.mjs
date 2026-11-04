import test from 'node:test';
import assert from 'node:assert/strict';
import {planSizeLabels,sizeLabelGlyphs} from '../dist/size-labels.js';
import {blankProject,validateProject} from '../dist/model.js';
import {catalogSets} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {addToolGroup} from '../dist/set-module.js';
import {autoTraceImage} from '../dist/auto-trace.js';
import {slantedScrewdriversPhoto} from './fixtures/tool-photos.mjs';
import {smartArrange} from '../dist/smart-layout.js';
import {exportSTL,exportFitSTL,validateLayout,pocketOutline,autoArrange} from '../dist/geometry.js';
import {printConfig,validatePrintMesh} from '../dist/print-geometry.js';
import {printPreview} from '../dist/preview3d.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const area=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0)/2;
const fixture=()=>({...blankProject(),id:'labels',name:'Velikosti',width:252,height:252,sizeLabels:true,limitToBed:false,printMode:'solid',bottomMode:'plain',modules:[{id:'m',name:'Popisek',x:42,y:42,width:126,height:126,sizeMode:'manual'}],tools:[{id:'t',name:'Klíč 13 mm',nominalSize:{value:13,unit:'mm'},moduleId:'m',points:rectangle(30,60),x:85,y:75,rotation:0,depth:10,fingerGrips:[{id:'left',x:0,y:30,radius:9},{id:'right',x:30,y:30,radius:9}]}]});
let rasterPromise;
const rasterPhoto=()=>rasterPromise??=autoTraceImage(slantedScrewdriversPhoto(),{pxPerMm:2,kind:'paper'});
function mesh(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),edges=new Map(),triangles=[];let volume=0;
  const key=p=>p.map(value=>Math.round(value*1e5)/1e5).join(',');
  for(let i=0;i<count;i++){
    const tri=Array.from({length:3},(_,j)=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true)));triangles.push(tri);
    assert.ok(tri.flat().every(Number.isFinite));const [a,b,c]=tri;
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let j=0;j<3;j++){const a=key(tri[j]),b=key(tri[(j+1)%3]),id=a<b?a+'|'+b:b+'|'+a,entry=edges.get(id)||{count:0,direction:0};entry.count++;entry.direction+=a<b?1:-1;edges.set(id,entry);}
  }
  for(const [edge,entry] of edges){assert.equal(entry.count,2,'non-manifold edge '+edge);assert.equal(entry.direction,0,'incorrect winding '+edge);}
  assert.ok(volume>0);return{triangles,volume,count};
}
function materialAt(mesh,x,y,z){
  const intersections=[];
  for(const [a,b,c] of mesh.triangles){
    const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const hit=u*a[2]+v*b[2]+w*c[2];if(hit>z+1e-5&&!intersections.some(value=>Math.abs(value-hit)<1e-5))intersections.push(hit);
  }
  return intersections.length%2===1;
}
function inside(point,polygon){let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;}
function glyphPoint(label){
  for(let y=label.y+.11;y<label.y+label.height;y+=.17)for(let x=label.x+.13;x<label.x+label.width;x+=.17){const point={x,y};if(label.polygons.reduce((s,p)=>s+(inside(point,p)?Math.sign(area(p)):0),0))return point;}
  assert.fail('label has no engraved pixels');
}

test('size label font uses real polygons, handles fractions and rejects unsupported text',()=>{
  for(const text of ['13 mm','1/2 in','6.35 mm','TX25','+/- 10','1/4"']){
    const glyphs=sizeLabelGlyphs(text);assert.ok(glyphs,text);assert.equal(glyphs.height,3.5);assert.ok(glyphs.polygons.length>0);assert.ok(glyphs.polygons.reduce((s,p)=>s+area(p),0)>0);
  }
  assert.equal(sizeLabelGlyphs('尺寸'),null);assert.equal(sizeLabelGlyphs('A'.repeat(25)),null);
  assert.equal(sizeLabelGlyphs('1,5 mm').text,'1.5 mm');assert.equal(sizeLabelGlyphs('½ in').text,'1/2 in');
});

test('planner shares absolute millimetres, preserves geometry and reports missing or unsafe labels',()=>{
  const p=fixture(),before=structuredClone(p),plan=planSizeLabels(p);
  assert.equal(plan.labels.length,1);assert.deepEqual(plan.skipped,[]);assert.deepEqual(p,before);
  const label=plan.labels[0];assert.equal(label.toolId,'t');assert.equal(label.moduleId,'m');assert.match(label.text,/13\s*mm/);assert.equal(label.depth,.35);assert.equal(label.top,20);
  assert.ok(label.x>=p.modules[0].x+p.wall);assert.ok(label.y>=p.modules[0].y+p.wall);
  assert.deepEqual(planSizeLabels({...p,sizeLabels:false}),{labels:[],skipped:[]});
  const unsupported=fixture();unsupported.tools[0].sizeLabel='尺寸';assert.equal(planSizeLabels(unsupported).skipped[0].reason,'unsupported-character');
  const unknown=fixture();unknown.tools[0]={...unknown.tools[0],name:'Neznámý',nominalSize:undefined};assert.equal(planSizeLabels(unknown).skipped[0].reason,'missing-size');
  const tight={...p,modules:[{id:'m',name:'Těsný',x:0,y:0,width:42,height:84}],tools:[{id:'t',name:'Klíč 13 mm',points:rectangle(30,74),x:6,y:5,rotation:0,depth:10,moduleId:'m',fingerGrips:[]}]};
  assert.deepEqual(validateLayout(tight),[]);assert.equal(planSizeLabels(tight).labels.length,0);assert.equal(planSizeLabels(tight).skipped[0].reason,'no-space');
  assert.deepEqual(exportSTL(tight),exportSTL({...tight,sizeLabels:false}),'skipped labels do not damage the manufacturing mesh');
  assert.equal(planSizeLabels({...p,insertHeight:p.base+.5}).skipped[0].reason,'insufficient-height');
});

test('engraved STL remains closed, oriented and separate from pockets for both constructions and all bottoms',()=>{
  for(const printMode of ['solid','light'])for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const p={...fixture(),printMode,bottomMode},plan=planSizeLabels(p),label=plan.labels[0],origin=p.modules[0],cfg=printConfig(p);
    assert.ok(label,`${printMode}/${bottomMode} can place a label`);assert.deepEqual(plan.skipped,[]);
    const actual=mesh(exportSTL(p,{moduleId:'m'})),plain=mesh(exportSTL({...p,sizeLabels:false},{moduleId:'m'})),glyphArea=label.polygons.reduce((s,poly)=>s+area(poly),0);
    const added=printMode==='light'?label.width*label.height*(label.top-label.baseTop):0;
    assert.ok(Math.abs(actual.volume-plain.volume-(added-glyphArea*label.depth))<.03,`${printMode}/${bottomMode}: only the planned text/plaque volume changes`);
    const pixel=glyphPoint(label),x=pixel.x-origin.x,y=origin.height-(pixel.y-origin.y);
    assert.equal(materialAt(actual,x,y,label.top-.15),false,'text is a real recessed cavity');
    assert.equal(materialAt(actual,x,y,label.top-label.depth-.15),true,'engraving retains solid support underneath');
    assert.equal(materialAt(actual,x,y,label.baseTop-.1),true,'the original base thickness is preserved');
    const pocket=pocketOutline(p.tools[0],p.clearance);
    for(const pt of [{x:100,y:100},{x:84,y:105},{x:116,y:105}]){
      if(!inside(pt,pocket))continue;
      const z=printMode==='light'?label.baseTop+5:cfg.footHeight+cfg.height+cfg.extraBase-5;
      assert.equal(materialAt(actual,pt.x-origin.x,origin.height-(pt.y-origin.y),z),false,'original pocket and finger bays stay open');
    }
  }
});

test('mixed-depth shared modules keep non-overlapping labels and printable geometry',()=>{
  const p={...fixture(),printMode:'light'};p.tools=[
    {id:'a',name:'13 mm',points:rectangle(25,45),x:55,y:60,rotation:0,depth:7,moduleId:'m',fingerGrips:[]},
    {id:'b',name:'1/2 in',points:rectangle(25,45),x:110,y:60,rotation:0,depth:12,moduleId:'m',fingerGrips:[]}
  ];
  const plan=planSizeLabels(p);assert.equal(plan.labels.length,2);assert.deepEqual(plan.skipped,[]);
  const [a,b]=plan.labels;assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));
  mesh(exportSTL(p));
  assert.deepEqual(exportFitSTL(p),exportFitSTL({...p,sizeLabels:false}),'one-millimetre fit rings intentionally omit labels');
});

test('fractions, all supported letter forms and a rotated side label remain manifold',()=>{
  for(const text of ['0123456789','ABCDEFGHIJKL','MNOPQRSTUVWXYZ','1/2 in','6.35 mm','+/- 1/4"'])for(const printMode of ['solid','light']){
    const p={...fixture(),printMode};p.tools[0].sizeLabel=text;
    assert.equal(planSizeLabels(p).labels.length,1,text+' can be placed');mesh(exportSTL(p));
  }
  const narrow={...fixture(),modules:[{id:'m',name:'Úzký',x:42,y:42,width:42,height:126}],tools:[{id:'t',name:'13 mm',points:rectangle(20,115),x:52,y:47,rotation:0,depth:10,moduleId:'m',fingerGrips:[]}]};
  assert.deepEqual(validateLayout(narrow),[]);const plan=planSizeLabels(narrow);assert.equal(plan.labels.length,1);assert.equal(plan.labels[0].rotation,90,'a vertical side strip can carry the size');mesh(exportSTL(narrow));
});

test('actual upper STL cavities read FR2 from above, including a rotated side label',()=>{
  // Independent expected pixels: asymmetric letters/digit detect a reflection that
  // manifoldness and cavity-volume tests cannot see. Read the exported binary STL,
  // never the planned polygons or the 3D preview's projection.
  const expected=[
    ['11111','10000','10000','11110','10000','10000','10000'],
    ['11110','10001','10001','11110','10100','10010','10001'],
    ['01110','10001','00001','00010','00100','01000','11111']
  ];
  for(const printMode of ['solid','light'])for(const rotation of [0,90]){
    const p={...fixture(),printMode,
      modules:[{id:'m',name:'Side label',x:42,y:42,width:rotation?42:126,height:rotation?126:42}],
      tools:[{id:'t',name:'Test',sizeLabel:'FR2',points:rectangle(rotation?20:115,rotation?115:20),x:rotation?52:47,y:rotation?47:52,rotation:0,depth:10,moduleId:'m',fingerGrips:[]}]
    };
    const [label]=planSizeLabels(p).labels;assert.ok(label);assert.equal(label.rotation,rotation);
    const actual=mesh(exportSTL(p,{moduleId:'m'})),origin=p.modules[0],pixels=[];
    for(let character=0;character<3;character++){
      const rows=[];
      for(let row=0;row<7;row++){
        let bits='';
        for(let col=0;col<5;col++){
          const across=character*3+(col+.5)*.5,down=(row+.5)*.5;
          // Sample the layout's font rows after the SAME whole-body conversion
          // as its pocket. The side label retains its original layout rotation.
          const x=label.x+.8+(rotation?3.5-down:across)-origin.x;
          const y=origin.height-(label.y+.8+(rotation?across:down)-origin.y);
          bits+=materialAt(actual,x,y,label.top-.15)?'0':'1';
          assert.equal(materialAt(actual,x,y,label.top-label.depth-.15),true,'every sampled pixel retains support beneath engraving');
        }
        rows.push(bits);
      }
      pixels.push(rows);
    }
    assert.deepEqual(pixels,expected,`${printMode}/${rotation}: readable physical upper surface, not reflected text`);
    // The editor uses its own Y-down representation, without changing the
    // manufacturing shape or relying on SVG's screen convention for the STL.
    for(let character=0;character<3;character++)for(let row=0;row<7;row++)for(let col=0;col<5;col++){
      const across=character*3+(col+.5)*.5,down=(row+.5)*.5;
      const point={x:label.x+.8+(rotation?3.5-down:across),y:label.y+.8+(rotation?across:down)};
      const ink=label.screenPolygons.reduce((sum,polygon)=>sum+(inside(point,polygon)?Math.sign(area(polygon)):0),0)!==0;
      assert.equal(ink,expected[character][row][col]==='1','the Y-down editor representation also stays readable');
    }
    assert.equal(label.depth,.35);
  }
});

test('all 26 real compact wrench-set sizes fit labels and remain below the STL complexity limit',()=>{
  const set=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm');assert.ok(set);
  const tools=set.tools.map((item,i)=>{const tool={...catalogTool(item),id:'w-'+i,depth:12,locked:false,moduleId:null};return{...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})};});
  const result=addToolGroup({...blankProject(),width:1800,height:1500,limitToBed:false,sizeLabels:true},tools,{arrangement:'compact',order:'asc',toolSet:{name:'Klíče 6–32 mm',layout:'shared',arrangement:'compact',order:'asc'}});
  assert.equal(result.placed,true);assert.equal(result.project.modules.length,1);
  assert.deepEqual(result.project.tools.map(tool=>tool.nominalSize?.value),tools.map(tool=>tool.nominalSize.value));
  for(const printMode of ['solid','light']){
    const p={...result.project,printMode},plan=planSizeLabels(p);validateProject(p);
    assert.equal(plan.labels.length,26,'every wrench has a safe label');assert.deepEqual(plan.skipped,[]);assert.deepEqual(validateLayout(p),[]);
    const output=mesh(exportSTL(p));assert.ok(output.count<120000,`${printMode} label geometry stays within the existing facet limit`);
  }
});

test('raster contours with mixed pocket depths preserve stitching with engraved labels',async()=>{
  const trace=await rasterPhoto();assert.equal(trace.contours.length,6);
  const tools=trace.contours.map((contour,i)=>{
    const minX=Math.min(...contour.points.map(p=>p.x)),minY=Math.min(...contour.points.map(p=>p.y));
    const tool={id:'photo-'+i,name:`Foto ${i+1}`,points:contour.points.map(p=>({x:(p.x-minX)/2,y:(p.y-minY)/2})),x:0,y:0,rotation:0,depth:8+i,moduleId:null,locked:false};
    if(i<2)tool.fingerGrips=automaticFingerGrips(tool);return tool;
  });
  // Match the editor's manufacturing-checked set layout, including its coherent per-tool fallback.
  const p={...blankProject(),width:1100,height:700,limitToBed:false,printMode:'light',tools};Object.assign(p,autoArrange(p));
  const result=await smartArrange(p,{mode:'sets'}),next={...p,tools:result.tools.map((tool,i)=>({...tool,nominalSize:{value:8+i,unit:'mm'}})),modules:result.modules,sizeLabels:true};
  assert.deepEqual(validateLayout(next),[]);
  const plan=planSizeLabels(next);assert.ok(plan.labels.length>0,'the complex fixture actually includes engraving');
  for(const printMode of ['solid','light']){
    mesh(exportSTL({...next,printMode,sizeLabels:false}));
    mesh(exportSTL({...next,printMode}));
  }
});

test('a near-collinear raster packing returns a manifold STL or a clear atomic manufacturing error',async()=>{
  const trace=await rasterPhoto(),tools=trace.contours.slice(0,3).map((contour,i)=>{
    const minX=Math.min(...contour.points.map(p=>p.x)),minY=Math.min(...contour.points.map(p=>p.y)),tool={id:'photo-'+i,name:`Foto ${i+1}`,nominalSize:{value:8+i,unit:'mm'},points:contour.points.map(p=>({x:(p.x-minX)/2,y:(p.y-minY)/2})),x:0,y:0,rotation:0,depth:8+i,moduleId:null,locked:false};
    return{...tool,fingerGrips:automaticFingerGrips(tool)};
  });
  const open=[[[0,0,0],[1,0,0],[0,1,0]]];
  assert.throws(()=>validatePrintMesh(open),error=>error.i18n?.cs==='Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');
  const source={...blankProject(),width:1100,height:700,limitToBed:false},snapshot=structuredClone(source);let result;
  try{result=addToolGroup(source,tools,{arrangement:'ordered',toolSet:{name:'Raster',layout:'shared',arrangement:'ordered'}});}
  catch(error){assert.equal(error.i18n?.cs,'Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');assert.deepEqual(source,snapshot);return;}
  assert.deepEqual(validateLayout(result.project),[],'2D layout checks alone do not prove printable topology');
  for(const printMode of ['solid','light'])for(const sizeLabels of [false,true]){
    let bytes;
    try{bytes=exportSTL({...result.project,printMode,sizeLabels});}
    catch(error){assert.equal(error.i18n?.cs,'Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');continue;}
    mesh(bytes);
  }
});

test('3D preview renders the same actual engraved STL and reports omitted text',()=>{
  const p=fixture(),stl=mesh(exportSTL(p)),preview=printPreview(p,null,null);
  assert.equal(preview.stats.triangles,stl.count);assert.equal(preview.stats.invalidModules,0);assert.deepEqual(preview.warnings,[]);
  assert.notEqual(printPreview({...p,sizeLabels:false},null,null).stats.triangles,stl.count,'engraving contributes real facets to the preview');
  const bad=fixture();bad.tools[0].sizeLabel='尺寸';const warning=printPreview(bad,null,null);
  assert.equal(warning.stats.invalidModules,0);assert.ok(warning.warnings.some(message=>message.includes('Popisek')&&message.includes('nepodporovaný')));
  const changed=fixture();const original=printPreview(changed,null,null);changed.tools[0].sizeLabel='14 mm';
  const edited=printPreview(changed,null,null);assert.notEqual(edited.stats.meshRevision,original.stats.meshRevision,'a manual text edit invalidates the geometry cache');
  changed.sizeLabels=false;const disabled=printPreview(changed,null,null);assert.notEqual(disabled.stats.meshRevision,edited.stats.meshRevision,'the label flag invalidates the geometry cache');
  assert.equal(printPreview(changed,'t',null,{yaw:.1}).stats.meshRevision,disabled.stats.meshRevision,'selection and camera keep the cached mesh');
});
