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
const originalBitmap=globalThis.createImageBitmap,canvases=new WeakMap(),posted=[];
function actual(element){
  if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));
  const canvas=canvases.get(element);
  if(canvas.width!==element.width)canvas.width=element.width;
  if(canvas.height!==element.height)canvas.height=element.height;
  return canvas;
}
win.HTMLCanvasElement.prototype.getContext=function(type){
  if(type!=='2d')return null;
  const context=actual(this).getContext('2d');
  return new Proxy(context,{get:(target,key)=>key==='drawImage'?((source,...args)=>target.drawImage(source instanceof win.HTMLCanvasElement?actual(source):source,...args)):typeof target[key]==='function'?target[key].bind(target):target[key],set:(target,key,value)=>(target[key]=value,true)});
};

// Independent pixel truth: the source photo is 5 px/mm. Loading halves it,
// leaving a 250 x 50 px tool and a 250 px ruler segment representing 100 mm.
// Never derive these contours, or expected dimensions, from the runtime scale.
const fixedContour=[{x:300,y:300},{x:550,y:300},{x:550,y:350},{x:300,y:350}];
let currentContour=fixedContour;
globalThis.Worker=class{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){queueMicrotask(()=>{
    if(this.terminated)return;
    if(this.url.endsWith('/neural-worker.js'))return this.onmessage?.({data:{type:'error',id:message.id,message:'Independent fixed-pixel calibration fixture'}});
    posted.push({width:message.image.width,height:message.image.height,pxPerMm:message.options.pxPerMm});
    this.onmessage?.({data:{result:{contours:[{points:structuredClone(currentContour)}],mask:new Uint8Array(message.image.width*message.image.height),quality:{status:'ready',reasons:[]}}}});
  });}
  terminate(){this.terminated=true;}
};
const {setLang}=await import('../dist/i18n.js');
const {setAppUnit,setProjectUnit,fmtSize}=await import('../dist/units.js');
const {openCapture}=await import('../dist/capture.js');
const {blankProject,validateProject}=await import('../dist/model.js');
const {exportSVG}=await import('../dist/geometry.js');
const $=selector=>win.document.querySelector(selector);
const pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(predicate,message){
  const started=performance.now();
  while(!predicate()){if(performance.now()-started>5000)throw Error(`Timed out: ${message}; ${$('.modal-body')?.textContent}`);await pause();}
}
function click(selector){assert.ok($(selector),selector);$(selector).click();}
function typed(selector,value){const input=$(selector);assert.ok(input,selector);input.value=value;input.dispatchEvent(new win.Event('input',{bubbles:true}));}
function changed(selector,value){const input=$(selector);assert.ok(input,selector);input.value=value;input.dispatchEvent(new win.Event('change',{bubbles:true}));}
function closeTo(actualValue,expected,message){assert.ok(Math.abs(actualValue-expected)<.003,`${message}: ${actualValue}, expected ${expected}`);}
function size(points,angle=0){const c=Math.cos(angle),s=Math.sin(angle),x=points.map(p=>p.x*c+p.y*s),y=points.map(p=>-p.x*s+p.y*c);return{width:Math.max(...x)-Math.min(...x),height:Math.max(...y)-Math.min(...y)};}
function placePoint(index,x,y){
  click(`[data-ruler-point="${index}"]`);
  const canvas=$('#calibration-canvas');
  // A nonzero offset and a half-size CSS canvas exercise client -> raster coordinates.
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new win.PointerEvent(type,{pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerdown'?1:0,clientX:80+x/2,clientY:40+y/2,bubbles:true,cancelable:true}));
}
function calibrationCanvas(){
  const canvas=$('#calibration-canvas');assert.ok(canvas);
  assert.equal(canvas.width,1400,'large input is resized before ruler placement');assert.equal(canvas.height,1050);
  canvas.getBoundingClientRect=()=>({left:80,top:40,width:700,height:525,right:780,bottom:565});
  return canvas;
}
function photo(angle=0){
  const bitmap=createCanvas(2800,2100),context=bitmap.getContext('2d');
  context.fillStyle='#fff';context.fillRect(0,0,2800,2100);
  context.fillStyle='#222';context.save();context.translate(600,600);context.rotate(angle);context.fillRect(0,0,500,100);context.restore();
  context.fillRect(198,1598,5,5);context.fillRect(698,1598,5,5);
  return bitmap;
}
function projectFor(tool,margin){
  return validateProject({...blankProject(),id:'capture-scale',width:210,height:126,printMode:'solid',bottomMode:'plain',limitToBed:false,
    modules:[{id:'capture-module',x:0,y:0,width:210,height:126,sizeMode:'manual',pocketMargin:margin}],
    tools:[{...tool,id:'calibrated-tool',moduleId:'capture-module',x:20,y:20,fingerGrips:[]}]});
}
function exportedSize(project,angle=0){
  const svg=exportSVG(project);
  assert.match(svg,/<svg[^>]*width="210mm"[^>]*height="126mm"/,'SVG physical units remain millimetres even with inch display');
  const path=svg.match(/<path id="calibrated-tool"[^>]* d="([^"]+)"/)?.[1];assert.ok(path,'actual exported cavity path');
  const points=[...path.matchAll(/(?:M|L)(-?[\d.]+),(-?[\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
  assert.ok(points.length>=4);return{svg,size:size(points,angle)};
}

test('fixed photo pixels retain independent physical truth through ruler UI, capture and SVG export',{timeout:30000},async t=>{
  t.after(async()=>{delete globalThis.Worker;if(originalBitmap)globalThis.createImageBitmap=originalBitmap;else delete globalThis.createImageBitmap;setLang('cs',{save:false});setAppUnit('mm',{save:false});setProjectUnit('');await win.happyDOM.close();});
  const cases=[
    {name:'measured millimetres after large-photo resize',display:'mm',distance:'100 mm',mode:'measured',margin:'0 mm',tool:[100,20],pocket:[100,20]},
    {name:'equivalent inches and repeated calibration do not compound scale',display:'in',distance:'3.937007874015748 in',mode:'measured',margin:'0.8 mm',tool:[100,20],pocket:[101.6,21.6],recalibrate:true},
    {name:'ideal reserve and the normal per-side margin are each added once',display:'mm',distance:'100 mm',mode:'ideal',margin:'0.8 mm',tool:[102,20.4],pocket:[103.6,22]},
    {name:'oblique photo keeps physical length and width instead of its camera-axis bounding box',angle:37,display:'mm',distance:'100 mm',mode:'measured',margin:'0.8 mm',tool:[100,20],pocket:[101.6,21.6]}
  ];
  for(const example of cases)await t.test(example.name,async()=>{
    setLang('cs',{save:false});setProjectUnit('');setAppUnit(example.display,{save:false});posted.length=0;
    const angle=(example.angle||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    currentContour=fixedContour.map(p=>({x:300+(p.x-300)*c-(p.y-300)*s,y:300+(p.x-300)*s+(p.y-300)*c}));
    let added,options,bitmapClosed=0;
    const bitmap=photo(angle);bitmap.close=()=>bitmapClosed++;
    globalThis.createImageBitmap=async()=>bitmap;
    const modal=openCapture({onAdd:(tools,configuration)=>{added=tools;options=configuration;}});
    try{
      changed('#photo-reference','ruler');
      const input=$('#gallery-file');Object.defineProperty(input,'files',{configurable:true,value:[new win.File(['fixed-pixel photo'],'scale.jpg',{type:'image/jpeg'})]});
      await input.onchange();await waitFor(()=>$('#calibration-canvas'),'ruler calibration');
      const canvas=calibrationCanvas();assert.equal(bitmapClosed,1,'decoded camera bitmap is released after resize');
      const row=actual(canvas).getContext('2d').getImageData(0,325,1400,1).data;
      const darkPixels=Array.from({length:1400},(_,x)=>x).filter(x=>row[x*4]<60);
      if(!angle)assert.deepEqual([darkPixels[0],darkPixels.at(-1),darkPixels.length],[300,549,250],'actual resized photo agrees with the fixed worker pixel truth');
      else{const centre={x:300+125*c-25*s,y:300+125*s+25*c};assert.ok(actual(canvas).getContext('2d').getImageData(Math.round(centre.x),Math.round(centre.y),1,1).data[0]<60,'rotated bitmap agrees with independent pixel truth');}
      placePoint(0,100,800);placePoint(1,350,800);typed('#ruler-distance',example.distance);
      click('#capture-continue');await waitFor(()=>$('#capture-pocket-shape'),'fixed-pixel recognition');
      if(example.recalibrate){
        const initialRuns=posted.length;click('#capture-calibration-back');calibrationCanvas();
        // Keep the same original pixel marks through a second complete recognition.
        typed('#ruler-distance',example.distance);click('#capture-continue');
        await waitFor(()=>$('#capture-pocket-shape')&&posted.length>initialRuns,'second calibrated recognition');
      }
      changed('#capture-pocket-shape',example.mode);typed('#capture-pocket-margin',example.margin);typed('#capture-depth','8 mm');
      $('[data-name="0"]').focus();
      assert.equal($('[data-trace-index="0"] span:last-child').textContent,fmtSize(100,20),'list keeps the independently measured tool size in every pocket mode');
      const summary=$('#capture-size-summary');assert.ok(summary,'tool and final pocket sizes are visible together');
      assert.ok(summary.textContent.includes(fmtSize(100,20)),`summary measured size: ${summary.textContent}`);
      assert.ok(summary.textContent.includes(fmtSize(...example.pocket)),`summary final cavity size: ${summary.textContent}`);
      click('#capture-add');await waitFor(()=>added,'captured millimetre tool');await waitFor(()=>!$('#trace-canvas'),'capture closes');
      assert.equal(added.length,1);assert.equal(added[0].depth,8);
      closeTo(size(added[0].points,angle).width,example.tool[0],'captured physical length');closeTo(size(added[0].points,angle).height,example.tool[1],'captured physical width');
      assert.ok(posted.length>0);for(const request of posted){assert.equal(request.width,1400);assert.equal(request.height,1050);closeTo(request.pxPerMm,2.5,'independent 250 px / 100 mm calibration');}
      let project=projectFor(added[0],options.pocketMargin),previous;
      for(let roundtrip=0;roundtrip<3;roundtrip++){
        const before=structuredClone(project),exported=exportedSize(project,angle);
        closeTo(exported.size.width,example.pocket[0],'actual SVG cavity length');closeTo(exported.size.height,example.pocket[1],'actual SVG cavity width');
        assert.deepEqual(project,before,'export does not change stored scale or reserve');if(previous)assert.equal(exported.svg,previous,'JSON reload cannot add reserve or margin again');
        previous=exported.svg;project=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project})));
      }
      t.diagnostic(`${example.mode}; ${example.distance}; captured ${example.tool.join(' x ')} mm; SVG ${example.pocket.join(' x ')} mm`);
    }finally{modal.close();}
  });
});
