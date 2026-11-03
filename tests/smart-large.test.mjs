import test from 'node:test';
import assert from 'node:assert/strict';
import {smartArrange} from '../dist/smart-layout.js';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout,pocketOutline} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {catalogSets} from '../dist/catalog/index.js';
import {setCoherence} from '../dist/tool-sets.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
function tinyProject(count=26,{width=420,height=252,manual=false}={}){
  const modules=Array.from({length:count},(_,i)=>({id:`m${i}`,name:`Module ${i}`,x:i===0?0:Math.ceil(width/42)*42+42,y:0,width:i===0&&manual?width:84,height:210,locked:false,sizeMode:i===0&&manual?'manual':'auto'}));
  const tools=modules.map((module,i)=>({id:`t${i}`,name:`Part ${i}`,points:rectangle(20,20),x:module.x+20,y:20,rotation:0,depth:8+i%3,moduleId:module.id,locked:false,fingerGrips:[],sizeLabel:String(i)}));
  return validateProject({...blankProject(),id:`large-${count}`,width,height,tools,modules});
}
function preserved(source,result){for(const tool of source.tools){const current=result.tools.find(item=>item.id===tool.id);assert.ok(current,tool.id);for(const key of Object.keys(tool).filter(key=>!['x','y','rotation','moduleId'].includes(key)))assert.deepEqual(current[key],tool[key],`${tool.id}: ${key}`);}assert.equal(new Set(result.modules.map(module=>module.id)).size,result.modules.length);}
function placedLayout(source,result){const ids=new Set(result.modules.filter(module=>module.x>=0&&module.y>=0&&module.x+module.width<=source.width&&module.y+module.height<=source.height).map(module=>module.id));return{...source,...result,modules:result.modules.filter(module=>ids.has(module.id)),tools:result.tools.filter(tool=>ids.has(tool.moduleId))};}

test('26 oversized automatic modules are minimized and all parked tools fit in both Smart modes',async()=>{
  for(const mode of ['compact','sets']){const project=tinyProject(),snapshot=structuredClone(project),result=await smartArrange(project,{mode});assert.deepEqual(result.unplaced,[]);assert.equal(result.stats.strategy,'greedy');assert.equal(result.stats.reason,'ok');assert.equal(result.stats.changed,true);assert.ok(result.stats.resizedModules.length>=25);assert.deepEqual(validateLayout({...project,...result}),[]);assert.ok(result.modules.every(module=>module.width===42&&module.height===42));preserved(project,result);assert.deepEqual(project,snapshot);}
});

test('the lightweight path supports the full 300-tool schema limit without exponential pair nesting',async t=>{
  const project=tinyProject(300,{width:1260,height:630}),started=performance.now(),result=await smartArrange(project,{moduleShape:'rectangular'});assert.deepEqual(result.unplaced,[]);assert.equal(result.tools.length,300);assert.equal(result.modules.length,300);assert.equal(result.stats.strategy,'greedy');assert.deepEqual(validateLayout({...project,...result}),[]);preserved(project,result);t.diagnostic(`300 actual tools, ${result.modules.length} modules: ${Math.round(performance.now()-started)}ms; no timing threshold`);
});

test('large manual reclaim needs a real placement gain and locks preserve all existing tools and module geometry',async()=>{
  const project=tinyProject(26,{manual:true}),snapshot=structuredClone(project),result=await smartArrange(project,{mode:'sets'});assert.deepEqual(result.unplaced,[]);const resized=result.stats.resizedModules.find(module=>module.id==='m0');assert.deepEqual(resized,{id:'m0',name:'Module 0',before:{width:420,height:210},after:{width:42,height:42}});assert.equal(result.modules.find(module=>module.id==='m0').sizeMode,'manual');preserved(project,result);assert.deepEqual(project,snapshot);
  for(const lock of ['module','tool']){const source=tinyProject(26,{manual:true});if(lock==='module')source.modules[0].locked=true;else source.tools[0].locked=true;const kept=await smartArrange(source);assert.ok(kept.unplaced.length>0);assert.deepEqual(kept.modules.find(module=>module.id==='m0'),source.modules[0]);assert.deepEqual(kept.tools.find(tool=>tool.id==='t0'),source.tools[0]);assert.ok(!kept.stats.resizedModules.some(module=>module.id==='m0'));assert.deepEqual(validateLayout(placedLayout(source,kept)),[]);preserved(source,kept);}
});

test('a real 26-wrench catalogue family with central grips can rebuild as one safe ordered shared module',async t=>{
  const set=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm'),tools=set.tools.map((item,index)=>{const tool={id:`wrench-${index}`,name:item.name.cs,points:item.points,unit:item.unit,nominalSize:{value:item.size,unit:item.unit},x:0,y:0,rotation:0,depth:Math.min(item.depth,17.6),locked:false,moduleId:null};return{...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})};});
  let project=addToolGroup({...blankProject(),width:1008,height:756},tools,{name:'Wrenches 6–32',toolSet:{id:'wrenches',name:'Wrenches 6–32',layout:'auto'},order:'asc',arrangement:'compact'}).project;
  project.modules=project.modules.map((module,index)=>{const moved={...module,x:index===0?0:1050,y:index===0?0:(index-1)*126,width:630,height:126};for(const tool of project.tools.filter(tool=>tool.moduleId===module.id)){tool.x+=moved.x-module.x;tool.y+=moved.y-module.y;}return moved;});
  project=validateProject(project);assert.equal(project.tools.length,26);assert.ok(project.tools.every(tool=>tool.fingerGrips.length===2&&tool.fingerGrips.every(grip=>grip.radius===9)));const snapshot=structuredClone(project),started=performance.now(),result=await smartArrange(project,{mode:'sets',moduleShape:'stepped'});
  assert.deepEqual(result.unplaced,[]);assert.equal(new Set(result.tools.map(tool=>tool.moduleId)).size,1);assert.equal(result.modules.length,1);assert.equal(result.modules[0].grouped,true);assert.equal(result.modules[0].setLayout,'shared');assert.deepEqual(validateLayout({...project,...result}),[]);preserved(project,result);assert.deepEqual(project,snapshot);assert.equal(result.stats.manufacturingChecked,false);assert.equal(result.stats.setSummary[0].applied,'shared');assert.equal(result.stats.setSummary[0].status,'applied');assert.ok(setCoherence({...project,...result},project.toolSets).satisfied.includes('wrenches'));
  for(const module of result.modules)for(const key of ['x','y','width','height'])assert.equal(module[key]%42,0);
  for(const tool of result.tools)assert.ok(pocketOutline(tool,project.clearance).length>=3);t.diagnostic(`26 real wrench contours +52 central finger bays: ${Math.round(performance.now()-started)}ms; one shared raster module`);
});

test('large cancellation and invalid parked contours reject without mutating the source',async()=>{
  const project=tinyProject(),snapshot=structuredClone(project),controller=new AbortController();await assert.rejects(smartArrange(project,{signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});assert.deepEqual(project,snapshot);
  const invalid=tinyProject();invalid.tools[1].depth=99;await assert.rejects(smartArrange(invalid),/Hloubka/);assert.equal(invalid.tools[1].depth,99);
  await assert.rejects(smartArrange(project,{moduleShape:'unknown'}),/tvar modulů/);
});

test('a partial improvement with 300 blocked tools keeps every parked module saveable within the coordinate range',async()=>{
  const project=tinyProject(300,{width:84,height:84});for(const module of project.modules){module.x=126;module.y=0;}for(const tool of project.tools){tool.x=146;tool.y=20;}
  project.modules.push({id:'filler',name:'Locked filler',x:0,y:0,width:42,height:84,sizeMode:'manual',locked:true});const snapshot=structuredClone(project),result=await smartArrange(project,{moduleShape:'stepped'});
  assert.equal(result.unplaced.length,298);assert.equal(result.tools.length,300);assert.equal(result.modules.length,301);assert.equal(result.stats.changed,true);assert.deepEqual(result.modules.find(module=>module.id==='filler'),project.modules.at(-1));
  const restored=validateProject(JSON.parse(JSON.stringify({...project,...result})));assert.equal(restored.tools.length,300);assert.equal(restored.modules.length,301);assert.deepEqual(validateLayout(placedLayout(project,result)),[]);assert.ok(result.modules.every(module=>module.x>=0&&module.y>=0&&module.x+module.width<=4000&&module.y+module.height<=4000));assert.ok(result.modules.some(module=>module.y>3000),'parking overflow is exercised, then saturated');preserved(project,result);assert.deepEqual(project,snapshot);
});
