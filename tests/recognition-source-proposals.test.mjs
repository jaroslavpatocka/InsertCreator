import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {autoTraceImage} from '../dist/auto-trace.js';
import {getToolDimensions} from '../dist/tool-dimensions.js';

test('all RGB proposal methods retain original photo coordinates after internal downsampling',async()=>{
  const canvas=createCanvas(1400,1050),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.translate(400,300);ctx.rotate(37*Math.PI/180);ctx.fillStyle='#bfc3c7';ctx.fillRect(0,0,250,50);ctx.restore();
  const image=ctx.getImageData(0,0,canvas.width,canvas.height),source=new Uint8ClampedArray(image.data);
  const options={pxPerMm:2.5,kind:'reference',source:image};
  const baseline=await autoTraceImage(image,options),collected=await autoTraceImage(image,{...options,collectProposals:true});
  assert.equal(baseline.sourceProposals,undefined,'ordinary callers keep the existing result contract');
  assert.equal(collected.method,baseline.method);assert.deepEqual(collected.contours,baseline.contours);assert.deepEqual(collected.mask,baseline.mask);assert.deepEqual(collected.quality,baseline.quality);
  assert.deepEqual(image.data,source,'collecting alternatives cannot edit the photograph');
  assert.ok(collected.diagnostics.processingWidth<image.width,'this scene exercises actual internal resizing');
  assert.deepEqual(collected.sourceProposals.map(proposal=>proposal.method).sort(),['edge-flood','local-contrast','paper-color']);
  const expectedCorners=[{x:0,y:0},{x:250,y:0},{x:250,y:50},{x:0,y:50}].map(p=>({x:400+p.x*Math.cos(37*Math.PI/180)-p.y*Math.sin(37*Math.PI/180),y:300+p.x*Math.sin(37*Math.PI/180)+p.y*Math.cos(37*Math.PI/180)}));
  const box=points=>({x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))}),expected=box(expectedCorners);
  for(const proposal of collected.sourceProposals){
    assert.ok(Number.isFinite(proposal.score)&&Number.isFinite(proposal.boundaryCoverage));
    assert.equal(proposal.contours.length,1,'one independently drawn visible rectangle');
    const actual=box(proposal.contours[0].points);
    for(const key of Object.keys(expected))assert.ok(Math.abs(actual[key]-expected[key])<3,`${proposal.method} ${key} is in source pixels: ${actual[key]}, expected ${expected[key]}`);
    const measured=getToolDimensions({points:proposal.contours[0].points.map(p=>({x:p.x/2.5,y:p.y/2.5}))});
    assert.ok(Math.abs(measured.length-100)<1&&Math.abs(measured.width-20)<1,`${proposal.method} source scale ${measured.length}x${measured.width}mm`);
  }
  assert.deepEqual(collected.sourceProposals.find(proposal=>proposal.method===collected.method).contours,collected.contours,'the selected method retains its source-refined output');
});
