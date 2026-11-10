import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject,writeLocal,readLocal} from '../dist/model.js';
import {exportSVG,validateLayout} from '../dist/geometry.js';
import {isCustomModule} from '../dist/custom-module.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
writeLocal('suplik-studio-lang','cs');writeLocal('suplik-studio-unit','mm');writeLocal('suplik-studio-start-guide',{status:'done'});
const original=validateProject({...blankProject(),id:'custom-app',width:336,height:252,bottomMode:'plain'});
writeLocal('suplik-studio-projects-v1',[original]);writeLocal('suplik-studio-current',original.id);
await import('../dist/app.js');
after(async()=>{await win.happyDOM.close();globalThis.setTimeout=nativeTimeout;});
const $=selector=>document.querySelector(selector),pause=()=>new Promise(resolve=>nativeTimeout(resolve,0));
const saved=()=>readLocal('suplik-studio-projects-v1',[]).find(item=>item.id===original.id);
function click(selector){const el=$(selector);assert.ok(el,selector);el.click();}
const action=name=>click(`[data-action="${name}"]`);
function change(key,value){const el=$(`[data-custom-field="${key}"]`);assert.ok(el,key);el.value=String(value);el.dispatchEvent(new win.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}

test('own module is created, edited and persisted through the actual app, with cancel and atomic history',async()=>{
  await pause();const before=saved();action('add-custom-module');
  change('name','My parts');change('pocketName','Universal tray');change('label','M6');change('shape','ellipse');
  change('pocketWidth',48);change('pocketHeight',40);change('depth',8);
  assert.deepEqual(saved(),before,'all input stays in a draft');
  assert.ok($('.cme-preview .cme-pocket').getAttribute('d').length>100,'the real custom outline is shown');
  click('[data-custom-save]');assert.equal($('#modal-root').children.length,0);
  const created=saved(),id=created.modules[0].id;
  assert.equal(created.modules.length,1);assert.equal(created.tools.length,1);
  assert.equal(created.tools[0].customPocket,true);assert.equal(created.tools[0].sizeLabel,'M6');assert.equal(created.sizeLabels,true);
  assert.equal(created.modules[0].sizeMode,'manual');assert.equal(created.modules[0].width,84);assert.equal(created.tools[0].depth,8);
  assert.deepEqual(validateLayout(created),[]);assert.equal(isCustomModule(validateProject(JSON.parse(JSON.stringify(created))),id),true);
  assert.ok($('[data-action="edit-custom-module"]'),'reopening is directly available in the inspector');
  assert.ok(exportSVG(created).includes(created.tools[0].id),'the pocket reaches manufacturing SVG');
  action('edit-custom-module');change('pocketWidth',42);click('[data-custom-cancel]');assert.deepEqual(saved(),created);
  action('edit-custom-module');change('pocketWidth',42);click('[data-custom-save]');
  const edited=saved();assert.equal(edited.modules[0].id,id);assert.equal(edited.tools[0].id,created.tools[0].id);
  assert.notDeepEqual(edited.tools[0].points,created.tools[0].points);
  action('undo');assert.deepEqual(saved().tools,created.tools);action('redo');assert.deepEqual(saved().tools,edited.tools);
  const beforeInvalid=saved();action('edit-custom-module');change('pocketWidth',500);assert.equal($('[data-custom-save]').disabled,true);
  assert.ok($('[data-custom-error]').textContent);assert.deepEqual(saved(),beforeInvalid);click('[data-custom-cancel]');
  action('undo');assert.deepEqual(saved().tools,created.tools,'rejected input adds no history entry');
});

test('an editor opened before a project change cannot overwrite the newer project',()=>{
  action('edit-custom-module');change('label','M8');action('undo');
  const current=saved();click('[data-custom-save]');
  assert.deepEqual(saved(),current);assert.ok($('[data-custom-error]').textContent.includes('Projekt se mezitím změnil'));
  click('[data-custom-cancel]');action('redo');
});

test('module controls remain reachable at a mobile width and custom identity survives category changes',()=>{
  win.innerWidth=390;action('2d');assert.ok($('.assembly-panel [data-action="add-custom-module"]'));
  const p=saved();p.tools[0].category='other';assert.equal(isCustomModule(validateProject(p),p.modules[0].id),true);
});

test('wall profiles can be edited after insertion and invalid depth changes are atomic',()=>{
  const select=$('[data-pocket-wall-type]');assert.ok(select);select.value='roundTop';select.dispatchEvent(new win.Event('change',{bubbles:true}));
  assert.deepEqual(saved().tools[0].pocketWall,{type:'roundTop',value:2});
  const before=saved(),depth=$('[data-field="depth"][data-scope="tool"]');depth.value='0.5';depth.dispatchEvent(new win.Event('change',{bubbles:true}));
  assert.deepEqual(saved(),before,'a depth below the rounding radius cannot invalidate the saved project');
  const radius=$('[data-field="wallValue"]');assert.ok(radius);radius.value='1';radius.dispatchEvent(new win.Event('change',{bubbles:true}));
  assert.deepEqual(saved().tools[0].pocketWall,{type:'roundTop',value:1});
  action('undo');assert.deepEqual(saved().tools[0].pocketWall,{type:'roundTop',value:2});
  action('edit-custom-module');assert.equal($('[data-custom-field="wallType"]').value,'roundTop');click('[data-custom-cancel]');
});
