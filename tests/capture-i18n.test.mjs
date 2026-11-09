import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
const canvases=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')return null;const ctx=actual(this).getContext('2d');return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});};
// The instance fixture answers; the contour worker records calibrated input and remains pending.
const posted=[];
globalThis.Worker=class{constructor(url){this.url=String(url);}postMessage(message){posted.push({url:this.url,message});if(this.url.endsWith('/tool-neural-worker.js'))queueMicrotask(()=>this.onmessage?.({data:instanceWorkerReply(message)}));}terminate(){}};
const {setLang,getLang}=await import('../dist/i18n.js'),{setAppUnit,parseLength}=await import('../dist/units.js');
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,message){const started=performance.now();while(!fn()){if(performance.now()-started>3000)throw Error('Timed out: '+message);await pause(2);}}
function input(element,value){element.value=value;element.dispatchEvent(new win.Event('input',{bubbles:true}));}
async function openRuler(){
  const modal=openCapture({onAdd(){}});const reference=$('#photo-reference');reference.value='ruler';reference.onchange();
  $('#sample-scan').click();await waitFor(()=>$('#ruler-distance'),'ruler calibration');return modal;
}

test('capture modal follows language and unit, ruler distance accepts any unit',async t=>{
  t.after(async()=>{setLang('cs');setAppUnit('mm');delete globalThis.Worker;await win.happyDOM.close();});
  await t.test('English capture modal is built in English when opened after a language change',async()=>{
    setLang('en');assert.equal(getLang(),'en');
    const modal=openCapture({onAdd(){}});
    assert.match($('#modal-title').textContent,/Take a photo/);assert.match($('#sample-scan').textContent,/Try it on a sample photo/);
    assert.match($('.capture-steps').textContent,/1 · Photo/);assert.doesNotMatch($('.modal-body').textContent,/Vyfoťte|Fotografie|nástroj/);
    modal.close();setLang('cs');
    const czech=openCapture({onAdd(){}});assert.match($('#modal-title').textContent,/Vyfoťte/);assert.match($('#sample-scan').textContent,/ukázkové fotografii/);czech.close();
  });
  await t.test('ruler distance shows the current unit and parses "4 in" as 101.6 mm',async()=>{
    setLang('en');setAppUnit('in');
    let modal=await openRuler();const field=$('#ruler-distance');
    assert.equal(field.type,'text');assert.equal(field.getAttribute('inputmode'),'decimal');assert.equal(field.nextElementSibling.textContent,'in');assert.equal(field.value,'3.937');
    assert.match($('.capture-sidebar').textContent,/Real distance between the marks/);
    input(field,'abc');$('#capture-continue').click();assert.match($('#capture-error').textContent,/Enter the real distance between the marks, from 0.039 in to 196.85 in/);
    setAppUnit('mm');input(field,'4 in');$('#capture-continue').click();
    await waitFor(()=>posted.some(p=>p.url.includes('recognize-worker')),'recognition started');
    const sent=posted.find(p=>p.url.includes('recognize-worker')).message.options.pxPerMm,distancePx=1000*.4;
    assert.ok(Math.abs(sent-distancePx/101.6)<1e-9,`scale ${sent}`);assert.equal(parseLength('4 in'),101.6);
    $('#cancel-processing').click();modal.close();
    // Czech + mm: default 100 mm, Czech error text.
    setLang('cs');posted.length=0;modal=await openRuler();
    assert.equal($('#ruler-distance').value,'100');assert.equal($('#ruler-distance').nextElementSibling.textContent,'mm');
    input($('#ruler-distance'),'0');$('#capture-continue').click();assert.match($('#capture-error').textContent,/Zadejte skutečnou vzdálenost/);modal.close();
  });
});
