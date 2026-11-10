import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectPhotoRegion} from '../dist/photo-selection.js';

test('a small explicit selection on opaque native RGBA above16MP preserves full-source pixels and coordinates',{timeout:30000},async()=>{
 const width=4001,height=4000,data=new Uint8ClampedArray(width*height*4),backgroundPixel=[190,195,200,255];
 for(let p=0;p<width*height;p++)data.set(backgroundPixel,p*4);
 const tool={x:3500,y:3333,width:37,height:11};for(let y=tool.y;y<tool.y+tool.height;y++)for(let x=tool.x;x<tool.x+tool.width;x++)data.set([30,34,39,255],(y*width+x)*4);
 const roi={x:3490,y:3323,width:57,height:31},foreground=[],background=[];
 // Explicit synthetic user brush strokes, not a prediction or model fixture.
 for(let x=3502;x<=3534;x++)foreground.push({x,y:3338,r:1});
 for(let x=3493;x<=3544;x++){background.push({x,y:3328,r:1});background.push({x,y:3349,r:1});}
 for(let y=3328;y<=3349;y++){background.push({x:3494,y,r:1});background.push({x:3543,y,r:1});}
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(data),seedSnapshot=JSON.stringify({roi,foreground,background}),previousWorker=globalThis.Worker;let workers=0;
 globalThis.Worker=class{constructor(){workers++;throw Error('Deterministic ROI selection must never start an inference worker');}};
 try{
  const result=await selectPhotoRegion({width,height,data},{roi,foreground,background,lighting:'original'});
  assert.equal(result.width,width);assert.equal(result.height,height);assert.ok(result.mask instanceof Uint8Array);assert.equal(result.mask.length,width*height);assert.equal(result.contours.length,1);
  const contour=result.contours[0],xs=contour.points.map(point=>point.x),ys=contour.points.map(point=>point.y);assert.deepEqual({x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)},{x0:3500,x1:3537,y0:3333,y1:3344});assert.equal(contour.width,37);assert.equal(contour.height,11);assert.equal(contour.area,407);
  let selected=0,outside=0;for(let p=0;p<result.mask.length;p++)if(result.mask[p]){selected++;const x=p%width,y=Math.floor(p/width);outside+=+(x<roi.x||x>=roi.x+roi.width||y<roi.y||y>=roi.y+roi.height);assert.ok(x>=tool.x&&x<tool.x+tool.width&&y>=tool.y&&y<tool.y+tool.height,'every selected source pixel belongs to the declared37x11control');}
  assert.equal(selected,407);assert.equal(outside,0);for(const point of foreground)assert.equal(result.mask[point.y*width+point.x],1);for(const point of background)assert.equal(result.mask[point.y*width+point.x],0);
  assert.equal(result.quality.status,'review');assert.deepEqual(result.diagnostics.roi,roi);assert.equal(result.diagnostics.lighting.method,'original');assert.equal(result.diagnostics.sourceCoordinates,true);assert.equal(JSON.stringify({roi,foreground,background}),seedSnapshot);assert.equal(hash(data),before);assert.equal(data.byteLength,width*height*4);assert.equal(workers,0);
 }finally{if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;}
});
