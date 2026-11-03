import test from 'node:test';
import assert from 'node:assert/strict';
import {autoTraceImage} from '../dist/auto-trace.js';
import {parallelScrewdriversPhoto,maskMetrics,rasterizeContours} from './fixtures/tool-photos.mjs';

test('a solid bar painted in two longitudinal colors remains one physical outline',async()=>{
  const width=260,height=440,data=new Uint8ClampedArray(width*height*4),truth=new Uint8Array(width*height);
  for(let i=0;i<truth.length;i++)data.set([250,250,248,255],i*4);
  for(let y=50;y<390;y++)for(let x=80;x<160;x++){
    const p=y*width+x;data.set(x<120?[197,43,40,255]:[217,179,41,255],p*4);truth[p]=1;
  }
  const result=await autoTraceImage({width,height,data},{pxPerMm:2});
  assert.equal(result.contours.length,1,'a color boundary without an external paper gap must not invent another tool');
  assert.equal(result.quality.status,'ready',JSON.stringify(result.quality));
  assert.ok(maskMetrics(rasterizeContours(result.contours,width,height),truth).iou>.98);
});

test('touching handles separate when independently visible shafts provide paper-gap evidence',async()=>{
  const image=parallelScrewdriversPhoto({touching:true});
  const result=await autoTraceImage(image,{pxPerMm:image.pxPerMm});
  assert.equal(result.contours.length,2);
  assert.equal(result.quality.status,'ready',JSON.stringify(result.quality));
  const masks=result.contours.map(contour=>rasterizeContours([contour],image.width,image.height));
  for(const [i,truth] of image.toolMasks.entries()){
    const best=masks.map(mask=>({mask,...maskMetrics(mask,truth)})).sort((a,b)=>b.iou-a.iou)[0];
    assert.ok(best.iou>.88,'each separated contour must preserve one complete tool');
    assert.ok(maskMetrics(best.mask,image.shaftMasks[i]).recall>.94,'the independent shaft must remain complete');
  }
});

test('two complete variable-width screwdrivers remain separate across a small end-to-end gap',async()=>{
  for(const gap of [1,2,3]){
    const width=260,height=440,data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<width*height;i++)data.set([250,250,248,255],i*4);
    const paint=(x,y,w,h,color)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)data.set([...color,255],(yy*width+xx)*4);};
    for(const y of [40,210+gap]){paint(126,y,8,110,[75,80,85]);paint(115,y+100,30,70,[180,45,35]);}
    const result=await autoTraceImage({width,height,data},{pxPerMm:2});
    assert.equal(result.contours.length,2,`two complete tools must not merge across a ${gap}px paper gap`);
    assert.equal(result.quality.status,'ready',JSON.stringify(result.quality));
    assert.ok(result.contours.every(contour=>contour.height>=169&&contour.height<=171));
  }
});
