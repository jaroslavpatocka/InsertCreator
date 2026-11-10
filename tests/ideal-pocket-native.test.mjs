import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Clipper from '../dist/vendor/clipper.js';
import {fitIdealPocket} from '../dist/ideal-pocket.js';
import {getToolDimensions} from '../dist/tool-dimensions.js';
import {simpleOutline,pocketOutline} from '../dist/finger-grip.js';

// This fixture is measured source pixels from saved native alpha, not a target
// pocket. All expected material below comes from that unchanged measurement.
const fixture=JSON.parse(await fs.readFile(new URL('fixtures/native-caliper-contour.json',import.meta.url),'utf8'));
const raw=fixture.points;
function measured(scale){return simpleOutline(raw.map(p=>({x:+((p.x-fixture.bounds.minX)/scale).toFixed(4),y:+((p.y-fixture.bounds.minY)/scale).toFixed(4)})));}
const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
function outsideArea(subject,clip){
 const scale=1e7,path=points=>{const result=points.map(p=>({X:Math.round(p.x*scale),Y:Math.round(p.y*scale)}));if(!Clipper.Clipper.Orientation(result))result.reverse();return result;},engine=new Clipper.Clipper(),out=[];
 engine.AddPath(path(subject),Clipper.PolyType.ptSubject,true);engine.AddPath(path(clip),Clipper.PolyType.ptClip,true);engine.Execute(Clipper.ClipType.ctDifference,out,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
 return out.reduce((sum,p)=>sum+Math.abs(Clipper.Clipper.Area(p))/(scale*scale),0);
}
function distance(p,polygon){
 let inside=false,best=Infinity;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[j],b=polygon[i];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));
 }return inside?0:best;
}
function assertCompleteMaterial(source,pocket){
 assert.equal(outsideArea(source,pocket),0,'no measured source polygon area may remain outside the pocket');
 for(let i=0;i<source.length;i++){const a=source[i],b=source[(i+1)%source.length];for(const t of [0,.25,.5,.75,1])assert.ok(distance({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},pocket)<.00001,'all source vertices and sampled edge interiors must fit');}
}
function span(points,axis){const normal={x:-axis.y,y:axis.x},a=points.map(p=>p.x*axis.x+p.y*axis.y),b=points.map(p=>p.x*normal.x+p.y*normal.y);return{length:Math.max(...a)-Math.min(...a),width:Math.max(...b)-Math.min(...b)};}

test('measured native caliper retains every source point and edge at six calibrated scales',()=>{
 assert.equal(raw.length,294);const before=structuredClone(fixture);
 for(const scale of [1,1.569186,4,5,10,100]){
  const source=measured(scale),snapshot=structuredClone(source),result=fitIdealPocket(source);assert.equal(result.fallback,'source-offset');assert.equal(result.kind,'ideal');assert.equal(result.reserveRatio,.02);assert.equal(result.filledOffsetHoles,1);assert.ok(result.filledOffsetHoleAreaRatio>.004&&result.filledOffsetHoleAreaRatio<.006,'enclosed offset hole is disclosed as about half a percent of source area');
  assertCompleteMaterial(source,result.points);assert.deepEqual(source,snapshot);const axis=getToolDimensions({points:source}).axis,a=span(source,axis),b=span(result.points,axis);
  for(const key of ['length','width'])assert.ok(b[key]/a[key]>1.019&&b[key]/a[key]<1.021,'requested2percent reserve occurs once, in the unchanged calibrated frame');
 }
 assert.deepEqual(fixture,before);
});
test('source-offset fallback preserves millimetres under rotation, translation and winding',()=>{
 const source=measured(1.569186),baseline=fitIdealPocket(source);
 for(const angle of [0,.37,1.57,2.39]){
  const c=Math.cos(angle),s=Math.sin(angle),transform=p=>({x:711+c*p.x-s*p.y,y:-325+s*p.x+c*p.y}),inverse=p=>({x:c*(p.x-711)+s*(p.y+325),y:-s*(p.x-711)+c*(p.y+325)}),input=source.map(transform).reverse(),result=fitIdealPocket(input),returned=result.points.map(inverse);
  assert.equal(result.fallback,'source-offset');assertCompleteMaterial(input,result.points);assert.ok(Math.abs(area(returned)-area(baseline.points))<.0001);assert.ok(outsideArea(returned,baseline.points)+outsideArea(baseline.points,returned)<.0002,'inverse transform returns the same physical pocket');
 }
});
test('zero reserve adds no growth or hole filling to the native measurement',()=>{
 const source=measured(1.569186),result=fitIdealPocket(source,{reserveRatio:0});assert.equal(result.reserveRatio,0);assert.equal(result.fallback,undefined);assert.equal(result.filledOffsetHoles||0,0);
 // Legacy reserve0 uses the normalized1e7 integer grid. Its micrometre-scale
 // boundary quantization is preserved; no reserve or fallback is introduced.
 const axis=getToolDimensions({points:source}).axis,before=span(source,axis),after=span(result.points,axis);assert.ok(Math.abs(before.length-after.length)<.00005);assert.ok(Math.abs(before.width-after.width)<.00005);assert.ok(outsideArea(source,result.points)+outsideArea(result.points,source)<.002);
});
test('broad open jaw stays open and successful smoothing does not acquire fallback metadata',()=>{
 const source=[{x:0,y:0},{x:120,y:0},{x:120,y:18},{x:85,y:18},{x:85,y:55},{x:120,y:55},{x:120,y:73},{x:0,y:73}],result=fitIdealPocket(source);assertCompleteMaterial(source,result.points);assert.ok(distance({x:105,y:36},result.points)>5,'the open primary jaw must not become an enclosed manufacturing island');assert.equal(result.fallback,undefined);
});
test('reserve and ordinary clearance stay separate and are each applied once',()=>{
 const source=[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:0,y:20}],result=fitIdealPocket(source),expanded=pocketOutline({points:result.points,x:0,y:0,rotation:0,fingerGrips:[]},.8),size=span(expanded,{x:1,y:0});assert.ok(Math.abs(size.length-103.6)<.003);assert.ok(Math.abs(size.width-22)<.003);assert.equal(result.fallback,undefined);
});
test('disconnected or self-crossing source cannot be accepted by selecting its largest part',()=>{
 const disconnected=[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4},{x:0,y:0},{x:10,y:0},{x:14,y:0},{x:14,y:4},{x:10,y:4},{x:10,y:0},{x:0,y:0}];assert.throws(()=>fitIdealPocket(disconnected),/křížit/);
});
