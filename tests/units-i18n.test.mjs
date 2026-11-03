import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLength,fmtLen,fmtSize,inputValue,setAppUnit,setProjectUnit,unit,getAppUnit,onUnitChange} from '../dist/units.js';
import {t,plural,setLang,getLang,i18nError,errorText,_dictionaries} from '../dist/i18n.js';
import {validateProject,blankProject} from '../dist/model.js';

const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} ≠ ${b}`);

test('parseLength understands metric, imperial, fractions and compound input',()=>{
  near(parseLength('12','mm'),12);
  near(parseLength('12,5','mm'),12.5);
  near(parseLength('2','in'),50.8);
  near(parseLength('3 in','mm'),76.2);
  near(parseLength('3"','mm'),76.2);
  near(parseLength('1 1/2 in','mm'),38.1);
  near(parseLength('1-1/2"','mm'),38.1);
  near(parseLength('3/4in','mm'),19.05);
  near(parseLength('.5 in','mm'),12.7);
  near(parseLength('30 cm','in'),300);
  near(parseLength("1' 2\"",'mm'),355.6);
  near(parseLength("1' 2",'mm'),355.6);
  near(parseLength('2 ft 3 in','mm'),685.8);
  near(parseLength('15mm','in'),15);
  for(const bad of ['','abc','5 xyz','1/0x','--3'])assert.ok(Number.isNaN(parseLength(bad,'mm')),bad);
});

test('formatting follows effective unit: drawer override beats app default',()=>{
  assert.equal(getAppUnit(),'mm');
  assert.equal(fmtLen(504),'504 mm');
  assert.equal(inputValue(0.8,{unit:'in'}),'0.031');
  const seen=[];const off=onUnitChange(u=>seen.push(u));
  setProjectUnit('in');assert.equal(unit(),'in');
  assert.equal(fmtLen(25.4),'1 in');
  assert.equal(fmtSize(508,254),'20 × 10 in');
  setAppUnit('in',{save:false});setProjectUnit('mm');assert.equal(unit(),'mm');
  setProjectUnit('');assert.equal(unit(),'in');
  setAppUnit('mm',{save:false});off();
  assert.deepEqual(seen,['in','mm','in','mm']);
});

test('translation falls back to Czech, fills placeholders and pluralises',()=>{
  assert.equal(getLang(),'cs');
  _dictionaries.en['Test {n} nástroj']='Test {n} tool';_dictionaries.en['Test {n} nástroje']='Test {n} tools';_dictionaries.en['Test {n} nástrojů']='Test {n} tools';
  const forms=['Test {n} nástroj','Test {n} nástroje','Test {n} nástrojů'];
  assert.equal(plural(3,forms),'Test 3 nástroje');assert.equal(plural(7,forms),'Test 7 nástrojů');
  setLang('en',{save:false});
  try{
    assert.equal(plural(1,forms),'Test 1 tool');assert.equal(plural(5,forms),'Test 5 tools');
    assert.equal(t('Neexistující text {x}',{x:1}),'Neexistující text 1');
    const error=i18nError('Test {n} nástroj',{n:1});assert.equal(error.message,'Test 1 tool');
    setLang('cs',{save:false});assert.equal(errorText(error),'Test 1 nástroj');
  }finally{setLang('cs',{save:false});for(const k of forms)delete _dictionaries.en[k];}
});

test('English dictionaries keep every placeholder of the Czech key',()=>{
  for(const [cs,en] of Object.entries(_dictionaries.en)){
    const names=s=>[...String(s).matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join();
    assert.equal(names(en),names(cs),`Placeholder mismatch: ${cs}`);
    assert.equal(typeof en,'string');assert.ok(en.trim(),`Empty translation: ${cs}`);
  }
});

test('drawer unit override is validated and survives JSON roundtrip',()=>{
  assert.equal(blankProject().unit,'');
  const p=validateProject(JSON.parse(JSON.stringify({...blankProject(),unit:'in'})));
  assert.equal(p.unit,'in');
  assert.equal(validateProject({...blankProject(),unit:'furlong'}).unit,'');
  assert.equal(validateProject({...blankProject(),unit:undefined}).unit,'');
});

test('tools and modules can each override the drawer unit and keep it through JSON',async()=>{
  const {unitFor}=await import('../dist/units.js');
  const square=[{x:0,y:0},{x:20,y:0},{x:20,y:10},{x:0,y:10}];
  const input={...blankProject(),unit:'mm',modules:[{id:'m1',x:0,y:0,width:84,height:42,unit:'in'},{id:'m2',x:84,y:0,width:42,height:42}],
    tools:[{id:'a',points:square,moduleId:'m1',unit:'in'},{id:'b',points:square,moduleId:'m2',unit:'mm'},{id:'c',points:square,unit:'yard'}]};
  const p=validateProject(JSON.parse(JSON.stringify(validateProject(input))));
  assert.equal(p.modules[0].unit,'in');assert.equal(Object.hasOwn(p.modules[1],'unit'),false);
  assert.deepEqual(p.tools.map(t=>t.unit),['in','mm',undefined]);
  setProjectUnit(p.unit);
  try{
    assert.equal(unitFor(p.tools[0].unit),'in');
    assert.equal(unitFor(p.tools[1].unit,p.modules[1].unit),'mm');
    assert.equal(unitFor(p.tools[2].unit,p.modules[1].unit),'mm');
    assert.equal(unitFor(undefined,p.modules[0].unit),'in');
    assert.equal(fmtLen(25.4,{unit:unitFor(p.tools[0].unit)}),'1 in');
  }finally{setProjectUnit('');}
});
