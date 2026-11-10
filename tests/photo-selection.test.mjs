import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectPhotoRegion,traceBoundarySegment,tracePhotoBoundary} from '../dist/photo-selection.js';
const sha=data=>createHash('sha256').update(data).digest('hex');
function image(width=160,height=100){const data=new Uint8ClampedArray(width*height*4).fill(255);return{width,height,data};}
function rect(photo,x0,y0,x1,y1,rgb){for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)photo.data.set([...rgb,255],(y*photo.width+x)*4);}
function inside(x,y,points){let odd=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a.y>y)!==(b.y>y)&&x<a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y))odd=!odd;}return odd;}
const selected=(result,x,y)=>!!result.mask[y*result.width+x];

test('source RGB and hard labels select a complete coloured object without moving the photo',async()=>{
 const photo=image();rect(photo,30,25,125,75,[180,35,50]);const before=sha(photo.data),result=await selectPhotoRegion(photo,{foreground:[{x:60,y:45}],background:[{x:10,y:10}]});
 assert.equal(sha(photo.data),before);assert.equal(result.width,160);assert.equal(result.height,100);assert.equal(result.contours.length,1);
 for(const[x,y]of[[31,26],[124,74],[70,50]])assert.ok(selected(result,x,y)&&inside(x+.5,y+.5,result.contours[0].points));
 assert.equal(selected(result,20,40),false);assert.equal(result.diagnostics.hardSeedValidation,true);
});

test('several material colours and a one-pixel visible connector remain one selected body',async()=>{
 const photo=image();rect(photo,20,35,65,65,[170,35,45]);rect(photo,65,49,95,50,[135,140,145]);rect(photo,95,30,140,70,[35,70,180]);
 const result=await selectPhotoRegion(photo,{foreground:[{x:40,y:50},{x:80,y:49},{x:115,y:50}],background:[{x:10,y:10}],lighting:'original'});
 assert.equal(result.contours.length,1);for(let x=65;x<95;x++)assert.ok(selected(result,x,49),'full resolution connector material');assert.equal(selected(result,80,45),false);
});

for(const gap of[2,6,20])test(`an actual ${gap}px source gap and its negative stroke remain open`,async()=>{
 const photo=image(180,100);rect(photo,20,30,80,70,[190,35,45]);rect(photo,80+gap,30,140+gap,70,[190,35,45]);const result=await selectPhotoRegion(photo,{foreground:[{x:45,y:50},{x:110+gap,y:50}],background:[{x:80+gap/2,y:50,r:0}],lighting:'original'});
 assert.equal(result.contours.length,2);for(let x=80;x<80+gap;x++)for(let y=35;y<65;y++)assert.equal(selected(result,x,y),false,'visible background must not become a bridge');
 assert.ok(result.contours.every(c=>!inside(80+gap/2,50,c.points)));
});

test('ROI and brush disks stay in original source coordinates and never escape the selected crop',async()=>{
 const photo=image();rect(photo,55,30,85,60,[30,80,180]);const result=await selectPhotoRegion(photo,{roi:{x:40,y:20,width:65,height:55},foreground:[{x:70,y:45,r:2}],background:[{x:45,y:25,r:1}],lighting:'original'});
 assert.equal(result.contours.length,1);assert.ok(result.contours[0].points.every(p=>p.x>=40&&p.x<=105&&p.y>=20&&p.y<=75));assert.ok(selected(result,70,45));
 for(let y=0;y<photo.height;y++)for(let x=0;x<photo.width;x++)if(x<40||x>=105||y<20||y>=75)assert.equal(selected(result,x,y),false);
});

test('conflicting labels and seeds outside the ROI are rejected instead of silently changing user intent',async()=>{
 const photo=image();await assert.rejects(selectPhotoRegion(photo,{foreground:[{x:40,y:40,r:3}],background:[{x:42,y:40,r:3}]}),/překrývají/);
 await assert.rejects(selectPhotoRegion(photo,{roi:{x:20,y:20,width:50,height:40},foreground:[{x:10,y:10}]}),/mimo/);
 await assert.rejects(selectPhotoRegion(photo,{foreground:[]}),/alespoň/);
});

test('an explicitly marked shadow stays background while black body and enclosed white glare survive',async()=>{
 const photo=image();rect(photo,35,25,120,75,[25,28,30]);rect(photo,120,30,140,80,[165,165,165]);rect(photo,65,40,90,60,[255,255,255]);
 const result=await selectPhotoRegion(photo,{foreground:[{x:45,y:45}],background:[{x:130,y:50,r:2}]});
 assert.ok(selected(result,45,45));assert.ok(selected(result,75,50),'an enclosed white reflection must not split the selected opaque body');assert.equal(selected(result,130,50),false);assert.equal(result.contours.length,1);
 assert.equal(result.contours.some(c=>inside(130.5,50.5,c.points)),false);
});

test('a deliberately marked one-pixel part is retained rather than discarded by area filtering',async()=>{
 const photo=image(40,30);rect(photo,20,15,21,16,[30,70,190]);const result=await selectPhotoRegion(photo,{foreground:[{x:20,y:15}],background:[{x:2,y:2}],lighting:'original'});
 assert.ok(selected(result,20,15));assert.equal(result.contours.length,1);assert.ok(inside(20.5,15.5,result.contours[0].points));
});

test('an explicitly subtracted interior cannot silently reappear in the exported outer polygon',async()=>{
 const photo=image();rect(photo,25,20,135,80,[35,40,45]);const result=await selectPhotoRegion(photo,{foreground:[{x:65,y:50},{x:95,y:50},{x:80,y:35},{x:80,y:65}],background:[{x:80,y:50,r:1}],lighting:'original'});
 assert.equal(selected(result,80,50),false);assert.ok(result.diagnostics.protectedInteriorHoles>0);assert.equal(result.contours.length,0);assert.equal(result.quality.needsManual,true);assert.equal(result.quality.status,'retake');
});

test('weak image evidence remains explicitly reviewable instead of a confident invented object',async()=>{
 const photo=image(80,60),result=await selectPhotoRegion(photo,{foreground:[{x:40,y:30}],background:[{x:2,y:2}],lighting:'original'});
 assert.equal(result.quality.status,'review');assert.equal(result.quality.needsManual,true);
});

test('livewire preserves exact user anchors and follows a visible source edge',async()=>{
 const photo=image(150,100);rect(photo,25,25,125,75,[30,40,50]);const from={x:25,y:25},to={x:125,y:25},result=await traceBoundarySegment(photo,from,to,{lighting:'original'});
 assert.deepEqual(result.points[0],from);assert.deepEqual(result.points.at(-1),to);assert.equal(result.diagnostics.fallback,false);assert.ok(result.points.every(p=>Math.abs(p.y-25)<=2));
});

test('closed magnetic boundary produces a valid source contour and an explicit blank-image fallback',async()=>{
 const photo=image(150,100);rect(photo,25,25,125,75,[30,40,50]);const points=[{x:25,y:25},{x:125,y:25},{x:125,y:75},{x:25,y:75}],result=await tracePhotoBoundary(photo,{points,lighting:'original'});
 assert.equal(result.contours.length,1);assert.ok(selected(result,75,50));assert.equal(selected(result,10,10),false);assert.equal(result.diagnostics.valid,true);
 const blank=await tracePhotoBoundary(image(150,100),{points,lighting:'original'});assert.equal(blank.contours.length,1);assert.equal(blank.quality.needsManual,true);assert.ok(blank.diagnostics.segments.every(segment=>segment.fallback&&segment.reason==='no-visible-edge'));
});

test('cancellation is observed both before work and after yielding to the UI',async()=>{
 const photo=image(300,200);rect(photo,50,40,240,160,[160,35,50]);const controller=new AbortController();controller.abort();await assert.rejects(selectPhotoRegion(photo,{foreground:[{x:80,y:80}],signal:controller.signal}),{name:'AbortError'});
 const during=new AbortController();await assert.rejects(selectPhotoRegion(photo,{foreground:[{x:80,y:80}],signal:during.signal,onProgress(){during.abort();}}),{name:'AbortError'});
 await assert.rejects(tracePhotoBoundary(photo,{points:[{x:50,y:40},{x:240,y:40},{x:240,y:160}],signal:controller.signal}),{name:'AbortError'});
});
