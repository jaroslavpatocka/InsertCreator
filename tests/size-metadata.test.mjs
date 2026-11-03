import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject,clone} from '../dist/model.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {scaleTool} from '../dist/set-module.js';
import {bulkRotate,bulkMove,bulkSetDepth} from '../dist/bulk-edit.js';
import {setLang} from '../dist/i18n.js';
import {sizeText} from '../dist/tool-size.js';

const points=[{x:0,y:0},{x:30,y:0},{x:30,y:60},{x:0,y:60}];
const fixture=extra=>({...blankProject(),id:'sizes',sizeLabels:true,limitToBed:false,modules:[{id:'m',name:'M',x:0,y:0,width:126,height:126,sizeMode:'manual',locked:false}],tools:[{id:'t',name:'Tool',points,x:40,y:30,rotation:0,moduleId:'m',depth:8,nominalSize:{value:13,unit:'mm'},sizeLabel:'13 mm',...extra}]});

test('nominal size, explicit label and project option survive validation and JSON backup repeatedly',()=>{
  const p=fixture(),before=clone(p),normalized=validateProject(p);
  assert.equal(normalized.sizeLabels,true);assert.deepEqual(normalized.tools[0].nominalSize,{value:13,unit:'mm'});assert.equal(normalized.tools[0].sizeLabel,'13 mm');
  const restored=validateProject({schemaVersion:1,project:JSON.parse(JSON.stringify(normalized))});assert.deepEqual(restored,normalized);assert.deepEqual(validateProject(JSON.parse(JSON.stringify(restored))),restored);assert.deepEqual(p,before);
  const inch=validateProject(fixture({nominalSize:{value:.5,unit:'in'},sizeLabel:'1/2 in',unit:'in'}));assert.deepEqual(inch.tools[0].nominalSize,{value:.5,unit:'in'});assert.equal(inch.tools[0].sizeLabel,'1/2 in');
});

test('legacy tools keep size metadata absent and printing defaults off',()=>{
  const p=fixture();delete p.sizeLabels;delete p.tools[0].nominalSize;delete p.tools[0].sizeLabel;
  const next=validateProject(p);assert.equal(next.sizeLabels,false);assert.equal(Object.hasOwn(next.tools[0],'nominalSize'),false);assert.equal(Object.hasOwn(next.tools[0],'sizeLabel'),false);
  assert.equal(validateProject({...p,sizeLabels:'true'}).sizeLabels,false,'only an explicit boolean enables labels');
});

test('label text is safely normalized and capped at 24 characters, while non-text is rejected',()=>{
  assert.equal(validateProject(fixture({sizeLabel:' 13\u0000 mm\n '})).tools[0].sizeLabel,'13 mm');
  assert.equal(validateProject(fixture({sizeLabel:'x'.repeat(30)})).tools[0].sizeLabel,'x'.repeat(24));
  assert.equal(validateProject(fixture({sizeLabel:''})).tools[0].sizeLabel,'','an explicit empty label remains editable');
  for(const value of [null,13,true,[],{}])assert.throws(()=>validateProject(fixture({sizeLabel:value})),error=>!!error.i18n);
});

test('malformed nominal dimensions are rejected without altering source metadata',()=>{
  const cases=[null,{},[],{value:NaN,unit:'mm'},{value:Infinity,unit:'mm'},{value:0,unit:'mm'},{value:-1,unit:'mm'},{value:3001,unit:'mm'},{value:'13',unit:'mm'},{value:true,unit:'mm'},{value:13,unit:'cm'},{value:13},{unit:'mm'}];
  for(const nominalSize of cases){const p=fixture({nominalSize});assert.throws(()=>validateProject(p),error=>!!error.i18n,String(nominalSize));assert.equal(p.tools[0].nominalSize,nominalSize);}
});

test('catalogue numeric metric and fractional inch sizes become nominal metadata without scaling millimetre outlines',()=>{
  const item=(size,unit)=>({id:'catalog',name:{cs:'Klíč',en:'Wrench'},points,depth:8,size,unit});
  setLang('cs',{save:false});const metric=catalogTool(item(13,'mm')),inch=catalogTool(item(.5,'in'));
  assert.deepEqual(metric.nominalSize,{value:13,unit:'mm'});assert.deepEqual(inch.nominalSize,{value:.5,unit:'in'});assert.deepEqual(inch.points,metric.points);assert.notEqual(inch.points,points);
  for(const size of [undefined,'T25',NaN,Infinity,0,-1])assert.equal(Object.hasOwn(catalogTool(item(size,'mm')),'nominalSize'),false);
  assert.equal(Object.hasOwn(catalogTool(item(13,'cm')),'nominalSize'),false);
});

test('geometry edits preserve nominal identity and custom label independently of outline size and units',()=>{
  const p=validateProject({...fixture(),unit:'in'}),before=clone(p);
  for(const next of [bulkRotate(p,['t']),bulkMove(p,['t'],{dx:42,dy:42}),bulkSetDepth(p,['t'],12.7)]){assert.deepEqual(next.tools[0].nominalSize,before.tools[0].nominalSize);assert.equal(next.tools[0].sizeLabel,'13 mm');assert.equal(next.sizeLabels,true);assert.equal(next.unit,'in');}
  const scaled=scaleTool(p.tools[0],1.1);assert.deepEqual(scaled.nominalSize,p.tools[0].nominalSize);assert.equal(scaled.sizeLabel,'13 mm');assert.deepEqual(p,before);
});

test('profile codes stay PH, PZ and Torx labels rather than being printed as millimetre sizes',()=>{
  for(const [name,size,label] of [['Phillips screwdriver PH0 x 75 mm',0,'PH0'],['Pozidriv screwdriver PZ2 x 100 mm',2,'PZ2'],['Torx key T25',4.43,'T25']]){
    const tool=catalogTool({name,points,depth:8,size,unit:'mm'});
    assert.equal(sizeText(tool),label);
    if(label.startsWith('P'))assert.equal(Object.hasOwn(tool,'nominalSize'),false);
  }
});
