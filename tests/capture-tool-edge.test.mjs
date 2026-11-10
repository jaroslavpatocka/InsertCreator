import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCaptureEdit,getCaptureEditModel,insertContourNode,moveContourNode,limitCaptureEdit,checkCaptureEditSafety} from '../dist/capture-contour-edit.js';
import {resizeCaptureItem,toolFromCaptureItem,prepareCaptureFit} from '../dist/capture-tools.js';

const rectangle=[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:0,y:50}];
function item(shape=rectangle){return{name:'Tool',depth:'8',pocketShape:'measured',checked:true,pocketMargin:0,info:{minX:120,minY:210},contour:{points:shape.map(p=>({x:120+p.x*2,y:210+p.y*2}))}};}
const blocked=error=>error.code==='CAPTURE_TOOL_EDGE';

test('the atomic edit gate refuses an inward corner without modifying any item field',()=>{
 const draft=item(),before=structuredClone(draft),model=getCaptureEditModel(draft,2),index=model.nodes.findIndex(p=>p.x===100&&p.y===0);
 assert.throws(()=>applyCaptureEdit(draft,2,moveContourNode(model,index,{x:90,y:5})),blocked);assert.deepEqual(draft,before);
});

test('a pointer constraint consumes only outward room and cannot erode its reference over repeated attempts',()=>{
 const draft=item(),created=insertContourNode(getCaptureEditModel(draft,2),{x:50,y:0}),expanded=moveContourNode(created.model,created.index,{x:50,y:-5});applyCaptureEdit(draft,2,expanded);
 let current=expanded;
 for(let i=0;i<30;i++){
  const requested=moveContourNode(current,created.index,{x:50,y:20}),limited=limitCaptureEdit(draft,2,current,requested);
  assert.equal(limited.limited,true);assert.ok(limited.model.nodes[created.index].y<=.000101);applyCaptureEdit(draft,2,limited.model);assert.equal(checkCaptureEditSafety(draft,2,limited.model).safe,true);current=limited.model;
 }
 assert.deepEqual(draft.contour,item().contour);assert.equal(draft.pocketMargin,0);
});

test('numeric resize rejects a smaller body and an enlarged concave shape that removes a real shoulder',()=>{
 for(const [draft,dimensions] of [[item(),{length:80}],[item([{x:0,y:0},{x:30,y:0},{x:30,y:30},{x:15,y:30},{x:15,y:60},{x:0,y:60}]),{length:80}]]){
  const before=structuredClone(draft);assert.throws(()=>resizeCaptureItem(draft,2,dimensions),blocked);assert.deepEqual(draft,before);
 }
});

test('manufacturing allowance cannot conceal a legacy edited silhouette that cuts into the tool',()=>{
 const draft=item();draft.editedPoints=[{x:1,y:1},{x:99,y:1},{x:99,y:49},{x:1,y:49}];draft.contourEditOrigin={x:120,y:210};draft.pocketMargin=100;
 const before=structuredClone(draft);assert.throws(()=>toolFromCaptureItem(draft,{scale:2,depth:8,id:'tool'}),blocked);assert.deepEqual(draft,before);
});

test('switching a legacy undersized edited fit to measured cannot bypass the source floor',()=>{
 const draft=item();draft.pocketShape='ideal';draft.editedPoints=[{x:.5,y:.25},{x:99.5,y:.25},{x:99.5,y:49.75},{x:.5,y:49.75}];draft.contourEditOrigin={x:120,y:210};
 const before=structuredClone(draft);assert.throws(()=>prepareCaptureFit({...draft,pocketShape:'measured'},2),blocked);assert.deepEqual(draft,before);
});

test('outward numeric growth stays usable and preserves the source, scale and separate clearance',()=>{
 const draft=item(),source=structuredClone(draft.contour);draft.pocketMargin=.8;resizeCaptureItem(draft,2,{length:120});const tool=toolFromCaptureItem(draft,{scale:2,depth:8,id:'tool'});
 assert.ok(Math.abs(Math.max(...tool.points.map(p=>p.x))-Math.min(...tool.points.map(p=>p.x))-120)<1e-6);assert.deepEqual(draft.contour,source);assert.equal(draft.pocketMargin,.8);assert.equal(tool.pocketMargin,.8);
});
