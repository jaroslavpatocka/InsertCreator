import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const canvases=new WeakMap(),paints=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;const element=this,target=actual(element).getContext('2d');let path=[];
  if(!paints.has(element))paints.set(element,[]);const strokes=paints.get(element);
  return new Proxy(target,{get:(ctx,key)=>{
    if(key==='drawImage')return(source,...args)=>ctx.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args);
    if(key==='putImageData')return(...args)=>{strokes.length=0;return ctx.putImageData(...args);};
    if(key==='beginPath')return()=>{path=[];ctx.beginPath();};
    if(key==='moveTo'||key==='lineTo')return(x,y)=>{path.push({x,y});ctx[key](x,y);};
    if(key==='stroke')return()=>{strokes.push({color:ctx.strokeStyle,points:structuredClone(path),dash:ctx.getLineDash()});ctx.stroke();};
    return typeof ctx[key]==='function'?ctx[key].bind(ctx):ctx[key];
  },set:(ctx,key,value)=>(ctx[key]=value,true)});
};
let recognitions=0,calibration=1;
globalThis.Worker=class{
  constructor(url){this.url=String(url);}
  postMessage(message){queueMicrotask(()=>{
    if(this.closed)return;
    if(this.url.endsWith('/tool-neural-worker.js'))return this.onmessage?.({data:instanceWorkerReply(message)});
    recognitions++;calibration=message.options.pxPerMm;
    const source=[{x:30,y:30},{x:45,y:30},{x:45,y:50},{x:39,y:50},{x:39.3,y:60},{x:39,y:70},{x:39.4,y:80},{x:39,y:90},{x:47,y:90},{x:47,y:125},{x:27,y:125},{x:27,y:90},{x:33,y:90},{x:33,y:50},{x:30,y:50}];
    const contours=[source,[{x:110,y:40},{x:130,y:40},{x:130,y:100},{x:110,y:100}]].map(points=>({points:points.map(p=>({x:p.x*calibration,y:p.y*calibration}))}));
    this.onmessage?.({data:{result:{width:message.image.width,height:message.image.height,contours,mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
  });}
  terminate(){this.closed=true;}
};
const {setLang}=await import('../dist/i18n.js');setLang('cs',{save:false});
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
function change(selector,value){const field=$(selector);field.value=value;field.dispatchEvent(new win.Event('change',{bubbles:true}));}
const waitFor=async(fn)=>{const started=performance.now();while(!fn()){if(performance.now()-started>5000)throw Error('Capture did not become ready');await new Promise(resolve=>setTimeout(resolve,2));}};
const green=()=>paints.get($('#trace-canvas')).find(stroke=>stroke.color==='#577b67');

test('capture defaults to smooth pockets with reserve, switches without recognition, and imports the previewed geometry',{timeout:15000},async t=>{
  let added,options;const modal=openCapture({onAdd:(tools,opts)=>{added=tools;options=opts;}});
  t.after(async()=>{modal.close();delete globalThis.Worker;await win.happyDOM.close();});
  $('#sample-scan').click();await waitFor(()=>$('[data-name="1"]'));
  assert.equal($('#capture-pocket-shape').value,'ideal');
  assert.deepEqual([...$('#capture-pocket-shape').options].map(option=>option.value),['ideal','hybrid','functional','measured']);
  $('[data-name="0"]').focus();const fitted=structuredClone(green().points),calls=recognitions;
  assert.ok(paints.get($('#trace-canvas')).some(stroke=>stroke.dash.length),'active tool axis is visible');
  change('#capture-pocket-shape','measured');assert.notDeepEqual(green().points,fitted);
  change('#capture-pocket-shape','functional');assert.notDeepEqual(green().points,fitted,'fully regular is a distinct optional pocket');
  change('#capture-pocket-shape','hybrid');assert.notDeepEqual(green().points,fitted,'balanced pockets remain accessible');
  change('#capture-pocket-shape','ideal');assert.deepEqual(green().points,fitted);assert.equal(recognitions,calls);
  $('#capture-guide-start').click();assert.equal($('#capture-pocket-shape').value,'ideal');
  $('#capture-guide-list').click();change('#capture-layout','photo');
  $('#capture-add').click();await waitFor(()=>added);
  assert.equal(options.layout,'photo');assert.equal(added.length,2);
  assert.equal(added[0].pocketFit.mode,'ideal');
  const points=added[0].points.map(point=>({x:point.x+added[0].x,y:point.y+added[0].y}));assert.equal(points.length,fitted.length);
  points.forEach((point,i)=>{assert.ok(Math.abs(point.x-fitted[i].x/calibration)<1e-7);assert.ok(Math.abs(point.y-fitted[i].y/calibration)<1e-7);});
});
