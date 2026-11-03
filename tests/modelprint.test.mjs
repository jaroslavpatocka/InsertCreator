import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';

const fixture=()=>({...blankProject(),id:'print-project',tools:[{id:'test-tool',name:'Kleště',points:[{x:0,y:0},{x:30,y:0},{x:30,y:90},{x:0,y:90}],x:6,y:6,depth:12,rotation:0,moduleId:'test-module',locked:true}],modules:[{id:'test-module',name:'Kleště',x:0,y:0,width:42,height:126,locked:true,sizeMode:'auto'}]});

test('all printing and bottom choices survive a portable JSON project round trip',()=>{
  for(const printMode of ['solid','light'])for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const source={...fixture(),printMode,bottomMode,bedWidth:256,bedHeight:180,limitToBed:false,magnetDiameter:6.4,magnetDepth:2.5};
    const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,app:'Suplik Studio',project:source})));
    for(const key of ['printMode','bottomMode','bedWidth','bedHeight','limitToBed','magnetDiameter','magnetDepth'])assert.equal(restored[key],source[key],`${printMode}/${bottomMode}: ${key}`);
    assert.deepEqual(restored.tools,source.tools);assert.deepEqual(restored.modules,source.modules);
  }
});

test('legacy projects keep solid construction while new projects start with the saving option',()=>{
  assert.equal(blankProject().printMode,'light');
  const source=fixture();
  for(const key of ['printMode','bottomMode','bedWidth','bedHeight','limitToBed','magnetDiameter','magnetDepth'])delete source[key];
  const restored=validateProject(source);
  assert.equal(restored.printMode,'solid');assert.equal(restored.bottomMode,'plain');assert.equal(restored.limitToBed,true);
  assert.equal(restored.bedWidth,220);assert.equal(restored.bedHeight,220);assert.equal(restored.magnetDiameter,6.2);assert.equal(restored.magnetDepth,2.2);
});

test('both printer dimensions reject nonfinite and out-of-range imported values',()=>{
  for(const key of ['bedWidth','bedHeight'])for(const value of [NaN,Infinity,-Infinity,0,49.9,2000.1,'not-a-number']){
    assert.throws(()=>validateProject({...fixture(),[key]:value}),/tiskové plochy/,`${key}=${value}`);
  }
  for(const value of [50,2000,'256']){
    const restored=validateProject({...fixture(),bedWidth:value,bedHeight:value});
    assert.equal(restored.bedWidth,Number(value));assert.equal(restored.bedHeight,Number(value));
  }
});

test('magnet pocket dimensions stay finite and within supported manufacturing ranges',()=>{
  for(const value of [NaN,Infinity,2.9,20.1])assert.throws(()=>validateProject({...fixture(),bottomMode:'magnet',magnetDiameter:value}),/průměr kapsy/);
  for(const value of [NaN,Infinity,.9,8.1])assert.throws(()=>validateProject({...fixture(),bottomMode:'magnet',magnetDepth:value}),/hloubka kapsy/);
  const restored=validateProject({...fixture(),bottomMode:'magnet',magnetDiameter:20,magnetDepth:8});
  assert.equal(restored.magnetDiameter,20);assert.equal(restored.magnetDepth,8);
});

test('an unrecognized imported finish falls back to known construction settings',()=>{
  const restored=validateProject({...fixture(),printMode:'unknown-future-mode',bottomMode:'unknown-future-bottom'});
  assert.equal(restored.printMode,'solid');assert.equal(restored.bottomMode,'plain');
});
