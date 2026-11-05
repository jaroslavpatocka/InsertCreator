// Synthetic socket heads viewed from above; no pixels from a product or user photograph.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {recognizeTools} from '../dist/recognize.js';

const WIDTH=480,HEIGHT=360;
function socketTray(){
  const canvas=createCanvas(WIDTH,HEIGHT),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle='#202225';ctx.fillRect(30,30,420,300);
  // A long case rail and tiny, disconnected printing must not become extra tools.
  ctx.fillStyle='#d5d8dc';ctx.fillRect(55,34,370,3);
  for(let x=70;x<=390;x+=16){ctx.fillRect(x,146,2,3);ctx.fillRect(x+4,146,2,3);}
  const heads=[
    {x:90,y:105,r:7.5,rim:1.5},
    {x:145,y:105,r:9.5,rim:1.75},
    {x:205,y:105,r:11.5,rim:2},
    {x:270,y:105,r:14.5,rim:2.5},
    {x:340,y:105,r:17.5,rim:3},
  ];
  for(const head of heads){
    ctx.fillStyle='#d5d8dc';ctx.beginPath();ctx.arc(head.x,head.y,head.r,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#202225';ctx.beginPath();ctx.arc(head.x,head.y,head.r-head.rim,0,Math.PI*2);ctx.fill();
  }
  // Solid tools make the bright foreground share representative of a populated tray.
  const solids=Array.from({length:4},(_,i)=>({x:100+i*75,y:205,w:18,h:75}));
  ctx.fillStyle='#d5d8dc';for(const tool of solids)ctx.fillRect(tool.x,tool.y,tool.w,tool.h);
  return {image:ctx.getImageData(0,0,WIDTH,HEIGHT),heads,solids};
}
function bounds(contour){
  const xs=contour.points.map(p=>p.x),ys=contour.points.map(p=>p.y);
  return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};
}
function contains(points,x,y){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
const polygonArea=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0))/2;

test('thin hollow socket heads survive tray cleaning as complete individual tool silhouettes',async()=>{
  const {image,heads,solids}=socketTray();
  const result=await recognizeTools(image,{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');
  assert.equal(result.quality.status,'ready',result.quality.reasons.join(' '));
  const used=new Set();
  for(const head of heads){
    const matches=result.contours.filter(c=>contains(c.points,head.x,head.y));
    assert.equal(matches.length,1,`socket at (${head.x},${head.y}), diameter ${head.r*2}, rim ${head.rim} must have one full silhouette`);
    const contour=matches[0],b=bounds(contour);used.add(contour);
    assert.ok(contour.points.length>=8,'a round socket keeps a curved exterior');
    for(const [actual,expected] of [[b.x0,head.x-head.r],[b.x1,head.x+head.r],[b.y0,head.y-head.r],[b.y1,head.y+head.r]]){
      assert.ok(Math.abs(actual-expected)<=2,`socket diameter/position changed: ${JSON.stringify(b)}`);
    }
    const area=polygonArea(contour.points);
    assert.ok(area>=Math.PI*(head.r-1.5)**2&&area<=Math.PI*(head.r+1.5)**2,`socket exterior area ${area} must describe the full disk, not a rim fragment`);
    assert.equal(result.mask[head.y*WIDTH+head.x],1,'the pocket silhouette includes the socket opening');
  }
  for(const tool of solids){
    const matches=result.contours.filter(c=>{const b=bounds(c);return Math.abs(b.x0-tool.x)<=2&&Math.abs(b.x1-tool.x-tool.w)<=2&&Math.abs(b.y0-tool.y)<=2&&Math.abs(b.y1-tool.y-tool.h)<=2;});
    assert.equal(matches.length,1,`solid tool at ${tool.x} keeps its position and dimensions`);used.add(matches[0]);
  }
  assert.equal(result.contours.length,heads.length+solids.length,'each tool appears once; printing and the case rail add no tools');
  assert.equal(used.size,result.contours.length,'no contour is reused to account for multiple tools');
});

test('small socket rim gaps recover without joining nearby tools or filling a visibly open arc',async()=>{
  const {image,heads}=socketTray(),canvas=createCanvas(WIDTH,HEIGHT),ctx=canvas.getContext('2d');
  ctx.putImageData(image,0,0);
  // A one-pixel radial interruption and a diagonal one resemble weak reflections.
  ctx.strokeStyle='#202225';ctx.lineWidth=1;
  for(const [head,angle] of [[heads[0],0],[heads[1],Math.PI/4]]){
    ctx.beginPath();ctx.moveTo(head.x+(head.r-head.rim-1)*Math.cos(angle),head.y+(head.r-head.rim-1)*Math.sin(angle));
    ctx.lineTo(head.x+(head.r+1)*Math.cos(angle),head.y+(head.r+1)*Math.sin(angle));ctx.stroke();
  }
  // A narrow but resolvable dark gap must survive recovery and engraving cleanup.
  const neighbour={x:363,y:99,w:12,h:12};
  ctx.fillStyle='#d5d8dc';ctx.fillRect(neighbour.x,neighbour.y,neighbour.w,neighbour.h);
  // A broad missing sector is real missing evidence: it must stay open.
  const arc={x:405,y:205,r:14,rim:3};
  ctx.strokeStyle='#d5d8dc';ctx.lineWidth=arc.rim;ctx.beginPath();
  ctx.arc(arc.x,arc.y,arc.r-arc.rim/2,.65,Math.PI*2-.65);ctx.stroke();
  const result=await recognizeTools(ctx.getImageData(0,0,WIDTH,HEIGHT),{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');
  for(const head of heads.slice(0,2)){
    const matches=result.contours.filter(c=>contains(c.points,head.x,head.y));
    assert.equal(matches.length,1,`a tiny rim gap must not erase the socket at ${head.x}`);
    const b=bounds(matches[0]);
    assert.ok(Math.abs(b.x0-head.x+head.r)<=2&&Math.abs(b.x1-head.x-head.r)<=2&&Math.abs(b.y0-head.y+head.r)<=2&&Math.abs(b.y1-head.y-head.r)<=2,'recovered socket keeps its outer dimensions');
    assert.ok(polygonArea(matches[0].points)>=Math.PI*(head.r-2)**2,'recovery retains the full outer silhouette');
  }
  assert.equal(result.mask[arc.y*WIDTH+arc.x],0,'a visibly open arc does not invent a filled socket opening');
  assert.equal(result.contours.some(c=>contains(c.points,arc.x,arc.y)),false,'no full tool silhouette is invented inside an open arc');
  const head=heads.at(-1),headContours=result.contours.filter(c=>contains(c.points,head.x,head.y));
  const neighbours=result.contours.filter(c=>contains(c.points,neighbour.x+neighbour.w/2,neighbour.y+neighbour.h/2));
  assert.equal(headContours.length,1,'the socket beside another tool survives');
  assert.equal(neighbours.length,1,'the neighbouring tool survives');
  assert.ok(headContours[0]!==neighbours[0],'filling a socket opening must not connect two separate tools');
  assert.ok(bounds(headContours[0]).x1<=head.x+head.r+2,'the socket contour does not expand over the gap');
});
