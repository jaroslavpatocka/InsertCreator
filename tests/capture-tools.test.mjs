import test from 'node:test';
import assert from 'node:assert/strict';
import {captureToolPoints,captureItemDimensions,resizeCaptureItem,toolFromCaptureItem} from '../dist/capture-tools.js';

const item=()=>({name:'  Klíč 13 mm  ',checked:true,category:'wrenches',sizeLabel:'13 mm',info:{minX:50,minY:70},contour:{points:[{x:50,y:70},{x:90.913578,y:70},{x:90.913578,y:270},{x:50,y:270}]}});

test('photo drafts preserve calibration and metadata without inventing nominal sizes',()=>{
  const draft=item(),before=structuredClone(draft),tool=toolFromCaptureItem(draft,{scale:2,depth:9.5,id:'tool'});
  assert.deepEqual(draft,before);
  assert.equal(tool.name,'Klíč 13 mm');assert.equal(tool.category,'wrenches');assert.equal(tool.sizeLabel,'13 mm');
  assert.equal(tool.depth,9.5);assert.equal(tool.nominalSize,undefined);
  assert.deepEqual(new Set(tool.points.map(point=>`${point.x},${point.y}`)),new Set(['0,0','20.4568,0','20.4568,100','0,100']));
  assert.deepEqual([tool.x,tool.y,tool.rotation,tool.moduleId],[0,0,0,null]);
});

test('an explicit length correction preserves exact width and photo geometry, while a failed correction is atomic',()=>{
  const draft=item(),photo=structuredClone(draft.contour),before=captureItemDimensions(draft,2);
  resizeCaptureItem(draft,2,{length:127});
  const measured=captureItemDimensions(draft,2);
  assert.ok(Math.abs(measured.length-127)<1e-8);assert.ok(Math.abs(measured.width-before.width)<1e-8);
  assert.deepEqual(draft.contour,photo);
  const valid=structuredClone(draft.editedPoints);
  assert.throws(()=>resizeCaptureItem(draft,2,{width:0}));assert.deepEqual(draft.editedPoints,valid);
  const exported=captureToolPoints(draft,2);exported[0].x=999;
  assert.deepEqual(draft.editedPoints,valid,'exported points cannot change the live manufacturing draft');
});

test('photo tool conversion rejects unsupported categories and overlong labels',()=>{
  assert.throws(()=>toolFromCaptureItem({...item(),category:'invalid'},{scale:2,depth:12,id:'a'}));
  assert.throws(()=>toolFromCaptureItem({...item(),sizeLabel:'x'.repeat(25)},{scale:2,depth:12,id:'a'}));
  const automatic=toolFromCaptureItem({...item(),category:'',sizeLabel:''},{scale:2,depth:12,id:'a'});
  assert.equal(Object.hasOwn(automatic,'category'),false);assert.equal(Object.hasOwn(automatic,'sizeLabel'),false);
});
