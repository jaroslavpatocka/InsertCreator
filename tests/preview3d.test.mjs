import test from 'node:test';
import assert from 'node:assert/strict';
import {createCamera3D,normalizeCamera3D,printPreview,PREVIEW_BUDGET} from '../dist/preview3d.js';
import {blankProject} from '../dist/model.js';
import {exportSTL,createDemoProject} from '../dist/geometry.js';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {preparePrintBatch} from '../dist/print-batch.js';

const fixture=()=>({...blankProject(),id:'camera-test',width:168,height:126,printMode:'solid',bottomMode:'plain',limitToBed:false,modules:[{id:'m',name:'Nástroj',x:42,y:0,width:84,height:126}],tools:[{id:'t',name:'Nástroj',x:55,y:12,rotation:0,depth:9,moduleId:'m',points:[{x:0,y:0},{x:34,y:0},{x:34,y:75},{x:0,y:75}]}]});
const renderedFaces=preview=>[...preview.html.matchAll(/<polygon data-module="([^"]+)" data-face-index="(\d+)" points="([^"]+)"/g)].map(match=>({moduleId:match[1],index:Number(match[2]),points:match[3]}));
const stlFaces=project=>{
  const bytes=exportSTL(project,{moduleId:'m'}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:view.getUint32(80,true)},(_,i)=>({normal:[0,1,2].map(c=>view.getFloat32(84+i*50+c*4,true)),points:[0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true)))}));
};
function assertFinite(preview){
  assert.ok(preview.viewBox.split(' ').map(Number).every(Number.isFinite));
  assert.ok(preview.viewBounds.width>0&&preview.viewBounds.height>0);
  assert.ok(Object.values(preview.camera).every(Number.isFinite));
  assert.doesNotMatch(preview.html,/NaN|Infinity/);
}
const inside2d=(point,polygon)=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};

test('camera normalization wraps yaw, supports underneath views and keeps invalid inputs finite',()=>{
  const camera=createCamera3D();assert.equal(camera.yaw,Math.PI/4);assert.equal(camera.zoom,1);assert.equal(camera.panX,0);
  assert.notEqual(createCamera3D(),camera,'each caller needs independent camera state');
  const wrapped=normalizeCamera3D({yaw:Math.PI/4+Math.PI*20,pitch:-.7,zoom:2,panX:17,panY:-31});
  assert.ok(Math.abs(wrapped.yaw-Math.PI/4)<1e-12);assert.deepEqual({...wrapped,yaw:0},{yaw:0,pitch:-.7,zoom:2,panX:17,panY:-31});
  assert.deepEqual(normalizeCamera3D({}),camera);
  for(const input of [{yaw:NaN,pitch:Infinity,zoom:NaN,panX:Infinity,panY:NaN},{yaw:1e200,pitch:Math.PI,zoom:500},{pitch:-Math.PI,zoom:0},null]){
    const normalized=normalizeCamera3D(input);assert.ok(Object.values(normalized).every(Number.isFinite));
    assert.ok(normalized.yaw>=-Math.PI&&normalized.yaw<Math.PI);assert.ok(Math.abs(normalized.pitch)<Math.PI/2);assert.ok(normalized.zoom>=.2&&normalized.zoom<=10);
  }
});

test('a 95-tool drawer uses a bounded honest reference before exact manufacturing work',()=>{
  const project={...blankProject(),id:'large-reference',width:420,height:420,connectors:true,sizeLabels:true,modules:[],tools:[]};
  const points=[{x:0,y:0},{x:26,y:3},{x:25,y:8},{x:9,y:6},{x:8,y:26},{x:0,y:26}];
  for(let i=0;i<95;i++){
    const x=i%10*42,y=Math.floor(i/10)*42,id='m'+i;
    project.modules.push({id,name:'Module '+i,x,y,width:42,height:42});
    project.tools.push({id:'t'+i,name:'Tool '+i,moduleId:id,x:x+8,y:y+8,rotation:0,depth:8,nominalSize:{value:8,unit:'mm'},points});
  }
  const before=JSON.stringify(project),start=performance.now(),preview=printPreview(project,null,null,{yaw:0,pitch:1.56});
  assert.ok(performance.now()-start<1500,'reference preview must not enter the multi-second label/part/mesh pipeline');
  assert.equal(preview.stats.reducedDetail,true);assert.equal(preview.stats.invalidModules,0);assert.equal(preview.stats.visibleFaces,0);
  assert.equal(preview.stats.printParts,null,'uncomputed production information must not claim that no parts or joints exist');assert.equal(preview.stats.joints,null);
  assert.equal((preview.html.match(/data-preview-tool="true"/g)||[]).length,95);assert.equal((preview.html.match(/data-simplified-module="true"/g)||[]).length,95);
  assert.ok(preview.html.length<PREVIEW_BUDGET.htmlBytes);assert.doesNotMatch(preview.html,/Skutečná geometrie STL|data-invalid-module/);assert.match(preview.warnings[0],/export/);
  const first=preview.html.match(/<polygon data-preview-tool="true" points="([^"]+)"/)[1].split(' ').map(point=>point.split(',').map(Number));
  const [cx,cy,cz]=preview.frame.center,screen=([x,y])=>[x-cx,-(project.height-y-cy)*Math.sin(1.56)-(project.insertHeight-cz)*Math.cos(1.56)];
  for(const index of [0,1,3,5]){
    const expected=screen([points[index].x+8,points[index].y+8]);
    assert.ok(first[index].every((value,axis)=>Math.abs(value-expected[axis])<.001),'reference keeps the declared asymmetric outline and its layout position');
  }
  assert.equal(JSON.stringify(project),before);assertFinite(preview);
});

test('a dense photographed contour produces bounded reference markup without cleaning or meshing every vertex',()=>{
  const project=fixture();project.tools[0].points=Array.from({length:6000},(_,i)=>({x:17+17*Math.cos(i*Math.PI/3000),y:35+35*Math.sin(i*Math.PI/3000)}));
  const before=JSON.stringify(project),start=performance.now(),preview=printPreview(project,null,null);
  assert.ok(performance.now()-start<1500);assert.equal(preview.stats.reducedDetail,true);assert.equal(preview.stats.invalidModules,0);
  const outline=preview.html.match(/data-preview-tool="true" points="([^"]+)"/);assert.ok(outline);
  assert.ok(outline[1].split(' ').length<=128,'DOM work is limited even when a single source contour has thousands of vertices');
  assert.ok(preview.html.length<50000);assert.equal(JSON.stringify(project),before);assertFinite(preview);
});

test('metadata and material colours reuse geometry while pan and zoom reuse projected polygons',()=>{
  const project={...fixture(),multiMaterial:{enabled:true,floorThickness:.6,bodyColor:'#2f3a45',floorColor:'#e7a039',textColor:'#ffffff'}};
  const first=printPreview(project,null,null),metadata=structuredClone(project);
  metadata.updatedAt='different-save-time';metadata.name='Renamed drawer';metadata.modules[0].locked=true;metadata.tools[0].locked=true;metadata.unit='in';
  const saved=printPreview(metadata,null,null);assert.equal(saved.stats.meshRevision,first.stats.meshRevision);assert.equal(saved.stats.projectionRevision,first.stats.projectionRevision);
  const recoloured=structuredClone(metadata);recoloured.multiMaterial.bodyColor='#ff0000';
  const changed=printPreview(recoloured,null,null);assert.equal(changed.stats.meshRevision,first.stats.meshRevision);assert.notEqual(changed.html,first.html);
  const pan=printPreview(recoloured,null,null,{panX:18,panY:-12,zoom:2});
  assert.equal(pan.stats.projectionRevision,changed.stats.projectionRevision);assert.deepEqual(renderedFaces(pan),renderedFaces(changed));assert.notEqual(pan.viewBox,changed.viewBox);
  const thicker=structuredClone(recoloured);thicker.multiMaterial.floorThickness=.8;
  assert.notEqual(printPreview(thicker,null,null).stats.meshRevision,first.stats.meshRevision,'manufacturing material thickness remains a real geometry change');
});

test('orbit exposes actual opposite STL walls and the underside without rebuilding the cached mesh',()=>{
  const project=fixture(),facets=stlFaces(project);
  const front=printPreview(project,null,null,{yaw:0,pitch:.5}),back=printPreview(project,null,null,{yaw:Math.PI,pitch:.5}),under=printPreview(project,null,null,{yaw:0,pitch:-.5});
  const normals=preview=>renderedFaces(preview).map(face=>facets[face.index].normal);
  assert.ok(normals(front).some(n=>n[1]<-.9)&&!normals(front).some(n=>n[1]>.9),'the front view from negative Y must expose its facing Y walls');
  assert.ok(normals(back).some(n=>n[1]>.9)&&!normals(back).some(n=>n[1]<-.9),'rotating half a turn must expose the opposite Y walls');
  assert.ok(normals(front).some(n=>n[2]>.9)&&!normals(front).some(n=>n[2]<-.9));
  assert.ok(normals(under).some(n=>n[2]<-.9)&&!normals(under).some(n=>n[2]>.9),'negative pitch must render actual bottom facets');
  assert.equal(front.stats.triangles,facets.length,'cache must retain every STL triangle');
  assert.equal(front.stats.meshRevision,back.stats.meshRevision);assert.equal(front.stats.meshRevision,under.stats.meshRevision);
  assert.equal(front.stats.invalidModules,0);assert.deepEqual(front.warnings,[]);
});

test('visible outward STL faces keep camera handedness for every orbit quadrant and underneath view',()=>{
  // With screen Y pointing down, an outward face seen from outside has negative
  // signed area in screen coordinates. The former reflected camera made these areas
  // positive even though its normal-based visibility and manifold tests passed.
  const project=fixture();let checked=0;
  for(const yaw of [-2.6,-1.3,0,.7,2.1])for(const pitch of [-1.56,-.65,0,.55,1.56]){
    const preview=printPreview(project,null,null,{yaw,pitch});
    for(const face of renderedFaces(preview)){
      const points=face.points.split(' ').map(pair=>pair.split(',').map(Number));
      const twiceArea=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
      if(Math.abs(twiceArea)<1e-4)continue; // SVG rounds subpixel fragments to .001 mm.
      assert.ok(twiceArea<0,`outward face ${face.index} is reflected at yaw=${yaw}, pitch=${pitch}`);checked++;
    }
  }
  assert.ok(checked>200,'the regression exercises actual nondegenerate manufacturing facets');
});

test('physical top preview preserves the layout position and chirality of an asymmetric pocket',()=>{
  const project={...blankProject(),id:'layout-chirality',width:252,height:252,clearance:0,printMode:'solid',bottomMode:'plain',limitToBed:false,
    modules:[{id:'m',name:'Asymmetric module',x:42,y:42,width:126,height:84}],
    tools:[{id:'t',name:'L pocket',x:56,y:56,rotation:0,depth:8,moduleId:'m',fingerGrips:[],points:[{x:0,y:0},{x:38,y:0},{x:38,y:10},{x:12,y:10},{x:12,y:35},{x:0,y:35}]}]};
  const pitch=1.56,preview=printPreview(project,null,null,{yaw:0,pitch}),facets=stlFaces(project),floor=12;
  const floorIds=new Set(facets.flatMap((face,i)=>face.normal[2]>.99&&face.points.every(p=>Math.abs(p[2]-floor)<1e-5)?[i]:[]));
  assert.ok(floorIds.size>0);
  const polygons=renderedFaces(preview).filter(face=>floorIds.has(face.index)).map(face=>face.points.split(' ').map(pair=>pair.split(',').map(Number)));
  const inside=(point,polygon)=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  const [cx,cy,cz]=preview.frame.center;
  // Expectations come from the independently declared editor L shape. A physical
  // +Z top view must put its long arm at the top and its short arm on the left.
  // Do not obtain expected coordinates from the manufacturing transform helper.
  for(const [x,y,expected] of [[61,61,true],[90,61,true],[61,83,true],[90,83,false]]){
    const screen=[x-cx,(y-(project.height-cy))*Math.sin(pitch)-(floor-cz)*Math.cos(pitch)];
    assert.equal(polygons.some(poly=>inside(screen,poly)),expected,`layout point ${x},${y} keeps its position and handedness in the physical preview`);
  }
  assert.deepEqual(preview.warnings,[]);
});

test('large Gridfinity wire reference retains the drawer top origin and the unused bottom strip in physical space',()=>{
  const project={...blankProject(),width:1261,height:631,bottomMode:'grid',modules:[],tools:[]},pitch=1.56,preview=printPreview(project,null,null,{yaw:0,pitch});
  const match=preview.html.match(/<g data-baseplate="true"[^>]*><path d="M([-\d.]+) ([-\d.]+)L/);assert.ok(match,'over 400 cells use the bounded wire reference');
  const [cx,cy,cz]=preview.frame.center;
  assert.ok(Math.abs(Number(match[1])-(-cx))<.002);
  assert.ok(Math.abs(Number(match[2])-(-(project.height-cy)*Math.sin(pitch)-(-.25-cz)*Math.cos(pitch)))<.002,'layout top Y=0 maps to physical Y=drawer height');
});

test('puzzle preview renders the actual binary STL part geometry, including cut joints and magnet bottoms',async()=>{
  const cases=[
    {bottomMode:'plain',printMode:'solid',modules:[{id:'m',x:42,y:42,width:168,height:84}],bedWidth:100,bedHeight:100},
    {bottomMode:'magnet',printMode:'solid',modules:[{id:'m',x:42,y:42,width:84,height:84},{id:'n',x:126,y:42,width:84,height:84}],bedWidth:220,bedHeight:220},
    {bottomMode:'magnet',printMode:'light',modules:[{id:'m',x:42,y:42,width:168,height:84}],bedWidth:100,bedHeight:100},
    {bottomMode:'magnet',printMode:'light',modules:[{id:'m',x:42,y:42,width:84,height:168}],bedWidth:100,bedHeight:100}
  ];
  for(const options of cases){
    const project={...blankProject(),id:'visible-puzzle',width:336,height:252,connectors:true,tools:[],...options},before=JSON.stringify(project),result=await preparePrintBatch(project);
    const pitch=-1.56,preview=printPreview(project,null,null,{yaw:0,pitch}),parts=new Map(),moduleCounts=new Map();
    assert.equal(preview.stats.invalidModules,0);assert.equal(preview.stats.printParts,result.parts.length);assert.equal(preview.stats.joints,result.joints);assert.ok(result.joints>0);
    assert.equal(preview.stats.triangles,result.parts.reduce((sum,part)=>sum+part.triangles,0),'the preview contains every exported part facet, including the base-level puzzle surfaces');
    assert.equal(new Set([...preview.html.matchAll(/data-print-part="([^"]+)"/g)].map(match=>match[1])).size,result.parts.length);
    for(const part of result.parts){
      const bytes=result.files.find(file=>file.name===part.file).data,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),matrix=part.assemblyTransform,faces=[];
      for(let i=0;i<view.getUint32(80,true);i++){
        const points=[0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true))).map(p=>[0,1,2].map(a=>matrix[a*4]*p[0]+matrix[a*4+1]*p[1]+matrix[a*4+2]*p[2]+matrix[a*4+3]));
        faces.push({points,normalZ:view.getFloat32(84+i*50+8,true)});
      }
      parts.set(part.key,{part,faces,start:moduleCounts.get(part.moduleId)||0});moduleCounts.set(part.moduleId,(moduleCounts.get(part.moduleId)||0)+faces.length);
    }
    const rendered=renderedFaces(preview),[cx,cy,cz]=preview.frame.center;
    for(const joint of result.manifest.joints.connections){
      const owner=parts.get(joint.owner),x=joint.at.x+(joint.axis==='x'?5.75:.137),y=project.height-joint.at.y-(joint.axis==='y'?5.75:.137);
      const index=owner.faces.findIndex(face=>face.normalZ<-.99&&inside2d([x,y],face.points));assert.ok(index>=0,'the actual exported male tab has a bottom facet under its head');
      const screen=[x-cx,-(y-cy)*Math.sin(pitch)+cz*Math.cos(pitch)];
      const faces=rendered.filter(face=>face.moduleId===owner.part.moduleId&&face.index===owner.start+index);
      assert.ok(faces.some(face=>inside2d(screen,face.points.split(' ').map(pair=>pair.split(',').map(Number)))),'the actual male head is visibly rendered from underneath, rather than merely counted in a plan');
    }
    assert.equal(JSON.stringify(project),before,'viewing real puzzle and magnet geometry does not edit the drawer');
  }
});

test('orbit changes projected triangles while keeping the fit, pan and zoom frame stable',()=>{
  const project=fixture(),camera={...createCamera3D(),zoom:1.7,panX:31,panY:-26};
  const first=printPreview(project,null,null,camera,{width:960,height:540});
  for(const yaw of [0,.2,1.1,2.8])for(const pitch of [-1.56,-.3,0,.8,1.56]){
    const next=printPreview(project,null,null,{...camera,yaw,pitch},{width:960,height:540});
    assertFinite(next);assert.equal(next.viewBox,first.viewBox);assert.deepEqual(next.frame.center,first.frame.center);assert.equal(next.frame.fitSize,first.frame.fitSize);
    assert.equal(next.stats.meshRevision,first.stats.meshRevision);
  }
  const rotated=printPreview(project,null,null,{...camera,yaw:2.1,pitch:-.4},{width:960,height:540});
  assert.notDeepEqual(renderedFaces(first).map(face=>face.points),renderedFaces(rotated).map(face=>face.points));
});

test('pan moves the viewBox center, zoom scales it and viewport aspect stays exact',()=>{
  const project=fixture(),base=printPreview(project,null,null,{}, {width:1200,height:600});
  const pan=printPreview(project,null,null,{panX:25,panY:-35},{width:1200,height:600});
  assert.equal(pan.viewBounds.x-base.viewBounds.x,25);assert.equal(pan.viewBounds.y-base.viewBounds.y,-35);
  assert.deepEqual(renderedFaces(base),renderedFaces(pan),'pan must move the camera rather than rewriting the mesh projection');
  const zoom=printPreview(project,null,null,{zoom:2},{width:1200,height:600});
  assert.equal(zoom.frame.width,base.frame.width/2);assert.equal(zoom.frame.height,base.frame.height/2);
  for(const viewport of [{width:1200,height:600},{width:400,height:1000},{width:0,height:Infinity}]){
    const preview=printPreview(project,null,null,{},viewport);assertFinite(preview);
    assert.ok(Math.abs(preview.frame.width/preview.frame.height-preview.frame.viewport.width/preview.frame.viewport.height)<1e-10);
  }
});

test('selection changes highlighting only and geometry edits invalidate the mesh without mutating STL or project',()=>{
  const project=fixture(),before=JSON.stringify(project),bytes=exportSTL(project,{moduleId:'m'});
  const normal=printPreview(project,null,null),selected=printPreview(project,'t',null),selectedModule=printPreview(project,null,'m');
  assert.equal(selected.stats.meshRevision,normal.stats.meshRevision);assert.deepEqual(renderedFaces(selected),renderedFaces(normal));assert.equal(selected.html,selectedModule.html);assert.notEqual(normal.html,selected.html);
  for(const camera of [{yaw:3,pitch:-1,zoom:4,panX:100,panY:-40},{yaw:-1,pitch:1,zoom:.3}])printPreview(project,'t','m',camera);
  assert.equal(JSON.stringify(project),before);assert.deepEqual(exportSTL(project,{moduleId:'m'}),bytes);
  project.tools[0].depth=12;
  const edited=printPreview(project,null,null);assert.notEqual(edited.stats.meshRevision,normal.stats.meshRevision);assert.notEqual(edited.html,normal.html);
});

test('empty and partially invalid drawers retain an orbitable reference and warning wireframes',()=>{
  const empty={...blankProject(),modules:[],tools:[]};
  const a=printPreview(empty,null,null,{yaw:.1,pitch:.3}),b=printPreview(empty,null,null,{yaw:1.2,pitch:-.4,panX:20,zoom:2});
  assertFinite(a);assertFinite(b);assert.match(a.html,/data-reference="drawer"/);assert.ok(a.warnings.length);assert.notEqual(a.html,b.html);
  const project=fixture();project.modules.push({id:'bad',name:'<img src=x onerror=bad()>',x:0,y:0,width:42,height:84});
  project.tools.push({...structuredClone(project.tools[0]),id:'bad-tool',moduleId:'bad',x:8,y:8,depth:100,points:[{x:0,y:0},{x:20,y:0},{x:20,y:50},{x:0,y:50}]});
  const preview=printPreview(project,null,'bad',{yaw:-.8,pitch:-.6,zoom:1.4,panX:-30});
  assertFinite(preview);assert.equal(preview.stats.invalidModules,1);assert.ok(preview.stats.visibleFaces>0);assert.match(preview.html,/data-module="bad" data-invalid-module="true"/);
  assert.ok(preview.warnings.some(warning=>warning.includes('Hloubka')));assert.doesNotMatch(preview.html,/<img/);assert.match(preview.html,/&lt;img/);
});

test('the opaque solid bottom occludes every pocket wall in rasterized underside views',async()=>{
  const demo=createDemoProject(),original=demo.modules[0],project={...demo,printMode:'solid',bottomMode:'plain',modules:demo.modules.map((module,i)=>i?module:{...module,id:'m'}),tools:demo.tools.map(tool=>tool.moduleId===original.id?{...tool,moduleId:'m'}:tool)};
  const facets=stlFaces(project),width=1200,height=900;
  for(const yaw of [Math.PI/4,-.4,2.4]){
    const camera={yaw,pitch:-.65},preview=printPreview(project,null,null,camera,{width,height});
    const bottomIndices=new Set(facets.flatMap((face,i)=>face.normal[2]<-.99?[i]:[]));
    const bottomPolygon=[...preview.html.matchAll(/<polygon data-module="m" data-face-index="(\d+)"[^>]*fill="([^"]+)"/g)].find(match=>bottomIndices.has(Number(match[1])));
    assert.ok(bottomPolygon,'a real bottom facet must be present');
    const swatch=createCanvas(1,1),swatchContext=swatch.getContext('2d');swatchContext.fillStyle=bottomPolygon[2];swatchContext.fillRect(0,0,1,1);
    const expected=swatchContext.getImageData(0,0,1,1).data;
    const image=await loadImage(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${preview.viewBox}">${preview.html}</svg>`));
    const canvas=createCanvas(width,height),context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,width,height).data;
    const [cx,cy,cz]=preview.frame.center,sy=Math.sin(yaw),cos=Math.cos(yaw),sp=Math.sin(camera.pitch),cp=Math.cos(camera.pitch);
    let mismatches=0,samples=0,example='';
    for(const module of project.modules)for(let x=module.x+4;x<module.x+module.width-4;x+=3)for(let y=module.y+4;y<module.y+module.height-4;y+=3){
      const physicalY=project.height-y;
      const sx=(x-cx)*cos-(physicalY-cy)*sy,screenY=-((x-cx)*sy+(physicalY-cy)*cos)*sp+cz*cp;
      const px=Math.floor((sx-preview.viewBounds.x)/preview.viewBounds.width*width),py=Math.floor((screenY-preview.viewBounds.y)/preview.viewBounds.height*height),offset=(py*width+px)*4;
      // Subpixel seams between identically colored facets may blend a few RGB
      // levels; an exposed pocket wall has a distinctly different material shade.
      if([0,1,2].some(c=>Math.abs(pixels[offset+c]-expected[c])>8)){mismatches++;example=`world ${x},${y}; pixel ${px},${py}; color ${[...pixels.slice(offset,offset+4)]}; expected ${[...expected]}`;}
      samples++;
    }
    assert.ok(samples>500);assert.equal(mismatches,0,`${mismatches}/${samples} points inside the closed bottom expose hidden pocket geometry at yaw=${yaw}; ${example}`);
  }
});
