import test from 'node:test';
import assert from 'node:assert/strict';
import Clipper from '../dist/vendor/clipper.js';
import {fitIdealPocket} from '../dist/ideal-pocket.js';

const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2);
const bounds=p=>({x0:Math.min(...p.map(p=>p.x)),x1:Math.max(...p.map(p=>p.x)),y0:Math.min(...p.map(p=>p.y)),y1:Math.max(...p.map(p=>p.y))});
function contains(source,pocket){
  const S=1e6,path=p=>{const q=p.map(v=>({X:Math.round(v.x*S),Y:Math.round(v.y*S)}));if(!Clipper.Clipper.Orientation(q))q.reverse();return q;},engine=new Clipper.Clipper(),out=[];
  engine.AddPath(path(source),Clipper.PolyType.ptSubject,true);engine.AddPath(path(pocket),Clipper.PolyType.ptClip,true);engine.Execute(Clipper.ClipType.ctDifference,out,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  assert.ok(out.reduce((sum,p)=>sum+Math.abs(Clipper.Clipper.Area(p))/(S*S),0)<1e-5,'complete measured tool must fit');
}
function inside(p,polygon){let value=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)value=!value;}return value;}
const rectangle=[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:0,y:20}];
const wrench=[{x:0,y:5},{x:4,y:0},{x:12,y:0},{x:20,y:9},{x:85,y:9},{x:91,y:5},{x:100,y:5},{x:106,y:11},{x:106,y:21},{x:100,y:27},{x:91,y:27},{x:85,y:23},{x:20,y:23},{x:12,y:32},{x:4,y:32},{x:0,y:27},{x:0,y:22},{x:10,y:22},{x:14,y:18},{x:14,y:14},{x:10,y:10},{x:0,y:10}];

test('2 percent is total dimensional growth in unchanged mm coordinates',()=>{
  const original=structuredClone(rectangle),result=fitIdealPocket(rectangle),b=bounds(result.points);
  assert.deepEqual(rectangle,original);assert.equal(result.kind,'ideal');assert.equal(result.reserveRatio,.02);assert.deepEqual(result.primitives,[]);
  assert.ok(Math.abs(b.x1-b.x0-102)<.003);assert.ok(Math.abs(b.y1-b.y0-20.4)<.003);contains(rectangle,result.points);
  assert.ok(Math.abs((b.x0+b.x1)/2-50)<.001);assert.ok(Math.abs((b.y0+b.y1)/2-10)<.001);
});

test('small teeth become broad smooth flanks while the whole measurement fits',()=>{
  const source=[];for(let i=0;i<=300;i++)source.push({x:i/3,y:10+.13*Math.sin(i*1.8)});for(let i=300;i>=0;i--)source.push({x:i/3,y:-10-.13*Math.sin(i*1.8)});
  const result=fitIdealPocket(source);contains(source,result.points);assert.ok(result.points.length<source.length/3);
  assert.ok(area(result.points)<area(source)*1.08,'smoothing must not make a large symmetric head');
  const central=result.points.filter(p=>p.x>10&&p.x<90);assert.ok(central.length<12,'a straight flank must not retain each pixel tooth');
});

test('a broad asymmetric jaw stays open rather than being replaced by a circle',()=>{
  const result=fitIdealPocket(wrench);contains(wrench,result.points);assert.equal(inside({x:5,y:16},result.points),false);
  assert.ok(area(result.points)<area(wrench)*1.15);
  for(const p of [{x:5,y:6},{x:105,y:16},{x:60,y:10}])assert.ok(inside(p,result.points));
});

test('rotation, winding and vertex density retain the same practical shape',()=>{
  const baseline=fitIdealPocket(wrench),transform=(points,angle)=>points.map(p=>({x:Math.cos(angle)*p.x-Math.sin(angle)*p.y+711,y:Math.sin(angle)*p.x+Math.cos(angle)*p.y-325}));
  for(const angle of [0,.37,1.57,2.39]){const source=transform(wrench,angle).reverse(),result=fitIdealPocket(source);contains(source,result.points);assert.ok(Math.abs(area(result.points)-area(baseline.points))<.01);}
  const dense=rectangle.flatMap((p,i)=>{const q=rectangle[(i+1)%rectangle.length];return Array.from({length:100},(_,j)=>({x:p.x+(q.x-p.x)*j/100,y:p.y+(q.y-p.y)*j/100}));});
  assert.ok(Math.abs(area(fitIdealPocket(dense).points)-area(fitIdealPocket(rectangle).points))<.01);
});

test('invalid contours and reserves fail before manufacturing',()=>{
  for(const source of [null,[],[{x:0,y:0},{x:1,y:1},{x:2,y:2}],[{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}],rectangle.map((p,i)=>i?p:{x:NaN,y:0})])assert.throws(()=>fitIdealPocket(source));
  for(const reserveRatio of [-1,.21,NaN,Infinity,null,'0.02'])assert.throws(()=>fitIdealPocket(rectangle,{reserveRatio}));
});
