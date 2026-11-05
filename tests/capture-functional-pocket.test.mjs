import test from 'node:test';
import assert from 'node:assert/strict';
import {captureToolPoints,capturePocketGeometry,capturePhotoGeometry,captureItemDimensions,resizeCaptureItem,toolFromCaptureItem} from '../dist/capture-tools.js';
import {drawCaptureContours,drawCaptureToolPreview} from '../dist/capture-preview.js';
import {transformedPoints} from '../dist/geometry.js';
import {blankProject,validateProject} from '../dist/model.js';

function fixture(angle=0,pocketShape='functional'){
  const points=[{x:0,y:0},{x:12,y:0},{x:12,y:22},{x:7,y:22}];
  for(let y=24;y<65;y+=2)points.push({x:7+.18*Math.sin(y),y});
  points.push({x:15,y:65},{x:15,y:100},{x:-3,y:100},{x:-3,y:65},{x:2,y:65},{x:2,y:22},{x:0,y:22});
  const c=Math.cos(angle),s=Math.sin(angle),photo=points.map(p=>({x:250+2.5*(p.x*c-p.y*s),y:175+2.5*(p.x*s+p.y*c)}));
  const xs=photo.map(p=>p.x),ys=photo.map(p=>p.y);
  return{name:'Ráčna',checked:true,pocketShape,contour:{points:photo},info:{minX:Math.min(...xs),minY:Math.min(...ys),center:{x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2}}};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
function samePoints(actual,expected){
  const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,square=dx*dx+dy*dy,t=square?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/square)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  const follows=(source,target)=>source.every((a,i)=>{const b=source[(i+1)%source.length];return[0,.25,.5,.75].every(t=>{const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};return target.some((q,j)=>distance(p,q,target[(j+1)%target.length])<1e-5);});});
  assert.ok(follows(actual,expected)&&follows(expected,actual),'preview and transformed manufacturing boundaries must coincide, allowing redundant collinear vertices');
}
const convert=draft=>toolFromCaptureItem(draft,{scale:2.5,depth:8,id:'ratchet',preservePosition:true});

test('switching capture pocket modes is reversible and never replaces measured photo contours',()=>{
  const draft=fixture(),before=structuredClone(draft),first=captureToolPoints(draft,2.5),measured=captureItemDimensions(draft,2.5);
  assert.ok(capturePocketGeometry(draft,2.5).axis);
  draft.pocketShape='measured';const raw=captureToolPoints(draft,2.5);
  assert.notDeepEqual(first,raw,'a noisy measured profile must change to a regular pocket');
  assert.equal(capturePocketGeometry(draft,2.5).axis,null);
  assert.deepEqual(captureItemDimensions(draft,2.5),measured,'tool measurements do not change when choosing its pocket');
  draft.pocketShape='functional';assert.deepEqual(captureToolPoints(draft,2.5),first);
  assert.deepEqual(draft,before);
  const returned=captureToolPoints(draft,2.5);returned[0].x=999;
  assert.deepEqual(captureToolPoints(draft,2.5),first,'preview/export points do not expose cached geometry');
});

test('photo positions and model normalization preserve the exact fitted frame at any tool angle',()=>{
  for(const mode of ['hybrid','functional'])for(const angle of [0,.37,Math.PI/2,2.8]){
    const draft=fixture(angle,mode),before=structuredClone(draft),tool=convert(draft);
    const expected=capturePhotoGeometry(draft,2.5).points.map(p=>({x:p.x/2.5,y:p.y/2.5}));
    samePoints(transformedPoints(tool),expected);
    const restored=validateProject({...blankProject(),tools:[tool]}).tools[0];
    assert.equal(tool.pocketFit.mode,mode);assert.match(tool.pocketFit.signature,/^[0-9a-f]{8}$/);
    assert.deepEqual(restored.pocketFit,tool.pocketFit,'the capture fit marker survives validation');
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify({...blankProject(),tools:[tool]}))).tools[0].pocketFit,tool.pocketFit,'JSON round trips preserve the fit marker');
    samePoints(transformedPoints(restored),expected);assert.deepEqual(draft,before);
  }
});

test('resizing changes the measured source once and fitting cannot accumulate across switching or export',()=>{
  for(const mode of ['hybrid','functional']){
  const draft=fixture(.31,mode),photo=structuredClone(draft.contour),before=captureItemDimensions(draft,2.5);
  resizeCaptureItem(draft,2.5,{length:before.length*1.2});
  const source=structuredClone(draft.editedPoints),once=captureToolPoints(draft,2.5);
  near(captureItemDimensions(draft,2.5).length,before.length*1.2);
  for(let i=0;i<8;i++){
    convert(draft);draft.pocketShape='measured';captureToolPoints(draft,2.5);draft.pocketShape=mode;
    assert.deepEqual(captureToolPoints(draft,2.5),once);
  }
  assert.deepEqual(draft.editedPoints,source);assert.deepEqual(draft.contour,photo);
  samePoints(transformedPoints(convert(draft)),capturePhotoGeometry(draft,2.5).points.map(p=>({x:p.x/2.5,y:p.y/2.5})));
  }
});

function recorder(){
  const strokes=[];let path=[],dash=[];
  return{strokes,save(){},restore(){},beginPath(){path=[];},moveTo(x,y){path.push({x,y});},lineTo(x,y){path.push({x,y});},closePath(){},arc(){},fill(){},fillText(){},fillRect(){},translate(){},scale(){},drawImage(){},setLineDash(value){dash=[...value];},stroke(){strokes.push({points:structuredClone(path),color:this.strokeStyle,dash:[...dash]});}};
}
test('overview and close-up render the exported functional outline and its tool axis',()=>{
  for(const mode of ['hybrid','functional']){
  const draft=fixture(.42,mode),expected=capturePhotoGeometry(draft,2.5),ctx=recorder();
  drawCaptureContours(ctx,[draft],{activeIndex:0,scale:1,photoScale:2.5});
  samePoints(ctx.strokes.find(stroke=>stroke.color==='#577b67').points,expected.points);
  samePoints(ctx.strokes.find(stroke=>stroke.dash.length).points,[expected.axis.start,expected.axis.end]);
  const detail=recorder(),canvas={clientWidth:320,getContext:()=>detail};
  drawCaptureToolPreview(canvas,{},draft,0,{zoom:1,x:0,y:0},2.5);
  samePoints(detail.strokes.find(stroke=>stroke.color==='#577b67').points,expected.points);
  }
});
