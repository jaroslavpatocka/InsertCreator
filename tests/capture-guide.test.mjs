import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
const canvases=new WeakMap(),paints=new WeakMap(),photoHashes=new WeakMap();
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
  if(!paints.has(element))paints.set(element,[]);
  let path=[];
  return new Proxy(ctx,{get:(target,key)=>{
    if(key==='drawImage')return (source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args);
    if(key==='putImageData')return (...args)=>{paints.set(element,[]);photoHashes.set(element,createHash('sha256').update(args[0].data).digest('hex'));return target.putImageData(...args);};
    if(key==='beginPath')return ()=>{path=[];return target.beginPath();};
    if(['moveTo','lineTo','arc','closePath'].includes(key))return (...args)=>{path.push([key,...args]);return target[key](...args);};
    if(key==='stroke')return (...args)=>{paints.get(element).push({color:target.strokeStyle,path:path.map(point=>[...point])});return target.stroke(...args);};
    return typeof target[key]==='function'?target[key].bind(target):target[key];
  },set:(target,key,value)=>(target[key]=value,true)});
};

// The imperial UI case uses known physical rectangles; the main workflows below
// run the sample raster through the real ONNX and contour workers.
let fixtureRecognition=false;
const workers=new Set(),neuralPhases=[];
class BrowserWorker{
  constructor(url){
    this.url=String(url);this.fixture=fixtureRecognition;this.terminated=false;
    if(this.fixture)return;
    this.inner=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:this.url}});workers.add(this);
    this.inner.on('message',data=>{if(data.type==='progress')neuralPhases.push(data.phase);this.onmessage?.({data});});
    this.inner.on('error',error=>this.onerror?.({message:error.message,error,preventDefault(){}}));
    this.inner.on('messageerror',error=>this.onmessageerror?.({error}));
    this.inner.on('exit',()=>workers.delete(this));
  }
  postMessage(message,transfer){
    if(!this.fixture)return this.inner.postMessage(message,transfer);
    queueMicrotask(()=>{
      if(this.terminated)return;
      if(this.url.endsWith('/neural-worker.js'))return this.onmessage?.({data:{type:'error',id:message.id,message:'Fixture uses deterministic classical contours'}});
      const scale=message.options.pxPerMm,rect=(x,y,width,height)=>({points:[{x:x*scale,y:y*scale},{x:(x+width)*scale,y:y*scale},{x:(x+width)*scale,y:(y+height)*scale},{x:x*scale,y:(y+height)*scale}]});
      this.onmessage?.({data:{result:{contours:[rect(10,10,20,100),rect(60,10,25,80)],mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
    });
  }
  terminate(){this.terminated=true;workers.delete(this);return this.inner?.terminate();}
}
globalThis.Worker=BrowserWorker;
const {setLang}=await import('../dist/i18n.js'),{setAppUnit,parseLength}=await import('../dist/units.js');
const {getToolDimensions}=await import('../dist/tool-dimensions.js');
const {simpleOutline}=await import('../dist/finger-grip.js');
const {openCapture}=await import('../dist/capture.js');
const $=selector=>win.document.querySelector(selector);
const rows=()=>[...win.document.querySelectorAll('#trace-items .trace-item')];
const panel=()=>$('.capture-guide-panel');
const current=()=>Number(panel()?.dataset.guideIndex);
const greenPath=()=>paints.get($('#trace-canvas'))?.find(stroke=>stroke.color==='#577b67'&&stroke.path[0]?.[0]==='moveTo')?.path;
const pause=()=>new Promise(resolve=>setTimeout(resolve,3));
async function waitFor(fn,message,timeout=25000){
  const start=performance.now();
  while(!fn()){
    if(performance.now()-start>timeout)throw Error('Timed out: '+message+'; '+$('.modal-body')?.textContent);
    await pause();
  }
}
function click(selector){const element=$(selector);assert.ok(element,'Missing '+selector);element.click();}
function typed(selector,value){const element=$(selector);assert.ok(element,'Missing '+selector);element.value=value;element.dispatchEvent(new win.Event('input',{bubbles:true}));}
function changed(selector,value){const element=$(selector);assert.ok(element,'Missing '+selector);if(element.type==='checkbox')element.checked=value;else element.value=value;element.dispatchEvent(new win.Event('change',{bubbles:true}));}
async function sample(){click('#sample-scan');await waitFor(()=>rows().length===2,'two recognised sample tools');}
function assertGuideIndex(index){assert.ok(panel());assert.equal(current(),index);assert.ok(greenPath(),'the current tool is highlighted in the photo');}
function approximate(actualValue,expected,message,tolerance=.05){assert.ok(Math.abs(actualValue-expected)<tolerance,`${message}: ${actualValue}, expected ${expected}`);}

test('optional capture guide preserves edits, validates chosen tools and exports corrected metric geometry',{timeout:120000},async t=>{
  t.after(async()=>{await Promise.all([...workers].map(worker=>worker.terminate()));delete globalThis.Worker;setLang('cs',{save:false});setAppUnit('mm',{save:false});await win.happyDOM.close();});

  await t.test('English imperial form applies explicit dimensions without moving the original photo contour',async()=>{
    fixtureRecognition=true;setLang('en',{save:false});setAppUnit('in',{save:false});
    let added;
    const modal=openCapture({onAdd:tools=>added=tools});
    try{
      await sample();assert.equal(panel(),null,'the guide is recommended but remains optional');assert.ok($('#capture-guide-start'));
      typed('[data-depth="0"]','invalid');click('#capture-add');
      assert.equal(panel(),null,'a list validation error does not force the optional guide open');
      assert.equal(added,undefined);assert.equal($('#capture-error').hidden,false);
      typed('[data-depth="0"]','');
      click('#capture-guide-start');assertGuideIndex(0);
      assert.equal(win.document.activeElement,$('#capture-guide-name'),'starting the guide moves keyboard focus into the current tool');
      assert.doesNotMatch(panel().textContent,/Nástroj|Hloubka|Kategorie|Šířka|Délka|Zpět|Další|Dokončit/,'guide labels follow English');
      approximate(parseLength($('#capture-guide-length').value),100,'length is displayed in inches');
      approximate(parseLength($('#capture-guide-width').value),20,'width is displayed in inches');
      assert.match(panel().textContent,/\bin\b/,'imperial fields identify their unit');
      const originalPath=structuredClone(greenPath()),originalPhotoHash=photoHashes.get($('#trace-canvas'));
      const measuredPath=()=>paints.get($('#trace-canvas')).find(stroke=>stroke.color==='rgba(255, 255, 255, 0.6)')?.path;
      const originalMeasuredPath=structuredClone(measuredPath());
      assert.ok(originalMeasuredPath?.length,'the original measured outline remains visible under the functional pocket');
      typed('#capture-guide-length','1000 mm');click('#capture-guide-resize');
      await waitFor(()=>!$('#capture-guide-resize').disabled&&!$('#capture-guide-error').hidden,'unsupported correction reports an error');
      assert.equal(win.document.activeElement,$('#capture-guide-length'),'a resize error focuses an enabled correction field');
      assert.deepEqual(greenPath(),originalPath);
      typed('#capture-guide-name','Ratchet wrench');typed('#capture-guide-depth','1/4 in');
      changed('#capture-guide-category','wrenches');typed('#capture-guide-size-label','3/8 in');
      typed('#capture-guide-length','5 in');typed('#capture-guide-width','1 in');
      click('#capture-guide-next');assertGuideIndex(0);
      assert.equal($('#capture-guide-error').hidden,false,'unapplied dimensions require an explicit choice');
      assert.deepEqual(greenPath(),originalPath,'typing corrections leaves the photographed contour fixed');
      click('#capture-guide-resize');
      await waitFor(()=>!$('#capture-guide-resize').disabled&&$('#capture-guide-error').hidden,'dimension correction is applied');
      assert.notDeepEqual(greenPath(),originalPath,'applied dimensions update the manufacturing pocket shown in the preview');
      assert.deepEqual(measuredPath(),originalMeasuredPath,'the calibrated source contour stays fixed underneath the resized pocket');
      assert.equal(photoHashes.get($('#trace-canvas')),originalPhotoHash,'the underlying photograph is unchanged');
      const pathBounds=path=>{
        const points=path.filter(part=>part[0]==='moveTo'||part[0]==='lineTo'),xs=points.map(part=>part[1]),ys=points.map(part=>part[2]);
        return{width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys),x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};
      };
      const originalBounds=pathBounds(originalPath),resizedBounds=pathBounds(greenPath());
      approximate(resizedBounds.x,originalBounds.x,'the resized pocket keeps the measured photo centre X',1e-6);
      approximate(resizedBounds.y,originalBounds.y,'the resized pocket keeps the measured photo centre Y',1e-6);
      approximate(resizedBounds.width/originalBounds.width,25.4/20,'the preview shows the applied width',1e-6);
      approximate(resizedBounds.height/originalBounds.height,127/100,'the preview shows the applied length',1e-6);
      approximate(parseLength($('#capture-guide-length').value),127,'applied length remains visible');
      approximate(parseLength($('#capture-guide-width').value),25.4,'applied width remains visible');
      if(process.env.CAPTURE_GUIDE_PREVIEW){
        const destination=new URL('../tmp/capture-guide-preview.png',import.meta.url);
        await fs.mkdir(new URL('.',destination),{recursive:true});await fs.writeFile(destination,actual($('#trace-canvas')).toBuffer('image/png'));
        await fs.writeFile(new URL('../tmp/capture-guide-detail.png',import.meta.url),actual($('#capture-guide-preview')).toBuffer('image/png'));
      }
      click('#capture-guide-next');assertGuideIndex(1);
      assert.equal(win.document.activeElement,$('#capture-guide-name'),'the next tool receives keyboard focus');
      click('#capture-guide-next');
      assert.equal(panel(),null,'finishing the last tool returns to the optional list');
      assert.equal(win.document.activeElement,$('#capture-guide-start'),'finishing leaves focus on a visible control');
      assert.equal($('[data-item="1"]').checked,true,'ordinary Next retains inclusion');
      click('#capture-add');await waitFor(()=>added,'imperial tool added');
      assert.equal(added.length,2);assert.equal(added[0].name,'Ratchet wrench');assert.equal(added[0].category,'wrenches');assert.equal(added[0].sizeLabel,'3/8 in');
      approximate(added[0].depth,6.35,'imperial depth is exported in millimetres',1e-8);
      const dimensions=getToolDimensions(added[0]);
      approximate(dimensions.length,127,'manufacturing length is millimetres');approximate(dimensions.width,25.4,'manufacturing width is millimetres');
      assert.ok(added[0].points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.y>=0));
      assert.deepEqual(added[1].points,simpleOutline([{x:0,y:0},{x:25,y:0},{x:25,y:80},{x:0,y:80}]),'untouched Next keeps the exact original metric outline');
      await waitFor(()=>!$('#trace-canvas'),'successful addition closes capture');
    }finally{modal.close();fixtureRecognition=false;setLang('cs',{save:false});setAppUnit('mm',{save:false});}
  });

  await t.test('real recognition drafts survive list and guide navigation, depth checks and asynchronous addition',async()=>{
    let added,finishAdd;
    const modal=openCapture({maxDepth:()=>18,onAdd:tools=>{added=tools;return new Promise(resolve=>finishAdd=resolve);}});t.after(()=>modal.close());
    const beforeInference=neuralPhases.filter(phase=>phase==='inference').length;
    await sample();assert.ok(neuralPhases.filter(phase=>phase==='inference').length>beforeInference,'the sample goes through real ONNX inference');
    assert.equal(panel(),null);typed('[data-name="0"]','Dílenský klíč');typed('[data-depth="0"]','8,5');
    click('#capture-guide-start');assertGuideIndex(0);
    assert.equal($('#capture-guide-name').value,'Dílenský klíč');assert.equal($('#capture-guide-depth').value,'8,5');
    if(process.env.CAPTURE_GUIDE_PREVIEW){
      await fs.writeFile(new URL('../tmp/capture-guide-real-detail.png',import.meta.url),actual($('#capture-guide-preview')).toBuffer('image/png'));
    }
    changed('#capture-guide-category','wrenches');typed('#capture-guide-size-label','13 mm');
    click('#capture-guide-next');assertGuideIndex(1);typed('#capture-guide-name','Náhradní šroubovák');typed('#capture-guide-depth','10');
    click('#capture-guide-prev');assertGuideIndex(0);
    assert.equal($('#capture-guide-name').value,'Dílenský klíč');assert.equal($('#capture-guide-category').value,'wrenches');assert.equal($('#capture-guide-size-label').value,'13 mm');
    click('#capture-guide-list');assert.equal(panel(),null);
    assert.equal($('[data-name="0"]').value,'Dílenský klíč');assert.equal($('[data-depth="0"]').value,'8,5');
    assert.equal($('[data-name="1"]').value,'Náhradní šroubovák');assert.equal($('[data-depth="1"]').value,'10');
    typed('[data-name="0"]','Dílenský klíč upravený');click('#capture-guide-start');assertGuideIndex(0);
    assert.equal($('#capture-guide-name').value,'Dílenský klíč upravený');

    typed('#capture-guide-depth','1000');click('#capture-guide-next');assertGuideIndex(0);
    assert.equal($('#capture-guide-error').hidden,false,'an included tool cannot advance with invalid depth');
    click('#capture-add');await new Promise(resolve=>setTimeout(resolve,15));assert.equal(added,undefined,'the final Add also rejects invalid selected depth');
    changed('#capture-guide-include',false);click('#capture-guide-next');assertGuideIndex(1);
    click('#capture-guide-prev');assertGuideIndex(0);assert.equal($('#capture-guide-include').checked,false);
    assert.equal($('#capture-guide-depth').value,'1000','an excluded draft is preserved, not silently repaired');
    typed('#capture-guide-depth','8,5');changed('#capture-guide-include',true);click('#capture-guide-next');assertGuideIndex(1);
    assert.equal($('#capture-guide-name').value,'Náhradní šroubovák');assert.equal($('#capture-guide-depth').value,'10');
    click('#capture-guide-skip');assert.equal(panel(),null);
    assert.equal($('[data-item="0"]').checked,true);assert.equal($('[data-item="1"]').checked,false);
    click('#capture-guide-start');assert.ok(panel(),'the optional guide can be reopened before adding');
    click('#capture-add');await waitFor(()=>finishAdd,'asynchronous addition starts');
    assert.equal(added.length,1);assert.equal(added[0].name,'Dílenský klíč upravený');assert.equal(added[0].depth,8.5);
    assert.equal(added[0].category,'wrenches');assert.equal(added[0].sizeLabel,'13 mm');
    assert.ok([...panel().querySelectorAll('button,input,select')].every(element=>element.disabled),'guide controls cannot change drafts while onAdd is pending');
    assert.equal($('#capture-add').disabled,true);assert.equal($('#capture-calibration-back').disabled,true);
    finishAdd();await waitFor(()=>!$('#trace-canvas'),'pending addition completes');
  });

  await t.test('a new photograph resets the optional guide and its per-tool drafts',async()=>{
    const modal=openCapture({onAdd:()=>assert.fail('Replacing a photo must not add tools')});t.after(()=>modal.close());
    await sample();click('#capture-guide-start');assertGuideIndex(0);
    typed('#capture-guide-name','Starý upravený nástroj');changed('#capture-guide-category','cutting');typed('#capture-guide-size-label','T25');
    click('#capture-guide-next');assertGuideIndex(1);
    click('#retake-photo');assert.ok($('#sample-scan'));assert.equal(panel(),null);
    await sample();assert.equal(panel(),null,'recognition does not restart the previous guide automatically');assert.ok($('#capture-guide-start'));
    click('#capture-guide-start');assertGuideIndex(0);
    assert.equal($('#capture-guide-name').value,'Nástroj 1');assert.equal($('#capture-guide-size-label').value,'');
    assert.notEqual($('#capture-guide-category').value,'cutting','classification is not inherited from the previous photo');
  });
});
