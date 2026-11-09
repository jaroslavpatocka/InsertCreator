import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject,writeLocal,readLocal} from '../dist/model.js';
import {exportSVG} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=originalTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
writeLocal('suplik-studio-lang','cs');writeLocal('suplik-studio-unit','mm');
const original=validateProject({...blankProject(),id:'grip-shapes',name:'Mixed finger cutouts',width:252,height:126,insertHeight:20,
  modules:[{id:'mod',x:0,y:0,width:126,height:84,sizeMode:'manual',locked:true,pocketMargin:.8}],
  tools:[{id:'t',name:'Mixed tool',moduleId:'mod',points:[{x:-10,y:-5},{x:70,y:-5},{x:70,y:15},{x:-10,y:15}],x:20,y:20,rotation:0,depth:8,
    fingerGrips:[{id:'ellipse',x:70,y:5,shape:'ellipse',width:18,height:12,rotation:25},
      {id:'legacy',x:-10,y:5,radius:9},
      {id:'rounded',x:30,y:-5,shape:'rounded-rect',width:18,height:14,rotation:12,cornerRadius:3},
      {id:'rectangle',x:20,y:15,shape:'rectangle',width:16,height:8,rotation:15}]}]});
writeLocal('suplik-studio-projects-v1',[original]);writeLocal('suplik-studio-current',original.id);
await import('../dist/app.js');
after(async()=>{await win.happyDOM.close();globalThis.setTimeout=originalTimeout;});
const $=selector=>document.querySelector(selector),pause=()=>new Promise(resolve=>originalTimeout(resolve,0));
const click=selector=>{const node=$(selector);assert.ok(node,selector);if(typeof node.click==='function')node.click();else node.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click(`[data-action="${name}"]`);
const saved=()=>readLocal('suplik-studio-projects-v1',[]).find(project=>project.id===original.id);
function change(selector,value){const input=$(selector);assert.ok(input,selector);input.value=String(value);input.dispatchEvent(new win.Event('input',{bubbles:true}));input.dispatchEvent(new win.Event('change',{bubbles:true}));}

test('app saves mixed cutout shapes synchronously and exports their actual millimetres, with atomic undo and errors',async()=>{
  await pause();click('.tool-outline[data-tool="t"]');await pause();
  assert.match($('.grip-summary').textContent,/Ovál/);assert.match($('.grip-summary').textContent,/Zaoblený obdélník/);
  assert.doesNotMatch($('.grip-summary').textContent,/NaN|undefined/);
  const before=saved();action('finger-grips');
  change('[data-grip-row="ellipse"] [data-field=fingerX]',82);
  assert.deepEqual(saved(),before,'a modal draft never mutates the project');
  click('[data-grips-save]');
  assert.equal($('#modal-root').children.length,0,'synchronous validation and commit preserve existing Save behaviour');
  const edited=saved(),ellipse=edited.tools[0].fingerGrips.find(grip=>grip.id==='ellipse');
  assert.deepEqual(ellipse,{...before.tools[0].fingerGrips[0],x:82});
  assert.deepEqual(edited.tools[0].points,before.tools[0].points,'cutout editing does not resize the physical tool');
  assert.deepEqual(edited.modules,before.modules,'a fitting edit keeps the locked module');
  assert.deepEqual(edited.tools[0].fingerGrips.slice(1),before.tools[0].fingerGrips.slice(1));
  const svg=exportSVG(edited),d=svg.match(/<path id="t"[^>]* d="([^"]+)"/)?.[1];assert.ok(d);
  const xs=[...d.matchAll(/(?:M|L)(-?[\d.]+),(-?[\d.]+)/g)].map(match=>Number(match[1]));
  // Analytic ellipse extremum: no expected outline calls pocketOutline or fingerGripOutline.
  const angle=25*Math.PI/180,expectedRight=20+82+Math.hypot(9*Math.cos(angle),6*Math.sin(angle));
  assert.ok(Math.abs(Math.max(...xs)-expectedRight)<.02,'SVG uses the rotated ellipse, rather than a replacement circle');
  assert.ok(Math.abs(Math.min(...xs)-11)<.002,'the legacy 9 mm circular cutout remains exact');
  const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project:edited})));
  assert.deepEqual(restored.tools[0].fingerGrips,edited.tools[0].fingerGrips,'all four shapes survive actual project persistence');
  action('undo');assert.deepEqual(saved().tools[0].fingerGrips,before.tools[0].fingerGrips);
  action('redo');assert.deepEqual(saved().tools[0].fingerGrips,edited.tools[0].fingerGrips);
  const beforeInvalid=saved();
  action('finger-grips');change('[data-grip-row="ellipse"] [data-field=fingerX]',500);
  click('[data-grips-save]');assert.deepEqual(saved(),beforeInvalid,'a disconnected cutout cannot partially commit');
  assert.ok($('[data-grip-error]').textContent);click('[data-modal-close]');
  action('undo');assert.deepEqual(saved().tools[0].fingerGrips,before.tools[0].fingerGrips,'a rejected Save adds no history entry');
});
