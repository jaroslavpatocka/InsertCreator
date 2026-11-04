// Light tools on a dark case insert: synthetic photographs with a known truth, no pixels from any user photo.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {readableImage} from '../dist/photo-enhance.js';
import {recognizeTools} from '../dist/recognize.js';

const SIZE=800;
// A grid of socket-like tools: {x,y,w,h} in pixels. Heads carry dark engraving, as real sockets do.
const grid=(columns,rows,{x=130,y=210,w=30,h=120,gapX=45,gapY=40}={})=>Array.from({length:columns*rows},(_,i)=>({x:x+(i%columns)*(w+gapX),y:y+Math.floor(i/columns)*(h+gapY),w,h}));
function paintTools(ctx,tools){
  for(const t of tools){
    const shade=ctx.createLinearGradient(t.x,0,t.x+t.w,0);shade.addColorStop(0,'#a9adb1');shade.addColorStop(.5,'#e8eaec');shade.addColorStop(1,'#9b9fa3');
    ctx.fillStyle=shade;ctx.fillRect(t.x,t.y,t.w,t.h);
    ctx.fillStyle='#35383a';ctx.fillRect(t.x,t.y+t.h*.7,5,4);ctx.fillRect(t.x+t.w-5,t.y+t.h*.75,5,4);
  }
}
function caseImage(tools){
  const canvas=createCanvas(SIZE,SIZE),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,SIZE,SIZE);
  // Lid with a white card, a rail in the frame and a handle ring, as on a real case.
  ctx.fillStyle='#17181a';ctx.beginPath();ctx.roundRect(90,120,620,70,12);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(105,130,590,40);
  ctx.fillStyle='#17181a';ctx.beginPath();ctx.roundRect(90,180,620,440,18);ctx.fill();
  ctx.fillStyle='#b9bcbe';ctx.fillRect(200,184,400,5);
  ctx.strokeStyle='#17181a';ctx.lineWidth=7;ctx.beginPath();ctx.roundRect(290,620,220,46,10);ctx.stroke();
  paintTools(ctx,tools);
  return ctx.getImageData(0,0,SIZE,SIZE);
}
function matImage(tools){
  const canvas=createCanvas(SIZE,SIZE),ctx=canvas.getContext('2d');
  ctx.fillStyle='#1c1d1f';ctx.fillRect(0,0,SIZE,SIZE);paintTools(ctx,tools);
  return ctx.getImageData(0,0,SIZE,SIZE);
}
const asPlain=image=>({width:image.width,height:image.height,data:image.data});
const box=contour=>{const xs=contour.points.map(p=>p.x),ys=contour.points.map(p=>p.y);return{x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};};
const matched=(contours,tools,tolerance)=>tools.filter(t=>contours.some(c=>{const b=box(c);return Math.abs(b.x0-t.x)<=tolerance&&Math.abs(b.x1-t.x-t.w)<=tolerance&&Math.abs(b.y0-t.y)<=tolerance&&Math.abs(b.y1-t.y-t.h)<=tolerance;})).length;

test('the readable image keeps the size and only darkens the tools',()=>{
  const tools=grid(7,2),result=readableImage(asPlain(caseImage(tools)));
  assert.equal(result?.name,'dark-tray');assert.equal(result.image.width,SIZE);assert.equal(result.image.height,SIZE);
  const value=(x,y)=>result.image.data[(y*SIZE+x)*4];
  assert.ok(value(tools[0].x+15,tools[0].y+40)<60,'a tool becomes dark');
  assert.equal(value(110,600),255,'the foam becomes white');
  assert.equal(value(20,20),255,'the background stays white');
  assert.equal(value(400,186),255,'the rail in the case frame is not a tool');
  assert.equal(value(400,640),255,'the inside of the handle is not a tool');
});

test('a case with many tools is recognised tool by tool, at the true position and size',async()=>{
  const tools=grid(7,3,{h:100,gapY:30}),result=await recognizeTools(asPlain(caseImage(tools)),{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');
  assert.equal(result.quality.status,'ready',result.quality.reasons.join(' '));
  assert.equal(result.contours.length,tools.length,'more than 15 separate tools are not suspicious here');
  assert.equal(matched(result.contours,tools,3),tools.length,'every outline sits on its tool');
});

test('tools on a dark mat that fills the photograph are recognised too',async()=>{
  const tools=grid(5,2),result=await recognizeTools(asPlain(matImage(tools)),{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');assert.equal(result.contours.length,tools.length);
  assert.equal(matched(result.contours,tools,3),tools.length);
});

test('a dark tool with openings on paper is not mistaken for a case',()=>{
  const canvas=createCanvas(SIZE,SIZE),ctx=canvas.getContext('2d');
  ctx.fillStyle='#f6f6f4';ctx.fillRect(0,0,SIZE,SIZE);
  ctx.fillStyle='#141517';ctx.beginPath();ctx.roundRect(150,150,500,500,60);ctx.fill();
  ctx.fillStyle='#f6f6f4';for(const [x,y] of [[300,300],[500,300],[400,500]]){ctx.beginPath();ctx.arc(x,y,70,0,Math.PI*2);ctx.fill();}
  assert.equal(readableImage(asPlain(ctx.getImageData(0,0,SIZE,SIZE))),null);
});

test('ordinary photographs stay untouched',()=>{
  const canvas=createCanvas(SIZE,SIZE),ctx=canvas.getContext('2d');
  ctx.fillStyle='#f2f1ec';ctx.fillRect(0,0,SIZE,SIZE);ctx.fillStyle='#3b3f44';ctx.fillRect(200,300,400,50);ctx.fillRect(250,450,300,40);
  assert.equal(readableImage(asPlain(ctx.getImageData(0,0,SIZE,SIZE))),null,'dark tools on paper');
  ctx.fillStyle='#16171a';ctx.fillRect(0,0,SIZE,SIZE);
  assert.equal(readableImage(asPlain(ctx.getImageData(0,0,SIZE,SIZE))),null,'an empty dark surface');
});

test('a dark surface with too few recognisable pieces falls back to the normal recognition',async()=>{
  const tools=[{x:300,y:300,w:200,h:200}],result=await recognizeTools(asPlain(matImage(tools)),{pxPerMm:2});
  assert.equal(result.enhanced,undefined);
});
