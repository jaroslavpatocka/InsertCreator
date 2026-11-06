import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');

// 520 x 400 leaves 16 and 22 mm beyond the 12 x 9 raster.
const base=validateProject({...blankProject(),id:'shape',name:'shape',width:520,height:400,grid:42,bottomMode:'grid',bedWidth:600,bedHeight:600});
base.tools=[{id:'w',name:'w',points:[{x:-60,y:-20},{x:510,y:-20},{x:510,y:20},{x:-60,y:20}],x:0,y:0,rotation:36,depth:8,moduleId:null,fingerGrips:[],locked:false}];
const placed=autoArrange(base),project={...base,tools:placed.tools,modules:placed.modules};
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([project]));localStorage.setItem('suplik-studio-current','"shape"');
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='shape');
const cells=()=>saved().modules[0].cells?.length;
const pick=value=>{const el=$('[data-smart-shape]');assert.ok(el,'shape select');el.value=value;el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const action=name=>{const el=$(`#app [data-action="${name}"]`);assert.ok(el,name);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
after(()=>win.happyDOM.abort());

test('switching the module shape cuts or fills in place as one undo step',()=>{
  const start=saved().modules[0];
  pick('rectangular');assert.equal(cells(),undefined);
  pick('stepped');const cut=cells();assert.ok(cut>0&&cut<54,'the module follows the tool on the raster');
  assert.deepEqual([saved().modules[0].x,saved().modules[0].y],[start.x,start.y]);
  action('undo');assert.equal(cells(),undefined);action('redo');assert.equal(cells(),cut);
});
test('the editor shows the expansion piece and the free cells for plugs',()=>{
  action('2d');
  assert.ok($('[data-baseplate-expansion="right"]'),'right strip');assert.ok($('[data-baseplate-expansion="bottom"]'),'bottom strip');
  assert.equal($('[data-baseplate-expansion="right"]').getAttribute('width'),'15.75');
});
