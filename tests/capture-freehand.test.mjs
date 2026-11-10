import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFreehandContour} from '../dist/capture-freehand.js';

// Independent helpers: expectations come from the drawn shapes, not from the module.
const area=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0)/2;
const bbox=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};};
const inside=(points,p)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const segDist=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);};
const boundaryDist=(points,p)=>Math.min(...points.map((a,i)=>segDist(p,a,points[(i+1)%points.length])));
const near=(actual,expected,eps,message)=>assert.ok(Math.abs(actual-expected)<=eps,`${message}: ${actual} != ${expected} ±${eps}`);
const rejects=(fn,pattern)=>assert.throws(fn,error=>pattern.test(error.i18n?.cs||error.message));

/** Dense stroke through mm corners, sampled every `step` mm, returned in photo pixels. */
function stroke(cornersMm,{pxPerMm,origin,step=.05,close=true,jitter=0}){
  const path=close?[...cornersMm,cornersMm[0]]:cornersMm,out=[];let k=0;
  for(let i=0;i<path.length-1;i++){
    const a=path[i],b=path[i+1],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step));
    for(let s=0;s<count;s++){
      const t=s/count,n=jitter?Math.sin(k++*12.9898)*jitter:0;
      out.push({x:origin.x+(a.x+(b.x-a.x)*t+n)*pxPerMm,y:origin.y+(a.y+(b.y-a.y)*t-n)*pxPerMm});
    }
  }
  out.push({x:origin.x+path.at(-1).x*pxPerMm,y:origin.y+path.at(-1).y*pxPerMm});
  return out;
}
const toMm=(points,{pxPerMm,origin})=>points.map(p=>({x:(p.x-origin.x)/pxPerMm,y:(p.y-origin.y)/pxPerMm}));
const rect=[{x:0,y:0},{x:40,y:0},{x:40,y:20},{x:0,y:20}];

test('rectangle stroke becomes four exact corners in local mm',()=>{
  const options={pxPerMm:8,origin:{x:100,y:50}},input=stroke(rect,options),before=structuredClone(input);
  const result=buildFreehandContour(input,options);
  assert.deepEqual(result.model.origin,{x:100,y:50});
  assert.equal(result.model.nodes.length,4);
  for(const corner of rect)assert.ok(result.model.nodes.some(n=>Math.hypot(n.x-corner.x,n.y-corner.y)<1e-9),'corner '+JSON.stringify(corner));
  near(Math.abs(area(result.points)),800,1e-6,'area');
  const box=bbox(result.points);near(box.maxX-box.minX,40,1e-9,'width');near(box.maxY-box.minY,20,1e-9,'height');
  assert.ok(result.stats.maxErrorMm<1e-9);assert.equal(result.stats.inputSamples,input.length);
  assert.deepEqual(input,before,'input stroke is not modified');assert.deepEqual(options.origin,{x:100,y:50});
});

test('same physical stroke at different scales and origins gives the same mm model',()=>{
  const reference=buildFreehandContour(stroke(rect,{pxPerMm:8,origin:{x:0,y:0}}),{pxPerMm:8}).model.nodes;
  for(const options of [{pxPerMm:3.7,origin:{x:-20.5,y:1000}},{pxPerMm:23.62,origin:{x:4000.25,y:12.5}},{pxPerMm:.9,origin:{x:7,y:-3}}]){
    const result=buildFreehandContour(stroke(rect,options),options);
    assert.deepEqual(result.model.origin,options.origin);
    assert.equal(result.model.nodes.length,reference.length);
    result.model.nodes.forEach((n,i)=>{near(n.x,reference[i].x,1e-6,'x '+options.pxPerMm);near(n.y,reference[i].y,1e-6,'y '+options.pxPerMm);});
  }
  // A shifted origin shifts the local coordinates by exactly origin/pxPerMm.
  const shifted=buildFreehandContour(stroke(rect,{pxPerMm:8,origin:{x:0,y:0}}),{pxPerMm:8,origin:{x:-80,y:16}}).model.nodes;
  shifted.forEach((n,i)=>{near(n.x,reference[i].x+10,1e-9,'shift x');near(n.y,reference[i].y-2,1e-9,'shift y');});
});

test('arc keeps its radius within the declared simplification error',()=>{
  const R=25,options={pxPerMm:10,origin:{x:300,y:300}},arc=[];
  for(let i=0;i<=2000;i++){const a=Math.PI*i/2000;arc.push({x:R*Math.cos(a),y:-R*Math.sin(a)});}
  const input=stroke(arc,{...options,step:.02});
  const result=buildFreehandContour(input,{...options,toleranceMm:.15});
  assert.ok(result.stats.maxErrorMm<=.15+1e-12,'reported error '+result.stats.maxErrorMm);
  // Minimal chord count for sagitta <= 0.15 mm on R=25 is ceil(pi/(2*acos(1-.15/25))) = 15.
  assert.ok(result.model.nodes.length>=16&&result.model.nodes.length<=60,'node count '+result.model.nodes.length);
  for(const n of result.model.nodes)assert.ok(Math.abs(Math.hypot(n.x,n.y)-R)<1e-6||Math.abs(n.y)<1e-6,'node on arc or chord');
  const sampled=toMm(input,options),worst=Math.max(...sampled.map(p=>boundaryDist(result.points,p)));
  assert.ok(worst<=result.stats.maxErrorMm+1e-9,'independent error '+worst);
  near(Math.abs(area(result.points)),Math.PI*R*R/2,(Math.PI*R+2*R)*.15,'area');
  const box=bbox(result.points);near(box.maxX-box.minX,50,1e-9,'chord width');near(box.maxY-box.minY,R,.15,'height');
});

test('open jaws and a narrow slot survive a jittered stroke',()=>{
  // Open-end wrench silhouette: handle 0..60, head 60..90 with a 12 mm jaw opening
  // and a 0.4 mm wide, 8 mm deep slot cut into the handle.
  const profile=[{x:0,y:0},{x:30,y:0},{x:30,y:8},{x:30.4,y:8},{x:30.4,y:0},{x:60,y:0},{x:62,y:-6},{x:90,y:-6},{x:90,y:3},
    {x:75,y:3},{x:75,y:9},{x:90,y:9},{x:90,y:18},{x:62,y:18},{x:60,y:12},{x:0,y:12}];
  const options={pxPerMm:6,origin:{x:50,y:400}},input=stroke(profile,{...options,step:.03,jitter:.04});
  const result=buildFreehandContour(input,options);
  assert.ok(result.stats.maxErrorMm<=.15+1e-12);
  const sampled=toMm(input,options);assert.ok(Math.max(...sampled.map(p=>boundaryDist(result.points,p)))<=result.stats.maxErrorMm+1e-9);
  assert.ok(inside(result.points,{x:10,y:6}),'handle is inside');
  assert.ok(!inside(result.points,{x:82,y:6}),'jaw opening stays open');
  assert.ok(!inside(result.points,{x:30.2,y:4}),'slot stays cut out');
  assert.ok(inside(result.points,{x:29.6,y:4})&&inside(result.points,{x:30.8,y:4}),'both slot walls stay');
  const box=bbox(result.points);near(box.maxX-box.minX,90,.2,'length');near(box.maxY-box.minY,24,.2,'height');
  const expected=Math.abs(area(profile));near(Math.abs(area(result.points)),expected,.15*400,'area');
  assert.ok(result.model.nodes.length>=profile.length&&result.model.nodes.length<=6000);
});

test('duplicate and near-identical samples do not change the result',()=>{
  const options={pxPerMm:5,origin:{x:0,y:0}},clean=stroke(rect,options),dirty=[];
  clean.forEach((p,i)=>{dirty.push(p,{...p},{x:p.x+.001*(i%3),y:p.y-.001*(i%2)});});
  const a=buildFreehandContour(clean,options),b=buildFreehandContour(dirty,options);
  assert.equal(b.model.nodes.length,4);
  b.model.nodes.forEach((n,i)=>{near(n.x,a.model.nodes[i].x,1e-3,'x');near(n.y,a.model.nodes[i].y,1e-3,'y');});
  assert.ok(b.stats.uniqueSamples<dirty.length/2);
});

test('an unclosed stroke is closed with the straight edge from end to start',()=>{
  const options={pxPerMm:4,origin:{x:10,y:10}},open=stroke(rect,{...options,close:false});
  const result=buildFreehandContour(open,options);
  assert.equal(result.model.nodes.length,4);near(Math.abs(area(result.points)),800,1e-6,'area');
});

test('self-crossing and degenerate strokes are rejected without substitute geometry',()=>{
  const options={pxPerMm:4,origin:{x:0,y:0}};
  rejects(()=>buildFreehandContour(stroke([{x:0,y:0},{x:20,y:20},{x:20,y:0},{x:0,y:20}],options),options),/křížit/);
  rejects(()=>buildFreehandContour(stroke([{x:0,y:0},{x:30,y:0},{x:30,y:10},{x:10,y:-10}],options),options),/křížit/);
  rejects(()=>buildFreehandContour([{x:1,y:1},{x:40,y:40}],options),/alespoň tři/);
  rejects(()=>buildFreehandContour(Array.from({length:50},()=>({x:5,y:5})),options),/alespoň tři/);
  rejects(()=>buildFreehandContour(stroke([{x:0,y:0},{x:30,y:0}],{...options,close:false}).concat(stroke([{x:30,y:0},{x:0,y:0}],{...options,close:false})),options),/křížit|plochu|alespoň/);
  rejects(()=>buildFreehandContour(stroke([{x:0,y:0},{x:.1,y:0},{x:.1,y:.1}],options),options),/plochu|alespoň/);
  rejects(()=>buildFreehandContour([],options),/alespoň tři/);
});

test('invalid calibration and points are rejected',()=>{
  const input=stroke(rect,{pxPerMm:4,origin:{x:0,y:0}});
  for(const pxPerMm of [0,-2,NaN,Infinity,undefined])rejects(()=>buildFreehandContour(input,{pxPerMm}),/Měřítko/);
  rejects(()=>buildFreehandContour([...input.slice(0,10),{x:NaN,y:1},...input.slice(10)],{pxPerMm:4}),/platnou polohu/);
  rejects(()=>buildFreehandContour(input,{pxPerMm:4,origin:{x:0}}),/platnou polohu/);
  rejects(()=>buildFreehandContour(null,{pxPerMm:4}),/platnou polohu/);
});

test('point limit is enforced instead of coarsening beyond tolerance',()=>{
  const circle=n=>Array.from({length:n},(_,i)=>({x:500+400*Math.cos(2*Math.PI*i/n),y:500+400*Math.sin(2*Math.PI*i/n)}));
  rejects(()=>buildFreehandContour(circle(8000),{pxPerMm:1,toleranceMm:0}),/6000/);
  rejects(()=>buildFreehandContour(circle(2000),{pxPerMm:10,toleranceMm:.15,maxPoints:10}),/6000/);
  const ok=buildFreehandContour(circle(2000),{pxPerMm:10,toleranceMm:.15});
  assert.ok(ok.model.nodes.length<=6000&&ok.stats.maxErrorMm<=.15);
});
