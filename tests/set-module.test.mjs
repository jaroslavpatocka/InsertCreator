import test from 'node:test';
import assert from 'node:assert/strict';
import {scaleTool,addToolGroup} from '../dist/set-module.js';
import {catalogSets} from '../dist/catalog/index.js';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout,autoArrange,resizeModule,pocketOutline} from '../dist/geometry.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {smartArrange} from '../dist/smart-layout.js';
import {setLang,errorText} from '../dist/i18n.js';

const box=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{minX:Math.min(...xs),minY:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
const set=id=>{const s=catalogSets().find(x=>x.id===id);assert.ok(s,id);return s;};
// Same preparation as the editor's addTools: depth capped, automatic finger grips.
const toolsOf=(id,{grips=true}={})=>set(id).tools.map((item,i)=>{
  const tool={id:`${id}-${i}`,name:item.name.cs,points:item.points,depth:Math.min(item.depth,17.6),unit:item.unit,x:0,y:0,rotation:0,locked:false,moduleId:null};
  if(grips)tool.fingerGrips=automaticFingerGrips(tool,{radius:9});
  return tool;
});
const drawer=(extra={})=>({...blankProject(),limitToBed:false,...extra});
const issuesFor=(project,moduleId)=>validateLayout({...project,modules:project.modules.filter(m=>m.id===moduleId),tools:project.tools.filter(t=>t.moduleId===moduleId)});
function assertGroup(result,tools,project){
  const {project:next,moduleId,placed}=result;
  assert.equal(placed,true);
  const added=next.modules.filter(m=>!project.modules.some(o=>o.id===m.id));
  assert.equal(added.length,1,'exactly one new module');
  const module=added[0];
  assert.equal(module.id,moduleId);
  assert.equal(module.grouped,true);assert.equal(module.sizeMode,module.setLayout==='shared'?'auto':'manual');assert.equal(module.locked,false);
  assert.equal(module.width%next.grid,0);assert.equal(module.height%next.grid,0);
  const own=next.tools.filter(t=>t.moduleId===moduleId);
  assert.equal(own.length,tools.length,'all tools in the module');
  assert.deepEqual(validateLayout(next),[]);
  for(const tool of own){const b=box(pocketOutline(tool,next.clearance));assert.ok(b.width>=b.height-1e-6,`${tool.id} pocket lies horizontally`);}
  const pockets=own.reduce((sum,tool)=>{const b=box(pocketOutline(tool,next.clearance));return sum+b.width*b.height;},0);
  assert.ok(module.width*module.height<=1.6*pockets,`area ratio ${(module.width*module.height/pockets).toFixed(2)}`);
  return {module,own};
}

test('scaleTool scales the outline, keeps grip radius and depth',()=>{
  const tool=toolsOf('combination-wrench-set-8-19mm')[3];
  const scaled=scaleTool(tool,1.1);
  assert.notEqual(scaled,tool);assert.equal(scaled.id,tool.id);assert.equal(scaled.depth,tool.depth);
  const a=box(tool.points),b=box(scaled.points);
  assert.ok(Math.abs(b.width-a.width*1.1)<1e-9&&Math.abs(b.height-a.height*1.1)<1e-9);
  assert.equal(scaled.fingerGrips.length,tool.fingerGrips.length);
  for(const [i,g] of scaled.fingerGrips.entries())assert.equal(g.radius,tool.fingerGrips[i].radius);
  assert.ok(pocketOutline(scaled,.8).length>2);
  assert.equal(tool.points[5].x,set('combination-wrench-set-8-19mm').tools[3].points[5].x,'input not mutated');
  assert.equal(scaleTool(tool,.9,{id:'copy'}).id,'copy');
  // Shrinking a lot still yields grips that touch the pocket (moved or recomputed).
  const tiny=scaleTool(tool,.25);
  assert.equal(tiny.fingerGrips.length,2);assert.ok(pocketOutline(tiny,0).length>2);
  const noGrips=scaleTool({...tool,fingerGrips:undefined},2);assert.equal(noGrips.fingerGrips,undefined);
});

test('scaleTool rejects invalid factors and outlines over 3000 mm',()=>{
  const tool=toolsOf('hex-key-set-1-5-10mm')[0];
  for(const factor of [0,.1,5.01,-1,NaN,Infinity,'x',null,true])assert.throws(()=>scaleTool(tool,factor),error=>!!error.i18n,String(factor));
  assert.doesNotThrow(()=>scaleTool(tool,'1.5'));
  const long={id:'bar',name:'Tyč',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:10},{x:0,y:10}],depth:5};
  assert.equal(box(scaleTool(long,3).points).width,3000);
  assert.throws(()=>scaleTool(long,3.01),error=>error.i18n?.cs==='Kontura nesmí v žádném směru přesáhnout {max}.');
  setLang('en',{save:false});
  try{assert.match(errorText((()=>{try{scaleTool(tool,9);}catch(e){return e;}})()),/scale/i);}finally{setLang('cs',{save:false});}
});

test('combination wrench set 8–19 mm becomes one tight module in the default drawer',()=>{
  const project=drawer(),tools=toolsOf('combination-wrench-set-8-19mm');
  const result=addToolGroup(project,tools,{name:'Očkoploché klíče 8–19',unit:'mm'});
  const {module}=assertGroup(result,tools,project);
  assert.equal(module.name,'Očkoploché klíče 8–19');assert.equal(module.unit,'mm');
  assert.ok(module.x+module.width<=504&&module.y+module.height<=378);
  assert.equal(project.tools.length,0,'input project not mutated');
});

test('hex key set and socket sets pack into a single module each, next to existing modules',()=>{
  let project=drawer();
  const hex=toolsOf('hex-key-set-1-5-10mm'),sockets=toolsOf('socket-set-3-8in-8-22mm');
  const first=addToolGroup(project,hex,{name:'Imbusy'});assertGroup(first,hex,project);
  const second=addToolGroup(first.project,sockets,{name:'Hlavice'});assertGroup(second,sockets,first.project);
  assert.notEqual(first.moduleId,second.moduleId);
  const quarter=toolsOf('socket-set-1-4in-4-14mm');
  assertGroup(addToolGroup(drawer(),quarter),quarter,drawer());
  // Larger sets in a bigger drawer.
  const big=drawer({width:1008,height:840}),wrenches=toolsOf('combination-wrench-set-6-32mm');
  assertGroup(addToolGroup(big,wrenches),wrenches,big);
});

test('a duplicate module id gets a unique suffix; duplicate tool ids are rejected',()=>{
  const tools=toolsOf('hex-key-set-2-10mm'),first=addToolGroup(drawer(),tools,{moduleId:'set'});
  assert.equal(first.moduleId,'set');
  const again=addToolGroup(first.project,toolsOf('torx-key-set-t8-t40'),{moduleId:'set'});
  assert.notEqual(again.moduleId,'set');assert.equal(again.placed,true);
  assert.throws(()=>addToolGroup(first.project,tools),error=>!!error.i18n);
  assert.throws(()=>addToolGroup(drawer(),[]),error=>!!error.i18n);
});

test('a set too big for the drawer is kept outside the drawer, nothing lost',()=>{
  const project=drawer({width:126,height:126}),tools=toolsOf('combination-wrench-set-8-19mm');
  const {project:next,moduleId,placed}=addToolGroup(project,tools);
  assert.equal(placed,false);
  const module=next.modules.find(m=>m.id===moduleId);
  assert.ok(module.x>=project.width,'parked outside');
  assert.equal(next.tools.length,tools.length);
  assert.ok(next.tools.every(t=>t.moduleId===moduleId));
  assert.ok(validateLayout(next).every(issue=>issue.type==='outside'),'only the outside issue');
  // The parked group is still a valid module of its own and survives saving.
  assert.deepEqual(validateLayout({...next,width:5000,height:5000}),[]);
  const reloaded=validateProject(JSON.parse(JSON.stringify(next)));
  assert.equal(reloaded.tools.filter(t=>t.moduleId===moduleId).length,tools.length);
});

test('print bed limit: a set that does not fit the bed is not placed',()=>{
  const project={...blankProject(),limitToBed:true},tools=toolsOf('combination-wrench-set-8-19mm');
  const result=addToolGroup(project,tools);
  assert.equal(result.placed,false);assert.equal(result.project.tools.length,tools.length);
  const hex=toolsOf('hex-key-set-1-5-10mm'),fits=addToolGroup(project,hex);
  assert.equal(fits.placed,true);
  const m=fits.project.modules[0];assert.ok(m.width-.5<=220&&m.height-.5<=220);
});

test('when no free spot is left, autoArrange makes room and keeps the group whole',()=>{
  let project=drawer({width:420,height:252});
  // Three single-tool modules scattered so that no free 252×126 grid spot remains.
  const singles=toolsOf('pliers-set-3pcs',{grips:false}).map((t,i)=>({...t,id:`p${i}`}));
  const arranged=autoArrange({...project,tools:singles});
  assert.deepEqual(arranged.modules.map(m=>[m.width,m.height]),[[210,84],[210,84],[168,84]]);
  const spots=[[0,0],[210,84],[0,168]];
  project={...project,modules:arranged.modules.map((m,i)=>({...m,x:spots[i][0],y:spots[i][1]})),tools:arranged.tools.map(t=>{const i=arranged.modules.findIndex(m=>m.id===t.moduleId),m=arranged.modules[i];return{...t,x:t.x-m.x+spots[i][0],y:t.y-m.y+spots[i][1]};})};
  assert.deepEqual(validateLayout(project),[]);
  const hex=toolsOf('hex-key-set-1-5-10mm',{grips:false});
  const result=addToolGroup(project,hex);
  assert.equal(result.placed,true);
  assert.deepEqual(validateLayout(result.project),[]);
  assert.equal(result.project.modules.length,4);
  assert.equal(result.project.tools.filter(t=>t.moduleId===result.moduleId).length,hex.length);
  assert.notDeepEqual(result.project.modules.slice(0,3).map(m=>[m.x,m.y]),spots,'others were rearranged');
  // A locked layout cannot make room: the group is parked and the others stay put.
  const locked={...project,modules:project.modules.map(m=>({...m,locked:true}))};
  const parked=addToolGroup(locked,hex);
  assert.equal(parked.placed,false);
  assert.deepEqual(parked.project.modules.slice(0,3),locked.modules);
  assert.equal(parked.project.tools.length,singles.length+hex.length);
  // A second parked set goes below the first one, outside the drawer.
  const twice=addToolGroup(parked.project,toolsOf('torx-key-set-t8-t40',{grips:false}));
  assert.equal(twice.placed,false);
  const [a,b]=[parked.moduleId,twice.moduleId].map(id=>twice.project.modules.find(m=>m.id===id));
  assert.ok(b.y>=a.y+a.height&&b.x>=project.width);
});

test('the group survives JSON roundtrip, autoArrange, resizeModule and smartArrange',async()=>{
  const project=drawer(),tools=toolsOf('hex-key-set-1-5-10mm');
  const {project:next,moduleId}=addToolGroup(project,tools,{name:'Imbusy'});
  const reloaded=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project:next})));
  const module=reloaded.modules.find(m=>m.id===moduleId);
  assert.equal(module.grouped,true);assert.equal(module.sizeMode,'manual');
  assert.deepEqual(validateLayout(reloaded),[]);
  const relative=p=>p.tools.filter(t=>t.moduleId===moduleId).map(t=>{const m=p.modules.find(x=>x.id===moduleId);return[t.id,+(t.x-m.x).toFixed(6),+(t.y-m.y).toFixed(6),t.rotation];});

  // autoArrange moves the group as one rigid block.
  const shifted={...reloaded,modules:reloaded.modules.map(m=>({...m,x:m.x+84,y:m.y+42})),tools:reloaded.tools.map(t=>({...t,x:t.x+84,y:t.y+42}))};
  const arranged=autoArrange(shifted),after={...shifted,...arranged};
  assert.deepEqual(arranged.unplaced,[]);
  assert.equal(arranged.modules.length,1);
  assert.deepEqual(relative(after),relative(shifted));
  assert.deepEqual(validateLayout(after),[]);

  // Manual resize keeps the content centred and valid; auto shrinks back to the content.
  const bigger=resizeModule(reloaded,moduleId,{width:module.width+84,height:module.height+42});
  const m2=bigger.modules.find(m=>m.id===moduleId);
  assert.equal(m2.grouped,true);assert.deepEqual(validateLayout(bigger),[]);
  const content=box(bigger.tools.flatMap(t=>pocketOutline(t,bigger.clearance)));
  assert.ok(Math.abs((content.minX-m2.x)-(m2.x+m2.width-content.minX-content.width))<1e-6);
  assert.ok(Math.abs((content.minY-m2.y)-(m2.y+m2.height-content.minY-content.height))<1e-6);
  const auto=resizeModule(bigger,moduleId,{mode:'auto'}),m3=auto.modules.find(m=>m.id===moduleId);
  assert.equal(m3.sizeMode,'auto');assert.ok(m3.width<=module.width&&m3.height<=module.height);
  assert.deepEqual(validateLayout(auto),[]);
  assert.throws(()=>resizeModule(reloaded,moduleId,{width:42,height:42}));

  // smartArrange treats grouped modules as rigid atoms: never split.
  const smart=await smartArrange(reloaded);
  const smartModules=smart.modules.filter(m=>smart.tools.some(t=>t.moduleId===m.id));
  assert.equal(smartModules.length,1);
  assert.ok(smart.tools.every(t=>t.moduleId===moduleId));
  assert.equal(smart.modules.find(m=>m.id===moduleId).grouped,true);
  assert.deepEqual(relative({...reloaded,...smart}),relative(reloaded));
});

// --- Registered tool sets (project.toolSets, tool-sets.js / set-layout.js conventions) ---
const sharedIn=(project,ids)=>{const own=project.tools.filter(t=>ids.includes(t.id));return new Set(own.map(t=>t.moduleId)).size===1&&project.tools.filter(t=>t.moduleId===own[0].moduleId).length===ids.length;};

test('opts.toolSet "shared" registers the set and tags the module like set-layout.js',async()=>{
  const {arrangeToolSets}=await import('../dist/set-layout.js'),{setCoherence,findToolSets,validateToolSets}=await import('../dist/tool-sets.js');
  const project={...drawer(),toolSets:[{id:'old',name:'Stará',toolIds:[],layout:'auto'}]},tools=toolsOf('combination-wrench-set-8-19mm');
  const result=addToolGroup(project,tools,{toolSet:{name:'Klíče 8–19',layout:'shared'}});
  const {module}=assertGroup(result,tools,project),next=result.project;
  assert.equal(next.toolSets.length,2);
  const set=next.toolSets.at(-1);
  assert.equal(set.id,result.setId);assert.equal(set.name,'Klíče 8–19');assert.equal(set.layout,'shared');
  assert.deepEqual(set.toolIds,tools.map(t=>t.id));
  assert.equal(module.setId,set.id);assert.equal(module.setLayout,'shared');assert.equal(module.sizeMode,'auto');assert.equal(module.grouped,true);
  assert.equal(module.name,'Klíče 8–19');
  assert.deepEqual(setCoherence(next,findToolSets(next).sets).unsatisfied,[],'common heading, complete shared module');
  // Persisted schema.
  const reloaded=validateProject(JSON.parse(JSON.stringify(next)));
  assert.deepEqual(reloaded.toolSets.find(s=>s.id===set.id),set);
  assert.deepEqual(validateToolSets(reloaded.toolSets,reloaded.tools.map(t=>t.id)),reloaded.toolSets.filter(s=>s.toolIds.length));
  const m=reloaded.modules.find(x=>x.id===result.moduleId);assert.equal(m.setLayout,'shared');assert.equal(m.setId,set.id);
  // Set-aware and compact arrangement keep the whole set in one module.
  const sets=await arrangeToolSets(reloaded);assert.ok(sharedIn({...reloaded,...sets},set.toolIds));assert.deepEqual(validateLayout({...reloaded,...sets}),[]);
  const smartSets=await smartArrange(reloaded,{mode:'sets'});assert.ok(sharedIn({...reloaded,...smartSets},set.toolIds));
  const compact=await smartArrange(reloaded);assert.ok(sharedIn({...reloaded,...compact},set.toolIds));
  const auto={...reloaded,...autoArrange(reloaded)};assert.ok(sharedIn(auto,set.toolIds));assert.deepEqual(validateLayout(auto),[]);
});

test('opts.toolSet "uniform" gives every tool an equal module, kept by set-aware arrangement',async()=>{
  const {setCoherence,findToolSets}=await import('../dist/tool-sets.js');
  const project=drawer(),tools=toolsOf('hex-key-set-1-5-10mm');
  const result=addToolGroup(project,tools,{name:'Imbusy',toolSet:{layout:'uniform'}}),next=result.project;
  assert.equal(result.placed,true);assert.equal(result.moduleIds.length,tools.length);assert.equal(result.moduleId,result.moduleIds[0]);
  assert.deepEqual(validateLayout(next),[]);
  assert.equal(next.modules.length,tools.length);
  assert.equal(new Set(next.modules.map(m=>`${m.width}x${m.height}`)).size,1);
  assert.ok(next.modules.every(m=>m.setLayout==='uniform'&&m.setId===result.setId&&!m.grouped&&m.width%42===0));
  assert.ok(next.tools.every(t=>next.tools.filter(o=>o.moduleId===t.moduleId).length===1));
  assert.equal(next.toolSets[0].layout,'uniform');assert.equal(next.toolSets[0].name,'Imbusy');
  assert.deepEqual(setCoherence(next,findToolSets(next).sets).unsatisfied,[]);
  const reloaded=validateProject(JSON.parse(JSON.stringify(next)));
  const smart=await smartArrange(reloaded,{mode:'sets'}),after={...reloaded,...smart};
  assert.deepEqual(setCoherence(after,findToolSets(after).sets).unsatisfied,[]);
  assert.equal(new Set(after.tools.map(t=>t.moduleId)).size,tools.length);
});

test('opts.toolSet validation and unique set ids',()=>{
  const tools=toolsOf('torx-key-set-t8-t40');
  assert.throws(()=>addToolGroup(drawer(),tools,{toolSet:{layout:'pairs'}}),error=>!!error.i18n);
  const a=addToolGroup(drawer(),tools,{toolSet:{id:'s',layout:'shared'}});
  const b=addToolGroup(a.project,toolsOf('hex-key-set-2-10mm'),{toolSet:{id:'s'}});
  assert.equal(a.setId,'s');assert.notEqual(b.setId,'s');
  assert.equal(b.project.toolSets.length,2);assert.equal(b.project.toolSets[1].layout,'shared','layout defaults to shared');
  assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(b.project))));
  // Without opts.toolSet nothing is registered and the module stays a manual group.
  const plain=addToolGroup(drawer(),tools);
  assert.equal(plain.project.toolSets,undefined);assert.equal(plain.setId,undefined);
  assert.equal(plain.project.modules[0].sizeMode,'manual');assert.equal(plain.project.modules[0].setLayout,undefined);
});

const capacityTool=(id)=>({id,name:id,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],depth:8,x:0,y:0,rotation:0,locked:false,moduleId:null,fingerGrips:[]});
const withFillers=count=>validateProject({...drawer({width:588,height:420,grid:10}),modules:Array.from({length:count},(_,i)=>({id:`filler-${i}`,x:i%20*10,y:Math.floor(i/20)*10,width:5,height:5,locked:false}))});
const layoutOptions=layout=>layout?{toolSet:{layout}}:{};
const isCapacityError=error=>error.i18n?.cs==='Projekt je příliš velký. Limit je 300 nástrojů a 400 modulů.';

test('adding sets refuses more than 400 modules atomically for every layout and a singleton',()=>{
  for(const layout of [null,'shared','auto','uniform'])for(const count of [1,2]){
    const project=withFillers(400),snapshot=structuredClone(project),tools=Array.from({length:count},(_,i)=>capacityTool(`new-${i}`)),original=structuredClone(tools);
    assert.throws(()=>addToolGroup(project,tools,layoutOptions(layout)),isCapacityError,`${layout||'plain'} with ${count} tools`);
    assert.deepEqual(project,snapshot,'The existing project is unchanged');
    assert.deepEqual(tools,original,'The supplied tool contours are unchanged');
  }
  const project=withFillers(399),snapshot=structuredClone(project);
  assert.throws(()=>addToolGroup(project,[capacityTool('a'),capacityTool('b')],layoutOptions('uniform')),isCapacityError,'Two uniform modules also refuse a total of 401');
  assert.deepEqual(project,snapshot);
});

test('exactly 400 modules survive placement and saving for shared, automatic, plain and uniform sets',()=>{
  for(const layout of [null,'shared','auto','uniform'])for(const count of [1,2]){
    const added=layout==='uniform'?count:1,project=withFillers(400-added),snapshot=structuredClone(project),tools=Array.from({length:count},(_,i)=>capacityTool(`new-${i}`));
    const result=addToolGroup(project,tools,layoutOptions(layout));
    assert.equal(result.placed,true,`${layout||'plain'} with ${count} tools`);
    assert.equal(result.project.modules.length,400);
    assert.deepEqual(validateLayout(result.project),[]);
    assert.equal(validateProject(JSON.parse(JSON.stringify(result.project))).modules.length,400,'The result remains a loadable saved project');
    assert.deepEqual(project,snapshot);
  }
});

test('the direct set API rejects a total above 300 tools before changing the project',()=>{
  const project=validateProject({...drawer(),tools:Array.from({length:300},(_,i)=>capacityTool(`existing-${i}`))}),snapshot=structuredClone(project);
  for(const layout of [null,'shared','auto','uniform']){
    assert.throws(()=>addToolGroup(project,[capacityTool('new')],layoutOptions(layout)),isCapacityError);
    assert.deepEqual(project,snapshot);
  }
});

test('large unplaced uniform sets keep bounded module coordinates and survive JSON reload',()=>{
  const project=blankProject(),tools=toolsOf('combination-wrench-set-6-32mm').map(tool=>scaleTool(tool,1.5));
  const {project:next,placed}=addToolGroup(project,tools,{toolSet:{layout:'uniform'}});
  assert.equal(placed,false);
  assert.equal(next.tools.length,26);
  assert.equal(next.modules.length,26);
  assert.ok(next.modules.every(module=>module.x>=0&&module.x<=4000&&module.y>=0&&module.y<=4000));
  assert.ok(next.modules.every(module=>module.x+module.width>project.width||module.y+module.height>project.height),'Every parked module remains outside the drawer');
  const reloaded=validateProject(JSON.parse(JSON.stringify(next)));
  assert.equal(reloaded.tools.length,26);
  assert.deepEqual(reloaded.modules,next.modules);
  assert.equal(project.tools.length,0,'The original project is unchanged');
});
