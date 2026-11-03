import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,blankProject} from '../dist/model.js';
import {createDemoProject,autoArrange} from '../dist/geometry.js';
test('JSON round trip retains geometry, locks and metric settings',()=>{
  const p={...createDemoProject(),id:'demo'};p.modules[0].locked=true;p.tools[0].locked=true;
  const restored=validateProject({schemaVersion:1,project:JSON.parse(JSON.stringify(p))});
  assert.deepEqual(restored.tools.map(t=>t.points),p.tools.map(t=>t.points));assert.equal(restored.modules[0].locked,true);assert.equal(restored.clearance,.8);
});

test('manual module dimensions and size mode survive reload independently of position locks',()=>{
  const p={...blankProject(),modules:[{id:'manual',name:'Vlastní rozměr',x:0,y:0,width:151.5,height:139.25,locked:false,sizeMode:'manual'},{id:'legacy',name:'Původní',x:168,y:0,width:42,height:42,locked:true}]};
  const restored=validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.modules[0].width,151.5);assert.equal(restored.modules[0].height,139.25);
  assert.equal(restored.modules[0].sizeMode,'manual');assert.equal(restored.modules[0].locked,false);
  assert.equal(restored.modules[1].sizeMode,'auto');assert.equal(restored.modules[1].locked,true);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(restored))),restored);
});

test('separate drawers retain their own dimensions and independent tool/module collections',()=>{
  const first=blankProject(),second=blankProject();
  first.width=420;first.height=294;second.width=588;second.height=378;
  first.modules.push({id:'first-only',x:0,y:0,width:84,height:84,sizeMode:'manual'});
  assert.notEqual(first.id,second.id);assert.equal(second.modules.length,0);assert.equal(second.tools.length,0);
  const restored=[first,second].map(p=>validateProject(JSON.parse(JSON.stringify(p))));
  assert.deepEqual(restored.map(p=>[p.width,p.height]),[[420,294],[588,378]]);
  assert.equal(restored[0].modules.length,1);assert.equal(restored[1].modules.length,0);
});
test('invalid, oversized and duplicate-ID imports reject explicitly',()=>{
  assert.throws(()=>validateProject({}),/projekt/);
  assert.throws(()=>validateProject({...blankProject(),width:NaN}),/šířka/);
  const p=createDemoProject();p.tools.push(p.tools[0]);assert.throws(()=>validateProject(p),/Duplicitní/);
  const q=createDemoProject();q.tools[0].points[0].x=Infinity;assert.throws(()=>validateProject(q),/bod X/);
});
test('normalized negative contours remain stable through JSON round trips up to 3000 mm',()=>{
  const points=[{x:-1500,y:-2000},{x:1500,y:-2000},{x:1500,y:1000},{x:-1500,y:1000}];
  const normalized=validateProject({...blankProject(),tools:[{id:'negative',points}]});
  assert.deepEqual(normalized.tools[0].points,[{x:0,y:0},{x:3000,y:0},{x:3000,y:3000},{x:0,y:3000}]);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(normalized))),normalized);
});

test('contours exceeding the normalized coordinate limit fail on first import',()=>{
  for(const axis of ['x','y']){
    const points=[{x:-3000,y:0},{x:3000,y:0},{x:3000,y:10},{x:-3000,y:10}].map(p=>axis==='x'?p:{x:p.y,y:p.x});
    assert.throws(()=>validateProject({...blankProject(),tools:[{points}]}),/Kontura.*3\s?000 mm/);
  }
});

test('many unplaced tools remain reloadable without dropping the project',()=>{
  const base=createDemoProject().tools.find(t=>t.id==='tool-screwdriver');
  const p={...blankProject(),width:42,height:42,tools:Array.from({length:80},(_,i)=>({...base,id:'t'+i,moduleId:null,locked:false}))};
  const arranged=autoArrange(p);assert.equal(arranged.unplaced.length,80);
  assert.doesNotThrow(()=>validateProject({...p,...arranged}));
});

test('model validation errors are translated and show length ranges in the display unit',async()=>{
  const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
  assert.throws(()=>validateProject({...blankProject(),width:10}),/Neplatná hodnota: šířka \(42–3\s000 mm\)/);
  setLang('en',{save:false});
  try{
    assert.throws(()=>validateProject({}),/does not contain a Šuplík Studio project/);
    assert.throws(()=>validateProject({...blankProject(),width:10}),/Invalid value: width \(42–3,000 mm\)/);
    setAppUnit('in',{save:false});
    assert.throws(()=>validateProject({...blankProject(),width:10}),/Invalid value: width \(1\.654–118\.11 in\)/);
    assert.throws(()=>validateProject({...blankProject(),tools:[{points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}],rotation:9999}]}),/Invalid value: rotation \(-3600–3600\)/);
    assert.equal(blankProject().name,'My new drawer');
  }finally{setLang('cs',{save:false});setAppUnit('mm',{save:false});}
});
