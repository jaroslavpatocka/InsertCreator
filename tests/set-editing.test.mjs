import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';
import {addToolGroup} from '../dist/set-module.js';
import {validateLayout} from '../dist/geometry.js';
import {findToolSets,setCoherence} from '../dist/tool-sets.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

function uniformProject(id,{manual=false}={}){
  const tool=(suffix,width)=>({id:`${id}-${suffix}`,name:suffix,points:[{x:0,y:0},{x:width,y:0},{x:width,y:10},{x:0,y:10}],depth:8,x:0,y:0,rotation:0,locked:false,moduleId:null,fingerGrips:[]});
  const base={...blankProject(),id,name:id,width:588,height:420,limitToBed:false};
  const project=addToolGroup(base,[tool('large',100),tool('small',50)],{toolSet:{id:`set-${id}`,name:'Moje sjednocená sada',layout:'uniform'}}).project;
  if(manual)for(const module of project.modules)module.sizeMode='manual';
  return project;
}
const fixtures=[uniformProject('scale-auto'),uniformProject('size-auto'),uniformProject('scale-manual',{manual:true}),uniformProject('scale-same-size')];
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(fixtures));
localStorage.setItem('suplik-studio-current',JSON.stringify(fixtures[0].id));
localStorage.setItem('suplik-studio-lang','"cs"');
localStorage.setItem('suplik-studio-unit','"mm"');

const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const logical=project=>{const next=structuredClone(project);delete next.updatedAt;return next;};
function open(id,suffix='small'){
  action('projects');click(`[data-open="${id}"]`);click(`[data-select="${id}-${suffix}"]`);
  return saved();
}
function scale(percent){const field=$('#app [data-field=toolScale]');assert.ok(field);field.value=String(percent);field.dispatchEvent(new win.Event('change',{bubbles:true}));}
const sizes=project=>project.modules.map(module=>[module.width,module.height]);
const coherence=project=>setCoherence(project,findToolSets(project).sets);
const assertNotice=()=>assert.match($('#toast').textContent,/Sada „Moje sjednocená sada“ už nemá stejně velké moduly, její uspořádání je teď Automaticky\./);

await import('../dist/app.js');
after(async()=>{await win.happyDOM.close();});

test('scaling an automatic uniform-set member releases the size promise and is one undo step',()=>{
  const before=open('scale-auto');
  assert.deepEqual(sizes(before),[[126,42],[126,42]]);
  assert.deepEqual(coherence(before).unsatisfied,[]);
  scale(50);
  const after=saved(),small=after.tools.find(tool=>tool.id==='scale-auto-small'),original=before.tools.find(tool=>tool.id===small.id);
  assert.deepEqual(small.points,original.points.map(point=>({x:point.x*.5,y:point.y*.5})));
  assert.deepEqual(sizes(after),[[126,42],[42,42]]);
  assert.equal(after.toolSets[0].layout,'auto');
  assert.deepEqual(validateLayout(after),[]);
  assertNotice();
  action('undo');assert.deepEqual(logical(saved()),logical(before),'One undo restores the original dimensions, contour and uniform layout');
  action('redo');assert.deepEqual(logical(saved()),logical(after),'Redo restores the released layout with the scaled contour');
});

test('automatic sizing of a smaller uniform-set member releases the size promise without changing contours',()=>{
  const before=open('size-auto');
  action('size-module-auto');
  const after=saved();
  assert.deepEqual(sizes(after),[[126,42],[84,42]]);
  assert.equal(after.toolSets[0].layout,'auto');
  assert.deepEqual(after.tools.map(tool=>tool.points),before.tools.map(tool=>tool.points));
  assert.deepEqual(validateLayout(after),[]);
  assertNotice();
  action('undo');assert.deepEqual(logical(saved()),logical(before),'Sizing and releasing the set share one undo step');
});

test('scaling inside manual uniform modules preserves their dimensions and the uniform layout',()=>{
  const before=open('scale-manual');
  scale(50);
  const after=saved();
  assert.deepEqual(after.modules,before.modules,'Manual module footprints stay unchanged');
  assert.equal(after.toolSets[0].layout,'uniform');
  assert.deepEqual(coherence(after).unsatisfied,[]);
  assert.deepEqual(validateLayout(after),[]);
  const original=before.tools.find(tool=>tool.id==='scale-manual-small'),small=after.tools.find(tool=>tool.id===original.id);
  assert.deepEqual(small.points,original.points.map(point=>({x:point.x*.5,y:point.y*.5})));
  action('undo');assert.deepEqual(logical(saved()),logical(before));
});

test('scaling that leaves automatic module dimensions equal keeps the uniform layout',()=>{
  const before=open('scale-same-size','large');
  scale(90);
  const after=saved();
  assert.deepEqual(sizes(after),sizes(before));
  assert.equal(after.toolSets[0].layout,'uniform');
  assert.deepEqual(coherence(after).unsatisfied,[]);
  assert.deepEqual(validateLayout(after),[]);
  action('undo');assert.deepEqual(logical(saved()),logical(before));
});
