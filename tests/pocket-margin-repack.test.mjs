import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout,pocketOutline} from '../dist/geometry.js';
import {smartArrange} from '../dist/smart-layout.js';
import {prepareModuleMargins,applyCreatedModuleMargins,releaseSoloMargins,restoreSoloMargins} from '../dist/module-margin.js';
import {effectivePocketMargin} from '../dist/pocket-margin.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const narrow=i=>({id:`t${i}`,name:`Klic ${i}`,points:rectangle(6+i%3,90+i%4*2),x:0,y:0,depth:8,rotation:0,fingerGrips:[],moduleId:null});
const drawer=extra=>validateProject({...blankProject(),width:840,height:630,tools:[],modules:[],...extra});
const area=project=>project.modules.reduce((sum,module)=>sum+module.width*module.height,0);
const margins=project=>Object.fromEntries(project.tools.map(tool=>[tool.id,effectivePocketMargin(tool,project)]));
// The rotation-independent pocket size: its two side lengths, shortest first.
const pocketSize=(project,tool)=>{const p=pocketOutline(tool,project),xs=p.map(q=>q.x),ys=p.map(q=>q.y);return[Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)].sort((a,b)=>a-b).map(v=>Math.round(v*1000)/1000).join('x');};
const pockets=project=>Object.fromEntries(project.tools.map(tool=>[tool.id,pocketSize(project,tool)]));
// The same steps as addTools() for tools added from a photo.
function fromPhoto(margin,count=12,extra){
  const base=drawer(extra),{tools,plan}=prepareModuleMargins(base,Array.from({length:count},(_,i)=>narrow(i)),margin),next={...base,tools};
  return applyCreatedModuleMargins({...next,...autoArrange(next)},plan);
}

for(const margin of [.8,1]){
  test(`photo modules with a ${margin} mm margin merge in Smart compact and keep every pocket`,async()=>{
    const project=fromPhoto(margin),pocketsBefore=pockets(project);
    assert.equal(project.modules.length,12);assert.ok(project.modules.every(module=>module.pocketMargin===margin));
    const next={...project,...await smartArrange(project,{mode:'compact',moduleShape:'stepped',merge:true})};
    assert.ok(next.modules.length<project.modules.length,`modules ${next.modules.length}`);assert.ok(area(next)<area(project),`area ${area(next)}`);
    assert.deepEqual(validateLayout(next).map(issue=>issue.message),[]);
    assert.deepEqual(pockets(next),pocketsBefore);
    assert.ok(next.modules.every(module=>module.pocketMargin===margin),'the value returns to each module');
    assert.ok(next.tools.every(tool=>!Object.hasOwn(tool,'pocketMargin')),'inheritance stays an inheritance');
  });
}

test('a module margin packs exactly like the same drawer clearance, including when tools stop fitting together',async()=>{
  const options={mode:'compact',moduleShape:'stepped',merge:true},size=project=>[project.modules.length,area(project)];
  for(const margin of [.8,1,1.5]){
    const plain=drawer({clearance:margin,tools:Array.from({length:12},(_,i)=>narrow(i))}),arranged={...plain,...autoArrange(plain)},own=fromPhoto(margin);
    assert.deepEqual(size({...own,...await smartArrange(own,options)}),size({...arranged,...await smartArrange(arranged,options)}));
  }
});

test('a later drawer clearance change does not resize repacked photo pockets',async()=>{
  const project=fromPhoto(.8),next={...project,...await smartArrange(project,{mode:'compact',moduleShape:'rectangular',merge:true})};
  assert.deepEqual(margins({...next,clearance:3}),margins(next));
});

test('merging modules with different margins keeps each tool on its own value',async()=>{
  const base=fromPhoto(1.5,6),extra=Array.from({length:6},(_,i)=>narrow(i+6)),{tools,plan}=prepareModuleMargins(base,extra,.5),trial={...base,tools:[...base.tools,...tools]};
  const project=applyCreatedModuleMargins({...trial,...autoArrange(trial)},plan),before=margins(project);
  assert.deepEqual([...new Set(Object.values(before))].sort(),[.5,1.5]);
  const next={...project,...await smartArrange(project,{mode:'compact',moduleShape:'stepped',merge:true})};
  assert.ok(next.modules.length<project.modules.length);assert.deepEqual(margins(next),before);assert.deepEqual(validateLayout(next).map(issue=>issue.message),[]);
});

test('Auto keeps module margins and is stable when repeated',()=>{
  const project=fromPhoto(1.5,4),once={...project,...autoArrange(project)},twice={...once,...autoArrange(once)};
  assert.deepEqual(margins(once),margins(project));assert.deepEqual(margins(twice),margins(project));
  assert.ok(twice.modules.every(module=>module.pocketMargin===1.5));assert.ok(twice.tools.every(tool=>!Object.hasOwn(tool,'pocketMargin')));
});

test('a tool that no longer fits keeps its margin until it has a module again',()=>{
  const project=fromPhoto(1.5,2),small={...project,height:84,width:84},arranged=autoArrange(small),next={...small,...arranged};
  assert.ok(arranged.unplaced.length>0);
  for(const id of arranged.unplaced)assert.equal(effectivePocketMargin(next.tools.find(tool=>tool.id===id),next),1.5);
});

test('only free single-tool modules are released, without changing the input',()=>{
  const module=(id,fields)=>({id,name:id,x:0,y:0,width:42,height:42,pocketMargin:2,...fields}),member=(id,moduleId,fields)=>({...narrow(0),id,moduleId,...fields});
  const project={tools:[member('free','m-free'),member('a','m-many'),member('b','m-many'),member('c','m-locked'),member('d','m-manual',{}),member('e','m-grouped'),member('f','m-tool-lock',{locked:true}),member('g','m-own',{pocketMargin:1}),member('h','m-uniform')],
    toolSets:[{id:'set',layout:'uniform',toolIds:['h']}],
    modules:[module('m-free'),module('m-many'),module('m-locked',{locked:true}),module('m-manual',{sizeMode:'manual'}),module('m-grouped',{grouped:true}),module('m-tool-lock'),module('m-own'),module('m-uniform')]};
  const before=structuredClone(project),{project:source,released}=releaseSoloMargins(project);
  assert.deepEqual([...released.keys()],['free']);assert.equal(source.tools.find(tool=>tool.id==='free').pocketMargin,2);
  assert.equal(source.modules.find(m=>m.id==='m-free').pocketMargin,undefined);assert.equal(source.modules.filter(m=>m.pocketMargin===2).length,7);
  assert.deepEqual(project.tools.map(tool=>tool.pocketMargin),before.tools.map(tool=>tool.pocketMargin));assert.equal(project.modules[0].pocketMargin,2);
  const restored=restoreSoloMargins(source,released);
  assert.equal(restored.modules.find(m=>m.id==='m-free').pocketMargin,2);assert.equal(Object.hasOwn(restored.tools.find(tool=>tool.id==='free'),'pocketMargin'),false);
});
