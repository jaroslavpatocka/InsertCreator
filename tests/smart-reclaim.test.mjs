import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {smartArrange} from '../dist/smart-layout.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {screwdriverProject} from './fixtures/smart-tools.mjs';
import {addToolGroup} from '../dist/set-module.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const makeTool=(id,width,height,x,y,moduleId)=>({id,name:id,points:rectangle(width,height),x,y,moduleId,rotation:0,depth:10,locked:false,fingerGrips:[],sizeLabel:'custom'});
function crowded(extra={}){
  return{...blankProject(),width:168,height:126,bedWidth:50,bedHeight:50,limitToBed:true,modules:[
    {id:'manual',name:'My two tools',x:0,y:0,width:126,height:126,sizeMode:'manual',grouped:true,locked:false,unit:'in'},
    {id:'outside',name:'Large square',x:210,y:0,width:84,height:84,sizeMode:'auto',locked:false}
  ],tools:[makeTool('a',20,20,20,20,'manual'),makeTool('b',20,20,70,20,'manual'),makeTool('c',60,60,220,10,'outside')],...extra};
}
function assertToolsUnchanged(source,result){for(const tool of source.tools){const after=result.tools.find(t=>t.id===tool.id);for(const key of Object.keys(tool).filter(key=>!['x','y','rotation','moduleId'].includes(key)))assert.deepEqual(after[key],tool[key],`${tool.id}: ${key}`);}}

test('Smart reclaims only useful manual margin to place a previously outside tool, preserving rigid members',async()=>{
  const project=crowded(),snapshot=structuredClone(project),result=await smartArrange(project),module=result.modules.find(m=>m.id==='manual');
  assert.deepEqual(result.unplaced,[]);assert.equal(result.stats.reason,'ok');assert.deepEqual(validateLayout({...project,...result}),[]);assertToolsUnchanged(project,result);assert.deepEqual(project,snapshot);
  assert.deepEqual(result.stats.resizedModules,[{id:'manual',name:'My two tools',before:{width:126,height:126},after:{width:84,height:42}}]);
  assert.equal(module.sizeMode,'manual');assert.equal(module.unit,'in');
  const a=result.tools.find(t=>t.id==='a'),b=result.tools.find(t=>t.id==='b');assert.equal(b.x-a.x,50);assert.equal(b.y-a.y,0);assert.equal(a.rotation,0);assert.equal(b.rotation,0);
  for(const m of result.modules)for(const key of ['x','y','width','height'])assert.ok(Math.abs(m[key]/project.grid-Math.round(m[key]/project.grid))<1e-8);
});

test('manual dimensions are unchanged when no extra tool can fit; locks and empty fillers never shrink',async()=>{
  const impossible=crowded();impossible.tools[2].points=rectangle(200,20);impossible.modules[1].width=252;impossible.modules[1].height=42;
  const result=await smartArrange(impossible);assert.ok(result.unplaced.includes('c'));assert.equal(result.stats.reason,'drawer');assert.equal(result.modules.find(m=>m.id==='manual').width,126);assert.equal(result.modules.find(m=>m.id==='manual').height,126);assert.ok(!result.stats.resizedModules.some(m=>m.id==='manual'));
  for(const lockTool of [false,true]){
    const project=crowded();if(lockTool)project.tools[0].locked=true;else project.modules[0].locked=true;
    const locked=await smartArrange(project);assert.ok(locked.unplaced.includes('c'));assert.deepEqual(locked.modules.find(m=>m.id==='manual'),project.modules[0]);for(const tool of project.tools.slice(0,2))assert.deepEqual(locked.tools.find(t=>t.id===tool.id),tool);
  }
  const empty=crowded();empty.tools=empty.tools.filter(t=>t.moduleId!=='manual');const filler=await smartArrange(empty);assert.deepEqual(filler.modules.find(m=>m.id==='manual'),empty.modules[0]);assert.ok(filler.unplaced.includes('c'));
});

test('already placed manual groups retain their user margins and off-grid historical dimensions are conservative',async()=>{
  const project=crowded({width:420}),result=await smartArrange(project);assert.deepEqual(result.unplaced,[]);assert.equal(result.modules.find(m=>m.id==='manual').width,126);assert.equal(result.modules.find(m=>m.id==='manual').height,126);assert.ok(!result.stats.resizedModules.some(m=>m.id==='manual'));
  const offgrid=crowded();offgrid.modules[0].width=125;const kept=await smartArrange(offgrid);assert.equal(kept.modules.find(m=>m.id==='manual').width,125);assert.ok(kept.unplaced.includes('c'));
});

test('three similar screwdrivers form one smaller shared automatic module, including an old group and a new member',async()=>{
  let project=screwdriverProject(41,{count:3,width:630,height:420,slanted:false});
  project.tools.forEach((tool,index)=>{tool.points=tool.points.map(point=>({...point,x:point.x*1.6}));tool.fingerGrips=automaticFingerGrips(tool);tool.name=`Screwdriver ${index+1} mm`;tool.nominalSize={value:index+1,unit:'mm'};tool.x=0;tool.y=0;tool.moduleId=null;});
  project.modules=[];project={...project,...autoArrange(project)};
  // Simulate a previous valid two-tool group plus one newly added automatic cell.
  const third=structuredClone(project.tools[2]),oldThird=project.modules.find(module=>module.id===third.moduleId);
  const pair=addToolGroup({...project,tools:[],modules:[]},project.tools.slice(0,2),{name:'Old pair',arrangement:'ordered',order:'asc'}).project;
  pair.modules[0].sizeMode='auto';
  const extra={...oldThird,x:420,y:252};third.x+=extra.x-oldThird.x;third.y+=extra.y-oldThird.y;
  project={...project,tools:[...pair.tools,third],modules:[...pair.modules,extra]};
  project.toolSets=[{id:'screwdrivers',name:'Screwdriver family',toolIds:project.tools.map(tool=>tool.id),layout:'auto',order:'asc',arrangement:'compact'}];
  // Repack the rigid original arrangement so the source remains a valid drawer.
  project={...project,...autoArrange(project)};assert.deepEqual(validateLayout(project),[]);
  const result=await smartArrange(project);assert.deepEqual(result.unplaced,[]);assert.deepEqual(validateLayout({...project,...result}),[]);assertToolsUnchanged(project,result);
  assert.equal(new Set(result.tools.map(tool=>tool.moduleId)).size,1);assert.equal(result.modules.length,1);assert.ok(result.stats.afterArea<result.stats.beforeArea);
  const module=result.modules[0];assert.equal(module.grouped,true);assert.equal(module.sizeMode,'auto');for(const key of ['x','y','width','height'])assert.equal(module[key]%project.grid,0);
  const ordered=result.tools.slice().sort((a,b)=>a.x-b.x||a.y-b.y).map(tool=>tool.nominalSize.value);assert.deepEqual(ordered,[1,2,3]);
});

test('a small module can fill the real notch of a locked stepped module without overlapping its material',async()=>{
  const locked={id:'stepped',name:'Locked L',x:0,y:0,width:84,height:84,sizeMode:'manual',locked:true,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]};
  const project={...blankProject(),width:84,height:84,modules:[locked,{id:'small',name:'Outside',x:126,y:0,width:42,height:42,sizeMode:'auto',locked:false}],tools:[makeTool('long',20,60,10,10,'stepped'),makeTool('small',20,20,136,10,'small')]};
  const result=await smartArrange(project,{moduleShape:'stepped'});assert.deepEqual(result.unplaced,[]);assert.deepEqual(validateLayout({...project,...result}),[]);assert.deepEqual(result.modules.find(module=>module.id==='stepped'),locked);
  const small=result.modules.find(module=>module.id==='small');assert.equal(small.x,42);assert.equal(small.y,42);assertToolsUnchanged(project,result);
  const bad={...project,tools:project.tools.map(tool=>tool.id==='long'?{...tool,points:rectangle(60,60)}:tool)};assert.ok(validateLayout(bad).some(issue=>issue.type==='outside'&&issue.ids.includes('long')));
});

const ellTool=()=>({...makeTool('ell',100,100,10,10,'ell-module'),points:[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:20,y:20},{x:20,y:100},{x:0,y:100}]});
const ellModule=()=>({id:'ell-module',name:'Angle',x:0,y:0,width:126,height:126,sizeMode:'auto',locked:false});

test('stepped Smart candidates remove only whole empty cells, retain walls and keep a step another module uses',async()=>{
  const project={...blankProject(),width:126,height:126,modules:[ellModule(),{id:'small',name:'Small',x:168,y:0,width:42,height:42,sizeMode:'auto',locked:false}],tools:[ellTool(),makeTool('nut',20,20,179,11,'small')]},rectangular=await smartArrange(project,{moduleShape:'rectangular'}),stepped=await smartArrange(project,{moduleShape:'stepped'});
  assert.deepEqual(stepped.unplaced,[]);assert.deepEqual(validateLayout({...project,...stepped}),[]);assert.ok(stepped.modules.some(module=>module.cells?.length<module.width*module.height/project.grid**2));assert.equal(rectangular.unplaced.length,1);
  for(const module of stepped.modules)for(const key of ['x','y','width','height'])assert.equal(module[key]%project.grid,0);
});

test('a step no other module uses goes back to a plain rectangle',async()=>{
  const project={...blankProject(),width:252,height:252,modules:[ellModule()],tools:[ellTool()]},result=await smartArrange(project,{moduleShape:'stepped'});
  assert.deepEqual(result.unplaced,[]);assert.deepEqual(validateLayout({...project,...result}),[]);assertToolsUnchanged(project,result);
  for(const module of result.modules){assert.equal(Object.hasOwn(module,'cells'),false);assert.equal(Object.hasOwn(module,'shape'),false);}
});

test('rearranging drops a step left empty by an earlier layout, but never on a locked or manual module',()=>{
  const cells=[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:0,y:2}],base={...ellModule(),shape:'stepped',cells},project=extra=>({...blankProject(),width:252,height:252,modules:[{...base,...extra}],tools:[ellTool()]});
  const free=autoArrange(project({})).modules[0];assert.equal(Object.hasOwn(free,'cells'),false);assert.equal(Object.hasOwn(free,'shape'),false);
  assert.equal(autoArrange(project({locked:true})).modules[0].cells.length,cells.length);
  assert.equal(autoArrange(project({sizeMode:'manual'})).modules[0].cells.length,cells.length);
});
