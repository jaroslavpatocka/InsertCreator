import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
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
let fixtureContours=[];
globalThis.Worker=class{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){queueMicrotask(()=>{
    if(this.terminated)return;
    if(this.url.endsWith('/tool-neural-worker.js'))return this.onmessage?.({data:instanceWorkerReply(message)});
    const scale=message.options.pxPerMm;
    const rect=(x,y,width,height)=>({points:[{x:x*scale,y:y*scale},{x:(x+width)*scale,y:y*scale},{x:(x+width)*scale,y:(y+height)*scale},{x:x*scale,y:(y+height)*scale}]});
    fixtureContours=[rect(10,10,20,100),rect(60,10,25,80)];
    this.onmessage?.({data:{result:{width:message.image.width,height:message.image.height,contours:fixtureContours,mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
  });}
  terminate(){this.terminated=true;}
};
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const menu=()=>$('.model-context-menu');
const pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn,message){
  const started=performance.now();
  while(!fn()){if(performance.now()-started>5000)throw Error('Timed out: '+message);await pause();}
}
function typed(selector,value){const input=$(selector);assert.ok(input,selector);input.value=value;input.dispatchEvent(new win.Event('input',{bubbles:true}));}
function changed(selector,value){const input=$(selector);assert.ok(input,selector);input.checked=value;input.dispatchEvent(new win.Event('change',{bubbles:true}));}
async function sample(){
  $('#sample-scan').click();await waitFor(()=>$('[data-name="1"]'),'two capture tools');
  const canvas=$('#trace-canvas');
  canvas.getBoundingClientRect=()=>({left:120,top:85,width:canvas.width/2,height:canvas.height/2,right:120+canvas.width/2,bottom:85+canvas.height/2});
}
function right(index){
  const canvas=$('#trace-canvas'),points=fixtureContours[index].points;
  const x=(points[0].x+points[2].x)/2,y=(points[0].y+points[2].y)/2;
  const event=new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:120+x/2,clientY:85+y/2});
  canvas.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.ok(menu(),'tool context menu');
}
function action(name){const button=$(`[data-context-action="${name}"]`);assert.ok(button,name);button.click();}

test('photo context menu opens the shared guide on the clicked tool and keeps its live edits',{timeout:30000},async t=>{
  t.after(async()=>{delete globalThis.Worker;await win.happyDOM.close();});
  setLang('cs',{save:false});setAppUnit('mm',{save:false});
  let added;
  const modal=openCapture({onAdd:tools=>added=tools});
  await sample();
  typed('[data-name="0"]','První klíč');typed('[data-name="1"]','Druhý klíč');typed('#capture-depth','14');
  changed('[data-item="1"]',false);
  right(1);
  assert.match(menu().textContent,/Druhý klíč/);assert.match(menu().textContent,/14\s*mm/);
  assert.match(menu().textContent,/80/);assert.match(menu().textContent,/25/);
  assert.equal($('[data-item="1"]').checked,false,'right-click does not re-include a tool');
  action('properties');
  assert.equal(menu(),null);assert.equal($('.capture-guide-panel')?.dataset.guideIndex,'1');
  assert.equal($('#capture-guide-name').value,'Druhý klíč');
  assert.equal(win.document.activeElement,$('#capture-guide-name'),'properties opens the actual guide editor');
  right(0);assert.equal($('.capture-guide-panel').dataset.guideIndex,'0','an open guide follows the right-clicked tool');
  action('properties');right(1);action('properties');
  typed('#capture-guide-name','Ráčna 3/8');typed('#capture-guide-depth','0.5 in');
  typed('#capture-guide-length','90');$('#capture-guide-resize').click();
  await waitFor(()=>!$('#capture-guide-resize').disabled,'dimension correction applied');
  assert.equal($('[data-name="1"]').value,'Ráčna 3/8','guide and list share live tool drafts');
  $('#capture-guide-list').click();
  right(1);assert.match(menu().textContent,/Ráčna 3\/8/);assert.match(menu().textContent,/12[,.]7\s*mm/);
  assert.match(menu().textContent,/90/,'information shows the corrected manufacturing dimensions');
  action('depth');assert.equal(win.document.activeElement,$('#capture-guide-depth'));
  assert.equal($('#capture-guide-depth').value,'0.5 in');
  changed('#capture-guide-include',true);
  $('#capture-guide-list').click();changed('#trace-mask',true);right(0);
  assert.match(menu().textContent,/První klíč/);assert.doesNotMatch(menu().textContent,/Ráčna/);
  win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(menu(),null);assert.ok($('#trace-canvas'),'Escape closes the menu and keeps capture open');
  right(0);$('#capture-add').click();
  assert.equal(menu(),null,'starting import closes the photo menu');
  await waitFor(()=>added,'capture import');
  assert.deepEqual(added.map(tool=>tool.name),['První klíč','Ráčna 3/8']);
  assert.deepEqual(added.map(tool=>tool.depth),[14,12.7]);assert.equal($('#trace-canvas'),null);
  modal.close();

  await t.test('English menus and lifecycle cleanup work across calibration and retaking',async()=>{
    setLang('en',{save:false});
    const current=openCapture({onAdd(){}});
    await sample();right(0);
    assert.match($('#trace-canvas').title,/Right-click a tool/);
    assert.match(menu().textContent,/Tool properties/);assert.match(menu().textContent,/Pocket depth/);
    assert.doesNotMatch(menu().textContent,/Vlastnosti|Hloubka/);
    $('#capture-calibration-back').click();assert.equal(menu(),null);assert.ok($('#calibration-canvas'));
    $('#capture-back').click();await sample();right(1);
    $('#retake-photo').click();assert.equal(menu(),null);assert.ok($('#sample-scan'));
    await sample();right(0);current.close();assert.equal(menu(),null);
  });
  await t.test('a failed import leaves photo actions and the shared editor usable for retry',async()=>{
    setLang('cs',{save:false});let attempts=0,retried;
    const current=openCapture({onAdd:tools=>{if(++attempts===1)throw Error('Zkušební chyba importu');retried=tools;}});
    await sample();right(0);$('#capture-add').click();assert.equal(menu(),null);
    await waitFor(()=>$('#capture-error').textContent.includes('Zkušební chyba'),'failed import reported');
    right(1);action('properties');typed('#capture-guide-name','Opravený nástroj');
    $('#capture-add').click();await waitFor(()=>retried,'successful retry');
    assert.equal(attempts,2);assert.equal(retried[1].name,'Opravený nástroj');assert.equal(menu(),null);
    current.close();
  });
});
