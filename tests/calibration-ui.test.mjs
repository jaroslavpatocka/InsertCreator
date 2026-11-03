import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {calibrateRulers} from '../dist/ruler-calibration.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
globalThis.ImageData=ImageData;globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
const canvases=new WeakMap(),draws=new WeakMap(),captured=new Map(),posted=[];let respond=null;
function actual(element){if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));const c=canvases.get(element);if(c.width!==element.width)c.width=element.width;if(c.height!==element.height)c.height=element.height;return c;}
win.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')return null;const element=this,ctx=actual(element).getContext('2d');return new Proxy(ctx,{get(target,key){if(typeof target[key]!=='function')return target[key];return(...args)=>{if(key==='putImageData')draws.set(element,[]);if(['moveTo','lineTo','fillText','arc'].includes(key))draws.get(element)?.push([key,...args]);return target[key](...args);};},set:(target,key,value)=>(target[key]=value,true)});};
win.HTMLCanvasElement.prototype.setPointerCapture=function(id){captured.set(id,this);};
win.HTMLCanvasElement.prototype.hasPointerCapture=function(id){return captured.get(id)===this;};
win.HTMLCanvasElement.prototype.releasePointerCapture=function(id){if(captured.get(id)===this)captured.delete(id);};
globalThis.Worker=class{constructor(url){this.url=String(url);}postMessage(message){posted.push({url:this.url,message});if(respond)setTimeout(()=>respond?.(this,message),0);}terminate(){}};
const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js'),{openCapture}=await import('../dist/capture.js');
setLang('cs',{save:false});setAppUnit('mm',{save:false});
const $=selector=>win.document.querySelector(selector),pause=()=>new Promise(resolve=>setTimeout(resolve,2));
async function waitFor(fn){const start=performance.now();while(!fn()){if(performance.now()-start>4000)throw Error('Calibration state did not arrive');await pause();}}
async function openRuler(onAdd=()=>assert.fail('pending recognition must never add')){posted.length=0;const modal=openCapture({onAdd});$('#photo-reference').value='ruler';$('#photo-reference').onchange();$('#sample-scan').click();await waitFor(()=>$('#calibration-canvas'));sizeCanvas();return modal;}
function sizeCanvas(){const canvas=$('#calibration-canvas');canvas.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:900,right:1000,bottom:900});return canvas;}
const input=(el,value)=>{el.value=value;el.dispatchEvent(new win.Event('input',{bubbles:true}));};
function pointer(type,{id=7,x=300,y=585,...extra}={}){const c=$('#calibration-canvas');c.dispatchEvent(new win.PointerEvent(type,{pointerId:id,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true,...extra}));}
function key(value,extra={}){$('#calibration-canvas').dispatchEvent(new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra}));}
function marked(n){const row=draws.get($('#calibration-canvas')).find(row=>row[0]==='fillText'&&row[1]===String(n));return{x:row[2]-18,y:row[3]+18};}
function place(n,x,y){$(`[data-ruler-point="${n-1}"]`).click();pointer('pointerdown',{x,y});pointer('pointerup',{x,y});}

test('ruler calibration uses visible open crosshairs, accessible points and safe pointer lifecycles',async t=>{
  t.after(async()=>{delete globalThis.Worker;await win.happyDOM.close();});
  await t.test('crosshair is both a real cursor and a drawn high contrast open target',async()=>{
    const modal=await openRuler(),c=$('#calibration-canvas');assert.equal(c.style.cursor,'crosshair');assert.equal(c.style.touchAction,'none');
    pointer('pointermove',{x:250,y:200});const commands=draws.get(c);
    assert.ok(commands.some(r=>r[0]==='moveTo'&&r[1]===229&&r[2]===200));assert.ok(commands.some(r=>r[0]==='lineTo'&&r[1]===247&&r[2]===200));
    assert.ok(!commands.some(r=>r[0]==='arc'),'no filled point hides the ruler mark');
    assert.ok(!commands.some(r=>r[0]==='fillText'&&r[2]===300&&r[3]===585),'number is offset from the target');
    assert.equal($('[data-ruler-point="0"]').getAttribute('aria-pressed'),'true');modal.close();
  });
  await t.test('unrelated pointers cannot move or end a drag and cancel, lost capture and blur restore the point',async()=>{
    const modal=await openRuler();pointer('pointerdown');const original={x:300,y:585};
    pointer('pointermove',{id:8,x:400,y:500});pointer('pointercancel',{id:8});assert.deepEqual(marked(1),original);assert.equal(captured.has(7),true);
    pointer('pointermove',{x:400,y:500});assert.deepEqual(marked(1),{x:400,y:500});pointer('pointercancel');assert.deepEqual(marked(1),original);assert.equal(captured.has(7),false);
    for(const end of ['lostpointercapture','blur','window-blur','released']){pointer('pointerdown');pointer('pointermove',{x:410,y:510});if(end==='blur')$('#calibration-canvas').dispatchEvent(new win.Event('blur'));else if(end==='window-blur')win.dispatchEvent(new win.Event('blur'));else if(end==='released')pointer('pointermove',{x:420,y:520,buttons:0});else pointer(end);assert.deepEqual(marked(1),original);assert.equal(captured.has(7),false);}
    pointer('pointerdown');pointer('pointermove',{x:410,y:510});pointer('pointerup');assert.deepEqual(marked(1),{x:410,y:510});
    key('2');key('ArrowLeft',{shiftKey:true});assert.deepEqual(marked(2),{x:690,y:585});assert.equal($('[data-ruler-point="1"]').getAttribute('aria-pressed'),'true');modal.close();
  });
  await t.test('second reference parses units and sends the rewarped image and one metric scale to recognition',async()=>{
    const modal=await openRuler();$('#ruler-second').checked=true;$('#ruler-second').dispatchEvent(new win.Event('change'));sizeCanvas();
    assert.equal(win.document.querySelectorAll('[data-ruler-point]').length,4);assert.match($('.capture-sidebar').textContent,/fyzicky kolmý/);assert.match($('.capture-sidebar').textContent,/plnou perspektivu nenahrazují/);
    const refs=[{x:100,y:100},{x:500,y:100},{x:600,y:100},{x:600,y:500}];refs.forEach((p,i)=>place(i+1,p.x,p.y));
    key('4');assert.equal($('[data-ruler-point="3"]').getAttribute('aria-pressed'),'true');input($('#ruler-distance'),'4 in');input($('#ruler-second-distance'),'2 in');
    const expected=calibrateRulers({width:1000,height:900},refs,[101.6,50.8]);$('#capture-continue').click();await waitFor(()=>posted.some(p=>p.url.includes('recognize-worker')));
    const sent=posted.find(p=>p.url.includes('recognize-worker')).message;assert.equal(sent.image.width,expected.width);assert.equal(sent.image.height,expected.height);assert.equal(sent.options.pxPerMm,expected.pxPerMm);assert.notEqual(sent.image.height,900,'the second reference changes the actual recognition raster');
    $('#cancel-processing').click();modal.close();
  });
  await t.test('parallel second ruler and invalid distance stay on calibration with a translated error',async()=>{
    setLang('en',{save:false});const modal=await openRuler();$('#ruler-second').checked=true;$('#ruler-second').dispatchEvent(new win.Event('change'));sizeCanvas();
    input($('#ruler-second-distance'),'invalid');$('#capture-continue').click();assert.match($('#capture-error').textContent,/Enter the real distance/);
    input($('#ruler-second-distance'),'100 mm');place(3,100,200);place(4,600,200);$('#capture-continue').click();assert.match($('#capture-error').textContent,/almost parallel/);assert.ok($('#calibration-canvas'));assert.equal(posted.length,0);modal.close();setLang('cs',{save:false});
  });
  await t.test('after rewarp both photographed rulers remain excluded from adding tools',async()=>{
    let added=[];const modal=await openRuler(tools=>{added=tools;});$('#ruler-second').checked=true;$('#ruler-second').dispatchEvent(new win.Event('change'));sizeCanvas();
    const refs=[{x:100,y:100},{x:500,y:100},{x:600,y:100},{x:600,y:500}];refs.forEach((p,i)=>place(i+1,p.x,p.y));input($('#ruler-distance'),'100');input($('#ruler-second-distance'),'50');
    const calibrated=calibrateRulers({width:1000,height:900},refs,[100,50]);
    const box=(x0,y0,x1,y1)=>({points:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]});
    const around=(a,b)=>box(Math.min(a.x,b.x)-8,Math.min(a.y,b.y)-8,Math.max(a.x,b.x)+8,Math.max(a.y,b.y)+8);
    const contours=[around(...calibrated.points.slice(0,2)),around(...calibrated.points.slice(2)),box(30,30,80,80)];
    respond=(worker,message)=>{if(worker.url.includes('neural-worker'))worker.onmessage?.({data:{type:'error',id:message.id,message:'test uses measured contours'}});else worker.onmessage?.({data:{result:{contours,quality:{status:'ready',reasons:[]},mask:new Uint8Array(message.image.width*message.image.height)}}});};
    $('#capture-continue').click();await waitFor(()=>$('#trace-items input[type=checkbox]'));
    assert.deepEqual([...win.document.querySelectorAll('#trace-items input[type=checkbox]')].map(i=>i.checked),[false,false,true]);
    $('#capture-add').click();await waitFor(()=>!$('#modal-root').children.length);assert.equal(added.length,1);assert.equal(added[0].name,'Nástroj 3');respond=null;modal.close();
  });
});
