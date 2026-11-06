import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeOverlappingModules} from '../dist/module-merge.js';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout,pocketOutline} from '../dist/geometry.js';
import {moduleArea,moduleIntersects,validateModuleFootprint} from '../dist/module-footprint.js';
import {effectivePocketMargin} from '../dist/pocket-margin.js';
import {setCoherence} from '../dist/tool-sets.js';
import {getAppUnit,setAppUnit} from '../dist/units.js';

const clone=value=>structuredClone(value);
const points=(width=10,height=10)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const module=(id,x=0,y=0,width=84,height=84,extra={})=>({id,name:id,x,y,width,height,locked:false,sizeMode:'auto',...extra});
const tool=(id,moduleId,x,y,extra={})=>({id,name:id,moduleId,x,y,rotation:0,depth:8,locked:false,points:points(),...extra});
const project=(modules,tools=[],extra={})=>({...blankProject(),width:504,height:378,clearance:0,printMode:'solid',bottomMode:'plain',modules,tools,...extra});
const simple=()=>project([module('a'),module('b',42)],[tool('ta','a',10,10),tool('tb','b',60,50)]);
const immutable=(source,body)=>{const before=clone(source);try{return body();}finally{assert.deepEqual(source,before);}};
const valid=source=>assert.deepEqual(validateLayout(source),[]);
const reject=(source,pattern)=>immutable(source,()=>assert.throws(()=>mergeOverlappingModules(source,['a']),pattern));
const diagonalCells=[{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:1,y:2},{x:2,y:2}];

test('two diagonal stepped pockets merge their actual cells and retain the notch neighbour and all world poses',()=>{
  const source=project([module('a',0,0,126,126,{shape:'stepped',cells:clone(diagonalCells)}),module('b',42,0,126,126,{shape:'stepped',cells:clone(diagonalCells)}),module('notch',0,84,42,42)],
    [tool('ta','a',12,12,{rotation:45,points:points(100,8)}),tool('tb','b',54,12,{rotation:45,points:points(100,8)})]);
  assert.equal(moduleIntersects(source.modules[0],source.modules[1],42),true);
  const outlines=source.tools.map(item=>pocketOutline(item,source));
  const next=immutable(source,()=>mergeOverlappingModules(source,['b','a']));
  valid(next);assert.equal(next.modules.length,2);
  const merged=next.modules.find(item=>item.id==='b');
  assert.equal(merged.name,'b');assert.equal(merged.grouped,true);assert.equal(merged.sizeMode,'manual');
  assert.deepEqual([merged.x,merged.y,merged.width,merged.height],[0,0,168,126]);
  assert.equal(merged.cells.length,10);assert.equal(moduleArea(merged,42),10*42*42);
  assert.deepEqual(validateModuleFootprint(merged,42).cells,merged.cells);
  assert.deepEqual(next.modules.find(item=>item.id==='notch'),source.modules[2]);
  assert.equal(moduleIntersects(merged,next.modules.find(item=>item.id==='notch'),42),false);
  for(let i=0;i<source.tools.length;i++){
    assert.deepEqual({...next.tools[i],moduleId:source.tools[i].moduleId},source.tools[i]);
    assert.deepEqual(pocketOutline(next.tools[i],next),outlines[i]);
  }
  valid(validateProject(JSON.parse(JSON.stringify(next))));
});

test('overlap traversal is transitive, seeded components stay separate, and the first seed survives',()=>{
  const source=project([module('a'),module('b',42),module('c',84),module('x',252),module('y',294),module('outside',420)],
    [tool('ta','a',10,10),tool('tb','b',60,50),tool('tc','c',130,10)]);
  const next=immutable(source,()=>mergeOverlappingModules(source,['c','x','a','y']));
  assert.deepEqual(next.modules.map(item=>item.id),['c','x','outside']);
  assert.deepEqual(next.modules.map(item=>[item.x,item.width]),[[0,168],[252,126],[420,84]]);
  assert.ok(next.modules.every(item=>!item.cells));valid(next);
  assert.deepEqual(next.modules[2],source.modules[5]);
});

test('touch-only and unseeded overlaps do not merge or allocate a replacement project',()=>{
  const source=project([module('a'),module('b',84),module('c',252),module('d',294)]);
  assert.equal(mergeOverlappingModules(source,['a']),source);
  assert.equal(mergeOverlappingModules(source,[]),source);
  assert.throws(()=>mergeOverlappingModules(source,['missing']),/neexistuje/);
});

test('locks anywhere in the overlap component reject without mutating any record',()=>{
  const lockedModule=simple();lockedModule.modules[1].locked=true;reject(lockedModule,/zamčený/);
  const lockedTool=simple();lockedTool.tools[1].locked=true;reject(lockedTool,/zamčený/);
  const chain=project([module('a'),module('b',42),module('c',84,0,84,84,{locked:true})]);reject(chain,/zamčený/);
});

test('current pockets and explicit zero survive mixed module margins, including unchanged inheritance',()=>{
  const source=simple();source.clearance=1.1;source.modules[0].pocketMargin=.8;source.modules[1].pocketMargin=0;
  source.tools[0].pocketMargin=0;
  const old=source.tools.map(item=>pocketOutline(item,source)),next=immutable(source,()=>mergeOverlappingModules(source,['a']));
  assert.equal(next.modules[0].pocketMargin,.8);
  assert.equal(next.tools[0].pocketMargin,0);assert.equal(next.tools[1].pocketMargin,0);
  for(let i=0;i<source.tools.length;i++)assert.deepEqual(pocketOutline(next.tools[i],next),old[i]);
  const common=simple();common.modules.forEach(item=>item.pocketMargin=.8);
  const inherited=mergeOverlappingModules(common,['a']);
  assert.ok(inherited.tools.every(item=>!Object.hasOwn(item,'pocketMargin')));
  const legacy=simple();legacy.clearance=1.1;legacy.modules[0].pocketMargin=.8;
  const preserved=mergeOverlappingModules(legacy,['a']);assert.equal(effectivePocketMargin(preserved.tools[1],preserved),1.1);assert.equal(preserved.tools[1].pocketMargin,1.1);
});

test('module and app display-unit inheritance is frozen only where the surviving unit would change it',()=>{
  const source=simple();source.unit='mm';source.modules[0].unit='mm';source.modules[1].unit='in';
  source.tools[0].unit='in';
  const next=immutable(source,()=>mergeOverlappingModules(source,['a']));
  assert.equal(next.modules[0].unit,'mm');assert.equal(next.tools[0].unit,'in');assert.equal(next.tools[1].unit,'in');
  assert.deepEqual(next.tools.map(item=>[item.x,item.y,item.rotation,item.points]),source.tools.map(item=>[item.x,item.y,item.rotation,item.points]));
  const previous=getAppUnit();try{
    setAppUnit('in',{save:false});const inherited=simple();inherited.unit='';inherited.modules[0].unit='mm';
    const result=mergeOverlappingModules(inherited,['a']);assert.equal(result.tools[1].unit,'in');assert.equal(Object.hasOwn(result.tools[0],'unit'),false);
  }finally{setAppUnit(previous,{save:false});}
});

test('all existing tool metadata, local attachments, set records and source constraints survive',()=>{
  const source=simple();source.modules[0].sizeMode='manual';source.modules[0].grouped=true;
  Object.assign(source.tools[0],{unit:'in',sizeLabel:'13 mm',nominalSize:{value:13,unit:'mm'},category:'Klíče',setNames:['Dílna'],fingerGrips:[],pocketMagnets:[],pocketFit:{mode:'functional',signature:'deadbeef'},sourceInfo:{photo:'fixture',sourceContour:[1,2,3]}});
  source.toolSets=[{id:'auto',name:'Nářadí',layout:'auto',toolIds:['ta']}];
  const next=immutable(source,()=>mergeOverlappingModules(source,['a']));
  assert.deepEqual(next.tools[0],source.tools[0]);assert.deepEqual({...next.tools[1],moduleId:'b'},source.tools[1]);
  assert.deepEqual(next.toolSets,source.toolSets);assert.equal(next.modules[0].sizeMode,'manual');valid(next);
});

test('coherent explicit uniform/shared/ordered set contracts reject merges that would break them',()=>{
  const uniform=simple();uniform.toolSets=[{id:'set',name:'Stejné moduly',layout:'uniform',toolIds:['ta','tb']}];
  assert.deepEqual(setCoherence(uniform,uniform.toolSets).satisfied,['set']);reject(uniform,/uspořádání sady/);
  const shared=simple();shared.toolSets=[{id:'set',name:'Samostatná sada',layout:'shared',toolIds:['ta']}];
  assert.deepEqual(setCoherence(shared,shared.toolSets).satisfied,['set']);reject(shared,/uspořádání sady/);
  const ordered=simple();ordered.modules.push(module('other',252));ordered.tools.push(tool('tc','other',264,10));
  ordered.tools[0].nominalSize={value:10,unit:'mm'};ordered.tools[2].nominalSize={value:13,unit:'mm'};
  ordered.toolSets=[{id:'set',name:'Pořadí',layout:'auto',arrangement:'ordered',order:'asc',toolIds:['ta','tc']}];
  assert.deepEqual(setCoherence(ordered,ordered.toolSets).satisfied,['set']);reject(ordered,/uspořádání sady/);
});

test('already unsatisfied sets remain editable and pure matching set tags alone are retained',()=>{
  const source=simple();source.modules[1].width=126;
  source.toolSets=[{id:'set',name:'Již různé moduly',layout:'uniform',toolIds:['ta','tb']}];
  assert.deepEqual(setCoherence(source,source.toolSets).satisfied,[]);
  const next=mergeOverlappingModules(source,['a']);assert.deepEqual(next.toolSets,source.toolSets);valid(next);
  const pure=simple();pure.toolSets=[{id:'set',name:'Celá sada',layout:'shared',toolIds:['ta','tb']}];
  pure.modules.forEach(item=>Object.assign(item,{setId:'set',setLayout:'shared'}));
  const matching=mergeOverlappingModules(pure,['a']);assert.equal(matching.modules[0].setId,'set');assert.equal(matching.modules[0].setLayout,'shared');
  const mixed=clone(pure);delete mixed.modules[1].setId;delete mixed.modules[1].setLayout;
  const cleared=mergeOverlappingModules(mixed,['a']);assert.equal(Object.hasOwn(cleared.modules[0],'setId'),false);assert.equal(Object.hasOwn(cleared.modules[0],'setLayout'),false);
});

test('real pocket intersections and insufficient internal walls cannot be hidden by merging shells',()=>{
  for(const x of [59,60,61]){
    const source=project([module('a'),module('b',42)],[tool('ta','a',50,10),tool('tb','b',x,10)]);
    reject(source,/Kapsy|Mezi kapsami/);
  }
});

test('raster unions reject enclosed holes and excessive cell budgets without filling or bounding them',()=>{
  const cee=[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2}];
  const ring=project([module('a',0,0,126,126,{shape:'stepped',cells:cee}),module('b',84,0,42,126)]);
  reject(ring,/souvislé buňky.*bez otvorů/);
  const large=project([module('a',0,0,2688,2688),module('b',42,0,2688,2688)],[],{width:3000,height:3000});
  reject(large,/příliš velký/);
});

test('legacy non-Gridfinity rectangles can merge off-grid, but their bounding union cannot swallow a neighbour',()=>{
  const source=project([module('a',0,0,70,42),module('b',42,20,70,42)],[tool('ta','a',8,8),tool('tb','b',60,40)]);
  const next=immutable(source,()=>mergeOverlappingModules(source,['a']));valid(next);assert.deepEqual([next.modules[0].width,next.modules[0].height],[112,62]);assert.equal(next.modules[0].cells,undefined);
  for(const bottomMode of ['magnet','adhesive']){
    const other=clone(source);other.bottomMode=bottomMode;
    const merged=immutable(other,()=>mergeOverlappingModules(other,['a']));valid(merged);assert.equal(merged.bottomMode,bottomMode);assert.deepEqual([merged.modules[0].width,merged.modules[0].height],[112,62]);
  }
  const blocked=clone(source);blocked.modules.push(module('notch',0,45,20,17));reject(blocked,/Moduly.*překrývají/);
  const grid=clone(source);grid.bottomMode='grid';reject(grid,/v rastru/);
});

test('Gridfinity retains 42 mm cells and rejects a mismatched grid without applying print-bed limits',()=>{
  const source=simple();source.bottomMode='grid';source.bedWidth=50;source.bedHeight=50;
  const next=mergeOverlappingModules(source,['a']);valid(next);assert.equal(next.modules[0].width,126);assert.equal(next.limitToBed,true);
  const invalid=project([module('a',0,0,80,80),module('b',40,0,80,80)],[],{grid:40,bottomMode:'grid'});reject(invalid,/přesně 42 mm/);
});

test('unchanged old depth warnings are tolerated, while merged holding magnets cannot create a new sibling depth problem',()=>{
  const warning=simple();warning.tools[0].depth=19;
  const next=mergeOverlappingModules(warning,['a']);assert.equal(validateLayout(next).filter(issue=>issue.type==='depth').length,1);
  const source=project([module('a',0,0,126,126),module('b',42,0,126,126)],
    [tool('ta','a',14,14,{points:points(14,70),pocketMagnets:[{id:'magnet',x:7,y:50,diameter:4,height:5}]}),tool('tb','b',70,14,{points:points(72,14),depth:16})],{printMode:'light'});
  assert.equal(validateLayout(source).filter(issue=>issue.type==='depth').length,0);
  reject(source,/magnetem.*výšku vložky/);
});

test('scoped validation returns the exact full diagnostics involving affected modules and their tools',()=>{
  const source=simple();source.modules.push(module('outside',462,350,84,84));
  source.tools.push(tool('unplaced',null,12,12),tool('bad-depth','outside',475,365,{depth:19}),tool('far-unplaced',null,1500,1500));
  source.tools[0].depth=19;
  for(const requested of [['a'],['ta'],['outside'],['unplaced'],[],['missing']]){
    const expanded=new Set(requested);for(const item of source.tools)if(expanded.has(item.moduleId))expanded.add(item.id);
    const expected=validateLayout(source).filter(issue=>!issue.ids.length||issue.ids.some(id=>expanded.has(id)));
    assert.deepEqual(validateLayout(source,{affectedIds:requested}),expected,JSON.stringify(requested));
  }
  const brokenEarlier=clone(source);brokenEarlier.modules.unshift(module('invalid',0,0,84,84,{shape:'invalid'}));
  const expected=validateLayout(brokenEarlier).filter(issue=>!issue.ids.length||issue.ids.some(id=>['a','ta'].includes(id)));
  assert.deepEqual(validateLayout(brokenEarlier,{affectedIds:['a']}),expected,'an invalid earlier unselected footprint must skip its pair row exactly like full validation');
});

test('scoped collision checks still include unplaced foreign tools while unrelated old errors remain ignored',()=>{
  const source=simple();source.tools.push(tool('unplaced',null,12,12));
  reject(source,/Kapsy/);
  const unrelated=simple();unrelated.modules.push(module('outside',462,350,84,84));unrelated.tools.push(tool('far-unplaced',null,1500,1500,{depth:19}));
  const merged=immutable(unrelated,()=>mergeOverlappingModules(unrelated,['a']));
  assert.equal(merged.modules.length,2);assert.ok(validateLayout(merged).some(issue=>issue.ids.includes('far-unplaced')));
  assert.deepEqual(validateLayout(merged,{affectedIds:['a']}),[]);
});

test('scoped depth diagnostics include module-wide holding-magnet lift and global dimension issues',()=>{
  const source=project([module('a',0,0,126,126)],
    [tool('ta','a',14,14,{points:points(14,70),pocketMagnets:[{id:'magnet',x:7,y:50,diameter:4,height:5}]}),tool('tb','a',70,14,{points:points(40,14),depth:16})],{printMode:'light'});
  assert.deepEqual(validateLayout(source,{affectedIds:['a']}),validateLayout(source));
  assert.deepEqual(validateLayout(source,{affectedIds:['tb']}),validateLayout(source).filter(issue=>!issue.ids.length||issue.ids.includes('tb')));
  const invalid=project([],[],{insertHeight:2.4,base:2.4});assert.deepEqual(validateLayout(invalid,{affectedIds:[]}),validateLayout(invalid));
});
