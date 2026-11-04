// Layout of tools recognised from a photo: one module, separate modules, or decided by the free space in the drawer.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {photoLayout,sharedArrangement,separateModulesFit} from '../dist/photo-layout.js';

globalThis.localStorage??={getItem:()=>null,setItem(){}};
const {blankProject}=await import('../dist/model.js');

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const tools=(count,w=20,h=100)=>Array.from({length:count},(_,i)=>({id:'t'+i,name:'Nástroj '+(i+1),points:rect(w,h),depth:12,x:0,y:0,rotation:0,locked:false,moduleId:null,fingerGrips:[]}));
const drawer=(width,height,extra={})=>({...blankProject(),width,height,...extra});
const info={name:'Sada z fotky'};

test('auto keeps the tools together in one module while it fits',()=>{
  const project=drawer(504,378),before=JSON.stringify(project),plan=photoLayout(project,tools(6),'auto',info);
  assert.equal(plan.layout,'shared');assert.equal(plan.arrangement,'ordered');
  assert.equal(JSON.stringify(project),before,'trying layouts must not change the project');
});

test('auto separates the tools when free space is split by a locked module',()=>{
  // A locked wall through the middle leaves two narrow halves: no shared module fits, separate modules do.
  const wall={id:'wall',name:'Stěna',x:210,y:0,width:84,height:378,locked:true};
  const project=drawer(504,378,{modules:[wall]}),list=tools(16,30,160);
  assert.equal(sharedArrangement(project,list,info),null);
  assert.equal(separateModulesFit(project,list),true);
  assert.deepEqual(photoLayout(project,list,'auto',info),{layout:'each'});
});

test('when nothing fits, auto stays separate so the drawer dialog can offer more space',()=>{
  const project=drawer(84,84),list=tools(5,30,160);
  assert.equal(separateModulesFit(project,list),false);
  assert.deepEqual(photoLayout(project,list,'auto',info),{layout:'each'});
});

test('an explicit choice is respected whatever the space',()=>{
  const project=drawer(84,84),list=tools(5,30,160);
  assert.deepEqual(photoLayout(project,list,'each',info),{layout:'each'});
  assert.deepEqual(photoLayout(project,list,'shared',info),{layout:'shared',arrangement:'ordered'});
  assert.equal(photoLayout(drawer(504,378),tools(4),'each',info).layout,'each');
});
