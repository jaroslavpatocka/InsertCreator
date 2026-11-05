import {test} from 'node:test';
import assert from 'node:assert/strict';
import Clipper from '../dist/vendor/clipper.js';
import {fitFunctionalPocket,fitHybridPocket} from '../dist/functional-pocket.js';

const SCALE=1e6;
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2);
const rectangle=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const circle=(x,y,r,n=128)=>Array.from({length:n},(_,i)=>({x:x+r*Math.cos(i*Math.PI*2/n),y:y+r*Math.sin(i*Math.PI*2/n)}));
function operation(subject,clip=[],kind=Clipper.ClipType.ctUnion){
  const path=p=>{const q=p.map(v=>({X:Math.round(v.x*SCALE),Y:Math.round(v.y*SCALE)}));if(!Clipper.Clipper.Orientation(q))q.reverse();return q;};
  const c=new Clipper.Clipper(),out=[];c.StrictlySimple=true;c.AddPaths(subject.map(path),Clipper.PolyType.ptSubject,true);if(clip.length)c.AddPaths(clip.map(path),Clipper.PolyType.ptClip,true);c.Execute(kind,out,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);return out.map(p=>p.map(v=>({x:v.X/SCALE,y:v.Y/SCALE})));
}
const union=parts=>operation(parts)[0];
function contains(source,pocket){const remainder=operation([source],[pocket],Clipper.ClipType.ctDifference);assert.ok(remainder.reduce((sum,p)=>sum+area(p),0)<Math.max(1e-5,area(source)*1e-7),'complete source polygon must fit in pocket within micron-grid rounding');assert.equal(operation([pocket]).length,1,'pocket must be a single simple loop');}
function transform(points,angle,tx=0,ty=0){const c=Math.cos(angle),s=Math.sin(angle);return points.map(p=>({x:p.x*c-p.y*s+tx,y:p.x*s+p.y*c+ty}));}
const ratchet=()=>union([circle(15,0,15).map((p,i)=>{const a=i*Math.PI*2/128,r=15+.13*Math.cos(a*17);return{x:15+r*Math.cos(a),y:r*Math.sin(a)};}),rectangle(15,-5,65,10),rectangle(78,-9,55,18),circle(133,0,9)]);

test('ratchet becomes a small union of regular head, shaft and grip shapes',()=>{
  const source=ratchet(),before=structuredClone(source),result=fitFunctionalPocket(source);
  assert.deepEqual(source,before);contains(source,result.points);
  assert.ok(result.primitives.length>=2&&result.primitives.length<=5);
  assert.ok(result.primitives.some(p=>p.type==='circle'),'round ratchet head should be circular');
  assert.ok(result.primitives.some(p=>p.type==='rectangle'),'long narrow neck should be straight');
  assert.ok(area(result.points)<area(source)*1.35,'functional pocket should not become a full bounding box');
  for(const part of result.primitives){assert.ok(part.points.length>=4);assert.ok(Number.isFinite(part.center.x));}
});

test('compact socket stays circular and regular circles do not grow on repeated fits',()=>{
  const source=circle(23,-7,9),result=fitFunctionalPocket(source);contains(source,result.points);assert.equal(result.kind,'circle');
  let next=result;for(let i=0;i<8;i++)next=fitFunctionalPocket(next.points);
  assert.ok(Math.abs(area(next.points)-area(result.points))<1e-5);
});

test('stepped extension retains both tips and each width shoulder',()=>{
  const source=union([rectangle(0,-6,28,12),rectangle(28,-3,72,6),rectangle(100,-5,22,10)]),result=fitFunctionalPocket(source);
  contains(source,result.points);assert.ok(result.alreadyRegular);assert.deepEqual(result.points,source,'an exact primitive union is already a functional pocket');assert.ok(area(result.points)<area(source)*1.3);
});

test('rotation, reversal and uneven vertex density keep measured tool enclosed',()=>{
  const source=ratchet(),baseline=fitFunctionalPocket(source);
  for(const angle of [0,.37,Math.PI/2,2.39]){
    const transformed=transform(source,angle,54,-31),result=fitFunctionalPocket(transformed.reverse());contains(transformed,result.points);
    assert.ok(Math.abs(area(result.points)-area(baseline.points))<.05,'rigid rotation must not materially change pocket area');
  }
  const shaft=rectangle(0,-5,120,10),dense=[shaft[0],...Array.from({length:200},(_,i)=>({x:120*(i+1)/200,y:-5})),shaft[2],shaft[3]];
  const plain=fitFunctionalPocket(shaft),sampled=fitFunctionalPocket(dense);assert.ok(Math.abs(area(plain.points)-area(sampled.points))<1e-4);
});

test('asymmetric tools receive a connected conservative regular envelope',()=>{
  const source=union([rectangle(0,-4,100,8),rectangle(5,-4,22,25)]),result=fitFunctionalPocket(transform(source,.71));
  contains(transform(source,.71),result.points);assert.ok(result.primitives.length<=5);assert.ok(result.points.length<400);
});

test('invalid geometry fails instead of silently manufacturing an empty pocket',()=>{
  for(const source of [null,[],[{x:0,y:0},{x:1,y:1},{x:2,y:2}],rectangle(0,0,10,10).map((p,i)=>i? p:{x:NaN,y:0}),[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]])assert.throws(()=>fitFunctionalPocket(source));
});

test('a constructed compound pocket stays exact after JSON round-trip and repeated fitting',()=>{
  const first=fitFunctionalPocket(ratchet());assert.ok(first.primitives.length>=2);
  let points=JSON.parse(JSON.stringify(first.points));
  for(let i=0;i<10;i++){const next=fitFunctionalPocket(points);assert.ok(next.alreadyRegular);assert.deepEqual(next.points,first.points);points=JSON.parse(JSON.stringify(next.points));}
  const noisy=[];for(let i=0;i<=80;i++)noisy.push({x:i,y:5+.2*Math.sin(i*1.7)});for(let i=80;i>=0;i--)noisy.push({x:i,y:-5-.2*Math.sin(i*1.7)});
  const clean=fitFunctionalPocket(noisy);assert.notDeepEqual(clean.points,noisy,'mirror symmetry alone must not classify serrations as an existing construction');contains(noisy,clean.points);
});

test('hybrid macro profile stays between the complete measurement and regular envelope',()=>{
  const adaptor=union([rectangle(0,-9,20,18),rectangle(20,-5,24,10),rectangle(44,-9,24,18),[{x:28,y:5},{x:30,y:12},{x:32,y:5}]]);
  for(const source of [ratchet(),adaptor,transform(ratchet(),.73,28,-17)]){
    const before=structuredClone(source),regular=fitFunctionalPocket(source),hybrid=fitHybridPocket(source);
    assert.equal(hybrid.kind,'hybrid');assert.equal(hybrid.blend,.5);assert.deepEqual(source,before);
    contains(source,hybrid.points);contains(hybrid.points,regular.points);
    assert.ok(area(hybrid.points)>=area(source)-1e-5);assert.ok(area(hybrid.points)<=area(regular.points)+1e-5);
    assert.ok(hybrid.points.length<=6000);assert.equal(operation([hybrid.points]).length,1);
  }
});

test('hybrid endpoints honor selected blend and reject invalid interpolation weights',()=>{
  const source=ratchet();assert.deepEqual(fitHybridPocket(source,{blend:0}).points,source);assert.deepEqual(fitHybridPocket(source,{blend:1}).points,fitFunctionalPocket(source).points);
  for(const blend of [-.01,1.01,NaN,Infinity,null,'0.5'])assert.throws(()=>fitHybridPocket(source,{blend}));
  const exact=rectangle(0,0,25,80);assert.deepEqual(fitHybridPocket(exact).points,exact,'already regular dimensions and order stay exact');
});
