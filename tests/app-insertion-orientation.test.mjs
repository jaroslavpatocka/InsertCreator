import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';
﻿import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,bounds,validateLayout} from '../dist/geometry.js';
import {simpleOutline} from '../dist/finger-grip.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
const canvases=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);
  if(canvas.width!==element.width)canvas.width=element.width;
  if(canvas.height!==element.height)canvas.height=element.height;
  return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const ctx=actual(this).getContext('2d');
  return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});
};
let contourCount=2;
const photoAngles=[45,-27];
function photoContour(index,scale){
  const radians=photoAngles[index]*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return [{x:0,y:0},{x:80,y:0},{x:95,y:8},{x:80,y:16},{x:0,y:16}].map(point=>({x:(30+index*140+point.x*c-point.y*s)*scale,y:(45+point.x*s+point.y*c)*scale}));
}
globalThis.Worker=class{
  constructor(url){this.url=String(url);if(!/\/(?:recognize|tool-neural)-worker\.js$/.test(this.url))throw Error('Use fallback');}
  postMessage(message){queueMicrotask(()=>{if(this.terminated)return;if(this.url.endsWith('/tool-neural-worker.js'))return this.onmessage?.({data:instanceWorkerReply(message)});this.onmessage?.({data:{result:{width:message.image.width,height:message.image.height,contours:Array.from({length:contourCount},(_,index)=>({points:photoContour(index,message.options.pxPerMm)})),mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});});}
  terminate(){this.terminated=true;}
};
const initial={...blankProject(),id:'photo-orientation',name:'Photo angle regression',width:504,height:378};
const tooSmall={...blankProject(),id:'photo-orientation-small',name:'Small drawer angle regression',width:84,height:42};
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial,tooSmall]));
localStorage.setItem('suplik-studio-current',JSON.stringify(initial.id));
localStorage.setItem('suplik-studio-library-v1','[]');
await import('../dist/app.js');
after(async()=>{delete globalThis.Worker;await win.happyDOM.close();});
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const el=$(selector);assert.ok(el,selector);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
function change(selector,value){const el=$(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new win.Event('change',{bubbles:true}));}
async function waitFor(check,message){const start=performance.now();while(!check()){if(performance.now()-start>10000)throw Error(message+'; '+$('#modal-root').textContent);await new Promise(resolve=>setTimeout(resolve,3));}}
const logical=project=>{const copy=structuredClone(project);delete copy.updatedAt;return copy;};

test('actual photo addition keeps the source angle for one tool and each multi-tool import choice',async t=>{
  for(const [count,layout] of [[1,'auto'],[2,'shared'],[2,'each'],[2,'auto'],[2,'photo']])await t.test(`${count} tool(s), ${layout}`,async()=>{
    contourCount=count;const before=saved();
    action('capture');click('#sample-scan');await waitFor(()=>$(`[data-name="${count-1}"]`),'recognised fixture');
    change('#capture-pocket-shape','measured');change('#capture-layout',layout);
    click('#capture-add');await waitFor(()=>saved().tools.length===count&&!$('#trace-canvas'),'addition committed');
    const after=saved();assert.deepEqual(validateLayout(after),[]);assert.equal(after.modules.length,layout==='each'?count:1);
    for(const [index,tool] of after.tools.entries()){
      assert.equal(tool.rotation,0,`tool ${index} retains the original contour frame`);
      // The longest measured edge is directional: a mirrored or 90/180 degree turn cannot pass.
      const points=tool.points;let longest=null;
      for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!longest||length>longest.length)longest={dx,dy,length};}
      const angle=(Math.atan2(longest.dy,longest.dx)*180/Math.PI+360)%180;
      assert.ok(Math.abs(angle-(photoAngles[index]+180)%180)<.01,`original photo angle survives: ${angle}`);
    }
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(after))).tools.map(tool=>tool.rotation),after.tools.map(tool=>tool.rotation));
    action('undo');assert.deepEqual(logical(saved()),logical(before),'one undo restores the entire insertion');
    action('redo');assert.deepEqual(logical(saved()),logical(after),'redo restores original angles');
    action('undo');
  });
});

test('growing an undersized drawer keeps the angle of an incoming tool that initially had no module',async()=>{
  const more=$('#app [data-action="mobile-more"]');
  if(more){more.click();click('[data-mobile-menu="projects"]');}else action('projects');
  click(`[data-open="${tooSmall.id}"]`);
  contourCount=1;photoAngles[0]=75;
  action('capture');click('#sample-scan');await waitFor(()=>$('[data-name="0"]'),'recognised fixture');
  change('#capture-pocket-shape','measured');change('#capture-layout','each');
  click('#capture-add');await waitFor(()=>$('[data-fit="grow"]'),'drawer fit prompt');
  assert.equal(saved().tools[0].rotation,0,'unplaced tool still has its original photo angle');
  click('[data-fit="grow"]');
  assert.equal(saved().tools[0].rotation,0,'enlarging the drawer cannot rotate the newly inserted tool');
  assert.deepEqual(validateLayout(saved()),[]);
  action('undo');assert.equal(saved().tools.length,0);
});
