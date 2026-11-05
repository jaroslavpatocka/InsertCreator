import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_POCKET_MARGIN,MAX_POCKET_MARGIN,validatePocketMargin,optionalPocketMargin,effectivePocketMargin} from '../dist/pocket-margin.js';

const localized=error=>error instanceof Error&&error.i18n?.cs==='Přídavek kapsy musí být číslo od {min} do {max} mm.'&&error.i18n.params.min===0&&error.i18n.params.max===MAX_POCKET_MARGIN;
const legacyLocalized=error=>error instanceof Error&&error.i18n?.cs==='Přídavek kapsy musí být číslo od {min} do {max} mm.'&&error.i18n.params.min===0&&error.i18n.params.max===6000;
const invalid=[NaN,Infinity,-Infinity,-.0001,10.0001,null,undefined,'0','0.8','',true,false,{},[],new Number(.8)];

test('margin validation accepts finite numeric millimetres including both bounds',()=>{
  assert.equal(DEFAULT_POCKET_MARGIN,.8);assert.equal(MAX_POCKET_MARGIN,10);
  for(const value of [0,.01,.8,2.75,10])assert.equal(validatePocketMargin(value),value);
  for(const value of invalid)assert.throws(()=>validatePocketMargin(value),localized);
});

test('optional margin distinguishes inherited null/missing from explicit zero',()=>{
  assert.equal(optionalPocketMargin(null),undefined);assert.equal(optionalPocketMargin(undefined),undefined);
  for(const value of [0,.8,10])assert.equal(optionalPocketMargin(value),value);
  for(const value of invalid.filter(value=>value!=null))assert.throws(()=>optionalPocketMargin(value),localized);
});

test('each tool inherits its own module before the legacy drawer clearance',()=>{
  const project={clearance:.6,modules:[{id:'first',pocketMargin:1.2},{id:'second',pocketMargin:2.4},{id:'legacy'},{id:'empty',pocketMargin:null}]};
  assert.equal(effectivePocketMargin({moduleId:'first'},project),1.2);
  assert.equal(effectivePocketMargin({moduleId:'second'},project),2.4);
  for(const moduleId of ['legacy','empty','missing',null,undefined])assert.equal(effectivePocketMargin({moduleId},project),.6);
  assert.equal(effectivePocketMargin({moduleId:'first',pocketMargin:.25},project),.25);
  assert.equal(effectivePocketMargin({moduleId:'first',pocketMargin:null},project),1.2);
});

test('explicit zero works at tool, module and legacy levels without truthy fallback',()=>{
  const project={clearance:.8,modules:[{id:'zero',pocketMargin:0},{id:'wide',pocketMargin:3}]};
  assert.equal(effectivePocketMargin({moduleId:'wide',pocketMargin:0},project),0);
  assert.equal(effectivePocketMargin({moduleId:'zero'},project),0);
  assert.equal(effectivePocketMargin({},0),0);
  assert.equal(effectivePocketMargin({moduleId:'missing'},{clearance:0,modules:project.modules}),0);
});

test('project fallback defaults to .8 while legacy numeric calls retain their supplied allowance',()=>{
  assert.equal(effectivePocketMargin({},{}),DEFAULT_POCKET_MARGIN);
  assert.equal(effectivePocketMargin({},{clearance:null}),DEFAULT_POCKET_MARGIN);
  assert.equal(effectivePocketMargin({},{modules:[]}),DEFAULT_POCKET_MARGIN);
  assert.equal(effectivePocketMargin({moduleId:'missing'},{clearance:1.6}),1.6,'a project without module metadata keeps its legacy clearance');
  assert.equal(effectivePocketMargin({moduleId:'missing'},{clearance:0}),0,'a project without modules retains a zero legacy clearance');
  assert.equal(effectivePocketMargin({},2.5),2.5);
  assert.equal(effectivePocketMargin({},{clearance:30}),30,'legacy geometric validation retains its original offset range');
  assert.equal(effectivePocketMargin({},6000),6000);
  assert.equal(effectivePocketMargin({}),0);
  assert.equal(effectivePocketMargin(undefined),0);
  assert.equal(effectivePocketMargin({pocketMargin:1.1},2.5),1.1);
});

test('invalid selected tool, module or fallback margins cannot reach geometry',()=>{
  for(const value of invalid.filter(value=>value!=null)){
    assert.throws(()=>effectivePocketMargin({pocketMargin:value},{clearance:.8}),localized);
    assert.throws(()=>effectivePocketMargin({moduleId:'m'},{modules:[{id:'m',pocketMargin:value}],clearance:.8}),localized);
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>6000)assert.throws(()=>effectivePocketMargin({},{clearance:value}),legacyLocalized);
  }
  for(const value of [null,'0.8',false,NaN,-1,6001,[]])assert.throws(()=>effectivePocketMargin({},value),legacyLocalized);
});

test('resolution is read-only and an override does not consult unrelated modules',()=>{
  const project={clearance:.8,modules:[{id:'a',pocketMargin:1.2},{id:'unrelated',pocketMargin:NaN}]},tool={id:'tool',moduleId:'a',pocketMargin:.4};
  const beforeProject=structuredClone(project),beforeTool=structuredClone(tool);
  Object.freeze(project.modules[0]);Object.freeze(project.modules[1]);Object.freeze(project.modules);Object.freeze(project);Object.freeze(tool);
  assert.equal(effectivePocketMargin(tool,project),.4);
  assert.equal(effectivePocketMargin({...tool,pocketMargin:null},project),1.2);
  assert.equal(effectivePocketMargin(tool,NaN),.4,'an explicit tool override has precedence over the unused numeric fallback');
  assert.deepEqual(project,beforeProject);assert.deepEqual(tool,beforeTool);
});
