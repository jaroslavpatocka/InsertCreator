// Known synthetic tools with deliberately wrong seeds; the photograph alone must restore the true outline.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {refineContours} from '../dist/contour-refine.js';
import {recognizeTools} from '../dist/recognize.js';

const WIDTH=640,HEIGHT=420;
function photo(paint,width=WIDTH,height=HEIGHT){
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');paint(ctx);
  // Soften by a pixel so that edges have the width of a real lens and sensor.
  const soft=createCanvas(width,height),out=soft.getContext('2d');out.filter='blur(.7px)';out.drawImage(canvas,0,0);
  return out.getImageData(0,0,width,height);
}
const area=points=>{let sum=0;for(let i=0,j=points.length-1;i<points.length;j=i++)sum+=points[j].x*points[i].y-points[i].x*points[j].y;return Math.abs(sum)/2;};
const seed=points=>({points,area:area(points),width:0,height:0});
const box=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
function wobbly(x0,y0,x1,y1,amplitude){
  const points=[];
  for(let x=x0;x<x1;x+=4)points.push({x,y:y0+amplitude*Math.sin(x*.21)});
  for(let y=y0;y<y1;y+=4)points.push({x:x1+amplitude*Math.sin(y*.3),y});
  for(let x=x1;x>x0;x-=4)points.push({x,y:y1+amplitude*Math.cos(x*.17)});
  for(let y=y1;y>y0;y-=4)points.push({x:x0+amplitude*Math.cos(y*.3),y});
  return points;
}
const inside=(points,x,y)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++)if((points[i].y>y)!==(points[j].y>y)&&x<(points[j].x-points[i].x)*(y-points[i].y)/(points[j].y-points[i].y)+points[i].x)hit=!hit;return hit;};
const extent=points=>({x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))});
const near=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual.toFixed(2)} vs ${expected}`);
function foam(ctx,width=WIDTH,height=HEIGHT){ctx.fillStyle='#2a2b2d';ctx.fillRect(0,0,width,height);}

test('a noisy seed of a metal tool settles on the real straight edges',()=>{
  const image=photo(ctx=>{foam(ctx);ctx.fillStyle='#0a0a0c';ctx.fillRect(90,120,460,160);ctx.fillStyle='#d8dbde';ctx.fillRect(110,160,420,80);});
  const [result]=refineContours(image,[seed(wobbly(110,160,530,240,3))]);
  assert.equal(result.refined,true);
  const b=extent(result.points);
  near(b.x0,110,1,'left');near(b.x1,530,1,'right');near(b.y0,160,1,'top');near(b.y1,240,1,'bottom');
  // Waviness of the seed must not survive on a straight edge.
  const top=result.points.filter(p=>p.y<200&&p.x>140&&p.x<500).map(p=>p.y);
  assert.ok(Math.max(...top)-Math.min(...top)<=1,`top edge stays straight, spread ${Math.max(...top)-Math.min(...top)}`);
});

test('black rubber in a black recess keeps its true width, without the lit rim of the recess',()=>{
  const image=photo(ctx=>{
    foam(ctx);
    ctx.fillStyle='#10426a';ctx.fillRect(100,150,440,120); // lit recess wall
    ctx.fillStyle='#030508';ctx.fillRect(106,156,428,108); // shadow gap
    ctx.fillStyle='#262626';ctx.fillRect(120,170,400,80);  // dark grip
    ctx.fillStyle='#d8dbde';ctx.fillRect(120,190,120,40);  // metal part of the same tool
  });
  // The seed swallowed the gap and the rim on one side, and missed the grip on the other.
  const seedPoints=[{x:120,y:190},{x:300,y:176},{x:522,y:176},{x:522,y:268},{x:300,y:268},{x:120,y:230}];
  const [result]=refineContours(image,[seed(seedPoints)]);
  assert.equal(result.refined,true);
  const b=extent(result.points);
  near(b.y0,170,2,'grip top');near(b.y1,250,2,'grip bottom, not the recess rim');near(b.x0,120,2,'left');near(b.x1,520,2,'right');
});

test('a screw near the rim does not bite a notch into the outline',()=>{
  const image=photo(ctx=>{
    foam(ctx);ctx.fillStyle='#0a0a0c';ctx.beginPath();ctx.arc(320,210,120,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#d8dbde';ctx.beginPath();ctx.arc(320,210,100,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#0c0c0c';ctx.beginPath();ctx.arc(320,117,3,0,Math.PI*2);ctx.fill();
  });
  const circle=[];for(let i=0;i<360;i++){const a=i/360*Math.PI*2;let r=100;const off=Math.abs(Math.atan2(Math.sin(a+Math.PI/2),Math.cos(a+Math.PI/2)));if(off<.03)r=90;circle.push({x:320+r*Math.cos(a),y:210+r*Math.sin(a)});}
  const [result]=refineContours(image,[seed(circle)]);
  for(const p of result.points)near(Math.hypot(p.x-320,p.y-210),100,1.5,'radius');
});

test('a sharp shoulder survives while an unmanufacturable slit is closed',()=>{
  const image=photo(ctx=>{
    foam(ctx);ctx.fillStyle='#0a0a0c';ctx.fillRect(80,100,500,220);
    ctx.fillStyle='#d8dbde';ctx.fillRect(100,170,200,80);ctx.fillRect(300,140,40,140);ctx.fillRect(340,180,200,60);
    ctx.fillStyle='#0a0a0c';ctx.fillRect(160,170,4,40); // slit, far narrower than any foam web
  });
  const outline=[{x:100,y:170},{x:300,y:170},{x:300,y:140},{x:340,y:140},{x:340,y:180},{x:540,y:180},{x:540,y:240},{x:340,y:240},{x:340,y:280},{x:300,y:280},{x:300,y:250},{x:100,y:250}];
  const [result]=refineContours(image,[seed(outline)]);
  assert.equal(inside(result.points,162,175),true,'the slit is part of the pocket');
  for(const [x,y] of [[302,143],[337,143],[302,277],[337,277]])assert.equal(inside(result.points,x,y),true,`collar corner ${x},${y} stays inside`);
  for(const [x,y] of [[295,160],[345,170],[345,250]])assert.equal(inside(result.points,x,y),false,`shoulder ${x},${y} stays outside`);
});

test('neighbouring tools keep separate, non-overlapping outlines',()=>{
  const image=photo(ctx=>{foam(ctx);ctx.fillStyle='#0a0a0c';ctx.fillRect(90,110,460,200);ctx.fillStyle='#d8dbde';ctx.fillRect(120,150,400,50);ctx.fillRect(120,206,400,50);});
  const result=refineContours(image,[seed(box(120,150,520,200)),seed(box(120,206,520,256))]);
  const first=extent(result[0].points),second=extent(result[1].points);
  assert.ok(first.y1<=second.y0+.5,`outlines stay apart: ${first.y1} / ${second.y0}`);
});

test('a dark tool on paper does not swallow its cast shadow',async()=>{
  const image=photo(ctx=>{
    ctx.fillStyle='#f4f2ee';ctx.fillRect(0,0,WIDTH,HEIGHT);
    ctx.save();ctx.filter='blur(6px)';ctx.fillStyle='rgba(60,60,60,.25)';ctx.fillRect(130,190,420,80);ctx.restore();
    ctx.fillStyle='#1b1b1d';ctx.fillRect(120,180,420,60);
  });
  const result=await recognizeTools(image,{pxPerMm:2,kind:'paper'});
  assert.equal(result.contours.length,1);
  const b=extent(result.contours[0].points);
  near(b.y0,180,2,'top');near(b.y1,240,2.5,'bottom stops at the tool, not the shadow');near(b.x0,120,2,'left');near(b.x1,540,2.5,'right');
});

test('large photographs are measured in their own coordinates',()=>{
  const width=2800,height=2000;
  const image=photo(ctx=>{foam(ctx,width,height);ctx.fillStyle='#0a0a0c';ctx.fillRect(300,600,2200,800);ctx.fillStyle='#d8dbde';ctx.fillRect(500,800,1800,400);},width,height);
  const [result]=refineContours(image,[seed(box(508,806,2292,1194))]);
  assert.equal(result.refined,true);
  const b=extent(result.points);
  near(b.x0,500,3,'left');near(b.x1,2300,3,'right');near(b.y0,800,3,'top');near(b.y1,1200,3,'bottom');
});

test('a straight tool is not inflated at any photo size',()=>{
  // Slit closing depends on the photo size; these sizes used to grow rectangles by 2-5 px per side.
  for(const [width,height] of [[1280,960],[1400,1050],[1400,933],[1000,750]]){
    const image=photo(ctx=>{foam(ctx,width,height);ctx.fillStyle='#0a0a0c';ctx.fillRect(260,360,680,200);ctx.fillStyle='#d8dbde';ctx.fillRect(300,400,600,120);},width,height);
    const [result]=refineContours(image,[seed(box(302,402,898,518))]),b=extent(result.points);
    near(b.x0,300,1,width+' left');near(b.x1,900,1,width+' right');near(b.y0,400,1,width+' top');near(b.y1,520,1,width+' bottom');
  }
});

test('close neighbours never overlap on a large photo',()=>{
  const width=1400,height=1050,image=photo(ctx=>{foam(ctx,width,height);ctx.fillStyle='#0a0a0c';ctx.fillRect(260,360,680,250);ctx.fillStyle='#d8dbde';ctx.fillRect(300,400,600,80);ctx.fillRect(300,486,600,80);},width,height);
  const result=refineContours(image,[seed(box(302,402,898,478)),seed(box(302,488,898,564))]);
  assert.ok(extent(result[0].points).y1<=extent(result[1].points).y0+.5,'the 6 px gap stays between the outlines');
});

test('a dark frame around the photo does not change the learned gap level',()=>{
  const width=1000,height=700,image=photo(ctx=>{
    ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.fillStyle='#141414';ctx.fillRect(9,9,width-18,height-18);
    ctx.fillStyle='#060606';ctx.fillRect(186,250,628,200);ctx.fillStyle='#c8c8c8';ctx.fillRect(200,270,600,160);
  },width,height);
  const [result]=refineContours(image,[seed(box(202,272,798,428))]),b=extent(result.points);
  near(b.x0,200,1.5,'left');near(b.x1,800,1.5,'right');
});

test('a tool cut by the photo edge is still measured',()=>{
  const image=photo(ctx=>{foam(ctx);ctx.fillStyle='#0a0a0c';ctx.fillRect(0,140,420,140);ctx.fillStyle='#d8dbde';ctx.fillRect(0,170,400,80);});
  const [result]=refineContours(image,[seed(box(0,172,398,248))]);
  assert.equal(result.refined,true);
  const b=extent(result.points);near(b.y0,170,1,'top');near(b.y1,250,1,'bottom');near(b.x1,400,1,'right');
});

test('a thin shaft of a seeded tool is never cut off',()=>{
  const image=photo(ctx=>{foam(ctx);ctx.fillStyle='#0a0a0c';ctx.fillRect(100,160,460,100);ctx.fillStyle='#d8dbde';ctx.fillRect(120,204,160,7);ctx.fillRect(280,190,260,36);});
  const outline=[{x:120,y:204},{x:280,y:204},{x:280,y:190},{x:540,y:190},{x:540,y:226},{x:280,y:226},{x:280,y:211},{x:120,y:211}];
  const [result]=refineContours(image,[seed(outline)]);
  near(extent(result.points).x0,120,2,'the shaft end is kept');
});

test('a shaded underside takes its width from the visible flank',()=>{
  const image=photo(ctx=>{
    foam(ctx);ctx.fillStyle='#030508';ctx.fillRect(40,150,520,130);
    ctx.fillStyle='#d8dbde';ctx.fillRect(60,205,260,20);    // the shaft shows the true axis, y=215
    ctx.fillStyle='#303030';ctx.fillRect(320,195,220,34);   // lit part of a black grip
    ctx.fillStyle='#07090b';ctx.fillRect(320,229,220,6);    // its underside fades into the recess
  });
  const outline=[{x:60,y:205},{x:320,y:205},{x:320,y:195},{x:540,y:195},{x:540,y:229},{x:320,y:229},{x:320,y:225},{x:60,y:225}];
  const [result]=refineContours(image,[seed(outline)]),b=extent(result.points);
  near(b.y0,195,2,'visible top');assert.ok(b.y1>=232.5,'the hidden flank mirrors the visible one: '+b.y1);
});

test('round tools become true circles',()=>{
  const image=photo(ctx=>{foam(ctx);ctx.fillStyle='#0a0a0c';ctx.beginPath();ctx.arc(320,210,110,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d8dbde';ctx.beginPath();ctx.arc(320,210,90,0,Math.PI*2);ctx.fill();});
  const noisy=Array.from({length:120},(_,i)=>{const a=i/120*Math.PI*2,r=90+2*Math.sin(a*7);return {x:320+r*Math.cos(a),y:210+r*Math.sin(a)};});
  const [result]=refineContours(image,[seed(noisy)]);
  assert.equal(result.fitted,true);
  for(const p of result.points)near(Math.hypot(p.x-320,p.y-210),90,1,'radius');
});

test('ribs on a black grip do not saw the outline',()=>{
  const image=photo(ctx=>{
    foam(ctx);ctx.fillStyle='#030508';ctx.fillRect(90,130,480,170);ctx.fillStyle='#1a1a1a';ctx.fillRect(120,170,420,80);
    ctx.fillStyle='#030508';for(let x=130;x<530;x+=14)for(const y of [170,246])ctx.fillRect(x,y,5,4);
    ctx.fillStyle='#d8dbde';ctx.fillRect(120,195,420,30);
  });
  const [result]=refineContours(image,[seed(box(122,174,538,246))]);
  const top=result.points.filter(p=>p.y<210&&p.x>160&&p.x<500).map(p=>p.y);
  assert.ok(Math.max(...top)-Math.min(...top)<=3,'spread '+(Math.max(...top)-Math.min(...top)));
});

test('a curved black handle on white keeps its curve',()=>{
  const flank=x=>30+28*Math.sin((x-120)/420*Math.PI),outline=[];
  for(let x=120;x<=540;x+=6)outline.push({x,y:210-flank(x)});
  for(let x=540;x>=120;x-=6)outline.push({x,y:210+flank(x)});
  const image=photo(ctx=>{ctx.fillStyle='#f4f2ee';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.fillStyle='#17171a';ctx.beginPath();outline.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();});
  const [result]=refineContours(image,[seed(outline)],{search:.008});
  for(const x of [200,260,330,400,460])assert.equal(inside(result.points,x,210-flank(x)+2),true,'no chord cuts the handle at '+x);
  for(const x of [200,260,330,400,460])assert.equal(inside(result.points,x,210-flank(x)-3),false,'no bulge at '+x);
});

test('an outline the photograph does not support keeps its seed',()=>{
  const image=photo(ctx=>foam(ctx));
  const original=seed(box(200,150,420,270)),[result]=refineContours(image,[original]);
  const b=extent(result.points);
  near(b.x0,200,5,'left');near(b.x1,420,5,'right');near(b.y0,150,5,'top');near(b.y1,270,5,'bottom');
});
