import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateRulers,rectifyRulers} from '../dist/ruler-calibration.js';
import {calibrateSegment} from '../dist/trace.js';

const map=(m,p)=>({x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f});
const difference=(a,b)=>({x:b.x-a.x,y:b.y-a.y});
const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const size={width:640,height:480},points=[{x:50,y:50},{x:350,y:150},{x:100,y:120},{x:160,y:320}];

test('two known perpendicular metric segments undo rotation, shear and independent scales',()=>{
  const before=structuredClone(points),result=calibrateRulers(size,points,[100,100]);
  const u=difference(result.points[0],result.points[1]),v=difference(result.points[2],result.points[3]);
  near(u.x/result.pxPerMm,100);near(u.y,0);near(v.x,0);near(v.y/result.pxPerMm,100);
  // A third physical vector (37,-18) must be measured correctly, not merely the ruler endpoints.
  const a={x:280,y:230},b={x:280+3*37+.6*-18,y:230+37+2*-18};
  const measured=difference(map(result.transform,a),map(result.transform,b));
  near(measured.x/result.pxPerMm,37);near(measured.y/result.pxPerMm,-18);
  for(const p of [a,b,...points]){const roundtrip=map(result.inverse,map(result.transform,p));near(roundtrip.x,p.x);near(roundtrip.y,p.y);}
  assert.deepEqual(points,before,'calibration never changes user reference points');
});

test('reversing either or both references preserves orientation without reflecting tools',()=>{
  for(const reverseFirst of [false,true])for(const reverseSecond of [false,true]){
    const refs=[...(reverseFirst?points.slice(0,2).reverse():points.slice(0,2)),...(reverseSecond?points.slice(2).reverse():points.slice(2))];
    const result=calibrateRulers(size,refs,[100,100]),m=result.transform;
    assert.ok(m.a*m.d-m.b*m.c>0,'orientation determinant stays positive');
    const a=difference(result.points[0],result.points[1]),b=difference(result.points[2],result.points[3]);
    near(Math.hypot(a.x,a.y)/result.pxPerMm,100);near(Math.hypot(b.x,b.y)/result.pxPerMm,100);near(a.x*b.x+a.y*b.y,0,1e-6);
  }
});

test('second distance changes measured transverse geometry and output aspect ratio',()=>{
  const first=calibrateRulers(size,points,[100,100]),second=calibrateRulers(size,points,[100,200]);
  const transverse=r=>Math.hypot(r.points[3].x-r.points[2].x,r.points[3].y-r.points[2].y)/r.pxPerMm;
  near(transverse(first),100);near(transverse(second),200);
  near(second.widthMm,first.widthMm);near(second.heightMm,first.heightMm*2);
  assert.notEqual(second.width/second.height,first.width/first.height);
});

test('rewarp samples the original raster with the same transform as returned reference points',()=>{
  const width=128,height=96,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const k=(y*width+x)*4;data[k]=x;data[k+1]=y;data[k+2]=80;data[k+3]=255;}
  const refs=[{x:10,y:10},{x:90,y:30},{x:20,y:20},{x:26,y:59}],image={width,height,data};
  const result=rectifyRulers(image,refs,[40,30]),p=map(result.transform,{x:60,y:45}),x=Math.round(p.x),y=Math.round(p.y),source=map(result.inverse,{x,y}),k=(y*result.width+x)*4;
  near(result.imageData.data[k],source.x,.51);near(result.imageData.data[k+1],source.y,.51);assert.equal(result.imageData.data[k+2],80);assert.equal(result.imageData.data[k+3],255);
  result.points.forEach((p,i)=>assert.deepEqual(p,map(result.transform,refs[i])));
  assert.equal(result.imageData.width,result.width);assert.equal(image.data[0],0,'source raster remains unchanged');
  assert.ok(result.imageData.data.some((v,i)=>i%4===0&&v===255),'outside the rewarped photograph is white');
});

test('calibration bounds allocation and rejects unstable, short, invalid or nearly parallel references',()=>{
  const bounded=calibrateRulers({width:4000,height:3000},points,[100,100]);assert.ok(Math.max(bounded.width,bounded.height)<=1400);
  assert.throws(()=>calibrateRulers(size,[points[0],{x:51,y:51},...points.slice(2)],[100,100]),/příliš blízko/);
  assert.throws(()=>calibrateRulers(size,[...points.slice(0,2),{x:100,y:100},{x:400,y:201}],[100,100]),/rovnoběžné/);
  assert.throws(()=>calibrateRulers(size,points,[100,5000]),/zkreslení/);
  for(const values of [[NaN,100],[0,100],[100,5001]])assert.throws(()=>calibrateRulers(size,points,values));
  assert.throws(()=>calibrateRulers(size,[...points.slice(0,3),{x:640,y:0}],[100,100]));
  assert.throws(()=>rectifyRulers({...size,data:new Uint8ClampedArray(4)},points,[100,100]),/pixelová/);
  assert.equal(calibrateSegment({x:10,y:20},{x:210,y:20},100),2,'one-ruler scale remains unchanged');
  assert.throws(()=>calibrateSegment({x:10,y:20},{x:11,y:20},100),/příliš blízko/);
  assert.throws(()=>calibrateSegment(null,{x:100,y:20},100),/značky/);
});
