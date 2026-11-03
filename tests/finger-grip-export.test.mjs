import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {bounds,transformedPoints,pocketOutline,autoArrange,resizeModule,validateLayout,exportSVG,exportDXF,exportSTL,exportFitSTL} from '../dist/geometry.js';
import {exportFitPDF} from '../dist/fit-sheet.js';
import {printConfig} from '../dist/print-geometry.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const grips=()=>[{id:'left',x:0,y:30,radius:9},{id:'right',x:30,y:30,radius:9}];
const tool=()=>({id:'t',name:'Nástroj',points:rectangle(30,60),x:30,y:20,rotation:0,depth:10,locked:false,moduleId:'m',fingerGrips:grips()});
const project=()=>({id:'p',name:'Zkouška prstů',width:252,height:252,grid:42,gap:3,clearance:.8,wall:2.4,base:2.4,insertHeight:20,printMode:'solid',bottomMode:'plain',limitToBed:false,bedWidth:220,bedHeight:220,magnetDiameter:6.2,magnetDepth:2.2,modules:[{id:'m',name:'Modul',x:0,y:0,width:126,height:126,locked:false,sizeMode:'auto'}],tools:[tool()]});
const area=poly=>Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y;},0)/2);
function extent(points){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return {x:Math.min(...xs),y:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)};
}
function assertExtent(actual,expected){for(const key of ['x','y','maxX','maxY'])assert.ok(Math.abs(actual[key]-expected[key])<.0001,`${key}: ${actual[key]} vs ${expected[key]}`);}
function inspectSTL(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),edges=new Map(),triangles=[];let volume=0;
  assert.equal(bytes.length,84+count*50);
  const key=p=>p.map(value=>Math.round(value*1e5)/1e5).join(',');
  for(let i=0;i<count;i++){
    const triangle=Array.from({length:3},(_,j)=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true)));
    assert.ok(triangle.flat().every(Number.isFinite));triangles.push(triangle);
    const [a,b,c]=triangle;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let j=0;j<3;j++){
      const a=key(triangle[j]),b=key(triangle[(j+1)%3]),k=a<b?a+'|'+b:b+'|'+a,e=edges.get(k)||{count:0,direction:0};
      e.count++;e.direction+=a<b?1:-1;edges.set(k,e);
    }
  }
  for(const [key,edge] of edges){assert.equal(edge.count,2,'non-manifold edge '+key);assert.equal(edge.direction,0,'inconsistent winding '+key);}
  assert.ok(volume>0);return {triangles,volume};
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

test('grips never change measured tool bounds, contours or their rotation anchor',()=>{
  const source=tool(),before=structuredClone(source),plain={...source,fingerGrips:[]};
  assert.deepEqual(bounds(source),bounds(plain));assert.deepEqual(transformedPoints(source),transformedPoints(plain));
  assert.ok(area(pocketOutline(source,.8))>area(transformedPoints(source,.8)));
  const moved={...source,x:source.x+73,y:source.y+19};
  const a=pocketOutline(source,.8),b=pocketOutline(moved,.8);
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){assert.ok(Math.abs(b[i].x-a[i].x-73)<.001);assert.ok(Math.abs(b[i].y-a[i].y-19)<.001);}
  const rotated={...source,rotation:90},r=extent(pocketOutline(rotated,0));
  assert.ok(Math.abs(r.x-30)<.001);assert.ok(Math.abs(r.maxX-90)<.001);
  assert.ok(Math.abs(r.y-11)<.001);assert.ok(Math.abs(r.maxY-59)<.001);
  assert.deepEqual(source,before);
});

test('clearance expands the tool while finger circles retain their final radius',()=>{
  const source=tool(),a=extent(pocketOutline(source,0)),b=extent(pocketOutline(source,2));
  assert.ok(Math.abs(a.x-21)<.001);assert.ok(Math.abs(a.maxX-69)<.001);
  assert.ok(Math.abs(b.x-a.x)<.001);assert.ok(Math.abs(b.maxX-a.maxX)<.001);
  assert.ok(Math.abs(b.y-(a.y-2))<.02);assert.ok(Math.abs(b.maxY-(a.maxY+2))<.02);
  const removed={...source,fingerGrips:[]},legacy={...removed};delete legacy.fingerGrips;
  assert.deepEqual(pocketOutline(removed,.8),pocketOutline(legacy,.8));
});

test('automatic grips enlarge manufacturing footprints and manual modules enforce the real pocket',()=>{
  const source=project();source.tools[0].fingerGrips=automaticFingerGrips(source.tools[0]);
  const plain=structuredClone(source);plain.tools[0].fingerGrips=[];
  const packed=autoArrange(source),raw=autoArrange(plain);
  assert.equal(packed.unplaced.length,0);assert.ok(packed.modules[0].width*packed.modules[0].height>raw.modules[0].width*raw.modules[0].height);
  assert.deepEqual(packed.tools[0].points,source.tools[0].points);
  assert.deepEqual(validateLayout({...source,...packed}),[]);
  const automatic=resizeModule(source,'m',{mode:'auto'}),without=resizeModule(plain,'m',{mode:'auto'});
  assert.ok(automatic.modules[0].width>without.modules[0].width);
  const snapshot=structuredClone(source);
  assert.throws(()=>resizeModule(source,'m',{width:42,height:84,mode:'manual'}),/stěnu/);assert.deepEqual(source,snapshot);
  const locked={...source,modules:[],tools:[{...source.tools[0],x:42,y:42,locked:true,moduleId:null}]},stationary=autoArrange(locked);
  assert.deepEqual(validateLayout({...locked,...stationary}),[]);assert.equal(stationary.tools[0].x,42);assert.equal(stationary.tools[0].y,42);
});

test('central automatic wrench grips survive rotated layout and cut real printable cavities',()=>{
  const points=[[0,-25],[28,-25],[35,-8],[195,-8],[202,-48],[240,-48],[240,48],[202,48],[195,8],[35,8],[28,25],[0,25],[0,12],[17,12],[17,-12],[0,-12]].map(([x,y])=>({x,y:y+48}));
  for(const printMode of ['solid','light'])for(const rotation of [0,37]){
    const p={...project(),width:504,height:420,printMode,modules:[{id:'m',name:'Klíč',x:0,y:0,width:336,height:336,sizeMode:'manual'}],tools:[{...tool(),points,x:30,y:30,rotation}]};
    p.tools[0].fingerGrips=automaticFingerGrips(p.tools[0]);
    assert.ok(p.tools[0].fingerGrips.every(g=>Math.abs(g.x-120)<.001),'a broad head must not displace the grip from the shaft centre');
    const packed={...p,...autoArrange(p)},own=packed.tools[0],before=structuredClone(own);
    assert.deepEqual(own.fingerGrips,p.tools[0].fingerGrips);assert.deepEqual(validateLayout(packed),[]);
    const plain=structuredClone(packed);plain.tools[0].fingerGrips=[];
    const mesh=inspectSTL(exportSTL(packed)),original=inspectSTL(exportSTL(plain)),cfg=printConfig(packed);
    const angle=own.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rotated=points.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})),b=extent(rotated);
    const sample={x:120*c-38*s-b.x+own.x,y:120*s+38*c-b.y+own.y};
    const z=printMode==='solid'?cfg.height-5:cfg.effectiveBaseMm+5;
    assert.equal(materialAt(original,sample.x,sample.y,z),true,'the uncut shaft side has material');
    assert.equal(materialAt(mesh,sample.x,sample.y,z),false,'the central finger circle opens the actual pocket');
    assert.equal(materialAt(mesh,sample.x,sample.y,cfg.effectiveBaseMm/2),true,'the shared floor is retained');
    inspectSTL(exportFitSTL(packed));
    assert.deepEqual(own,before,'manufacturing exports preserve stored centres, radius and contour');
  }
});

test('expanded pockets participate in neighbouring pocket and module wall validation',()=>{
  const p=project();p.tools[0].x=20;
  p.tools.push({...tool(),id:'second',name:'Vedlejší',x:60,fingerGrips:[]});
  const plain=structuredClone(p);plain.tools[0].fingerGrips=[];assert.deepEqual(validateLayout(plain),[]);
  assert.ok(validateLayout(p).some(i=>i.type==='overlap'&&i.ids.includes('t')&&i.ids.includes('second')));
  p.modules[0].width=84;p.tools[0].x=40;p.tools[0].fingerGrips=[{id:'right',x:30,y:30,radius:20}];
  p.modules.push({id:'next',name:'Sousední',x:84,y:0,width:84,height:126});p.tools[1].moduleId='next';p.tools[1].x=87;
  assert.ok(validateLayout(p).some(i=>i.type==='outside'&&i.ids.includes('m')&&i.ids.includes('t')));
  assert.ok(validateLayout(p).some(i=>i.type==='overlap'&&i.ids.includes('t')&&i.ids.includes('second')));
});

test('disconnected grips become a clear issue and unplaced result instead of crashing the editor',()=>{
  const p=project();p.tools[0].fingerGrips=[{id:'far',x:500,y:500,radius:9}];
  assert.doesNotThrow(()=>validateLayout(p));
  assert.ok(validateLayout(p).some(i=>i.ids.includes('t')&&/Výřezy pro prsty/.test(i.message)));
  const arranged=autoArrange(p);assert.ok(arranged.unplaced.includes('t'));assert.equal(arranged.tools[0].moduleId,null);
  for(const variant of ['locked','manual']){
    const candidate=structuredClone(p);candidate.modules[0].locked=variant==='locked';candidate.modules[0].sizeMode=variant==='manual'?'manual':'auto';
    assert.ok(autoArrange(candidate).unplaced.includes('t'),variant+' invalid group must remain reportable');
  }
  for(const exporter of [exportSVG,exportDXF,exportSTL,exportFitSTL,exportFitPDF])assert.throws(()=>exporter(p),/Výřezy pro prsty/);
});

test('SVG, DXF and the actual 1:1 PDF all contain the united finger pocket',()=>{
  const p=project(),expected=extent(pocketOutline(p.tools[0],p.clearance)),svg=exportSVG(p),dxf=exportDXF(p),pdf=new TextDecoder().decode(exportFitPDF(p));
  const path=svg.match(/<path id="t"[^>]* d="([^"]+)"/)[1],coordinates=[...path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m=>({x:+m[1],y:+m[2]}));
  assertExtent(extent(coordinates),expected);
  const pairs=dxf.trim().split(/\r?\n/),pocket=[];let inPocket=false;
  for(let i=0;i<pairs.length;i+=2){if(pairs[i]==='8')inPocket=pairs[i+1]==='POCKETS';if(inPocket&&pairs[i]==='10'&&pairs[i+2]==='20')pocket.push({x:+pairs[i+1],y:p.height-(+pairs[i+3])});}
  assertExtent(extent(pocket),expected);
  const drawing=pdf.split('0 0 0 RG 0.25 w\n')[1].split('Q\n')[0],pdfPoints=[...drawing.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]/g)].map(m=>({x:+m[1],y:+m[2]}));
  assertExtent(extent(pdfPoints),expected);
});

test('finger pockets are real closed printable cavities for both constructions and every bottom',()=>{
  for(const printMode of ['solid','light'])for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const p={...project(),printMode,bottomMode},plain=structuredClone(p);plain.tools[0].fingerGrips=[];
    const mesh=inspectSTL(exportSTL(p)),original=inspectSTL(exportSTL(plain)),cfg=printConfig(p);
    const z=printMode==='solid'?cfg.footHeight+cfg.height+cfg.extraBase-5:cfg.footHeight+cfg.effectiveBaseMm+5;
    assert.equal(materialAt(original,28.5,50,z),true,`${printMode}/${bottomMode}: original side wall`);
    assert.equal(materialAt(mesh,28.5,50,z),false,`${printMode}/${bottomMode}: finger must enter the cavity`);
    assert.equal(materialAt(mesh,20,50,z),true,`${printMode}/${bottomMode}: printable wall around the grip`);
    assert.equal(materialAt(mesh,28.5,50,cfg.footHeight+cfg.effectiveBaseMm/2),true,`${printMode}/${bottomMode}: the pocket keeps its floor`);
    if(printMode==='solid'){
      const removed=(area(pocketOutline(p.tools[0],p.clearance))-area(pocketOutline(plain.tools[0],p.clearance)))*p.tools[0].depth;
      assert.ok(Math.abs((original.volume-mesh.volume)-removed)<.2,`${bottomMode}: actual removed finger volume`);
    }
    const fit=inspectSTL(exportFitSTL(p));
    assert.equal(materialAt(fit,28.5,50,.5),false);assert.equal(materialAt(fit,20,50,.5),true);
    const zs=fit.triangles.flat().map(p=>p[2]);assert.equal(Math.min(...zs),0);assert.equal(Math.max(...zs),1);
  }
});

test('obliquely rotated finger unions remain manifold in final and thin-fit models',()=>{
  for(const printMode of ['solid','light']){
    const p={...project(),printMode};p.tools[0].rotation=37;
    assert.deepEqual(validateLayout(p),[]);
    inspectSTL(exportSTL(p));inspectSTL(exportFitSTL(p));
    assert.equal(p.tools[0].rotation,37);assert.deepEqual(p.tools[0].points,rectangle(30,60));
  }
});
