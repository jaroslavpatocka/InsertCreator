import test from 'node:test';
import assert from 'node:assert/strict';
import {gridfinityLayout,planBaseplateTiles,baseplateTriangles,exportBaseplateSTL,BASEPLATE_SOCKET_LEVELS,GRIDFINITY_BASEPLATE} from '../dist/gridfinity-baseplate.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

const project=(width=126,height=84)=>({width,height,grid:42,limitToBed:true,bedWidth:1,bedHeight:1});
const key=p=>p.map(v=>Math.round(v*1e5)).join(',');
const bounds=triangles=>triangles.flat().reduce((b,p)=>({min:p.map((v,i)=>Math.min(v,b.min[i])),max:p.map((v,i)=>Math.max(v,b.max[i]))}),{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
function profileAt(levels,z){for(let i=1;i<levels.length;i++)if(z<=levels[i][0]+1e-9){const a=levels[i-1],b=levels[i],ratio=(z-a[0])/(b[0]-a[0]);return{size:a[1]+(b[1]-a[1])*ratio,radius:a[2]+(b[2]-a[2])*ratio};}throw Error('outside profile');}
function polygon({size,radius}){const low=(42-size)/2,high=42-low,out=[];for(const [cx,cy,start] of [[high-radius,low+radius,-Math.PI/2],[high-radius,high-radius,0],[low+radius,high-radius,Math.PI/2],[low+radius,low+radius,Math.PI]])for(let i=0;i<=8;i++){const angle=start+i*Math.PI/16;out.push([cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius]);}return out;}
function verticalIntersections(triangles,x,y){const found=[];for(const [a,b,c] of triangles){const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denominator)<1e-10)continue;const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator,w=1-u-v;if(Math.min(u,v,w)>=-1e-8)found.push(u*a[2]+v*b[2]+w*c[2]);}return [...new Set(found.map(z=>Math.round(z*1e6)/1e6))].sort((a,b)=>a-b);}

test('baseplate follows the drawer 42mm grid with explicit unused edge strips and ignores the printer during editing',()=>{
  assert.deepEqual(gridfinityLayout(project(1000,750)),{columns:23,rows:17,width:966,height:714,pitch:42,heightMm:5,footOffsetZ:.25,x:0,y:0,remainder:{right:34,bottom:36}});
  assert.deepEqual(bounds(baseplateTriangles(project(84,42))),{min:[0,0,0],max:[84,42,5]},'one-millimetre printer settings do not restrict the model');
  assert.throws(()=>gridfinityLayout(project(41,84)),/42 do 3000/);assert.throws(()=>gridfinityLayout({...project(),grid:50}),/rastr/);
});

test('socket profile clears the actual 35.6/37.2/41.5mm foot through its entire 4.75mm height',()=>{
  const foot=[[0,35.6,.8],[.8,37.2,1.6],[2.6,37.2,1.6],[4.75,41.5,3.75]];let minimum=Infinity;
  for(let i=0;i<=190;i++){
    const z=i*.025,cavity=polygon(profileAt(BASEPLATE_SOCKET_LEVELS,z+GRIDFINITY_BASEPLATE.footOffsetZ)),outline=polygon(profileAt(foot,z));
    for(const p of outline)for(let j=0;j<cavity.length;j++){const a=cavity[j],b=cavity[(j+1)%cavity.length],distance=((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/Math.hypot(b[0]-a[0],b[1]-a[1]);minimum=Math.min(minimum,distance);assert.ok(distance>.149-1e-6,`socket interferes with foot at z=${z}: ${distance}mm`);}
  }
  assert.ok(minimum<.16,'top retains the deliberate 0.15mm radial clearance');
});

test('actual sockets are open below and one connected, manifold plate surrounds them',()=>{
  const triangles=baseplateTriangles(project(84,84));validatePrintMesh(triangles);assert.ok(trianglesVolume(triangles)>0);
  for(const x of [21,63])for(const y of [21,63])assert.deepEqual(verticalIntersections(triangles,x,y),[],'socket centre stays open through the plate');
  assert.deepEqual(verticalIntersections(triangles,42.123,42.234),[0,5],'material actually joins the sockets');
  const neighbours=new Map();for(const triangle of triangles){const keys=triangle.map(key);for(const a of keys){if(!neighbours.has(a))neighbours.set(a,new Set());for(const b of keys)neighbours.get(a).add(b);}}
  const visited=new Set(),queue=[neighbours.keys().next().value];while(queue.length){const p=queue.pop();if(visited.has(p))continue;visited.add(p);for(const q of neighbours.get(p))if(!visited.has(q))queue.push(q);}assert.equal(visited.size,neighbours.size,'the plate is a single connected surface');
});

test('export tiles retain exact cell geometry, local coordinates and binary STL manifold topology',()=>{
  const p=project(420,294),before=structuredClone(p),tile={x:5,y:3,columns:3,rows:2},triangles=baseplateTriangles(p,{tile});
  assert.deepEqual(bounds(triangles),{min:[0,0,0],max:[126,84,5]});assert.deepEqual(triangles,baseplateTriangles(p,{tile:{...tile,x:0,y:0}}));assert.deepEqual(p,before);
  const bytes=exportBaseplateSTL(p,{tile}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),decoded=[];
  assert.equal(count,triangles.length);assert.equal(bytes.byteLength,84+count*50);
  for(let i=0;i<count;i++)decoded.push([0,1,2].map(v=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+v*12+axis*4,true))));
  validatePrintMesh(decoded);
  // The mesher remains in editor Y-down coordinates. The binary manufacturing
  // boundary reflects every point once, then reverses winding to preserve solids.
  // Check the correspondence even though the regular socket grid is symmetric.
  for(let i=0;i<count;i++)assert.deepEqual(decoded[i],[triangles[i][0],triangles[i][2],triangles[i][1]].map(([x,y,z])=>[Math.fround(x),Math.fround(84-y),Math.fround(z)]));
  triangles[0][0][0]+=100;assert.deepEqual(bounds(baseplateTriangles(p,{tile})),{min:[0,0,0],max:[126,84,5]},'cached profiles cannot be changed through a returned mesh');
  for(const invalid of [{x:0,y:0,columns:11,rows:1},{x:0,y:-1,columns:1,rows:1},{x:0,y:0,columns:1.5,rows:1},{x:0,y:0,columns:1,rows:0}])assert.throws(()=>baseplateTriangles(p,{tile:invalid}),/celá pole/);
});

test('mesh size is bounded to 400 cells and larger drawers can export legal tiles',t=>{
  const p=project(3000,3000);assert.throws(()=>baseplateTriangles(p),/400 polí/);
  const start=performance.now(),triangles=baseplateTriangles(p,{tile:{x:25,y:25,columns:20,rows:20}}),elapsed=performance.now()-start;
  assert.ok(triangles.length<180000);assert.deepEqual(bounds(triangles),{min:[0,0,0],max:[840,840,5]});
  t.diagnostic(`400 cells: ${triangles.length} triangles, ${Math.round(elapsed)}ms including float32 mesh validation`);
});

test('export tiling covers every cell once, in y/x order, within the printer and 400-cell budgets',()=>{
  for(const [width,height,bedWidth,bedHeight] of [[1000,750,220,220],[3000,3000,1600,800],[126,336,84,126],[42,42,42,42]]){
    const p={...project(width,height),bedWidth,bedHeight},plan=planBaseplateTiles(p),seen=new Set();let previous={x:-1,y:-1};
    for(const tile of plan.tiles){assert.ok(tile.columns*tile.rows<=400);assert.ok(tile.y>previous.y||tile.y===previous.y&&tile.x>previous.x);previous=tile;const w=(plan.rotated?tile.rows:tile.columns)*42,h=(plan.rotated?tile.columns:tile.rows)*42;assert.ok(w<=bedWidth&&h<=bedHeight);
      for(let y=tile.y;y<tile.y+tile.rows;y++)for(let x=tile.x;x<tile.x+tile.columns;x++){const id=`${x},${y}`;assert.equal(seen.has(id),false,'seams cannot overlap cells');seen.add(id);}}
    assert.equal(seen.size,plan.layout.columns*plan.layout.rows);
  }
  const rotated=planBaseplateTiles({...project(126,336),bedWidth:84,bedHeight:126});assert.equal(rotated.rotated,true);assert.equal(rotated.tiles.length,4);
  assert.throws(()=>planBaseplateTiles(project()),/alespoň/);assert.throws(()=>planBaseplateTiles(project(),{bedWidth:NaN}),/kladné/);
});

test('unchecked export uses at most 20 by 20 cells and does not read invalid printer dimensions',()=>{
  const p={...project(3000,3000),bedWidth:NaN,bedHeight:-5,limitToBed:false},plan=planBaseplateTiles(p);
  assert.equal(plan.rotated,false);assert.ok(plan.tiles.every(t=>t.columns<=20&&t.rows<=20));assert.equal(plan.tiles.length,16);
});
