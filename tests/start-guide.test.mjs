import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../dist/geometry.js';
import {blankProject,validateProject} from '../dist/model.js';
import {initialGuideState,isUntouchedDemo,reconcileGuide,withoutDemoTools} from '../dist/start-guide.js';

const demo=()=>validateProject({...createDemoProject(),id:'sample'});
const active=(step,extra={})=>({status:'active',step,baseline:0,projectId:'p',...extra});

test('only an untouched stored sample counts as nothing made yet',()=>{
  const sample=demo();
  assert.equal(isUntouchedDemo(validateProject(JSON.parse(JSON.stringify({...demo(),id:'other'}))),sample),true);
  assert.equal(isUntouchedDemo({...demo(),updatedAt:'2026-01-01T00:00:00Z'},sample),true);
  for(const change of [p=>{p.name='Renamed';},p=>{p.insertHeight=30;},p=>{p.printMode='light';},p=>{p.bottomMode='magnet';},p=>{p.clearance=1;},p=>{p.sizeLabels=true;},p=>{p.tools[0].name='Moje kleště';},p=>{p.tools[0].sizeLabel='17';},p=>{p.tools[0].pocketMargin=1;},p=>{p.modules[0].name='Modul';},p=>{p.modules[0].locked=true;}]){
    const edited=demo();change(edited);assert.equal(isUntouchedDemo(validateProject(edited),sample),false,change.toString());
  }
  const moved=demo();moved.modules[0].x+=42;assert.equal(isUntouchedDemo(moved,sample),false);
  const extra=demo();extra.tools=extra.tools.slice(1);assert.equal(isUntouchedDemo(extra,sample),false);
  const deeper=demo();deeper.tools[0].depth+=1;assert.equal(isUntouchedDemo(deeper,sample),false);
  const wider=demo();wider.width+=1;assert.equal(isUntouchedDemo(wider,sample),false);
  assert.equal(isUntouchedDemo(validateProject(blankProject()),sample),false);
});

test('seeded sample tools leave the library, own tools stay',()=>{
  const sample=demo(),seeded=sample.tools[0],own={...seeded,id:'mine'},edited={...sample.tools[1],points:[...sample.tools[1].points,{x:1,y:1}]};
  const categorized={...sample.tools[2],category:'hand'},stored={...sample.tools[3],x:0,y:0,moduleId:null};
  assert.deepEqual(withoutDemoTools([seeded,own,edited,categorized,stored],sample).map(tool=>tool.id),['mine',edited.id,categorized.id]);
});

test('people with work skip the guide, newcomers start at the question',()=>{
  assert.equal(initialGuideState(null,true).status,'done');
  assert.equal(initialGuideState(null,false).step,'welcome');
  assert.equal(initialGuideState({status:'done'},false).status,'done');
  assert.equal(initialGuideState(active('check'),true).step,'check');
  assert.equal(initialGuideState({status:'active',step:'nonsense'},false).step,'welcome');
});

test('the guide advances only when something really arrived',()=>{
  const tools=active('tools');
  assert.equal(reconcileGuide(tools,{id:'p',count:0}),tools,'cancelled flow stays put');
  assert.equal(reconcileGuide(tools,{id:'p',count:2}).step,'arrange');
  const more=active('tools',{baseline:3});
  assert.equal(reconcileGuide(more,{id:'p',count:3}),more,'existing content is not an addition');
  assert.equal(reconcileGuide(more,{id:'p',count:4}).step,'arrange');
  const undone=reconcileGuide(more,{id:'p',count:2});assert.equal(undone.step,'tools');assert.equal(undone.baseline,2,'undo lowers the baseline');
  assert.equal(reconcileGuide(undone,{id:'p',count:3}).step,'arrange','the next addition still counts');
});

test('opening finished work ends the guide',()=>{
  assert.equal(reconcileGuide(active('welcome'),{id:'p',count:5}).status,'done');
  assert.equal(reconcileGuide(active('tools'),{id:'imported',count:5}).status,'done');
  assert.equal(reconcileGuide(active('check'),{id:'imported',count:5}).status,'done');
});

test('an empty project keeps the guide going',()=>{
  assert.equal(reconcileGuide(active('tools'),{id:'new',count:0}).projectId,'new');
  assert.equal(reconcileGuide(active('tools'),{id:'new',count:0}).step,'tools');
  for(const step of ['arrange','check','export'])assert.equal(reconcileGuide(active(step,{baseline:2}),{id:'new',count:0}).step,'tools',step);
  assert.equal(reconcileGuide(active('arrange',{baseline:2}),{id:'p',count:0}).step,'tools','removing everything returns to adding');
  assert.equal(reconcileGuide(active('welcome',{projectId:''}),{id:'p',count:0}).projectId,'p');
  const done={status:'done'};assert.equal(reconcileGuide(done,{id:'p',count:0}),done);
});
