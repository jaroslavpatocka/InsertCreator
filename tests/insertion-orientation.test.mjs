import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,transformedPoints,validateLayout} from '../dist/geometry.js';
import {addToolGroup,splitForBed} from '../dist/set-module.js';
import {toolFromCaptureItem} from '../dist/capture-tools.js';
import {photoLayout,separateModulesFit} from '../dist/photo-layout.js';

const drawer=extra=>({...blankProject(),width:504,height:378,...extra});
const normalized=points=>{const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return points.map(p=>[p.x-x,p.y-y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);};
function photographed(id,degrees=45){
  const r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const contour=[{x:0,y:0},{x:95,y:0},{x:110,y:8},{x:95,y:16},{x:0,y:16}].map(p=>({x:200+2*(p.x*c-p.y*s),y:200+2*(p.x*s+p.y*c)}));
  const item={name:id,info:{minX:Math.min(...contour.map(p=>p.x)),minY:Math.min(...contour.map(p=>p.y))},contour:{points:contour},pocketShape:'measured'};
  return {...toolFromCaptureItem(item,{scale:2,id,depth:8}),fingerGrips:[]};
}
function sameAngle(source,actual){assert.equal(actual.rotation,source.rotation,'placement keeps the source rotation');const expected=normalized(transformedPoints(source)),got=normalized(transformedPoints(actual));assert.equal(got.length,expected.length);for(let i=0;i<got.length;i++)for(let axis=0;axis<2;axis++)assert.ok(Math.abs(got[i][axis]-expected[i][axis])<.001,'the complete world contour may translate but cannot rotate or mirror');}

test('45 degree photo contours keep their angle in shared, separate and uniform insertion, including JSON reload',()=>{
  const tools=[photographed('a',45),photographed('b',-27)],before=structuredClone(tools),project=drawer();
  for(const layout of ['shared','auto','uniform']){
    const result=addToolGroup(project,tools,{preserveOrientation:true,arrangement:'ordered',toolSet:{name:'Photo',layout}});
    assert.equal(result.placed,true);assert.deepEqual(validateLayout(result.project),[]);
    const reloaded=validateProject(JSON.parse(JSON.stringify(result.project)));
    for(const source of tools)sameAngle(source,reloaded.tools.find(tool=>tool.id===source.id));
  }
  assert.deepEqual(tools,before);assert.equal(project.tools.length,0);
});

test('source orientation also survives compact and print-bed fallback packing',()=>{
  const tools=[photographed('a',45),photographed('b',-27)],project=drawer();
  for(const method of [addToolGroup,splitForBed]){
    const result=method(project,tools,{preserveOrientation:true,arrangement:'compact',bedWidth:220,bedHeight:220});
    assert.equal(result.placed,true);assert.deepEqual(validateLayout(result.project),[]);
    for(const source of tools)sameAngle(source,result.project.tools.find(tool=>tool.id===source.id));
    if(result.diagonal)assert.deepEqual(result.diagonal,[]);
  }
});

test('insertion only fixes incoming angles while an explicit automatic arrangement can optimize',()=>{
  const horizontal={...photographed('bar',0),points:[{x:0,y:0},{x:16,y:0},{x:16,y:110},{x:0,y:110}],rotation:0};
  const project=drawer({tools:[horizontal]});
  const placed=autoArrange(project,{preserveOrientationIds:['bar']});
  sameAngle(horizontal,placed.tools[0]);assert.deepEqual(validateLayout({...project,...placed}),[]);
  const explicit=autoArrange(project);
  assert.equal(explicit.tools[0].rotation,90,'the explicit Auto command retains its optimization');
});

test('photo fitting probes measure the preserved orientations instead of assuming a straightened tool',()=>{
  const vertical={...photographed('bar',0),points:[{x:0,y:0},{x:16,y:0},{x:16,y:110},{x:0,y:110}],rotation:0};
  assert.equal(separateModulesFit(drawer({width:168,height:42}),[vertical]),false,'source orientation cannot fit this short drawer');
  assert.deepEqual(photoLayout(drawer({width:168,height:42}),[vertical],'auto'),{layout:'each'});
  const plan=photoLayout(drawer(),[photographed('a'),photographed('b',-27)],'shared');assert.equal(plan.layout,'shared');
});
