import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout,pocketOutline,resizeModule} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';
import {smartArrange} from '../dist/smart-layout.js';
import {steppedModuleFootprint} from '../dist/module-footprint.js';
import {effectivePocketMargin} from '../dist/pocket-margin.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const tool=(id,pocketMargin)=>({id,name:id,points:rectangle(32,32),x:0,y:0,rotation:0,depth:8,moduleId:null,fingerGrips:[],...(pocketMargin===undefined?{}:{pocketMargin})});

test('standalone and shared packing reserve each incoming tool margin including an explicit zero',()=>{
  const project=validateProject({...blankProject(),width:252,height:252,clearance:.8,tools:[tool('zero',0),tool('wide',3)]}),before=structuredClone(project);
  const arranged=autoArrange(project),next={...project,...arranged};assert.deepEqual(validateLayout(next),[]);assert.deepEqual(arranged.unplaced,[]);
  assert.equal(arranged.modules.find(m=>m.id===arranged.tools.find(t=>t.id==='zero').moduleId).width,42);
  assert.equal(arranged.modules.find(m=>m.id===arranged.tools.find(t=>t.id==='wide').moduleId).width,84);
  const shared=addToolGroup({...project,tools:[]},project.tools,{name:'Different margins',arrangement:'ordered',checkManufacturing:false});
  assert.equal(shared.placed,true);assert.deepEqual(validateLayout(shared.project),[]);
  assert.deepEqual(shared.project.tools.map(t=>t.pocketMargin).sort((a,b)=>a-b),[0,3]);assert.deepEqual(project,before);
});

test('module resizing and stepped footprint construction use inherited margins rather than the drawer fallback',()=>{
  const project=validateProject({...blankProject(),width:168,height:168,clearance:0,
    modules:[{id:'large',name:'large',x:0,y:0,width:84,height:84,sizeMode:'manual',pocketMargin:10}],
    tools:[{...tool('inside'),points:rectangle(10,10),x:25,y:25,moduleId:'large'}]});
  assert.deepEqual(validateLayout(project),[]);
  const fitted=resizeModule(project,'large',{mode:'auto'});assert.equal(fitted.modules[0].width,42);assert.equal(fitted.modules[0].pocketMargin,10);
  const stepped=steppedModuleFootprint(project,project.modules[0]);assert.equal(stepped.width,84);assert.equal(stepped.height,84,'the expanded pocket occupies both grid axes');
  const smaller={...project,modules:[{...project.modules[0],pocketMargin:0}]},cut=steppedModuleFootprint(smaller,smaller.modules[0]);
  assert.ok(cut.width<stepped.width||cut.height<stepped.height,'a zero inherited margin genuinely frees raster cells');
});

test('Auto and both Smart modes retain custom-margin modules as rigid groups without creating tool overrides',async()=>{
  const project=validateProject({...blankProject(),width:252,height:168,clearance:.8,
    modules:[{id:'zero-module',pocketMargin:0},{id:'wide-module',pocketMargin:3}].map((m,i)=>({...m,name:m.id,x:i*126,y:0,width:126,height:84,sizeMode:'auto',grouped:true})),
    tools:[{...tool('zero-member'),moduleId:'zero-module',x:15,y:15},{...tool('wide-member'),moduleId:'wide-module',x:141,y:15}]});
  const before=structuredClone(project);assert.deepEqual(validateLayout(project),[]);
  const candidates=[autoArrange(project),await smartArrange(project,{mode:'compact',moduleShape:'stepped',merge:true}),await smartArrange(project,{mode:'sets',moduleShape:'stepped',merge:true})];
  for(const candidate of candidates){
    const next={...project,...candidate};assert.deepEqual(validateLayout(next),[]);
    for(const original of project.modules){
      const module=next.modules.find(m=>m.id===original.id);assert.ok(module);assert.equal(module.pocketMargin,original.pocketMargin);assert.equal(module.width,original.width);assert.equal(module.height,original.height);
      const member=next.tools.find(t=>t.moduleId===module.id),source=project.tools.find(t=>t.id===member.id);
      assert.equal(Object.hasOwn(member,'pocketMargin'),false,'inheritance stays an inheritance');
      assert.deepEqual(member.points,source.points);assert.equal(member.x-module.x,source.x-original.x);assert.equal(member.y-module.y,source.y-original.y);
      assert.equal(effectivePocketMargin(member,next),original.pocketMargin);
      const points=pocketOutline(member,next),minimum=Math.min(...points.map(p=>p.x));assert.ok(Math.abs(minimum-(member.x-original.pocketMargin))<.0001);
    }
  }
  assert.deepEqual(project,before);
});
