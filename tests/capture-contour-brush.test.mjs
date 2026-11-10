import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothContourModel,flattenContour,validateContourModel} from '../dist/capture-contour-edit.js';

const clone=structuredClone,origin={x:1234.5,y:678.25};
const model=nodes=>({origin:clone(origin),nodes:clone(nodes)});
const square=()=>model([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
const jagged=()=>model([{x:0,y:0},{x:100,y:0},{x:100,y:68},{x:99,y:72},{x:99,y:76},{x:96,y:76},{x:107,y:85},{x:97,y:79},{x:98,y:86},{x:94,y:88},{x:94,y:94},{x:88,y:94},{x:86,y:98},{x:0,y:100}]);
const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const boundaryDistance=(p,points)=>Math.min(...points.map((a,i)=>segmentDistance(p,a,points[(i+1)%points.length])));
function polygonInside(p,points){let result=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;}
function uniformCubic(a,b,steps=1000){const result=[];for(let i=0;i<=steps;i++){const t=i/steps,u=1-t,p=a.out||a,q=b.in||b;result.push(a.out||b.in?{x:u**3*a.x+3*u*u*t*p.x+3*u*t*t*q.x+t**3*b.x,y:u**3*a.y+3*u*u*t*p.y+3*u*t*t*q.y+t**3*b.y}:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}return result;}
function assertOutsideFixed(before,after,center,radius,tolerance=.051){
 const raw=before.nodes.flatMap((a,i)=>uniformCubic(a,before.nodes[(i+1)%before.nodes.length],80)),result=flattenContour(after.nodes,{tolerance:.002});
 for(const p of raw.filter(p=>Math.hypot(p.x-center.x,p.y-center.y)>radius+.01))assert.ok(boundaryDistance(p,result)<tolerance,'source exterior moved: '+JSON.stringify(p));
 for(const p of result.filter(p=>Math.hypot(p.x-center.x,p.y-center.y)>radius+.01))assert.ok(boundaryDistance(p,raw)<tolerance,'new exterior geometry: '+JSON.stringify(p));
}
function verify(result){assert.ok(result.model.nodes.length<=6000);assert.deepEqual(result.model.origin,origin);validateContourModel(result.model);}

test('round creates a tangent circular fillet at an analytic90degree corner and keeps remote dimensions',()=>{
 const before=square(),snapshot=clone(before),center={x:100,y:100},result=smoothContourModel(before,{center,radius:40,mode:'round',strength:.2});verify(result);assert.equal(result.changed,true);assert.equal(result.kind,'round');assert.ok(Math.abs(result.roundRadius-6.8)<1e-6);assert.deepEqual(before,snapshot);
 const points=flattenContour(result.model.nodes,{tolerance:.001}),circle={x:100-6.8,y:100-6.8};assert.equal(polygonInside({x:99.5,y:99.5},points),false);
 const curves=result.model.nodes.map((a,i)=>[a,result.model.nodes[(i+1)%result.model.nodes.length]]).filter(([a,b])=>a.out&&b.in),curve=curves[0][0],end=curves.at(-1)[1];assert.ok(curve&&end);assert.ok(Math.abs(curve.out.x-curve.x)<1e-7,'vertical tangent');assert.ok(Math.abs(end.in.y-end.y)<1e-7,'horizontal tangent');for(const [a,b] of curves)for(const p of uniformCubic(a,b,60))assert.ok(Math.abs(Math.hypot(p.x-circle.x,p.y-circle.y)-6.8)<.003,'cubic matches the independently expected circular radius');assertOutsideFixed(before,result.model,center,40);
 assert.ok(Math.abs(Math.max(...points.map(p=>p.x))-100)<1e-7);assert.ok(Math.abs(Math.max(...points.map(p=>p.y))-100)<1e-7);
});

test('repeated round passes strengthen a real rounded corner instead of creating a spike',()=>{
 const center={x:100,y:100};let current=square(),previous=0;
 for(let i=0;i<7;i++){const result=smoothContourModel(current,{center,radius:40,mode:'round'});verify(result);assert.equal(result.changed,true);assert.ok(result.roundRadius>previous);assert.ok(result.roundRadius<34+.001);previous=result.roundRadius;current=result.model;}
 assert.ok(previous>26);assert.equal(polygonInside({x:97,y:97},flattenContour(current.nodes)),false);assertOutsideFixed(square(),current,center,40);
});

test('round replaces the jagged needle and stepped shoulder by one continuous rounded profile',()=>{
 const before=jagged(),center={x:100,y:100};let current=before;
 for(let i=0;i<8;i++){const result=smoothContourModel(current,{center,radius:40,mode:'round'});verify(result);assert.equal(result.changed,true,result.reason);current=result.model;}
 const points=flattenContour(current.nodes,{tolerance:.002});assert.equal(polygonInside({x:103,y:84},points),false,'needle is removed');assert.equal(polygonInside({x:97,y:96},points),false,'sharp corner becomes rounded');assertOutsideFixed(before,current,center,40);assert.ok(current.nodes.some(node=>node.in||node.out),'a curve joins the side faces');assert.ok(current.nodes.length<before.nodes.length);
});

for(const reverse of [false,true])test('local brush handles a corner crossing node zero, winding '+(reverse?'CW':'CCW'),()=>{
 const original=square(),center={x:0,y:0};if(reverse)original.nodes.reverse();const result=smoothContourModel(original,{center,radius:30,mode:'round'});verify(result);assert.equal(result.changed,true,result.reason);assertOutsideFixed(original,result.model,center,30);assert.equal(polygonInside({x:.2,y:.2},flattenContour(result.model.nodes)),false);
});

test('local brush splits a long linear edge at the actual circle intersections',()=>{
 const before=model([{x:0,y:0},{x:200,y:0},{x:200,y:60},{x:0,y:60}]),result=smoothContourModel(before,{center:{x:110,y:-5},radius:20,mode:'line'});verify(result);assert.equal(result.changed,false,'an already straight long edge stays unchanged');assert.deepEqual(result.model,before);
});

test('auto smooths a jagged straight side while preserving its independent line reference',()=>{
 const nodes=[];for(let x=0;x<=100;x+=2)nodes.push({x,y:x>=24&&x<=76?(x%4?1:-1):0});nodes.push({x:100,y:50},{x:0,y:50});const before=model(nodes),center={x:50,y:0},radius=32;let current=before;const error=m=>{const p=flattenContour(m.nodes).filter(p=>p.x>30&&p.x<70&&p.y<10);return p.reduce((sum,p)=>sum+p.y*p.y,0)/p.length;},initial=error(before);
 for(let i=0;i<5;i++){const result=smoothContourModel(current,{center,radius,mode:'auto'});verify(result);assert.equal(result.changed,true,result.reason);current=result.model;}
 assert.ok(error(current)<initial*.7);assertOutsideFixed(before,current,center,radius);
});

test('auto keeps a real circular crown while reducing radial noise',()=>{
 const nodes=[];for(let degree=210;degree<=330;degree+=2){const a=degree*Math.PI/180,r=50+(degree%4?1:-1);nodes.push({x:50+r*Math.cos(a),y:70+r*Math.sin(a)});}nodes.push({x:100,y:100},{x:0,y:100});const before=model(nodes),center={x:50,y:20},radius=22,error=m=>{const p=flattenContour(m.nodes).filter(p=>p.x>40&&p.x<60&&p.y<40);return p.reduce((sum,p)=>sum+(Math.hypot(p.x-50,p.y-70)-50)**2,0)/p.length;};let current=before;for(let i=0;i<4;i++){const result=smoothContourModel(current,{center,radius,mode:'auto'});verify(result);assert.equal(result.changed,true,result.reason);current=result.model;}assert.ok(error(current)<error(before)*.7);assertOutsideFixed(before,current,center,radius);
});

test('explicit straight and sharp-corner modes reduce local teeth and preserve the outside',()=>{
 const before=jagged(),center={x:100,y:100};for(const mode of ['line','corner']){let current=before;for(let i=0;i<6;i++){const result=smoothContourModel(current,{center,radius:40,mode});verify(result);assert.equal(result.changed,true,result.reason);current=result.model;}assertOutsideFixed(before,current,center,40);const p=flattenContour(current.nodes);assert.ok(Math.max(...p.filter(p=>p.y>60).map(p=>p.x))<107,'spike is reduced');}
});

test('brush on a narrow tool edits only the nearest connected side inside its circle',()=>{
 const nodes=[];for(let x=0;x<=100;x+=4)nodes.push({x,y:x>=32&&x<=68?(x%8?1:-1):0});nodes.push({x:100,y:10},{x:0,y:10});const before=model(nodes),result=smoothContourModel(before,{center:{x:50,y:0},radius:25,mode:'line'});verify(result);assert.equal(result.changed,true);const points=flattenContour(result.model.nodes,{tolerance:.002});for(let x=0;x<=100;x+=2)assert.ok(boundaryDistance({x,y:10},points)<1e-7,'opposite side must remain untouched');
});

test('splitting a sparse Bézier retains its exact exterior subcurves',()=>{
 const before=model([{x:0,y:50,out:{x:30,y:-10}},{x:100,y:50,in:{x:70,y:-10}},{x:100,y:120},{x:0,y:120}]),center={x:50,y:5},result=smoothContourModel(before,{center,radius:25,mode:'line'});verify(result);assert.equal(result.changed,true,result.reason);assertOutsideFixed(before,result.model,center,25,.015);
});

test('brush is translation and source-photo-origin invariant in calibrated millimetres',()=>{
 const before=jagged(),options={center:{x:100,y:100},radius:40,mode:'round'},a=smoothContourModel(before,options),shift={x:-200,y:300},moved=model(before.nodes.map(p=>({...p,x:p.x+shift.x,y:p.y+shift.y})));moved.origin={x:9000,y:123};const b=smoothContourModel(moved,{...options,center:{x:300-400,y:400}});assert.equal(b.changed,true);assert.deepEqual(b.model.origin,moved.origin);assert.equal(a.model.nodes.length,b.model.nodes.length);a.model.nodes.forEach((p,i)=>{const q=b.model.nodes[i];assert.ok(Math.hypot(p.x+shift.x-q.x,p.y+shift.y-q.y)<1e-6);for(const key of ['in','out'])if(p[key])assert.ok(Math.hypot(p[key].x+shift.x-q[key].x,p[key].y+shift.y-q[key].y)<1e-6);});
});

test('outside, zero-strength and whole-contained brushes return independent unchanged copies',()=>{
 for(const options of [{center:{x:1000,y:1000},radius:10},{center:{x:100,y:100},radius:10,strength:0},{center:{x:50,y:50},radius:1000}]){const before=square(),result=smoothContourModel(before,options);assert.equal(result.changed,false);assert.deepEqual(result.model,before);result.model.nodes[0].x=55;assert.equal(before.nodes[0].x,0);}
});

test('invalid brush settings and nonfinite model data are rejected without mutation',()=>{
 for(const options of [{center:{x:NaN,y:0},radius:10},{center:{x:0,y:0},radius:0},{center:{x:0,y:0},radius:3001},{center:{x:0,y:0},radius:10,strength:1.01},{center:{x:0,y:0},radius:10,mode:'garbage'}]){const before=square(),snapshot=clone(before);assert.throws(()=>smoothContourModel(before,options));assert.deepEqual(before,snapshot);}
 const invalid=square();invalid.nodes[0].out={x:Infinity,y:0};assert.throws(()=>smoothContourModel(invalid,{center:{x:0,y:0},radius:30}));
});

test('point-limit rejection is atomic rather than silently dropping remote vertices',()=>{
 const nodes=[];for(let i=0;i<6000;i++){const angle=i*Math.PI*2/6000;nodes.push({x:100+100*Math.cos(angle),y:100+100*Math.sin(angle)});}const before=model(nodes),snapshot=clone(before),result=smoothContourModel(before,{center:{x:100,y:0},radius:1,mode:'line'});assert.equal(result.changed,false);assert.equal(result.rejected,true);assert.equal(result.reason,'point-limit');assert.deepEqual(result.model,snapshot);assert.deepEqual(before,snapshot);
});
