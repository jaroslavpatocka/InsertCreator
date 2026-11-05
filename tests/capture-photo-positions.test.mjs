import test from 'node:test';
import assert from 'node:assert/strict';
import {captureToolPoints,resizeCaptureItem,toolFromCaptureItem} from '../dist/capture-tools.js';
import {bounds,transformedPoints} from '../dist/geometry.js';
import {blankProject,validateProject} from '../dist/model.js';

const rect=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
const item=(x=125,y=225,width=50,height=250)=>({name:'  Klíč  ',category:'wrenches',sizeLabel:'13 mm',info:{minX:x,minY:y},contour:{points:rect(x,y,width,height)}});
const convert=(draft,extra={})=>toolFromCaptureItem(draft,{scale:2.5,depth:8,id:'photo-tool',preservePosition:true,...extra});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const center=tool=>{const b=bounds(tool);return{x:b.x+b.width/2,y:b.y+b.height/2};};

test('preserved capture positions use calibrated millimetres without a flip or rotation',()=>{
  const draft=item(),before=structuredClone(draft),tool=convert(draft);
  assert.deepEqual([tool.x,tool.y,tool.rotation],[50,90,0]);
  const expected=draft.contour.points.map(point=>({x:point.x/2.5,y:point.y/2.5}));
  assert.deepEqual(new Set(transformedPoints(tool).map(point=>JSON.stringify(point))),new Set(expected.map(point=>JSON.stringify(point))));
  assert.equal(tool.name,'Klíč');assert.equal(tool.category,'wrenches');assert.equal(tool.sizeLabel,'13 mm');assert.equal(tool.depth,8);
  assert.deepEqual(draft,before);
});

test('the default and an explicit disabled choice retain standalone tool coordinates',()=>{
  const draft=item();
  for(const preservePosition of [undefined,false]){
    const tool=toolFromCaptureItem(draft,{scale:2.5,depth:8,id:'standalone',preservePosition});
    assert.deepEqual([tool.x,tool.y,tool.rotation],[0,0,0]);
    assert.deepEqual(tool.points,captureToolPoints(draft,2.5));
  }
});

test('resizing a captured tool repeatedly keeps its original photo centre',()=>{
  const draft=item(),original=structuredClone(draft.contour),expected=center(convert(draft));
  resizeCaptureItem(draft,2.5,{length:150,width:30});
  let tool=convert(draft),b=bounds(tool);
  close(b.width,30);close(b.height,150);close(center(tool).x,expected.x);close(center(tool).y,expected.y);
  resizeCaptureItem(draft,2.5,{length:125,width:25});
  tool=convert(draft);b=bounds(tool);
  close(b.width,25);close(b.height,125);close(center(tool).x,expected.x);close(center(tool).y,expected.y);
  assert.deepEqual(draft.contour,original,'calibration pixels remain unchanged by size correction');
  assert.deepEqual([tool.rotation,tool.moduleId,tool.locked],[0,null,false]);
});

test('edited outlines with a negative local origin preserve photo centre through model normalization',()=>{
  const draft=item(-25,50,50,100);
  draft.editedPoints=rect(-10,-20,30,60);
  const before=structuredClone(draft),tool=convert(draft),expected={x:0,y:40};
  close(center(tool).x,expected.x);close(center(tool).y,expected.y);
  assert.deepEqual([tool.x,tool.y],[-15,10]);
  const restored=validateProject({...blankProject(),tools:[tool]}).tools[0];
  assert.deepEqual(transformedPoints(restored),transformedPoints(tool));
  assert.deepEqual(draft,before,'conversion never normalizes or changes the capture draft itself');
});

test('asymmetric outlines retain their photo geometry and the offsets between selected tools',()=>{
  const draft=item(20,40,100,200);
  draft.contour.points=[{x:20,y:40},{x:120,y:40},{x:120,y:80},{x:60,y:80},{x:60,y:240},{x:20,y:240}];
  const other=item(220,490,50,150),first=convert(draft),second=convert(other,{id:'second'});
  close(second.x-first.x,80);close(second.y-first.y,180);
  const expected=draft.contour.points.map(point=>({x:point.x/2.5,y:point.y/2.5}));
  assert.deepEqual(new Set(transformedPoints(first).map(point=>JSON.stringify(point))),new Set(expected.map(point=>JSON.stringify(point))));
  first.points[0].x=999;
  assert.equal(draft.contour.points[0].x,20,'the returned contour is independent of the capture pixels');
});
