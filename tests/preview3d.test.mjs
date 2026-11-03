import test from 'node:test';
import assert from 'node:assert/strict';
import {createCamera3D,normalizeCamera3D,printPreview} from '../dist/preview3d.js';
import {blankProject} from '../dist/model.js';
import {exportSTL,createDemoProject} from '../dist/geometry.js';
import {createCanvas,loadImage} from '@napi-rs/canvas';

const fixture=()=>({...blankProject(),id:'camera-test',width:168,height:126,printMode:'solid',bottomMode:'plain',limitToBed:false,modules:[{id:'m',name:'Nástroj',x:42,y:0,width:84,height:126}],tools:[{id:'t',name:'Nástroj',x:55,y:12,rotation:0,depth:9,moduleId:'m',points:[{x:0,y:0},{x:34,y:0},{x:34,y:75},{x:0,y:75}]}]});
const renderedFaces=preview=>[...preview.html.matchAll(/<polygon data-module="([^"]+)" data-face-index="(\d+)" points="([^"]+)"/g)].map(match=>({moduleId:match[1],index:Number(match[2]),points:match[3]}));
const stlFaces=project=>{
  const bytes=exportSTL(project,{moduleId:'m'}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from({length:view.getUint32(80,true)},(_,i)=>({normal:[0,1,2].map(c=>view.getFloat32(84+i*50+c*4,true))}));
};
function assertFinite(preview){
  assert.ok(preview.viewBox.split(' ').map(Number).every(Number.isFinite));
  assert.ok(preview.viewBounds.width>0&&preview.viewBounds.height>0);
  assert.ok(Object.values(preview.camera).every(Number.isFinite));
  assert.doesNotMatch(preview.html,/NaN|Infinity/);
}

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

test('orbit exposes actual opposite STL walls and the underside without rebuilding the cached mesh',()=>{
  const project=fixture(),facets=stlFaces(project);
  const front=printPreview(project,null,null,{yaw:0,pitch:.5}),back=printPreview(project,null,null,{yaw:Math.PI,pitch:.5}),under=printPreview(project,null,null,{yaw:0,pitch:-.5});
  const normals=preview=>renderedFaces(preview).map(face=>facets[face.index].normal);
  assert.ok(normals(front).some(n=>n[1]>.9)&&!normals(front).some(n=>n[1]<-.9),'the front view must expose its facing Y walls');
  assert.ok(normals(back).some(n=>n[1]<-.9)&&!normals(back).some(n=>n[1]>.9),'rotating half a turn must expose the opposite Y walls');
  assert.ok(normals(front).some(n=>n[2]>.9)&&!normals(front).some(n=>n[2]<-.9));
  assert.ok(normals(under).some(n=>n[2]<-.9)&&!normals(under).some(n=>n[2]>.9),'negative pitch must render actual bottom facets');
  assert.equal(front.stats.triangles,facets.length,'cache must retain every STL triangle');
  assert.equal(front.stats.meshRevision,back.stats.meshRevision);assert.equal(front.stats.meshRevision,under.stats.meshRevision);
  assert.equal(front.stats.invalidModules,0);assert.deepEqual(front.warnings,[]);
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
      const sx=(x-cx)*cos-(y-cy)*sy,screenY=((x-cx)*sy+(y-cy)*cos)*sp+cz*cp;
      const px=Math.floor((sx-preview.viewBounds.x)/preview.viewBounds.width*width),py=Math.floor((screenY-preview.viewBounds.y)/preview.viewBounds.height*height),offset=(py*width+px)*4;
      // Subpixel seams between identically colored facets may blend a few RGB
      // levels; an exposed pocket wall has a distinctly different material shade.
      if([0,1,2].some(c=>Math.abs(pixels[offset+c]-expected[c])>8)){mismatches++;example=`world ${x},${y}; pixel ${px},${py}; color ${[...pixels.slice(offset,offset+4)]}; expected ${[...expected]}`;}
      samples++;
    }
    assert.ok(samples>500);assert.equal(mismatches,0,`${mismatches}/${samples} points inside the closed bottom expose hidden pocket geometry at yaw=${yaw}; ${example}`);
  }
});
