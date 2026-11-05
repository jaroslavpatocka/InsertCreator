import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {createEditorGeometryCache} from '../dist/editor-cache.js';
import {previewGeometryKey} from '../dist/preview3d.js';

const rectangle=[{x:0,y:0},{x:20,y:0},{x:20,y:40},{x:0,y:40}];
const bounds=points=>({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))});
function fixture(){
  return{...blankProject(),clearance:.6,modules:[{id:'first',name:'First',x:0,y:0,width:126,height:126,pocketMargin:1.2},{id:'second',name:'Second',x:126,y:0,width:126,height:126,pocketMargin:2.4}],
    tools:[{id:'one',name:'One',moduleId:'first',points:structuredClone(rectangle),x:20,y:20,rotation:0,depth:8,fingerGrips:[]},{id:'two',name:'Two',moduleId:'second',points:structuredClone(rectangle),x:150,y:20,rotation:0,depth:8,fingerGrips:[]}]};
}
const near=(actual,expected)=>{for(const key of Object.keys(expected))assert.ok(Math.abs(actual[key]-expected[key])<.00011,`${key}: ${actual[key]} should equal ${expected[key]}`);};
const expanded=(tool,margin)=>({minX:tool.x-margin,maxX:tool.x+20+margin,minY:tool.y-margin,maxY:tool.y+40+margin});

test('project pockets resolve tool, owning module and legacy margins in physical geometry',()=>{
  const project=fixture(),one=project.tools[0],two=project.tools[1],before=structuredClone(project);
  near(bounds(pocketOutline(one,project)),expanded(one,1.2));near(bounds(pocketOutline(two,project)),expanded(two,2.4));
  one.pocketMargin=.25;near(bounds(pocketOutline(one,project)),expanded(one,.25));
  one.pocketMargin=0;near(bounds(pocketOutline(one,project)),expanded(one,0));
  delete one.pocketMargin;delete project.modules[0].pocketMargin;near(bounds(pocketOutline(one,project)),expanded(one,.6));
  near(bounds(pocketOutline(one,{clearance:0})),expanded(one,0));near(bounds(pocketOutline(one,{})),expanded(one,.8));
  assert.deepEqual(project.tools[1],before.tools[1]);assert.equal(project.clearance,before.clearance);
});

test('numeric offsets remain exact even when a tool or module defines a larger allowance',()=>{
  const project=fixture(),tool={...project.tools[0],pocketMargin:5},before=structuredClone(tool);
  for(const margin of [0,.1,1,3])near(bounds(pocketOutline(tool,margin)),expanded(tool,margin));
  near(bounds(pocketOutline(tool)),expanded(tool,0));near(bounds(pocketOutline(tool,project)),expanded(tool,5));
  const detached={...tool,fingerGrips:[{id:'detached',x:24,y:20,radius:2}]};
  assert.throws(()=>pocketOutline(detached,0),/plošně navazovat/,'raw attachment validation cannot be masked by an inherited margin');
  assert.doesNotThrow(()=>pocketOutline(detached,project),'a physical expanded pocket remains explicitly distinct from the raw check');
  assert.deepEqual(tool,before);
});

test('model and JSON preserve optional module and tool overrides including zero without adding defaults',()=>{
  const project=fixture();project.modules[0].pocketMargin=0;project.tools[0].pocketMargin=0;project.tools[1].pocketMargin=1.75;
  const before=structuredClone(project),validated=validateProject(project),roundTrip=validateProject(JSON.parse(JSON.stringify(validated)));
  assert.equal(validated.modules[0].pocketMargin,0);assert.equal(validated.modules[1].pocketMargin,2.4);assert.equal(validated.tools[0].pocketMargin,0);assert.equal(validated.tools[1].pocketMargin,1.75);
  assert.deepEqual(roundTrip,validated);assert.equal(validated.clearance,.6);assert.deepEqual(project,before);
  for(const empty of [null,undefined]){
    const inherited=fixture();for(const item of [...inherited.modules,...inherited.tools])item.pocketMargin=empty;
    const clean=validateProject(inherited);assert.equal(clean.clearance,.6);for(const item of [...clean.modules,...clean.tools])assert.equal(Object.hasOwn(item,'pocketMargin'),false);
  }
  const legacy=fixture();for(const module of legacy.modules)delete module.pocketMargin;const old=validateProject(legacy);assert.equal(old.clearance,.6);assert.equal(Object.hasOwn(old,'pocketMargin'),false);
});

test('model rejects invalid stored overrides before unused or unrelated pockets can export',()=>{
  for(const value of [-.001,10.001,NaN,Infinity,'1',false,{},[]])for(const group of ['tools','modules']){
    const project=fixture();project[group][1].pocketMargin=value;
    assert.throws(()=>validateProject(project),error=>!!error.i18n,'stored margins must not be coerced or silently discarded');
  }
  const project=fixture();project.modules[0].pocketMargin=10;project.tools[0].pocketMargin=10;assert.equal(validateProject(project).tools[0].pocketMargin,10);
});

test('pocket cache keys use the effective allowance without serializing unrelated project data',()=>{
  const project=fixture(),tool=project.tools[0],calls=[];
  Object.defineProperty(project,'toJSON',{value:()=>{throw Error('A pocket must not serialize its whole drawer.');}});
  const cache=createEditorGeometryCache({validateLayout:()=>[],findToolSets:()=>[],pocketOutline:(item,allowance)=>{assert.equal(typeof allowance,'number');calls.push(allowance);return pocketOutline(item,allowance);}});
  near(bounds(cache.pocket(tool,project)),expanded(tool,1.2));assert.deepEqual(calls,[1.2]);
  project.modules[1].pocketMargin=3;project.clearance=1;near(bounds(cache.pocket(tool,project)),expanded(tool,1.2));assert.deepEqual(calls,[1.2]);
  project.modules[0].pocketMargin=1.8;near(bounds(cache.pocket(tool,project)),expanded(tool,1.8));assert.deepEqual(calls,[1.2,1.8]);
  tool.pocketMargin=.4;near(bounds(cache.pocket(tool,project)),expanded(tool,.4));
  project.modules[0].pocketMargin=4;near(bounds(cache.pocket(tool,project)),expanded(tool,.4));assert.deepEqual(calls,[1.2,1.8,.4]);
  tool.pocketMargin=0;near(bounds(cache.pocket(tool,project)),expanded(tool,0));
  near(bounds(cache.pocket(tool,0)),expanded(tool,0));assert.deepEqual(calls,[1.2,1.8,.4,0],'numeric zero and effective zero share identical geometry');
  delete tool.pocketMargin;tool.moduleId='second';near(bounds(cache.pocket(tool,project)),expanded(tool,3));assert.deepEqual(calls,[1.2,1.8,.4,0,3]);
  assert.equal(cache.stats().pockets,5);assert.equal(cache.stats().pocketHits,3);
  tool.pocketMargin=NaN;assert.throws(()=>cache.pocket(tool,project),error=>!!error.i18n,'invalid edits cannot reuse a previously valid cached pocket');
});

test('3D geometry key invalidates for both module and individual pocket allowance edits',()=>{
  const project=fixture(),base=previewGeometryKey(project);
  project.modules[0].pocketMargin=2;const moduleKey=previewGeometryKey(project);assert.notEqual(moduleKey,base);
  project.tools[0].pocketMargin=0;const toolKey=previewGeometryKey(project);assert.notEqual(toolKey,moduleKey);
  delete project.tools[0].pocketMargin;assert.equal(previewGeometryKey(project),moduleKey);
  project.modules[0].pocketMargin=1.2;assert.equal(previewGeometryKey(project),base);
});
