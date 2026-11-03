import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,minimizeAutoModules,pocketOutline,resizeModule,validateLayout} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const tool=(id,width,height,extra={})=>({id,name:id,points:rectangle(width,height),x:0,y:0,rotation:0,depth:10,locked:false,moduleId:null,fingerGrips:[],...extra});
const box=points=>({width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))});
function assertMinimal(project,module){
  const own=project.tools.filter(tool=>tool.moduleId===module.id),b=box(own.flatMap(tool=>pocketOutline(tool,project.clearance))),padding=project.wall+.25;
  assert.equal(module.width,Math.ceil((b.width+2*padding-1e-7)/project.grid)*project.grid);
  assert.equal(module.height,Math.ceil((b.height+2*padding-1e-7)/project.grid)*project.grid);
}

test('automatic socket modules lose inherited largest-tool length while explicit uniform cells stay equal',()=>{
  const project={...blankProject(),width:504,height:378,modules:[0,1,2].map(i=>({id:`m${i}`,name:`Socket ${i}`,x:i*84,y:0,width:84,height:294,sizeMode:'auto',setId:'s',setLayout:'uniform',locked:false})),tools:[0,1,2].map(i=>tool(`t${i}`,20+i*5,20+i*5,{x:i*84+20,y:100,moduleId:`m${i}`})),toolSets:[{id:'s',name:'Sockets',layout:'auto',toolIds:['t0','t1','t2']}]};
  const snapshot=structuredClone(project),refit=minimizeAutoModules(project);
  assert.equal(refit.resizedModules.length,3);for(const module of refit.project.modules)assertMinimal(refit.project,module);
  assert.deepEqual(project,snapshot);
  const result={...project,...autoArrange(project)};assert.deepEqual(validateLayout(result),[]);for(const module of result.modules)assertMinimal(result,module);
  const uniform={...project,toolSets:[{...project.toolSets[0],layout:'uniform'}]},kept={...uniform,...autoArrange(uniform)};
  assert.ok(kept.modules.every(module=>module.width===84&&module.height===294));
});

test('individual automatic set modules use each real pocket and survive JSON reload with units and nominal sizes',()=>{
  const project={...blankProject(),width:504,height:378,bedWidth:50,bedHeight:50,limitToBed:true},tools=[tool('small',18,35,{unit:'mm',nominalSize:{value:8,unit:'mm'}}),tool('large',28,170,{unit:'in',nominalSize:{value:.5,unit:'in'}})];
  const result=addToolGroup(project,tools,{toolSet:{id:'set',name:'Two sizes',layout:'auto'},arrangement:'ordered',order:'asc'}),next=result.project;
  assert.equal(result.placed,true);assert.equal(next.modules.length,2);assert.ok(next.modules.every(module=>module.setLayout==='auto'&&module.sizeMode==='auto'));
  for(const module of next.modules)assertMinimal(next,module);
  assert.notEqual(next.modules[0].width*next.modules[0].height,next.modules[1].width*next.modules[1].height);
  const reloaded=validateProject(JSON.parse(JSON.stringify(next)));assert.deepEqual(reloaded.modules,next.modules);assert.deepEqual(reloaded.toolSets,next.toolSets);
  for(const original of tools){const member=reloaded.tools.find(tool=>tool.id===original.id);assert.deepEqual(member.nominalSize,original.nominalSize);assert.equal(member.unit,original.unit);assert.deepEqual(member.points,original.points);}
  const packed={...reloaded,...autoArrange(reloaded)};assert.deepEqual(validateLayout(packed),[]);for(const module of packed.modules)assertMinimal(packed,module);
});

test('minimum footprint includes actual finger bays, locks, manual margins and fillers remain constraints',()=>{
  const project={...blankProject(),width:504,height:378,modules:[
    {id:'grips',name:'Finger access',x:0,y:0,width:168,height:168,sizeMode:'auto',locked:false},
    {id:'locked',name:'Lock',x:168,y:0,width:84,height:168,sizeMode:'auto',locked:true},
    {id:'manual',name:'Manual',x:252,y:0,width:126,height:168,sizeMode:'manual',locked:false},
    {id:'filler',name:'Empty',x:378,y:0,width:84,height:168,sizeMode:'auto',locked:false}
  ],tools:[tool('g',10,80,{moduleId:'grips',x:60,y:30,fingerGrips:[{id:'bay',x:5,y:40,radius:24}]}),tool('l',20,20,{moduleId:'locked',x:190,y:60}),tool('m',20,20,{moduleId:'manual',x:280,y:60})]};
  const result=minimizeAutoModules(project);assert.equal(result.resizedModules.length,1);assertMinimal(result.project,result.project.modules[0]);
  for(const id of ['locked','manual','filler']){assert.deepEqual(result.project.modules.find(module=>module.id===id),project.modules.find(module=>module.id===id));for(const original of project.tools.filter(tool=>tool.moduleId===id))assert.deepEqual(result.project.tools.find(tool=>tool.id===original.id),original);}
  assert.deepEqual(result.project.tools[0].fingerGrips,project.tools[0].fingerGrips);assert.deepEqual(result.project.tools[0].points,project.tools[0].points);
});

test('explicit module resizing replaces old stepped cell indices with a valid rectangular container',()=>{
  const project={...blankProject(),width:252,height:168,modules:[{id:'stepped',name:'L',x:0,y:0,width:84,height:84,sizeMode:'auto',locked:false,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}],tools:[tool('member',20,60,{moduleId:'stepped',x:10,y:10})]},snapshot=structuredClone(project);
  const resized=resizeModule(project,'stepped',{width:126,height:84});assert.equal(Object.hasOwn(resized.modules[0],'cells'),false);assert.equal(Object.hasOwn(resized.modules[0],'shape'),false);assert.deepEqual(validateLayout(resized),[]);assert.deepEqual(resized.tools[0].points,project.tools[0].points);assert.deepEqual(project,snapshot);
});
