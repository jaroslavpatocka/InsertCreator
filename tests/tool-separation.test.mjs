import test from 'node:test';
import assert from 'node:assert/strict';
import {autoTraceImage} from '../dist/auto-trace.js';
import {slantedScrewdriversPhoto,parallelScrewdriversPhoto,connectedScrewdriverPhoto,longitudinalHighlightPhoto,
  rasterizeContours,maskMetrics} from './fixtures/tool-photos.mjs';

function assertCompleteTools(result,im){
  const details=JSON.stringify({quality:result.quality,diagnostics:result.diagnostics});
  assert.equal(result.contours.length,im.toolMasks.length,'one contour per physical tool; '+details);
  const rendered=result.contours.map(contour=>rasterizeContours([contour],im.width,im.height));
  const unmatched=new Set(rendered.keys());
  for(const [i,truth] of im.toolMasks.entries()){
    const best=[...unmatched].map(index=>({index,...maskMetrics(rendered[index],truth)})).sort((a,b)=>b.iou-a.iou)[0];
    assert.ok(best.iou>.88,`tool ${i+1} silhouette IoU ${best.iou}; ${details}`);
    assert.ok(best.recall>.94,`tool ${i+1} silhouette coverage ${best.recall}`);
    const shaft=maskMetrics(rendered[best.index],im.shaftMasks[i]);
    assert.ok(shaft.recall>.94,`tool ${i+1} thin shaft coverage ${shaft.recall}; ${details}`);
    unmatched.delete(best.index);
  }
  const contoursMask=rasterizeContours(result.contours,im.width,im.height);
  assert.ok(maskMetrics(contoursMask,im.truth).iou>.90,'rendered contours must preserve the measured silhouettes; '+details);
  assert.ok(maskMetrics(result.mask,im.truth).iou>.90,'returned foreground mask must preserve the measured silhouettes; '+details);
  assert.equal(result.quality.status,'ready',details);
}

test('six separate slanted screwdrivers with overlapping bounds remain complete and ready',async()=>{
  const im=slantedScrewdriversPhoto();
  // Physical masks are separate despite strongly overlapping rectangular bounds.
  let overlap=0;for(let p=0;p<im.truth.length;p++)overlap+=+(im.toolMasks.reduce((sum,mask)=>sum+mask[p],0)>1);
  assert.equal(overlap,0);
  assertCompleteTools(await autoTraceImage(im,{pxPerMm:im.pxPerMm}),im);
});

for(const gap of [1,2,3])test(`two complete parallel screwdrivers keep their ${gap}px paper gap`,async()=>{
  const im=parallelScrewdriversPhoto({gap});
  assertCompleteTools(await autoTraceImage(im,{pxPerMm:im.pxPerMm}),im);
});

test('two touching colored handles separate along their visible contact edge without losing shafts',async()=>{
  const im=parallelScrewdriversPhoto({touching:true});
  assertCompleteTools(await autoTraceImage(im,{pxPerMm:im.pxPerMm}),im);
});

for(const degrees of [-30,30])test(`touching colored screwdrivers stay separate when the whole scene rotates ${degrees} degrees`,async()=>{
  const im=parallelScrewdriversPhoto({touching:true,angle:degrees*Math.PI/180});
  assertCompleteTools(await autoTraceImage(im,{pxPerMm:im.pxPerMm}),im);
});

test('one continuous screwdriver is not split along its enclosed longitudinal highlight',async()=>{
  const im=longitudinalHighlightPhoto();
  assertCompleteTools(await autoTraceImage(im,{pxPerMm:im.pxPerMm}),im);
});

test('a continuous screwdriver stays whole across metal, collar and handle color changes',async()=>{
  const im=connectedScrewdriverPhoto();
  assertCompleteTools(await autoTraceImage(im,{pxPerMm:im.pxPerMm}),im);
});
