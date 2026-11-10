import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCaptureContourSafety} from '../dist/capture-contour-safety.js';
const rectangle=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const item=()=>({contour:{points:rectangle(100,200,300,400)},info:{minX:100,minY:200},pocketShape:'ideal',contourReserveRatio:.02,editedPoints:rectangle(-2,-2,102,102),pocketMargin:99});
const candidate=(points,origin={x:100,y:200})=>({origin,points});
const check=(tool,points,origin)=>checkCaptureContourSafety(tool,2,candidate(points,origin));

test('the immutable source is protected while already fitted reserve can be consumed',()=>{
 const tool=item(),before=structuredClone(tool),exact=check(tool,rectangle(0,0,100,100));assert.equal(exact.safe,true);assert.equal(exact.protected,true);assert.equal(exact.referenceAreaMm2,10000);assert.equal(exact.lostAreaMm2,0);assert.equal(exact.precisionMm,.0001);
 assert.equal(check(tool,rectangle(-.5,-.5,100.5,100.5)).safe,true);assert.deepEqual(tool,before);
});

test('cutting an actual convex corner is rejected even if the rest of the outline grows',()=>{
 const tool=item(),outline=[{x:-5,y:-5},{x:101,y:-5},{x:101,y:95},{x:95,y:101},{x:-5,y:101}],result=check(tool,outline);assert.equal(result.safe,false);assert.equal(result.reason,'source-material-lost');assert.equal(result.protected,true);assert.ok(result.lostAreaMm2>7.9&&result.lostAreaMm2<8.1,'independent missing triangle near source corner has area8mm2');
});

test('a locally rounded cut can consume existing reserve when the complete source still fits',()=>{
 const result=check(item(),[{x:-.5,y:-.5},{x:100.5,y:-.5},{x:100.5,y:99.75},{x:99.75,y:100.5},{x:-.5,y:100.5}]);assert.equal(result.safe,true);assert.equal(result.lostAreaMm2,0);
});

test('tiny corner bites and mid-edge notches cannot evade a full polygon difference',()=>{
 const tool=item(),tiny=check(tool,[{x:0,y:0},{x:100,y:0},{x:100,y:99.9},{x:99.9,y:100},{x:0,y:100}]);assert.equal(tiny.safe,false);assert.ok(tiny.lostAreaMm2>.0049&&tiny.lostAreaMm2<.0051);
 const notch=check(tool,[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:60,y:100},{x:60,y:90},{x:40,y:90},{x:40,y:100},{x:0,y:100}]);assert.equal(notch.safe,false);assert.ok(notch.lostAreaMm2>199.99&&notch.lostAreaMm2<200,'all four reference vertices fit but its edge material does not');
});

test('allowance is numerical0.0001mm and never the2percent reserve or manufacturing clearance',()=>{
 const tool=item();assert.equal(check(tool,rectangle(.00009,0,100,100)).safe,true);const bite=check(tool,rectangle(.0003,0,100,100));assert.equal(bite.safe,false);assert.ok(bite.lostAreaMm2>.019&&bite.lostAreaMm2<.021);assert.equal(check(tool,rectangle(.1,0,100,100)).safe,false);tool.pocketMargin=1000;tool.contourReserveRatio=.5;tool.editedPoints=rectangle(20,20,80,80);assert.equal(check(tool,rectangle(20,20,80,80)).safe,false);
});

test('comparison preserves source/photo anchors across arbitrary local model origins',()=>{
 const tool=item(),origin={x:-300,y:600},points=rectangle(200,-200,300,-100),result=check(tool,points,origin);assert.equal(result.safe,true);const wrong=check(tool,points,{x:-299,y:600});assert.equal(wrong.safe,false,'shifting the candidate half a millimetre must not silently re-centre the reference');
});

test('large translated photos and different native pxPerMm preserve the same physical guard',()=>{
 for(const scale of [.4,2,13.3]){const anchor={x:5e8,y:-3e8},tool={contour:{points:rectangle(anchor.x,anchor.y,anchor.x+100*scale,anchor.y+50*scale)}},pass=checkCaptureContourSafety(tool,scale,candidate(rectangle(0,0,100,50),anchor));assert.equal(pass.safe,true);const fail=checkCaptureContourSafety(tool,scale,candidate(rectangle(0,.1,100,50),anchor));assert.equal(fail.safe,false);assert.ok(Math.abs(fail.referenceAreaMm2-5000)<.001);}
});

test('concave jaws are tested as filled source material instead of a convex hull',()=>{
 const source=[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:20,y:20},{x:20,y:80},{x:100,y:80},{x:100,y:100},{x:0,y:100}],tool={contour:{points:source}};assert.equal(checkCaptureContourSafety(tool,1,candidate(source,{x:0,y:0})).safe,true);assert.equal(checkCaptureContourSafety(tool,1,candidate(rectangle(0,0,100,100),{x:0,y:0})).safe,true,'guard only prevents lost material; preserving openings is a separate editing contract');const clipped=source.map(p=>p.x===100?{...p,x:99}:p);assert.equal(checkCaptureContourSafety(tool,1,candidate(clipped,{x:0,y:0})).safe,false);
});

test('winding does not change containment and neither source nor candidate is mutated',()=>{
 const tool=item();tool.contour.points.reverse();const proposed=candidate(rectangle(-1,-1,101,101).reverse()),before=structuredClone({tool,proposed});assert.equal(checkCaptureContourSafety(tool,2,proposed).safe,true);assert.deepEqual({tool,proposed},before);
});

test('a changed original source or calibration fails closed after the protected reference was established',()=>{
 const tool=item();assert.equal(check(tool,rectangle(0,0,100,100)).safe,true);tool.contour.points[1].x-=20;const changed=check(tool,rectangle(0,0,100,100));assert.equal(changed.safe,false);assert.equal(changed.reason,'reference-changed');tool.contour.points[1].x+=20;assert.equal(check(tool,rectangle(0,0,100,100)).safe,true);const scale=checkCaptureContourSafety(tool,4,candidate(rectangle(0,0,100,100)));assert.equal(scale.safe,false);assert.equal(scale.reason,'reference-calibration-changed');
});

test('an invalid reference or candidate cannot turn protection off permissively',()=>{
 for(const tool of [null,{}, {contour:{points:rectangle(0,0,0,0)}},{contour:{points:[{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0}]}},{contour:{points:[{x:NaN,y:0},{x:100,y:0},{x:0,y:100}]}}]){const result=check(tool,rectangle(0,0,100,100));assert.equal(result.safe,false);assert.equal(result.protected,false);}
 for(const proposed of [null,candidate([{x:0,y:0},{x:100,y:0}]),candidate(rectangle(0,0,100,100),{x:NaN,y:0}),candidate([{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0}])])assert.equal(checkCaptureContourSafety(item(),2,proposed).safe,false);
});

test('large3000mm contours remain valid through many cached clamp comparisons',()=>{
 for(const count of [100,1000]){
  const origin={x:2e8,y:-4e8},scale=.7,points=Array.from({length:count},(_,i)=>{const a=i*Math.PI*2/count;return{x:1500+1500*Math.cos(a),y:800+800*Math.sin(a)};}),tool={contour:{points:points.map(p=>({x:origin.x+p.x*scale,y:origin.y+p.y*scale}))}};
  const initial=checkCaptureContourSafety(tool,scale,candidate(points,origin));assert.equal(initial.safe,true,'source-size candidate must pass for '+count+'points: '+JSON.stringify(initial));
  for(let i=0;i<16;i++){const factor=1+(i+1)*1e-5,proposal=points.map(p=>({x:1500+(p.x-1500)*factor,y:800+(p.y-800)*factor})),result=checkCaptureContourSafety(tool,scale,candidate(proposal,origin));assert.equal(result.safe,true,JSON.stringify({count,i,result}));assert.ok(result.referenceAreaMm2>3.7e6);}
 }
});

test('a genuinely outward curved top-left corner contains the complete tool',()=>{
 const raw=rectangle(0,0,30,60),tool={contour:{points:raw.map(p=>({x:125+p.x*2,y:225+p.y*2}))}},points=[{x:30,y:60}],corner={x:-5,y:-3};
 const cubic=(p0,p1,p2,p3)=>{for(let i=0;i<32;i++){const t=i/32,u=1-t;points.push({x:u**3*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t**3*p3.x,y:u**3*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t**3*p3.y});}};
 cubic({x:0,y:60},{x:0,y:60},{x:-13.94427191,y:14.88854382},corner);cubic(corner,{x:-.527864045,y:-11.94427191},{x:30,y:0},{x:30,y:0});points.push({x:30,y:0});
 const result=checkCaptureContourSafety(tool,2,candidate(points,{x:125,y:225}));assert.equal(result.safe,true,JSON.stringify(result));assert.equal(result.lostAreaMm2,0);assert.equal(result.referenceAreaMm2,1800);
});
