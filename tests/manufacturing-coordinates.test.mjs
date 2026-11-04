import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutMeshToPhysical} from '../dist/manufacturing-coordinates.js';
import {weldPrintVertices,finalizePrintTriangles,validatePrintMesh,encodeSTL} from '../dist/print-geometry.js';

const signedVolume=triangles=>triangles.reduce((sum,[a,b,c])=>sum+(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0);
function box(x,y){
  const p=[[x,y,0],[x+1,y,0],[x+1,y+1,0],[x,y+1,0],[x,y,1],[x+1,y,1],[x+1,y+1,1],[x,y+1,1]];
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(t=>t.map(i=>[...p[i]]));
}
function splitPrism(){
  // This is an ordinary unit prism with one extra collinear perimeter vertex.
  // Source Y has finer Float32 spacing than the reflected physical Y near 574.
  const y=125.5241666666667,outline=[[0,y],[1,y],[1,y+1],[0,y+1],[0,125.5242]],triangles=[];
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length],a0=[...a,0],b0=[...b,0],a1=[...a,1],b1=[...b,1];
    triangles.push([[.5,y+.5,0],b0,a0],[[.5,y+.5,1],a1,b1],[a0,b0,b1],[a0,b1,a1]);
  }
  return triangles;
}
function inspectBinary(triangles){
  const bytes=encodeSTL(triangles),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoded=[],edges=new Map();
  for(let i=0;i<view.getUint32(80,true);i++){
    const normal=[0,1,2].map(c=>view.getFloat32(84+i*50+c*4,true));assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-5);
    const t=[0,1,2].map(j=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true))),keys=t.map(p=>p.join(','));assert.equal(new Set(keys).size,3);
    const [a,b,c]=t,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>0);
    for(let j=0;j<3;j++){const from=keys[j],to=keys[(j+1)%3],key=from<to?from+'|'+to:to+'|'+from,edge=edges.get(key)||{count:0,winding:0};edge.count++;edge.winding+=from<to?1:-1;edges.set(key,edge);}
    decoded.push(t);
  }
  for(const edge of edges.values()){assert.equal(edge.count,2,'actual serialized edges pair exactly without a tolerance weld');assert.equal(edge.winding,0);}
  assert.ok(signedVolume(decoded)>0);validatePrintMesh(decoded);return decoded;
}

test('reflection preserves source Float32 vertex equivalence before previously discarded fans can open a crack',()=>{
  const raw=box(121,519.0592),before=structuredClone(raw);
  raw[10][2][1]=519.0592333333333;
  assert.equal(Math.fround(raw[10][2][1]),Math.fround(raw[2][0][1]));validatePrintMesh(raw);
  const pure=layoutMeshToPhysical(raw,700,{finalize:false});assert.throws(()=>validatePrintMesh(pure),'a pure affine reproduces the former four unpaired edges');
  const fixed=layoutMeshToPhysical(raw,700);validatePrintMesh(fixed);inspectBinary(fixed);
  assert.ok(Math.abs(signedVolume(fixed)-1)<1e-9,'the intended unit-box material is retained');
  before[10][2][1]=519.0592333333333;assert.deepEqual(raw,before,'manufacturing cleanup must not edit source contours or mesh vertices');
});

test('fans newly collapsed by physical Float32 encoding are removed without losing the closed volume',()=>{
  const raw=splitPrism(),before=structuredClone(raw);validatePrintMesh(raw);
  const pure=layoutMeshToPhysical(raw,700,{finalize:false});assert.throws(()=>validatePrintMesh(pure));
  const fixed=layoutMeshToPhysical(raw,700);assert.equal(fixed.length,raw.length-4);validatePrintMesh(fixed);inspectBinary(fixed);
  assert.ok(Math.abs(signedVolume(fixed)-signedVolume(raw))<1e-9);assert.deepEqual(raw,before);
});

test('batch translation and proper 90 degree print rotation finalize only in the last serialization frame',()=>{
  const raw=splitPrism(),y=125.5241666666667,source=weldPrintVertices(raw);
  const reflected=layoutMeshToPhysical(source,700,{finalize:false});assert.equal(reflected.length,raw.length,'no intermediate Float32 fan may be pruned');
  for(const rotation of [0,90]){
    const placed=reflected.map(t=>t.map(([x,py,z])=>{const localY=py-(700-y-1);return rotation?[1-localY,x,z]:[x,localY,z];}));
    const final=finalizePrintTriangles(placed);assert.equal(final.length,raw.length,'the last smaller print frame resolves the distinct source edge again');
    validatePrintMesh(final);inspectBinary(final);assert.ok(Math.abs(signedVolume(final)-1)<1e-9);
  }
});

test('source welding never merges nearby vertices that remain distinct in the binary STL',()=>{
  const a=[0,0,0],b=[0,.000001,0],c=[1,0,0],raw=[[a,b,c]],welded=weldPrintVertices(raw);
  assert.notEqual(welded[0][0],welded[0][1]);assert.deepEqual(welded,raw);assert.deepEqual(weldPrintVertices(welded),welded);
});
