import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {recognizeTools} from '../dist/recognize.js';

function photo({gap=1,offset=0}={}){
  const canvas=createCanvas(600,320),ctx=canvas.getContext('2d');
  ctx.fillStyle='#3c3c3c';ctx.fillRect(0,0,600,320);
  ctx.fillStyle='#c8c8c8';ctx.fillRect(100,130,250,40);ctx.fillRect(356,130+offset,40,40);
  ctx.fillStyle='#141414';ctx.fillRect(350,130,6,40);
  ctx.fillStyle='#3c3c3c';ctx.fillRect(353,125,gap,50);
  return ctx.getImageData(0,0,600,320);
}

test('a compact end beside a shaft with an ambiguous seam remains a reviewable draft, never an automatic physical count',async()=>{
  const image=photo(),before=image.data.slice(),result=await recognizeTools(image,{pxPerMm:2});
  assert.equal(result.enhanced,'plain-background');
  assert.equal(result.contours.length,2,'review must preserve the observed separation');
  assert.equal(result.quality.status,'review');
  assert.ok(result.quality.reasons.some(reason=>reason.includes('stejnému nástroji')));
  assert.deepEqual(image.data,before);
});

test('a visible larger gap between a compact part and a whole shaft is retained',async()=>{
  const image=photo({gap:12}),result=await recognizeTools(image,{pxPerMm:2});
  assert.equal(result.contours.length,2);
  assert.equal(result.mask[150*image.width+358],0,'genuine background pixels are not connected by a quality check');
});
