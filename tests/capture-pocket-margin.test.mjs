import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePhotoGeometry,captureToolPoints,toolFromCaptureItem} from '../dist/capture-tools.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {effectivePocketMargin} from '../dist/pocket-margin.js';

const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
function item(extra={}){return{name:'Ráčna',checked:true,pocketShape:'hybrid',info:{minX:100,minY:200,center:{x:125,y:275}},contour:{points:rect(100,200,50,150)},...extra};}
const convert=draft=>toolFromCaptureItem(draft,{scale:2.5,depth:8,id:'tool',preservePosition:true});
const box=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
const close=(a,b)=>assert.ok(Math.abs(a-b)<.0002,`${a} != ${b}`);

test('capture stores only explicit per-tool margins and keeps zero distinct from inheritance',()=>{
  for(const inherited of [undefined,null]){
    const tool=convert(item({pocketMargin:inherited}));assert.equal(Object.hasOwn(tool,'pocketMargin'),false);
  }
  assert.equal(convert(item({pocketMargin:0})).pocketMargin,0);
  assert.equal(convert(item({pocketMargin:1.5})).pocketMargin,1.5);
  for(const invalid of ['', '1',false,true,NaN,Infinity,-.1,10.1,{},[]])assert.throws(()=>convert(item({pocketMargin:invalid})));
});

test('changing a module margin affects inherited pockets while one override stays local',()=>{
  const first=item({pocketMargin:0}),second=item(),before=[structuredClone(first),structuredClone(second)];
  const firstOne=box(capturePhotoGeometry(first,2.5,{includeMargin:true,pocketMargin:1}).points);
  const firstTwo=box(capturePhotoGeometry(first,2.5,{includeMargin:true,pocketMargin:2}).points);
  assert.deepEqual(firstOne,firstTwo,'an explicit zero ignores changes to the new module margin');
  const secondOne=box(capturePhotoGeometry(second,2.5,{includeMargin:true,pocketMargin:1}).points);
  const secondTwo=box(capturePhotoGeometry(second,2.5,{includeMargin:true,pocketMargin:2}).points);
  close((secondTwo.width-secondOne.width)/2.5,2);close((secondTwo.height-secondOne.height)/2.5,2);
  assert.deepEqual([first,second],before);
});

test('margin previews use the real manufacturing offset once and never inflate stored outlines or fit markers',()=>{
  for(const override of [undefined,0,.4,2]){
    const draft=item({pocketMargin:override}),before=structuredClone(draft),points=captureToolPoints(draft,2.5),tool=convert(draft);
    for(const common of [0,1,2,1,0]){
      const preview=capturePhotoGeometry(draft,2.5,{includeMargin:true,pocketMargin:common}).points.map(p=>({x:p.x/2.5,y:p.y/2.5}));
      const physical=pocketOutline(tool,effectivePocketMargin(tool,common)),a=box(preview),b=box(physical);
      for(const key of ['x','y','width','height'])close(a[key],b[key]);
      const margin=override??common;close(a.width,20+margin*2);close(a.height,60+margin*2);
      assert.deepEqual(captureToolPoints(draft,2.5),points);assert.deepEqual(convert(draft),tool);
    }
    assert.deepEqual(draft,before);assert.deepEqual(box(capturePhotoGeometry(draft,2.5).points),box(draft.contour.points),'the default geometry API remains unexpanded');
  }
});
