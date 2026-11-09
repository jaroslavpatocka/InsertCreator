import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {pocketOutline} from '../dist/finger-grip.js';

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
    if(key==='stroke')return()=>{strokes.push({color:ctx.strokeStyle,points:structuredClone(path)});ctx.stroke();};
    return typeof ctx[key]==='function'?ctx[key].bind(ctx):ctx[key];
  },set:(ctx,key,value)=>(ctx[key]=value,true)});
};
let calibration=1;
globalThis.Worker=class{
  constructor(url){this.url=String(url);}
  postMessage(message){queueMicrotask(()=>{
    if(this.closed)return;
    if(this.url.endsWith('/tool-neural-worker.js'))return this.onmessage?.({data:instanceWorkerReply(message)});
    calibration=message.options.pxPerMm;
    const rect=(x,y,width,height)=>({points:[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}].map(p=>({x:p.x*calibration,y:p.y*calibration}))});
    this.onmessage?.({data:{result:{width:message.image.width,height:message.image.height,contours:[rect(20,25,20,60),rect(80,35,30,50)],mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
  });}
  terminate(){this.closed=true;}
};
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const node=$(selector);assert.ok(node,selector);node.click();};
function type(selector,value){const field=$(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new win.Event('input',{bubbles:true}));}
const waitFor=async(fn)=>{const started=performance.now();while(!fn()){if(performance.now()-started>5000)throw Error('Capture margin fixture timed out');await new Promise(resolve=>setTimeout(resolve,2));}};
const box=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
const margins=()=>paints.get($('#trace-canvas')).filter(stroke=>stroke.color==='#3b7c9c').map(stroke=>box(stroke.points.map(p=>({x:p.x/calibration,y:p.y/calibration}))));
const close=(a,b)=>assert.ok(Math.abs(a-b)<.0002,`${a} != ${b}`);
after(async()=>{delete globalThis.Worker;setLang('cs',{save:false});setAppUnit('mm',{save:false});await win.happyDOM.close();});

test('capture margin belongs to the new module, supports local overrides and updates real pocket previews',{timeout:15000},async t=>{
  setLang('cs',{save:false});setAppUnit('mm',{save:false});
  let added,options;const modal=openCapture({onAdd:(tools,opts)=>{added=tools;options=opts;}});t.after(()=>modal.close());
  click('#sample-scan');await waitFor(()=>$('[data-name="1"]'));
  const shape=$('#capture-pocket-shape');shape.value='measured';shape.dispatchEvent(new win.Event('change',{bubbles:true}));
  assert.equal($('#capture-pocket-margin').value,'0.8');close(margins()[0].width,21.6);close(margins()[1].width,31.6);
  click('#capture-guide-start');assert.equal($('#capture-guide-margin').value,'');assert.equal($('#capture-guide-margin').placeholder,'0.8');
  type('#capture-guide-margin','1 mm');close(margins()[0].width,22);
  type('#capture-pocket-margin','2 mm');close(margins()[0].width,22);close(margins()[1].width,34);
  type('#capture-guide-margin','0');close(margins()[0].width,20);close(margins()[1].width,34);
  type('#capture-guide-margin','-1');assert.equal($('#capture-guide-margin').getAttribute('aria-invalid'),'true');click('#capture-add');assert.equal(added,undefined);
  type('#capture-guide-margin','0');click('#capture-guide-next');assert.equal($('#capture-guide-margin').value,'');assert.equal($('#capture-guide-margin').placeholder,'2');
  type('#capture-guide-margin','1/16 in');close(margins()[1].width,30+2*1.5875);
  type('#capture-guide-margin','');close(margins()[1].width,34);
  type('#capture-pocket-margin','11 mm');click('#capture-add');assert.equal(added,undefined);assert.equal($('#capture-error').hidden,false);
  type('#capture-pocket-margin','1 mm');close(margins()[0].width,20);close(margins()[1].width,32);
  const physicalPreview=structuredClone(margins());click('#capture-add');await waitFor(()=>added);
  assert.equal(options.pocketMargin,1);assert.equal(added[0].pocketMargin,0);assert.equal(Object.hasOwn(added[1],'pocketMargin'),false);
  for(let i=0;i<2;i++){
    const raw=box(added[i].points),physical=box(pocketOutline(added[i],added[i].pocketMargin??options.pocketMargin));
    close(raw.width,i?30:20);close(physical.width,physicalPreview[i].width);close(physical.height,physicalPreview[i].height);
  }
  const next=openCapture({onAdd:()=>{}});try{click('#sample-scan');await waitFor(()=>$('[data-name="1"]'));assert.equal($('#capture-pocket-margin').value,'0.8','another photo starts with its own default margin');}finally{next.close();}
});

test('capture parses imperial module and per-pocket margins without changing stored millimetre tool sizes',{timeout:10000},async t=>{
  setLang('en',{save:false});setAppUnit('in',{save:false});let added,options;
  const modal=openCapture({onAdd:(tools,opts)=>{added=tools;options=opts;}});t.after(()=>modal.close());
  click('#sample-scan');await waitFor(()=>$('[data-name="1"]'));
  const shape=$('#capture-pocket-shape');shape.value='measured';shape.dispatchEvent(new win.Event('change',{bubbles:true}));
  type('#capture-pocket-margin','1/16 in');click('#capture-guide-start');type('#capture-guide-margin','0.5 mm');
  assert.doesNotMatch($('.capture-guide-panel').textContent,/Vlastní|Prázdné|Nula/);
  click('#capture-add');await waitFor(()=>added);close(options.pocketMargin,1.5875);close(added[0].pocketMargin,.5);assert.equal(Object.hasOwn(added[1],'pocketMargin'),false);close(box(added[0].points).width,20);
});
