import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';
import {boundsFor,printPreview,previewGeometryKey} from '../dist/preview3d.js';
import {createLivePreview} from '../dist/preview-live.js';

const fixture=(extra={})=>({...blankProject(),id:'manufacturing-preview',width:420,height:252,printMode:'solid',bottomMode:'plain',connectors:false,bedWidth:100,bedHeight:100,
  modules:[{id:'m',name:'Wide module',x:42,y:42,width:168,height:84}],tools:[],...extra});

test('bed cut overlay follows actual split STL surfaces and does not change the saved layout',()=>{
  const project=fixture({previewCuts:true}),before=JSON.stringify(project),batch=previewBatch(project),mesh=moduleMesh(project,'m',batch);
  assert.equal(mesh.parts,2);assert.ok(mesh.cuts.length>0);
  const cutX=batch.plans[0].tiles[1].clip.x;
  assert.ok(mesh.cuts.every(segment=>segment.points.every(point=>Math.abs(point[0]-cutX)<.0002)));
  assert.ok(mesh.cuts.some(segment=>segment.normal[2]>.99));
  assert.ok(mesh.cuts.some(segment=>segment.normal[2]<-.99));
  const preview=printPreview(project,null,null);
  assert.match(preview.html,/data-preview-cuts="true"/);assert.equal(preview.stats.printParts,2);
  const hidden=printPreview({...project,previewCuts:false},null,null);
  assert.doesNotMatch(hidden.html,/data-preview-cuts/);assert.equal(hidden.stats.printParts,1);
  assert.equal(JSON.stringify(project),before);
  const larger={...project,bedWidth:220,bedHeight:220};
  assert.notEqual(previewGeometryKey(project),previewGeometryKey(larger));
  assert.doesNotMatch(printPreview(larger,null,null).html,/data-preview-cuts/);
});

test('cuts follow thin material-saving bases as well as solid blocks',()=>{
  const project=fixture({printMode:'light',previewCuts:true,tools:[{id:'t',name:'Tool',moduleId:'m',x:100,y:60,rotation:0,depth:8,points:[{x:0,y:0},{x:60,y:0},{x:60,y:30},{x:0,y:30}],fingerGrips:[]}]}),mesh=moduleMesh(project,'m',previewBatch(project));
  assert.ok(mesh.cuts.length>0);assert.ok(mesh.cuts.some(segment=>segment.points.every(point=>Math.abs(point[2]-project.base)<.001)),'the seam traces the low exposed base outside the tool wall');
  assert.match(printPreview(project,null,null,{yaw:0,pitch:1.3}).html,/data-preview-cuts/);
});

test('a focused static module retains its full drawer connector context and fits its own geometry',()=>{
  const project=fixture({width:840,connectors:true,bedWidth:220,bedHeight:220,modules:[{id:'m',name:'First',x:42,y:42,width:84,height:84},{id:'n',name:'Second',x:126,y:42,width:84,height:84}]}),before=JSON.stringify(project);
  const full=printPreview(project,null,null),focused=printPreview({...project,previewModuleIds:['m']},null,null),batch=previewBatch(project),mesh=moduleMesh(project,'m',batch);
  assert.ok(batch.jointPlan.joints.length>0);
  assert.equal(focused.stats.triangles,mesh.facets,'the neighbour is excluded from display while its mating connector remains in the batch');
  assert.match(focused.html,/data-module="m"/);assert.doesNotMatch(focused.html,/data-module="n"|data-reference="drawer"/);
  assert.ok(focused.frame.fitSize<full.frame.fitSize/2);
  assert.notDeepEqual(focused.frame.center,full.frame.center);
  assert.equal(boundsFor({...project,previewModuleIds:['m']}).reference.length,0);
  assert.equal(JSON.stringify(project),before);
});

test('WebGL preview displays the same projected cut lines and removes them when hidden',async()=>{
  const previous=globalThis.Worker;globalThis.Worker=function(){};
  const gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
  const canvas={width:1,height:1,setAttribute(){},addEventListener(){},getContext:()=>gl};
  let jobs=0;const pool={keep(){},broken:null,run(type,key,project,moduleId){jobs++;const batch=previewBatch(project);return Promise.resolve(type==='plan'?{batch}:moduleMesh(project,moduleId,batch));}};
  const options={activeIds:new Set(),camera:{},viewport:{width:600,height:400}},project=fixture({previewCuts:true});
  try{
    const live=createLivePreview({createCanvas:()=>canvas,pool});live.render(project,options);await new Promise(resolve=>setTimeout(resolve,0));
    const ready=live.render(project,options);assert.equal(ready.stats.ready,1);assert.match(ready.html,/data-preview-cuts="true"/);
    const count=jobs;live.render(project,{...options,camera:{yaw:1,pitch:.5}});assert.equal(jobs,count,'orbit only reprojects the completed cut lines');
    assert.doesNotMatch(live.render({...project,previewCuts:false},options).html,/data-preview-cuts/);
  }finally{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;}
});

test('selection keeps the configured body filament colour in SVG and adds a separate outline',()=>{
  const project=fixture({bedWidth:220,bedHeight:220,multiMaterial:{enabled:true,floor:false,text:false,bodyColor:'#ff0000'}});
  const normal=printPreview(project,null,null),active=printPreview(project,null,'m');
  const fills=value=>[...value.html.matchAll(/<polygon [^>]*data-face-index="\d+"[^>]*fill="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(fills(normal).length>0);assert.ok(fills(normal).every(fill=>/^rgb\(\d+ 0 0\)$/.test(fill)));
  assert.deepEqual(fills(active),fills(normal),'active selection cannot replace the body filament with amber');
  assert.match(active.html,/data-preview-selection="true"/);assert.doesNotMatch(normal.html,/data-preview-selection/);
  assert.equal(active.stats.meshRevision,normal.stats.meshRevision);
});

test('selected WebGL body uses its material colour while the outline identifies the active module',async()=>{
  const previous=globalThis.Worker;globalThis.Worker=function(){};
  const drawn=[],methods={getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_,name)=>name,uniform3fv:(name,value)=>{if(name==='color')drawn.push([...value]);}},gl=new Proxy(methods,{get:(target,name)=>name in target?target[name]:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
  const canvas={width:1,height:1,setAttribute(){},addEventListener(){},getContext:()=>gl},project=fixture({bedWidth:220,bedHeight:220,multiMaterial:{enabled:true,floor:false,text:false,bodyColor:'#ff0000'}});
  const pool={keep(){},broken:null,run(type,key,source,moduleId){const batch=previewBatch(source);return Promise.resolve(type==='plan'?{batch}:moduleMesh(source,moduleId,batch));}},options={activeIds:new Set(['m']),camera:{},viewport:{width:600,height:400}};
  try{
    const live=createLivePreview({createCanvas:()=>canvas,pool});live.render(project,options);await new Promise(resolve=>setTimeout(resolve,0));drawn.length=0;
    const active=live.render(project,options);assert.ok(drawn.some(color=>color[0]===1&&color[1]===0&&color[2]===0));assert.match(active.html,/data-preview-selection="true"/);
  }finally{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;}
});
