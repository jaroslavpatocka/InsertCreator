import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {planPrintBatch} from '../dist/print-batch.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';
import {printPreview,previewFrame} from '../dist/preview3d.js';
import {createLivePreview} from '../dist/preview-live.js';
import {jointPreviewMarkup,jointPreviewLegend,moduleJointProfiles,NO_PREVIEW_JOINTS,omitJointCutSegments} from '../dist/preview-joints.js';

const module=(id,x,y,width=84,height=84)=>({id,name:id,x,y,width,height});
const fixture=(extra={})=>({...blankProject(),id:'visible-puzzle',width:420,height:252,connectors:true,printMode:'solid',bottomMode:'plain',bedWidth:220,bedHeight:220,modules:[module('a',42,42),module('b',126,42)],tools:[],...extra});
const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('the joint guide legend remains readable in the native SVG rasterizer',async()=>{
  const {createCanvas,loadImage}=await import('@napi-rs/canvas'),frame=previewFrame(220,{}, {width:400,height:300}),markup=jointPreviewLegend(frame);
  const image=await loadImage(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="${frame.viewBox}">${markup}</svg>`)),canvas=createCanvas(400,300),context=canvas.getContext('2d');context.drawImage(image,0,0);
  const pixels=context.getImageData(0,0,400,35).data;let dark=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200&&pixels[i]<180&&pixels[i+1]<190&&pixels[i+2]<190)dark++;
  assert.ok(dark>100,'the foreground letters must contrast with the light halo: '+dark);
  assert.equal((markup.match(/data-preview-joint-legend="true"/g)||[]).length,1);
});

test('guide polygons are the actual module tab/socket polygons, including their real clearance and physical Z',()=>{
  const project=fixture({jointClearance:.5}),before=JSON.stringify(project),batch=planPrintBatch(project),profiles=project.modules.flatMap(module=>moduleJointProfiles(project,module.id,batch));
  assert.equal(batch.jointPlan.joints.length,1);assert.equal(profiles.length,2);
  for(const profile of profiles){
    const path=batch.jointPlan.byPart.get(profile.partKey)[profile.kind==='tab'?'tabs':'sockets'][0];
    assert.deepEqual(profile.points,path.map(point=>[point.x,project.height-point.y]));
    assert.equal(profile.bottom,0);assert.equal(profile.top,project.base);
  }
  const width=profile=>Math.max(...profile.points.map(point=>point[1]))-Math.min(...profile.points.map(point=>point[1]));
  assert.ok(Math.abs(width(profiles.find(profile=>profile.kind==='socket'))-width(profiles.find(profile=>profile.kind==='tab'))-1)<.01);
  assert.equal(JSON.stringify(project),before);
  assert.deepEqual(moduleJointProfiles(project,'a',batch,new Set()),[],'a part with no generated STL cannot have a guide');
});

test('both axes of actual bed-cut joints and mixed original neighbours get guides, never skipped joints',()=>{
  const project=fixture({modules:[module('big',0,0,168,168),module('next',168,0)],bedWidth:100,bedHeight:100}),batch=previewBatch(project);
  assert.ok(batch.jointPlan.joints.some(joint=>joint.axis==='x'));assert.ok(batch.jointPlan.joints.some(joint=>joint.axis==='y'));
  const profiles=project.modules.flatMap(module=>moduleMesh(project,module.id,batch).jointProfiles);
  assert.equal(profiles.filter(profile=>profile.kind==='tab').length,batch.jointPlan.joints.length);
  assert.equal(profiles.filter(profile=>profile.kind==='socket').length,batch.jointPlan.joints.length);
  assert.ok(profiles.every(profile=>batch.jointPlan.byPart.has(profile.partKey)));
  const blocked=fixture({modules:[module('big',0,0,168,84)],bedWidth:100,bedHeight:100,tools:[{id:'crossing',name:'Crossing tool',moduleId:'big',x:70,y:5,rotation:0,depth:8,fingerGrips:[],points:rect(40,74)}]}),none=previewBatch(blocked);
  assert.equal(none.jointPlan.joints.length,0);assert.ok(none.jointPlan.skipped>0);assert.deepEqual(moduleJointProfiles(blocked,'big',none),[]);
  const preview=printPreview(blocked,null,null);assert.doesNotMatch(preview.html,/data-preview-joint="/);assert.ok(preview.warnings.includes(NO_PREVIEW_JOINTS));
});

test('enabled profiles remain visible from above and below with bed cut visibility off and all material colours',()=>{
  for(const bodyColor of ['#151515','#ffffff','#f2b544']){
    const project=fixture({previewCuts:false,multiMaterial:{enabled:true,floor:false,text:false,bodyColor}});
    for(const pitch of [.75,-.75]){
      const preview=printPreview(project,null,null,{yaw:.6,pitch});
      assert.match(preview.html,/data-preview-joints="true" data-joint-guide="xray"/);
      assert.equal((preview.html.match(/data-preview-joint="tab"/g)||[]).length,1);assert.equal((preview.html.match(/data-preview-joint="socket"/g)||[]).length,1);
      assert.match(preview.html,new RegExp('data-joint-z="'+(pitch<0?0:project.base)+'"'));
      assert.match(preview.html,/stroke="#fffdf5" stroke-width="5"/);assert.match(preview.html,/stroke="#243d42" stroke-width="3.2"/);
      assert.match(preview.html,/stroke="#f2b544"/);assert.match(preview.html,/stroke="#57d2df"/);
      assert.equal((preview.html.match(/data-preview-joint-legend="true"/g)||[]).length,1);
      assert.doesNotMatch(preview.html,/data-preview-cuts/);
    }
  }
});

test('guides use the thicker real magnetic base and are absent when connectors are off or unsupported',()=>{
  const magnetic=fixture({bottomMode:'magnet',magnetDepth:3}),batch=previewBatch(magnetic),profiles=moduleJointProfiles(magnetic,'a',batch);
  assert.ok(profiles.length);assert.equal(profiles[0].top,4.2);
  for(const project of [fixture({connectors:false}),fixture({bottomMode:'grid'})]){
    assert.deepEqual(moduleJointProfiles(project,'a',previewBatch(project)),[]);assert.doesNotMatch(printPreview(project,null,null).html,/data-preview-joints=/);
  }
});

test('straight cut lines leave an actual profile gap and cannot cover the puzzle contour',()=>{
  const project=fixture({previewCuts:true,modules:[module('big',0,0,168,84)],bedWidth:100,bedHeight:100}),batch=previewBatch(project),mesh=moduleMesh(project,'big',batch);
  assert.ok(mesh.jointProfiles.length);assert.ok(mesh.cuts.length);
  const profile=mesh.jointProfiles.find(profile=>profile.kind==='tab'),low=Math.min(...profile.points.map(point=>point[1]))-.6,high=Math.max(...profile.points.map(point=>point[1]))+.6;
  const crossing={points:[[84,0,20],[84,252,20]],normal:[0,0,1]},trimmed=omitJointCutSegments([crossing],mesh.jointProfiles);
  assert.equal(trimmed.length,2);assert.ok(trimmed.every(segment=>Math.max(...segment.points.map(point=>point[1]))<=low+1e-7||Math.min(...segment.points.map(point=>point[1]))>=high-1e-7));
  const preview=printPreview(project,null,null);assert.ok(preview.html.indexOf('data-preview-joints')>preview.html.indexOf('data-preview-cuts'),'the halo/profile is also painted above the cut layer');
});

test('focused static previews keep only their generated side of the real neighbouring joint',()=>{
  const project=fixture(),preview=printPreview({...project,previewModuleIds:['b']},null,null);
  assert.match(preview.html,/data-preview-joint="socket"/);assert.doesNotMatch(preview.html,/data-preview-joint="tab"/);
  const frame=previewFrame(220,{pitch:.6},{width:400,height:300}),batch=previewBatch(project),markup=jointPreviewMarkup(moduleJointProfiles(project,'b',batch),frame,[0,0,0]);
  assert.match(markup,/data-joint-module="b"/);assert.doesNotMatch(markup,/NaN|Infinity/);
});

test('live WebGL uses the same actual profiles without rebuilding for orbit and clears stale profiles',async()=>{
  const previous=globalThis.Worker;globalThis.Worker=function(){};
  const gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})}),canvas={width:1,height:1,setAttribute(){},addEventListener(){},getContext:()=>gl};
  let jobs=0;const pool={keep(){},broken:null,run(type,key,project,moduleId){jobs++;const batch=previewBatch(project);return Promise.resolve(type==='plan'?{batch}:{...moduleMesh(project,moduleId,batch),joints:batch?.jointPlan?.joints.length||0,unjoined:batch?.jointPlan?.unjoined.length||0});}},project=fixture(),options={activeIds:new Set(),camera:{},viewport:{width:600,height:400}};
  try{
    const live=createLivePreview({createCanvas:()=>canvas,pool});live.render(project,options);await flush();
    const ready=live.render(project,options);assert.equal(ready.stats.ready,2);assert.match(ready.html,/data-preview-joints=/);assert.equal((ready.html.match(/data-preview-joint-legend=/g)||[]).length,1);
    const built=jobs,under=live.render(project,{...options,camera:{pitch:-.8}});assert.equal(jobs,built);assert.match(under.html,/data-joint-z="0"/);
    const changed={...project,connectors:false};assert.doesNotMatch(live.render(changed,options).html,/data-preview-joints=/);await flush();assert.doesNotMatch(live.render(changed,options).html,/data-preview-joints=/);
    const apart=fixture({modules:[module('a',0,0),module('b',126,0)]});live.render(apart,options);await flush();const none=live.render(apart,options);assert.doesNotMatch(none.html,/data-preview-joints=/);assert.match(none.notice,/nevznikla žádná puzzle spojka/);
  }finally{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;}
});
