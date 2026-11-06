// Final layout stage: real steps, a second chance for tools outside, and merging when the customer allows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {smartArrange} from '../dist/smart-layout.js';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {catalogSets} from '../dist/catalog/index.js';
import {moduleIntersects,moduleOutline} from '../dist/module-footprint.js';

const IDS=['combination-wrench-set-6-32mm','combination-wrench-set-6-22mm','hex-key-set-1-5-10mm','torx-key-set-t8-t40','socket-set-1-4in-4-14mm','bit-set-25mm-with-holder','screwdriver-set-sl-ph-pz-7pcs'];
function workshop(ids=IDS,size={width:1100,height:800}){
  let project={...blankProject(),id:'workshop',...size};
  for(const id of ids){
    const set=catalogSets().find(item=>item.id===id),tools=set.tools.map((item,index)=>{const tool={id:`${id}-${index}`,name:item.name.cs,points:item.points,unit:item.unit,nominalSize:{value:item.size,unit:item.unit},x:0,y:0,rotation:0,depth:10,moduleId:null,locked:false};tool.fingerGrips=automaticFingerGrips(tool,{radius:9});return tool;});
    project=addToolGroup(project,tools,{name:set.name.cs,arrangement:'ordered',order:'asc',toolSet:{name:set.name.cs,layout:'shared'}}).project;
  }
  project=validateProject(project);return {...project,...autoArrange(project)};
}
const inside=(m,p)=>m.x+m.width<=p.width+.001&&m.y+m.height<=p.height+.001;
const clean=(p,r)=>{const modules=r.modules.filter(m=>inside(m,p)),ids=new Set(modules.map(m=>m.id));return validateLayout({...p,...r,modules,tools:r.tools.filter(t=>ids.has(t.moduleId))});};

test('logic mode fits every tool of a full drawer and keeps each set in one module',async()=>{
  const p=workshop(),r=await smartArrange(p,{mode:'sets',moduleShape:'stepped'});
  assert.equal(r.unplaced.length,0);assert.equal(clean(p,r).length,0);assert.equal(r.modules.length,IDS.length);
  for(const id of IDS)assert.equal(new Set(r.tools.filter(t=>t.id.startsWith(id+'-')).map(t=>t.moduleId)).size,1,id);
});

test('stepped modules really lose the empty cells of a ragged set',async()=>{
  const p=workshop(),r=await smartArrange(p,{mode:'sets',moduleShape:'stepped'}),own=r.modules.find(m=>r.tools.some(t=>t.moduleId===m.id&&t.id.startsWith(IDS[0])));
  assert.ok(own.cells);assert.ok(own.cells.length<(own.width/p.grid)*(own.height/p.grid));
});

test('merging puts unrelated tools into free room and uses less drawer area',async()=>{
  const p=workshop(),logic=await smartArrange(p,{mode:'sets',moduleShape:'stepped'}),space=await smartArrange(p,{mode:'compact',moduleShape:'stepped',merge:true});
  assert.equal(space.unplaced.length,0);assert.equal(clean(p,space).length,0);
  assert.ok(space.stats.mergedModules>0);assert.ok(space.modules.length<logic.modules.length);assert.ok(space.stats.afterArea<logic.stats.afterArea);
  const mixed=space.modules.find(m=>new Set(space.tools.filter(t=>t.moduleId===m.id).map(t=>t.id.replace(/-\d+$/,''))).size>1);
  assert.ok(mixed,'one module holds tools of several sets');assert.equal(mixed.setId,undefined);assert.equal(mixed.setLayout,undefined);assert.equal(mixed.grouped,true);
  assert.equal(validateProject({...p,...space}).tools.length,p.tools.length);
});

test('without the merge option modules stay separate',async()=>{
  const p=workshop(IDS.slice(2)),r=await smartArrange(p,{mode:'compact',moduleShape:'stepped'});
  assert.equal(r.stats.mergedModules,0);assert.ok(!r.modules.some(m=>m.id.startsWith('merged-')));
});

test('locked and manual modules neither give nor take tools',async()=>{
  const p=workshop(IDS.slice(2,5),{width:840,height:630}),[locked,manual]=p.modules;locked.locked=true;manual.sizeMode='manual';
  const held=id=>p.tools.filter(t=>t.moduleId===id).map(t=>t.id).sort(),r=await smartArrange(p,{mode:'compact',moduleShape:'stepped',merge:true});
  for(const id of [locked.id,manual.id])assert.deepEqual(r.tools.filter(t=>t.moduleId===id).map(t=>t.id).sort(),held(id));
  assert.deepEqual([r.modules.find(m=>m.id===locked.id).x,r.modules.find(m=>m.id===locked.id).y],[locked.x,locked.y]);
});

test('cell comparison agrees with the outline comparison',()=>{
  const stepped={id:'s',x:42,y:0,width:126,height:84,shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1}]};
  assert.equal(moduleIntersects(stepped,{id:'a',x:84,y:42,width:84,height:42},42),false,'sits in the notch');
  assert.equal(moduleIntersects(stepped,{id:'b',x:42,y:42,width:84,height:42},42),true);
  assert.equal(moduleIntersects({id:'c',x:84,y:42,width:42,height:42,shape:'stepped',cells:[{x:0,y:0}]},stepped,42),false);
  assert.equal(moduleOutline(stepped,42).length>4,true);
});

test('a rejected merge leaves the found layout untouched',async()=>{
  const {tightenLayout}=await import('../dist/space-layout.js');
  const p=workshop(IDS.slice(2,4),{width:840,height:630}),before=JSON.stringify({tools:p.tools,modules:p.modules}),placed=new Set(p.tools.map(t=>t.id));
  const r=await tightenLayout(p,{tools:p.tools,modules:p.modules},{merge:true,pack:()=>null,better:()=>false,metric:()=>({placed})});
  assert.equal(JSON.stringify({tools:r.tools,modules:r.modules}),before);
});

test('uniform and hand-arranged modules are neither cut nor turned',async()=>{
  const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}],tool=(id,moduleId,x,y,w,h)=>({id,name:id,points:rect(w,h),x,y,rotation:0,depth:8,moduleId,locked:false,fingerGrips:[]});
  const p=validateProject({...blankProject(),id:'kept',width:840,height:630,toolSets:[{id:'u',name:'U',toolIds:['u1'],layout:'uniform'}],
    modules:[{id:'um',name:'U',x:0,y:0,width:252,height:252,sizeMode:'auto',setId:'u',setLayout:'uniform'},{id:'hand',name:'Hand',x:252,y:0,width:252,height:252,sizeMode:'auto'}],
    tools:[tool('u1','um',8,8,30,30),tool('h1','hand',260,8,30,30),tool('h2','hand',260,200,200,30)]});
  const {tightenLayout}=await import('../dist/space-layout.js'),offered=new Map(),placed=new Set(p.tools.map(t=>t.id));
  const r=await tightenLayout(p,{tools:p.tools,modules:p.modules},{moduleShape:'stepped',merge:true,pack:(source,stay,atoms)=>{for(const atom of atoms)offered.set(atom.id,atom.options.length);return null;},better:()=>false,metric:()=>({placed})});
  assert.equal(r.modules.find(m=>m.id==='um').cells,undefined);
  assert.equal(offered.get('hand'),1,'no turned or rebuilt variant of a hand-arranged module');assert.equal(offered.get('um'),1);
});

test('progress keeps moving through the last stage and ends at one',async()=>{
  const seen=[],p=workshop(IDS.slice(2,5),{width:840,height:630});await smartArrange(p,{mode:'compact',moduleShape:'stepped',merge:true,onProgress:event=>seen.push(event)});
  const last=seen.filter(event=>event.stage==='tighten');assert.ok(last.length>1);assert.ok(last[0].progress<1);assert.equal(seen.at(-1).progress,1);
});

// A tool alone in a drawer has no neighbour to justify a step, the module must still follow it.
const diagonal=extra=>({...validateProject({...blankProject(),id:'d',name:'d',width:504,height:378,grid:42,bottomMode:'grid',bedWidth:600,bedHeight:600}),tools:[{id:'w',name:'w',points:[{x:-60,y:-20},{x:510,y:-20},{x:510,y:20},{x:-60,y:20}],x:0,y:0,rotation:36,depth:8,moduleId:null,fingerGrips:[],locked:false,...extra}]});
test('stepped layout follows a lone diagonal tool although no neighbour stands in the notches',async()=>{
  const p=diagonal(),a=autoArrange(p),b={...p,tools:a.tools,modules:a.modules},r=await smartArrange(b,{mode:'compact',moduleShape:'stepped'}),[module]=r.modules;
  assert.ok(module.cells?.length<module.width/42*(module.height/42)/2,'most of the empty raster is gone');
  assert.equal(validateLayout({...b,...r}).length,0);
  const square=await smartArrange(b,{mode:'compact',moduleShape:'rectangular'});assert.equal(square.modules[0].cells,undefined);
});
test('arranging keeps existing steps, and applies or removes them only when a shape is requested',()=>{
  const p=diagonal(),first=autoArrange(p),placed={...p,tools:first.tools,modules:first.modules};
  assert.equal(first.modules[0].cells,undefined,'no requested shape leaves plain modules alone');
  const stepped=autoArrange(placed,{moduleShape:'stepped'}),cut={...p,tools:stepped.tools,modules:stepped.modules};assert.ok(stepped.modules[0].cells?.length>0);
  assert.equal(autoArrange(cut).modules[0].cells?.length,stepped.modules[0].cells.length,'adding a tool elsewhere does not erase steps');
  assert.equal(autoArrange(cut,{moduleShape:'rectangular'}).modules[0].cells,undefined);
  const manual={...placed,modules:placed.modules.map(m=>({...m,sizeMode:'manual'}))};assert.equal(autoArrange(manual,{moduleShape:'stepped'}).modules[0].cells,undefined,'a hand-sized module is not cut');
});
test('a module with its own pocket margin is cut too and keeps every pocket in material',async()=>{
  const p=diagonal({pocketMargin:.8}),a=autoArrange(p),b={...p,tools:a.tools,modules:a.modules.map(m=>({...m,pocketMargin:.8}))},r=await smartArrange(b,{mode:'compact',moduleShape:'stepped'});
  assert.ok(r.modules[0].cells?.length>0);assert.equal(validateLayout({...b,...r}).length,0);
});
