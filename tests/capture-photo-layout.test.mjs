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

// Measured rectangles in an asymmetric photo arrangement. Raster recognition is
// deterministic here; calibration, capture editing and import run their real paths.
const photographed=[{x:12.5,y:18.25,width:20,height:80},{x:75,y:40,width:25,height:60},{x:130.75,y:120.5,width:35,height:75}];
globalThis.Worker=class{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){queueMicrotask(()=>{
    if(this.terminated)return;
    if(this.url.endsWith('/neural-worker.js'))return this.onmessage?.({data:{type:'error',id:message.id,message:'Deterministic photo layout fixture'}});
    const scale=message.options.pxPerMm;
    const contours=photographed.map(({x,y,width,height})=>({points:[{x:x*scale,y:y*scale},{x:(x+width)*scale,y:y*scale},{x:(x+width)*scale,y:(y+height)*scale},{x:x*scale,y:(y+height)*scale}]}));
    this.onmessage?.({data:{result:{contours,mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
  });}
  terminate(){this.terminated=true;}
};
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn,message){
  const started=performance.now();
  while(!fn()){if(performance.now()-started>5000)throw Error('Timed out: '+message);await pause();}
}
function click(selector){const element=$(selector);assert.ok(element,selector);element.click();}
function typed(selector,value){const element=$(selector);assert.ok(element,selector);element.value=value;element.dispatchEvent(new win.Event('input',{bubbles:true}));}
function changed(selector,value){const element=$(selector);assert.ok(element,selector);if(element.type==='checkbox')element.checked=value;else element.value=value;element.dispatchEvent(new win.Event('change',{bubbles:true}));}
async function sample(){click('#sample-scan');await waitFor(()=>$('[data-name="2"]'),'three recognised tools');changed('#capture-pocket-shape','measured');}
function approximately(actualValue,expected,message){assert.ok(Math.abs(actualValue-expected)<.001,`${message}: ${actualValue}, expected ${expected}`);}

test('preserving the photographed arrangement is optional and survives capture editing and retry',{timeout:30000},async t=>{
  t.after(async()=>{delete globalThis.Worker;setLang('cs',{save:false});setAppUnit('mm',{save:false});await win.happyDOM.close();});
  setLang('cs',{save:false});setAppUnit('mm',{save:false});

  await t.test('the default import retains the existing automatic layout',async()=>{
    let added,options;
    const modal=openCapture({onAdd:(tools,opts)=>{added=tools;options=opts;}});
    try{
      await sample();assert.equal($('#capture-layout').value,'auto');
      assert.deepEqual([...$('#capture-layout').options].map(option=>option.value).sort(),['auto','each','photo','shared']);
      assert.match($('#capture-layout option[value="photo"]').textContent,/Zachovat rozložení z fotky/);
      click('#capture-add');await waitFor(()=>added,'default import');
      assert.equal(options.layout,'auto');assert.equal(added.length,3);
      assert.ok(added.every(tool=>tool.x===0&&tool.y===0&&tool.rotation===0),'ordinary import leaves placement to the selected layout');
      await waitFor(()=>!$('#trace-canvas'),'default import closes capture');
    }finally{modal.close();}
  });

  await t.test('a selected subset keeps calibrated photo offsets after the optional guide',async()=>{
    let added,options;
    const modal=openCapture({maxDepth:()=>18,onAdd:(tools,opts)=>{added=tools;options=opts;}});
    try{
      await sample();changed('#capture-layout','photo');
      changed('[data-item="1"]',false);typed('[data-name="0"]','První klíč');typed('[data-depth="0"]','8,5');
      typed('[data-name="2"]','Ráčna');typed('[data-depth="2"]','12');
      click('#capture-guide-start');assert.ok($('.capture-guide-panel'));
      assert.equal($('#capture-guide-name').value,'První klíč');
      click('#capture-guide-next');click('#capture-guide-next');
      typed('#capture-guide-name','Ráčna 3/8');click('#capture-guide-next');
      assert.equal($('.capture-guide-panel'),null,'finishing the optional guide returns to the list');
      assert.equal($('#capture-layout').value,'photo','reviewing tools preserves the layout choice');
      assert.equal($('[data-item="1"]').checked,false,'the excluded middle tool stays excluded');
      click('#capture-add');await waitFor(()=>added,'photo layout import');
      assert.equal(options.layout,'photo');assert.deepEqual(added.map(tool=>tool.name),['První klíč','Ráčna 3/8']);
      assert.deepEqual(added.map(tool=>tool.depth),[8.5,12]);assert.ok(added.every(tool=>tool.rotation===0));
      approximately(added[1].x-added[0].x,118.25,'horizontal spacing remains the photographed spacing in millimetres');
      approximately(added[1].y-added[0].y,102.25,'vertical spacing is neither inverted nor reset');
      approximately(added[0].x,12.5,'the first tool carries its calibrated photo X');
      approximately(added[0].y,18.25,'the first tool carries its calibrated photo Y');
      await waitFor(()=>!$('#trace-canvas'),'photo import closes capture');
    }finally{modal.close();}
  });

  await t.test('ideal pockets grow around calibrated centres without scaling their photographed spacing',async()=>{
    let added;
    const modal=openCapture({onAdd:tools=>{added=tools;}});
    try{
      await sample();changed('#capture-pocket-shape','ideal');changed('#capture-layout','photo');changed('[data-item="1"]',false);
      click('#capture-add');await waitFor(()=>added,'ideal photo import');
      const box=tool=>{const xs=tool.points.map(p=>p.x),ys=tool.points.map(p=>p.y);return{width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
      const first=box(added[0]),second=box(added[1]);
      approximately(first.width,20.4,'20 mm tool receives2% total width reserve');approximately(first.height,81.6,'80 mm tool receives2% total length reserve');
      approximately(second.width,35.7,'35 mm tool receives2% total width reserve');approximately(second.height,76.5,'75 mm tool receives2% total length reserve');
      approximately(added[1].x+second.width/2-added[0].x-first.width/2,125.75,'original physical centre distance X');
      approximately(added[1].y+second.height/2-added[0].y-first.height/2,99.75,'original physical centre distance Y');
    }finally{modal.close();}
  });

  await t.test('a failed preserved-layout import keeps choices and drafts, and can retry another layout',async()=>{
    let attempts=0,failedTools,added,options;
    const modal=openCapture({onAdd:(tools,opts)=>{
      if(++attempts===1){failedTools=tools;assert.equal(opts.layout,'photo');throw Error('Zkušební překryv kapes');}
      added=tools;options=opts;
    }});
    try{
      await sample();changed('#capture-layout','photo');typed('[data-name="2"]','Ponechaná ráčna');
      changed('[data-item="1"]',false);click('#capture-add');
      await waitFor(()=>$('#capture-error')?.textContent.includes('Zkušební překryv'),'failed import reported');
      assert.equal($('#capture-layout').value,'photo');assert.equal($('#capture-layout').disabled,false);
      assert.equal($('[data-name="2"]').value,'Ponechaná ráčna');assert.equal($('[data-item="1"]').checked,false);
      approximately(failedTools[1].x-failedTools[0].x,118.25,'the failing attempt used the chosen photo positions');
      assert.equal($('#capture-add').disabled,false,'a rejected import allows correction');
      changed('#capture-layout','each');click('#capture-add');await waitFor(()=>added,'retry with separate modules');
      assert.equal(attempts,2);assert.equal(options.layout,'each');assert.deepEqual(added.map(tool=>tool.name),['Nástroj 1','Ponechaná ráčna']);
      assert.ok(added.every(tool=>tool.x===0&&tool.y===0),'changing the choice stops carrying photo positions');
      await waitFor(()=>!$('#trace-canvas'),'retry closes capture');
    }finally{modal.close();}
  });
});
