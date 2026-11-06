import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const canvases=new WeakMap();
function actual(element){if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));const canvas=canvases.get(element);if(canvas.width!==element.width)canvas.width=element.width;if(canvas.height!==element.height)canvas.height=element.height;return canvas;}
win.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')return null;const ctx=actual(this).getContext('2d');return new Proxy(ctx,{get:(target,key)=>key==='drawImage'?((source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});};
let status='ready',scale,outlines;
const original=[{x:200,y:200},{x:500,y:200},{x:500,y:300},{x:200,y:300}];
const second=original.map(point=>({x:point.x,y:point.y+250}));outlines=[original];
globalThis.Worker=class{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){queueMicrotask(()=>{if(this.terminated)return;if(this.url.endsWith('/neural-worker.js'))return this.onmessage?.({data:{type:'error',id:message.id,message:'Deterministic capture contour fixture'}});scale=message.options.pxPerMm;this.onmessage?.({data:{result:{contours:outlines.map(points=>({points:structuredClone(points)})),mask:new Uint8Array(message.image.width*message.image.height),quality:{status,reasons:status==='review'?['Část hrany je málo kontrastní nebo splývá se stínem. Přesnost této části nelze z fotografie spolehlivě ověřit.']:[]}}}});});}
  terminate(){this.terminated=true;}
};
const {openCapture}=await import('../dist/capture.js');
const {setLang}=await import('../dist/i18n.js');
const {parseLength}=await import('../dist/units.js');
const $=selector=>win.document.querySelector(selector);
const pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn,message){const started=performance.now();while(!fn()){if(performance.now()-started>8000)throw Error('Timeout '+message+': '+$('.modal-body')?.textContent);await pause();}}
function pointer(type,x,y){const canvas=$('#trace-canvas');canvas.dispatchEvent(new win.PointerEvent(type,{clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,isPrimary:true,bubbles:true,cancelable:true}));}
async function begin({two=false}={}){outlines=two?[original,second]:[original];$('#sample-scan').click();await waitFor(()=>$('[data-trace-index="0"]'),'found contour');const shape=$('#capture-pocket-shape');shape.value='measured';shape.dispatchEvent(new win.Event('change',{bubbles:true}));}

test('the actual capture flow supports profile insertion, a movable point and importing its edited polygon',{timeout:30000},async t=>{
  t.after(async()=>{delete globalThis.Worker;setLang('cs',{save:false});await win.happyDOM.close();});
  await t.test('ready contour opens point actions and imports the manually changed profile',async()=>{
    setLang('cs',{save:false});status='ready';let added;
    const modal=openCapture({onAdd:tools=>added=tools});try{
      await begin();pointer('pointerdown',350,200);assert.equal(win.document.activeElement,$('#trace-canvas'),'editing surface receives actual focus');pointer('pointerup',350,200);assert.ok($('[data-context-action="curve"]'),'a direct click on the profile opens the action selector');
      $('[data-context-action="move"]').click();assert.equal(win.document.activeElement,$('#trace-canvas'),'closing an action menu returns keyboard focus to the contour');pointer('pointerdown',350,200);pointer('pointermove',350,160);pointer('pointerup',350,160);
      assert.equal($('#capture-add').disabled,false);assert.match($('.capture-contour-status').textContent,/ručně upravený/);
      $('#capture-add').click();await waitFor(()=>added,'edited import');assert.equal(added.length,1);
      const photo=added[0].points.map(p=>({x:p.x*scale+200,y:p.y*scale+160}));
      assert.ok(photo.some(p=>Math.abs(p.x-350)<1e-4&&Math.abs(p.y-160)<1e-4),'added manufacturing polygon contains the moved point');
      for(const p of original)assert.ok(photo.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<1e-4),'import retains untouched source corners');
    }finally{modal.close();}
  });
  await t.test('review contours remain honestly labelled editable drafts and can be added explicitly after correction',async()=>{
    setLang('cs',{save:false});status='review';let added;
    const modal=openCapture({onAdd:tools=>added=tools});try{
      await begin();assert.match($('.recognition-status').textContent,/potřebují kontrolu/);assert.ok(!$('.recognition-status').textContent.includes('Rozpoznáno automaticky'));assert.match($('.issue-box').textContent,/málo kontrastní/);
      pointer('pointerdown',350,200);pointer('pointerup',350,200);$('[data-context-action="move"]').click();pointer('pointerdown',350,200);pointer('pointermove',350,180);pointer('pointerup',350,180);
      assert.match($('.recognition-status').textContent,/potřebují kontrolu/,'manual edits must not forge an automatically ready score');
      $('#capture-add').click();await waitFor(()=>added,'explicit reviewed import');assert.equal(added.length,1);
    }finally{modal.close();}
  });
  await t.test('an invalid numeric edit blocks Add until its visible draft is corrected',async()=>{
    setLang('cs',{save:false});status='ready';let added;
    const modal=openCapture({onAdd:tools=>added=tools});try{
      await begin();pointer('pointerdown',350,200);pointer('pointerup',350,200);$('[data-context-action="move"]').click();
      const input=$('[data-contour-field="length"]');input.value='0 mm';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.dispatchEvent(new win.Event('change',{bubbles:true}));
      $('#capture-add').click();await pause();assert.equal(added,undefined);assert.equal(win.document.activeElement,input);assert.equal(input.getAttribute('aria-invalid'),'true');
      input.value='200 mm';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.dispatchEvent(new win.Event('change',{bubbles:true}));$('#capture-add').click();await waitFor(()=>added,'corrected numeric import');assert.equal(added.length,1);
    }finally{modal.close();}
  });
  await t.test('English review and point actions stay translated and show the current measurement unit',async()=>{
    setLang('en',{save:false});status='review';
    const modal=openCapture({onAdd:()=>{}});try{
      await begin();assert.match($('.recognition-status').textContent,/Outlines need review/);pointer('pointerdown',350,200);pointer('pointerup',350,200);
      assert.equal($('[data-context-action="curve"]').textContent,'Bézier curve');assert.equal($('[data-context-action="length"]').textContent,'Lengthen / shorten');
      $('[data-context-action="move"]').click();assert.match($('.capture-contour-fields label span').textContent,/Length \((mm|in)\)/);
      assert.match($('.capture-contour-status').textContent,/Selected point.*manually edited outline/);
    }finally{modal.close();setLang('cs',{save:false});}
  });
  await t.test('manual editing keeps the optional guide on the selected tool and refreshes its measured dimensions',async()=>{
    setLang('cs',{save:false});status='ready';
    const modal=openCapture({onAdd:()=>{}});try{
      await begin();$('#capture-guide-start').click();const before=parseLength($('#capture-guide-width').value);
      pointer('pointerdown',350,200);pointer('pointerup',350,200);$('[data-context-action="move"]').click();pointer('pointerdown',350,200);pointer('pointermove',350,160);pointer('pointerup',350,160);
      assert.equal($('.capture-guide-panel').dataset.guideIndex,'0');assert.ok(parseLength($('#capture-guide-width').value)>before+10/scale,'clean guide dimensions follow the newly edited profile');
      const field=$('#capture-guide-width');field.value='90 mm';field.dispatchEvent(new win.Event('input',{bubbles:true}));
      pointer('pointerdown',350,160);pointer('pointermove',350,150);pointer('pointerup',350,150);assert.equal($('#capture-guide-width').value,'90 mm','manual edits preserve unconfirmed numeric drafts in the optional guide');
    }finally{modal.close();}
  });
  await t.test('a late numeric blur during guide navigation edits its original tool and refreshes that tool’s cached dimensions',async()=>{
    setLang('cs',{save:false});status='ready';let added;
    const modal=openCapture({onAdd:tools=>added=tools});try{
      await begin({two:true});$('#capture-guide-start').click();pointer('pointerdown',350,200);pointer('pointerup',350,200);$('[data-context-action="move"]').click();
      const initialB=parseLength($('#capture-guide-length').value),input=$('[data-contour-field="length"]');input.focus();input.value='200 mm';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.addEventListener('blur',()=>input.dispatchEvent(new win.Event('change',{bubbles:true})),{once:true});
      $('#capture-guide-next').click();await pause();assert.equal($('.capture-guide-panel').dataset.guideIndex,'1');assert.ok(Math.abs(parseLength($('#capture-guide-length').value)-initialB)<.05,'the second tool keeps its original dimension');
      $('#capture-guide-prev').click();assert.ok(Math.abs(parseLength($('#capture-guide-length').value)-200)<.05,'the first tool’s clean cached dimension reflects its late committed edit');
      $('#capture-guide-list').click();$('#capture-add').click();await waitFor(()=>added,'owned late edit import');assert.equal(added.length,2);
    }finally{modal.close();}
  });
  await t.test('an invalid numeric draft remains owned and prevents Add after external guide selection',async()=>{
    setLang('cs',{save:false});status='ready';let added;
    const modal=openCapture({onAdd:tools=>added=tools});try{
      await begin({two:true});$('#capture-guide-start').click();pointer('pointerdown',350,200);pointer('pointerup',350,200);$('[data-context-action="move"]').click();
      const input=$('[data-contour-field="length"]');input.focus();input.value='0 mm';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.addEventListener('blur',()=>input.dispatchEvent(new win.Event('change',{bubbles:true})),{once:true});
      $('#capture-guide-next').click();$('#capture-add').click();await pause();assert.equal(added,undefined);assert.equal($('.capture-guide-panel').dataset.guideIndex,'0');assert.equal(win.document.activeElement,input);assert.equal(input.value,'0 mm');
      input.value='200 mm';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.dispatchEvent(new win.Event('change',{bubbles:true}));$('#capture-add').click();await waitFor(()=>added,'corrected owned edit import');assert.equal(added.length,2);
    }finally{modal.close();}
  });
});
