import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {getToolSize,sizeText,orderTools} from '../dist/tool-size.js';
import {catalogItems} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {setLang} from '../dist/i18n.js';

const outline=[{x:0,y:0},{x:20,y:0},{x:20,y:50},{x:0,y:50}];
const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const project=validateProject({...blankProject(),id:'label-scope',name:'Scoped labels',width:378,height:252,sizeLabels:true,limitToBed:false,printMode:'solid',
  modules:[{id:'a',name:'Valid label',x:0,y:0,width:126,height:126,sizeMode:'manual'},{id:'b',name:'Unsupported label',x:126,y:0,width:126,height:126,sizeMode:'manual'}],
  tools:[{id:'ta',name:'Tool A',points:outline,x:53,y:30,rotation:0,depth:8,moduleId:'a',sizeLabel:'13 mm',nominalSize:{value:13,unit:'mm'},fingerGrips:[]},{id:'tb',name:'Tool B',points:outline,x:179,y:30,rotation:0,depth:8,moduleId:'b',sizeLabel:'尺寸',fingerGrips:[]}]
});
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([project]));localStorage.setItem('suplik-studio-current',JSON.stringify(project.id));localStorage.setItem('suplik-studio-lang','"en"');localStorage.setItem('suplik-studio-unit','"mm"');setLang('en',{save:false});
await import('../dist/app.js');
after(async()=>{await win.happyDOM.close();});
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const change=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.value=value;element.dispatchEvent(new win.Event('change',{bubbles:true}));};
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id==='label-scope');

test('legacy PH/PZ/Torx names label the driver code instead of its shaft length, including PH0',()=>{
  for(const [name,label] of [['Šroubovák PH0×60 mm','PH0'],['Šroubovák PZ2×100 mm','PZ2'],['Torx T25','T25'],['Torx TX20 × 100 mm','TX20']]){
    const tool={name,points:outline};assert.equal(sizeText(tool),label,name);assert.equal(getToolSize(tool),null,'A driver code has no inferred mm nominal size');
    const reloaded=validateProject({...blankProject(),tools:[{...tool,id:'legacy',x:0,y:0,rotation:0,depth:8}]}).tools[0];assert.equal(sizeText(reloaded),label,'Legacy JSON and library-shaped entries keep the correct label without migration');
  }
  assert.equal(sizeText({name:'ALPH2 13 mm'}),'13 mm','PH inside a word is not a driver code');
  assert.equal(sizeText({name:'T25holder 100 mm'}),'100 mm','A code must end at a word boundary');
});

test('manual text and declared numeric metadata retain their priorities over legacy code-name fallback',()=>{
  const tool={id:'coded',name:'PH2 × 100 mm',points:outline,nominalSize:{value:13,unit:'mm'}};
  assert.equal(sizeText(tool),'PH2');assert.equal(getToolSize(tool).value,13);assert.equal(getToolSize(tool).mm,13);
  assert.equal(sizeText({...tool,sizeLabel:'My custom label'}),'My custom label');
  assert.equal(sizeText({...tool,sizeLabel:'1/2 in'}),'1/2 in');assert.equal(getToolSize({...tool,sizeLabel:'1/2 in'}).value,13,'Declared numeric size still controls sorting');
  assert.equal(sizeText({name:'PH2 × 100 mm',sizeLabel:'13 mm'}),'13 mm');assert.equal(getToolSize({name:'PH2 × 100 mm',sizeLabel:'13 mm'}).value,13);
  assert.equal(sizeText({name:'Klíč 13 mm'}),'13 mm');assert.equal(getToolSize({name:'Klíč 13 mm'}).value,13);
  assert.equal(sizeText({name:'Photo',points:outline}),'' ,'A photographed outline does not acquire a nominal size');
  assert.deepEqual(orderTools([tool,{id:'other',name:'Other',nominalSize:{value:12,unit:'mm'}}]).map(tool=>tool.id),['other','coded']);
});

test('new catalogue PH0, PZ2 and Torx labels keep the same code labels',()=>{
  for(const [id,label] of [['screwdriver-ph0x60','PH0'],['screwdriver-pz2x100','PZ2'],['torx-key-l-t25','T25']]){
    const item=catalogItems().find(item=>item.id===id);assert.ok(item,id);const tool=catalogTool(item);
    assert.equal(tool.sizeLabel,label);assert.equal(sizeText(tool),label);
    if(label.startsWith('PH')||label.startsWith('PZ'))assert.equal(getToolSize(tool),null);
  }
});

test('English selected-module export reports only its labels, while all-module and drawer views retain all warnings',()=>{
  const before=saved();click('[data-select="ta"]');action('export');
  assert.equal($('#export-scope').value,'all');assert.match($('.modal .label-warning').textContent,/Model labels: 1; skipped: 1\./);assert.match($('.modal .label-warning').textContent,/unsupported character/);
  change('#export-scope','selected');
  assert.equal($('.modal .label-warning'),null,'An unrelated module cannot add a skipped-label warning to the selected export');
  assert.match($('.modal-body').textContent,/Model labels: 1\./);assert.doesNotMatch($('.modal-body').textContent,/unsupported character/);assert.equal($('[data-do-export]').disabled,false);
  change('#export-scope','all');assert.match($('.modal .label-warning').textContent,/Model labels: 1; skipped: 1\./);
  change('#export-scope','selected');click('[data-modal-close]');click('[data-select="tb"]');action('export');
  assert.equal($('#export-scope').value,'selected');assert.match($('.modal .label-warning').textContent,/Model labels: 0; skipped: 1\./);assert.match($('.modal .label-warning').textContent,/unsupported character/);
  click('[data-modal-close]');action('drawer-tab');assert.match($('#drawer-settings .label-warning').textContent,/Model labels: 1; skipped: 1\./,'The drawer view always summarizes the complete project');
  assert.deepEqual(saved(),before,'Viewing scoped warnings does not change labels, geometry or project data');
});
