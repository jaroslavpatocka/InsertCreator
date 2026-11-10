import {instanceWorkerReply} from './fixtures/instance-worker-reply.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

// Pocket wall profile in the capture guide. Recognition is a fixed fixture
// (two rectangles), so no real model or contour worker is started.
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
globalThis.Worker=class{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){
    queueMicrotask(()=>{
      if(this.terminated)return;
      if(this.url.endsWith('/tool-neural-worker.js'))return this.onmessage?.({data:instanceWorkerReply(message)});
      const scale=message.options.pxPerMm,rect=(x,y,width,height)=>({points:[{x:x*scale,y:y*scale},{x:(x+width)*scale,y:y*scale},{x:(x+width)*scale,y:(y+height)*scale},{x:x*scale,y:(y+height)*scale}]});
      this.onmessage?.({data:{result:{width:message.image.width,height:message.image.height,contours:[rect(10,10,20,100),rect(60,10,25,80)],mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
    });
  }
  terminate(){this.terminated=true;}
};
const {setLang}=await import('../dist/i18n.js'),{setAppUnit,parseLength}=await import('../dist/units.js');
const {openCapture}=await import('../dist/capture.js');
const {toolFromCaptureItem}=await import('../dist/capture-tools.js');
const $=selector=>win.document.querySelector(selector);
const rows=()=>[...win.document.querySelectorAll('#trace-items .trace-item')];
const panel=()=>$('.capture-guide-panel');
const current=()=>Number(panel()?.dataset.guideIndex);
const pause=()=>new Promise(resolve=>setTimeout(resolve,3));
async function waitFor(fn,message,timeout=20000){const start=performance.now();while(!fn()){if(performance.now()-start>timeout)throw Error('Timed out: '+message);await pause();}}
function click(selector){const element=$(selector);assert.ok(element,'Missing '+selector);element.click();}
function typed(selector,value){const element=$(selector);assert.ok(element,'Missing '+selector);element.value=value;element.dispatchEvent(new win.Event('input',{bubbles:true}));}
function changed(selector,value){const element=$(selector);assert.ok(element,'Missing '+selector);element.value=value;element.dispatchEvent(new win.Event('change',{bubbles:true}));}
const valueField=()=>$('#capture-guide-wall-value');
const valueVisible=()=>!$('[data-guide-wall-value]').hidden;
const unitText=()=>$('[data-guide-wall-unit]').textContent;
const error=()=>$('#capture-guide-error').hidden?'':$('#capture-guide-error').textContent;
const close=(a,b,message,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a}, expected ${b}`);
async function startGuide(){click('#sample-scan');await waitFor(()=>rows().length===2,'two recognised tools');click('#capture-guide-start');assert.equal(current(),0);}

test('capture guide pocket wall profile',{timeout:60000},async t=>{
  t.after(async()=>{delete globalThis.Worker;setLang('cs',{save:false});setAppUnit('mm',{save:false});await win.happyDOM.close();});

  await t.test('Czech mm: each shape, defaults, depth clamp, blocking validation and vertical default',async()=>{
    setLang('cs',{save:false});setAppUnit('mm',{save:false});
    let added;const modal=openCapture({maxDepth:()=>30,onAdd:tools=>{added=tools;}});
    try{
      await startGuide();
      const select=$('#capture-guide-wall-type');
      assert.deepEqual([...select.options].map(option=>option.value),['vertical','draft','chamfer','roundTop','roundBottom']);
      assert.deepEqual([...select.options].map(option=>option.textContent),['Kolmá','Šikmá stěna','Zkosená horní hrana','Zaoblená horní hrana','Zaoblené dno']);
      assert.equal(select.value,'vertical');assert.equal(valueVisible(),false,'vertical wall has no value');
      assert.match($('[data-guide-wall-profile]').getAttribute('aria-label'),/Řez stěnou kapsy: Kolmá/);
      typed('#capture-guide-depth','12');
      changed('#capture-guide-wall-type','chamfer');
      assert.equal(valueVisible(),true);assert.equal(valueField().value,'1');assert.equal(unitText(),'mm');
      assert.match($('[data-guide-wall-label]').textContent,/Šířka zkosení/);
      changed('#capture-guide-wall-type','roundTop');assert.equal(valueField().value,'1.5');
      changed('#capture-guide-wall-type','roundBottom');assert.equal(valueField().value,'1');
      assert.match($('[data-guide-wall-hint]').textContent,/nemusí ležet rovně/,'round floor explains the tool may not sit flat');
      changed('#capture-guide-wall-type','draft');assert.equal(valueField().value,'5');assert.equal(unitText(),'°');
      assert.match($('[data-guide-wall-label]').textContent,/Úhel od svislice/);
      typed('#capture-guide-wall-value','50');
      assert.match(error(),/Úhel stěny kapsy musí být od 0,5° do 45°/);
      click('#capture-guide-next');assert.equal(current(),0,'an invalid wall blocks continuing');
      assert.equal(win.document.activeElement,valueField(),'the invalid wall value is focused');
      assert.equal(valueField().getAttribute('aria-invalid'),'true');
      typed('#capture-guide-wall-value','7,5');assert.equal(error(),'');assert.equal(valueField().hasAttribute('aria-invalid'),false);
      // chamfer larger than the pocket depth
      changed('#capture-guide-wall-type','chamfer');typed('#capture-guide-wall-value','5');assert.equal(error(),'');
      typed('#capture-guide-depth','3');click('#capture-guide-next');assert.equal(current(),0,'a shallower pocket invalidates the chamfer');
      assert.match(error(),/Rozměr tvaru stěny kapsy musí být od 0,2 mm do 3 mm/);
      typed('#capture-guide-depth','12');
      changed('#capture-guide-wall-type','draft');assert.equal(valueField().value,'7.5','the last valid angle of this tool is remembered');
      click('#capture-guide-next');assert.equal(current(),1);
      assert.equal($('#capture-guide-wall-type').value,'vertical','each tool has its own profile');
      typed('#capture-guide-depth','0,6');
      changed('#capture-guide-wall-type','roundTop');assert.equal(valueField().value,'0.6','default is clamped to the pocket depth');
      typed('#capture-guide-depth','10');
      changed('#capture-guide-wall-type','vertical');assert.equal(valueVisible(),false);
      click('#capture-guide-prev');assert.equal($('#capture-guide-wall-type').value,'draft');assert.equal(valueField().value,'7.5','the profile is kept when returning to the tool');
      click('#capture-guide-next');click('#capture-guide-next');assert.equal(panel(),null);
      click('#capture-add');await waitFor(()=>added,'tools added');
      assert.equal(added.length,2);
      assert.deepEqual(added[0].pocketWall,{type:'draft',value:7.5});
      assert.equal(Object.hasOwn(added[1],'pocketWall'),false,'a vertical wall leaves no pocketWall');
    }finally{modal.close();}
  });

  await t.test('English inches: input in inches, stored in mm, English labels and messages, unit switch',async()=>{
    setLang('en',{save:false});setAppUnit('in',{save:false});
    let added;const modal=openCapture({maxDepth:()=>30,onAdd:tools=>{added=tools;}});
    try{
      await startGuide();
      assert.match(panel().textContent,/Pocket wall profile/);assert.doesNotMatch(panel().textContent,/Tvar stěny|Kolmá|Zaoblen|Zkosen|Šikm/);
      assert.deepEqual([...$('#capture-guide-wall-type').options].map(option=>option.textContent),['Vertical','Sloped wall','Chamfered top edge','Rounded top edge','Rounded floor']);
      typed('#capture-guide-depth','0.5');
      changed('#capture-guide-wall-type','chamfer');
      assert.equal(unitText(),'in');close(parseLength(valueField().value),1,'the 1 mm default is shown in inches',1e-5);
      assert.match($('[data-guide-wall-hint]').textContent,/Allowed range 0\.008 in to 0\.5 in/);
      typed('#capture-guide-wall-value','0.05');
      setAppUnit('mm',{save:false});
      assert.equal(unitText(),'mm','the guide follows a unit switch');assert.equal(valueField().value,'1.27');
      setAppUnit('in',{save:false});assert.equal(unitText(),'in');assert.equal(valueField().value,'0.05');
      changed('#capture-guide-wall-type','roundBottom');assert.match($('[data-guide-wall-hint]').textContent,/may not sit flat/);
      typed('#capture-guide-wall-value','1');
      assert.match(error(),/The pocket wall shape size must be between 0\.008 in and 0\.5 in/);
      click('#capture-guide-next');assert.equal(current(),0);
      typed('#capture-guide-wall-value','0.04');assert.equal(error(),'');
      click('#capture-guide-next');assert.equal(current(),1);
      changed('#capture-guide-wall-type','draft');typed('#capture-guide-wall-value','0,2');
      assert.match(error(),/The pocket wall angle must be between 0\.5° and 45°/);
      typed('#capture-guide-wall-value','12');
      setLang('cs',{save:false});assert.match(panel().textContent,/Tvar stěny kapsy/,'the guide follows a language switch');assert.equal(valueField().value,'12');
      setLang('en',{save:false});
      click('#capture-guide-next');assert.equal(panel(),null);
      click('#capture-add');await waitFor(()=>added,'tools added');
      assert.equal(added[0].pocketWall.type,'roundBottom');close(added[0].pocketWall.value,1.016,'inches are stored in mm');
      assert.deepEqual(added[1].pocketWall,{type:'draft',value:12});
    }finally{modal.close();setLang('cs',{save:false});setAppUnit('mm',{save:false});}
  });
});

test('toolFromCaptureItem carries a normalized pocket wall',()=>{
  const item=wall=>({name:'Klíč',checked:true,info:{minX:50,minY:70},contour:{points:[{x:50,y:70},{x:90,y:70},{x:90,y:270},{x:50,y:270}]},...(wall===undefined?{}:{pocketWall:wall})});
  for(const wall of [{type:'draft',value:5},{type:'chamfer',value:1},{type:'roundTop',value:1.5},{type:'roundBottom',value:2}]){
    assert.deepEqual(toolFromCaptureItem(item(wall),{scale:2,depth:10,id:'a'}).pocketWall,wall);
  }
  assert.deepEqual(toolFromCaptureItem(item({type:'chamfer',value:'2'}),{scale:2,depth:10,id:'a'}).pocketWall,{type:'chamfer',value:2});
  for(const wall of [undefined,null,{type:'vertical'}])assert.equal(Object.hasOwn(toolFromCaptureItem(item(wall),{scale:2,depth:10,id:'a'}),'pocketWall'),false);
  assert.throws(()=>toolFromCaptureItem(item({type:'roundTop',value:12}),{scale:2,depth:10,id:'a'}),/hloubka kapsy|pocket depth/i);
});
