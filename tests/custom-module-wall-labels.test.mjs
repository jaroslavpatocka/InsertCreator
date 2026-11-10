import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {createCustomModule} from '../dist/custom-module.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {previewGeometryKey} from '../dist/preview3d.js';
import {createEditorGeometryCache} from '../dist/editor-cache.js';
import {pocketLayoutOutline} from '../dist/pocket-wall.js';
import {pocketOutline} from '../dist/finger-grip.js';

test('labels reserve the widest wall opening, including when manufacturing passes the floor polygon',()=>{
  const base=validateProject({...blankProject(),width:252,height:252,bottomMode:'plain',printMode:'solid'});
  const options={width:84,height:84,pocketWidth:60,pocketHeight:60,shape:'rectangle',depth:8,label:'M6'};
  const vertical=createCustomModule(base,options).project,wall=createCustomModule(base,{...options,pocketWall:{type:'draft',value:45}}).project;
  assert.equal(planSizeLabels(vertical).labels.length,1,'a label fits beside a vertical wall');
  const sloped=planSizeLabels(wall);assert.equal(sloped.labels.length,0,'the label cannot be placed on the sloping top edge');
  assert.equal(sloped.skipped[0].reason,'no-space');
  const tool=wall.tools[0];tool.poly=[{x:tool.x,y:tool.y},{x:tool.x+60,y:tool.y},{x:tool.x+60,y:tool.y+60},{x:tool.x,y:tool.y+60}];
  assert.equal(planSizeLabels(wall).labels.length,0,'a cached floor polygon cannot override the wider opening');
});

test('wall metadata validation and custom identity survive JSON reload without adding a vertical profile',()=>{
  const p=validateProject({...blankProject(),tools:[{id:'p',name:'Custom',customPocket:true,points:[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}],depth:8,pocketWall:{type:'roundTop',value:2}}]});
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).tools[0].pocketWall,{type:'roundTop',value:2});
  assert.equal(p.tools[0].customPocket,true);
  assert.throws(()=>validateProject({...p,tools:[{...p.tools[0],depth:1}]}),/hloubka|hloubky|hloubku/i);
  const vertical=validateProject({...p,tools:[{...p.tools[0],pocketWall:{type:'vertical'}}]});
  assert.equal(Object.hasOwn(vertical.tools[0],'pocketWall'),false);
});

test('changing only a wall profile or its value invalidates the real 3D geometry cache',()=>{
  const p=createCustomModule(validateProject(blankProject()),{shape:'rectangle',depth:8}).project;
  const keys=new Set([previewGeometryKey(p)]);
  for(const pocketWall of [{type:'draft',value:10},{type:'draft',value:15},{type:'chamfer',value:2},{type:'roundTop',value:2},{type:'roundBottom',value:2}]){
    const changed={...p,tools:[{...p.tools[0],pocketWall}]},key=previewGeometryKey(changed);
    assert.equal(keys.has(key),false,'cached vertical or different profile geometry must be rebuilt');keys.add(key);
  }
});

test('the board reuses a shaped wall outline on selection and translation, but refreshes changed angles and depths',()=>{
  const p=createCustomModule(validateProject(blankProject()),{shape:'rectangle',depth:8,pocketWall:{type:'draft',value:10}}).project;
  const tool=p.tools[0];let calls=0;
  const cache=createEditorGeometryCache({validateLayout:()=>[],findToolSets:()=>[],pocketOutline,pocketLayoutOutline:(...args)=>{calls++;return pocketLayoutOutline(...args);}});
  const first=cache.layoutPocket(tool,p);assert.equal(calls,1);
  assert.deepEqual(cache.layoutPocket({...tool,name:'Selected'},p),first);assert.equal(calls,1);
  const shifted=cache.layoutPocket({...tool,x:tool.x+12,y:tool.y+7},p);assert.equal(calls,1);
  assert.ok(shifted.every((point,index)=>Math.abs(point.x-first[index].x-12)<1e-8&&Math.abs(point.y-first[index].y-7)<1e-8));
  cache.layoutPocket({...tool,pocketWall:{type:'draft',value:15}},p);assert.equal(calls,2);
  const deeper=cache.layoutPocket({...tool,depth:9},p);assert.equal(calls,3);
  assert.ok(Math.max(...deeper.map(point=>point.x))>Math.max(...first.map(point=>point.x)),'a deeper sloping pocket really expands its opening');
});
