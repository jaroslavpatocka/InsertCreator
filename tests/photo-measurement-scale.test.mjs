import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {recognizeTools} from '../dist/recognize.js';
import {captureItemDimensions,toolFromCaptureItem} from '../dist/capture-tools.js';

// Independent physical truth: a 250 x 50 pixel silver rectangle at 2.5 px/mm
// is exactly 100 x 20 mm. Recognition consumes real RGB pixels, with no Worker
// fixture generating contours from the scale supplied by the implementation.
for(const degrees of [0,37])test(`original photo edges preserve a 100 x 20 mm tool at ${degrees} degrees`,async()=>{
  assert.equal(typeof globalThis.Worker,'undefined','this regression runs the actual local recognizer');
  const canvas=createCanvas(1400,1050),context=canvas.getContext('2d');
  context.fillStyle='#fff';context.fillRect(0,0,1400,1050);
  context.save();context.translate(400,300);context.rotate(degrees*Math.PI/180);
  context.fillStyle='#bfc3c7';context.fillRect(0,0,250,50);context.restore();
  const image=context.getImageData(0,0,1400,1050),original=new Uint8ClampedArray(image.data);
  const result=await recognizeTools(image,{pxPerMm:2.5,kind:'reference'});
  assert.deepEqual(image.data,original,'recognition cannot alter the source photograph');
  assert.equal(result.method,'physical-instances');assert.equal(result.quality.status,'ready');
  assert.equal(result.contours.length,1,'the entire physical tool remains one outline');
  const contour=result.contours[0];
  assert.notEqual(contour.fitted,true,'a measured photo edge is independent of manufacturing shape fitting');
  const item={name:'Independent 100 x 20 mm rectangle',pocketShape:'measured',contour,info:{minX:Math.min(...contour.points.map(p=>p.x)),minY:Math.min(...contour.points.map(p=>p.y))}};
  const measured=captureItemDimensions(item,2.5),tool=toolFromCaptureItem(item,{scale:2.5,depth:7,id:'physical-tool'});
  for(const [label,actual,expected] of [['length',measured.length,100],['width',measured.width,20]]){
    assert.ok(Math.abs(actual-expected)<.25,`source-measured ${label} ${actual} mm differs from physical ${expected} mm`);
  }
  assert.ok(tool.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
});
