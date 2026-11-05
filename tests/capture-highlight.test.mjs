import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.ImageData=ImageData;
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;

const canvases=new WeakMap(),paints=new WeakMap();
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);
  if(canvas.width!==element.width)canvas.width=element.width;
  if(canvas.height!==element.height)canvas.height=element.height;
  return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const element=this,ctx=actual(element).getContext('2d');
  if(!paints.has(element))paints.set(element,{strokes:[],texts:[]});
  const paint=paints.get(element);let path=[];
  return new Proxy(ctx,{
    get:(target,key)=>{
      if(key==='drawImage')return (source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args);
      if(key==='putImageData')return (...args)=>{paint.strokes=[];paint.texts=[];return target.putImageData(...args);};
      if(key==='beginPath')return ()=>{path=[];return target.beginPath();};
      if(['moveTo','lineTo','arc','closePath'].includes(key))return (...args)=>{path.push([key,...args]);return target[key](...args);};
      if(key==='stroke')return (...args)=>{paint.strokes.push({color:target.strokeStyle,width:target.lineWidth,path:path.map(point=>[...point])});return target.stroke(...args);};
      if(key==='fillText')return (text,...args)=>{paint.texts.push({text:String(text),color:target.fillStyle});return target.fillText(text,...args);};
      return typeof target[key]==='function'?target[key].bind(target):target[key];
    },
    set:(target,key,value)=>(target[key]=value,true)
  });
};

const workers=new Set();
class BrowserWorker{
  constructor(url){
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
    this.inner.on('message',data=>this.onmessage?.({data}));
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));
    this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){this.inner.postMessage(message,transfer);}
  terminate(){workers.delete(this);return this.inner.terminate();}
}
globalThis.Worker=BrowserWorker;
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
setLang('cs',{save:false});setAppUnit('mm',{save:false});
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const rows=()=>[...win.document.querySelectorAll('#trace-items .trace-item')];
const paint=()=>paints.get($('#trace-canvas'));
const contourStrokes=()=>paint().strokes.filter(stroke=>stroke.path[0]?.[0]==='moveTo');
const greenStrokes=()=>contourStrokes().filter(stroke=>stroke.color==='#577b67');
const pause=()=>new Promise(resolve=>setTimeout(resolve,3));
async function waitFor(fn,message,timeout=25000){
  const started=performance.now();
  while(!fn()){
    if(performance.now()-started>timeout)throw Error('Timed out: '+message+'; '+$('.modal-body')?.textContent);
    await pause();
  }
}
function typed(selector,value){const field=$(selector);field.value=value;field.dispatchEvent(new win.Event('input',{bubbles:true}));}
function assertActive(index){
  for(const [i,row] of rows().entries()){
    assert.equal(row.classList.contains('is-active'),i===index,'only the edited tool row is active');
    assert.equal(row.dataset.active==='true',i===index,'row state mirrors the preview');
  }
}
function assertHighlighted(path,label,normalWidth){
  const strokes=contourStrokes(),green=greenStrokes();
  assert.equal(green.length,1,'exactly one contour has the active UI color');
  assert.deepEqual(green[0].path,path,'the active color follows the matching tool contour');
  assert.equal(strokes.at(-1),green[0],'the active contour is painted over the other contours');
  assert.equal(green[0].width,normalWidth*2,'the active contour is twice as wide as the normal selected outline');
  const halo=strokes[strokes.indexOf(green[0])-1];
  assert.equal(halo.color,'#ffffff','a white halo keeps the green contour readable over the photo');
  assert.ok(halo.width>green[0].width);assert.deepEqual(halo.path,path);
  assert.equal(paint().texts.find(text=>text.text===label)?.color,'#ffffff','the active number badge also differs from the amber badges');
}

test('editing a recognised tool highlights its own contour without changing the tools being added',{timeout:75000},async t=>{
  t.after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;await win.happyDOM.close();});
  await t.test('name, depth and checkbox focus follow the correct contour and survive other result controls',async()=>{
    let added;
    const modal=openCapture({onAdd:tools=>added=tools});t.after(()=>modal.close());
    $('#sample-scan').click();await waitFor(()=>rows().length===2,'two recognised sample tools');
    assertActive(null);assert.equal(greenStrokes().length,0,'the initial result does not imply a tool is being edited');
    const initial=contourStrokes(),firstPath=initial[0].path,secondPath=initial[1].path,normalWidth=initial[0].width;

    rows()[1].querySelector('span').dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true}));
    assertActive(1);assertHighlighted(secondPath,'2',normalWidth);
    assert.equal($('[data-item="1"]').checked,true,'selecting a row in the preview does not toggle its checkbox');

    $('[data-name="0"]').focus();assertActive(0);assertHighlighted(firstPath,'1',normalWidth);
    typed('[data-name="0"]','Dílenský klíč');
    assert.equal(win.document.activeElement,$('[data-name="0"]'),'highlighting must not rebuild the focused input');
    assert.equal($('[data-name="0"]').value,'Dílenský klíč');assertActive(0);

    $('[data-depth="1"]').focus();assertActive(1);assertHighlighted(secondPath,'2',normalWidth);
    if(process.env.CAPTURE_HIGHLIGHT_PREVIEW){
      const destination=new URL('../tmp/capture-highlight-preview.png',import.meta.url);
      await fs.mkdir(new URL('.',destination),{recursive:true});
      await fs.writeFile(destination,actual($('#trace-canvas')).toBuffer('image/png'));
    }
    typed('[data-depth="1"]','9,5');
    assert.equal(win.document.activeElement,$('[data-depth="1"]'));assert.equal($('[data-depth="1"]').value,'9,5');
    assert.equal($('[data-name="0"]').value,'Dílenský klíč','switching active rows keeps the edited name');

    const firstCheckbox=$('[data-item="0"]');firstCheckbox.focus();assertActive(0);
    firstCheckbox.checked=false;firstCheckbox.dispatchEvent(new win.Event('change',{bubbles:true}));
    assert.equal(firstCheckbox.checked,false,'highlighting an excluded tool must not select it for adding');
    assertHighlighted(firstPath,'1',normalWidth);assert.equal($('#capture-add').textContent,'Přidat do šuplíku (1)');

    $('[data-depth="1"]').focus();assertActive(1);
    $('#trace-mask').focus();$('#trace-mask').checked=true;$('#trace-mask').dispatchEvent(new win.Event('change',{bubbles:true}));
    assertActive(1);assertHighlighted(secondPath,'2',normalWidth);
    $('#capture-depth').focus();typed('#capture-depth','14');
    assertActive(1);assert.equal(firstCheckbox.checked,false);assert.equal($('[data-depth="1"]').value,'9,5');

    firstCheckbox.checked=true;firstCheckbox.dispatchEvent(new win.Event('change',{bubbles:true}));
    $('#capture-add').click();await waitFor(()=>added,'tools passed to the drawer');
    assert.equal(added.length,2);assert.equal(added[0].name,'Dílenský klíč');
    assert.deepEqual(added.map(tool=>tool.depth),[14,9.5],'preview selection preserves shared and per-tool depths');
    await waitFor(()=>!$('#trace-canvas'),'capture closes after adding');
  });
  await t.test('returning to calibration and recognising a fresh photo clears the previous active tool',async()=>{
    const modal=openCapture({onAdd:()=>assert.fail('Calibration must not add tools')});t.after(()=>modal.close());
    $('#sample-scan').click();await waitFor(()=>rows().length===2,'sample result before recalibration');
    $('[data-name="1"]').focus();assertActive(1);assert.equal(greenStrokes().length,1);
    $('#capture-calibration-back').click();
    assert.ok($('#calibration-canvas'));assert.equal($('#trace-canvas'),null);assert.equal(rows().length,0);
    // The back action deliberately opens ruler calibration. Use its existing
    // other-photo action instead of recognising an unconfigured ruler segment.
    $('#capture-back').click();assert.ok($('#sample-scan'));
    $('#sample-scan').click();await waitFor(()=>rows().length===2,'fresh recognised sample after calibration');
    assertActive(null);assert.equal(greenStrokes().length,0,'a new result cannot inherit a stale edited contour');
  });
});
