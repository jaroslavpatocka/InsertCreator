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
const canvases=new WeakMap(),draws=new WeakMap(),rasters=new WeakMap(),sources=new WeakMap(),captured=new Map(),posted=[];let respond=null;
function actual(element){if(!canvases.has(element))canvases.set(element,createCanvas(element.width||300,element.height||150));const c=canvases.get(element);if(c.width!==element.width)c.width=element.width;if(c.height!==element.height)c.height=element.height;return c;}
win.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')return null;const element=this,ctx=actual(element).getContext('2d');return new Proxy(ctx,{get(target,key){if(typeof target[key]!=='function')return target[key];return(...args)=>{
  if(key==='putImageData'||key==='clearRect')draws.set(element,[]);
  if(['moveTo','lineTo','fillText','arc'].includes(key))draws.get(element)?.push([key,...args]);
  if(key==='drawImage'){
    const source=args[0],m=target.getTransform();let sx=1,sy=1,dx=0,dy=0;
    if(args.length===3){dx=args[1];dy=args[2];}
    else if(args.length===5){sx=args[3]/source.width;sy=args[4]/source.height;dx=args[1];dy=args[2];}
    else if(args.length===9){sx=args[7]/args[3];sy=args[8]/args[4];dx=args[5]-args[1]*sx;dy=args[6]-args[2]*sy;}
    rasters.set(element,{a:m.a*sx,b:m.b*sx,c:m.c*sy,d:m.d*sy,e:m.e+m.a*dx+m.c*dy,f:m.f+m.b*dx+m.d*dy});
    if(source instanceof win.HTMLCanvasElement){args[0]=actual(source);sources.set(element,args[0]);}
  }
  return target[key](...args);
};},set:(target,key,value)=>(target[key]=value,true)});};
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
function marked(n){const canvas=$('#calibration-canvas'),scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.width),row=draws.get(canvas).find(row=>row[0]==='fillText'&&row[1]===String(n));return{x:row[2]-18*scale,y:row[3]+18*scale};}
function place(n,x,y){$(`[data-ruler-point="${n-1}"]`).click();pointer('pointerdown',{x,y});pointer('pointerup',{x,y});}
function wheel({x=500,y=450,deltaY=-300,deltaMode=0}={}){const event=new win.WheelEvent('wheel',{deltaY,deltaMode,bubbles:true,cancelable:true});Object.defineProperties(event,{clientX:{value:x},clientY:{value:y}});$('#calibration-canvas').dispatchEvent(event);assert.equal(event.defaultPrevented,true,'wheel zoom must not scroll the modal');return event;}
function view(){return rasters.get($('#calibration-canvas'));}
function visible(p,m=view()){return{x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};}
function closePoint(actual,expected,message){assert.ok(Math.abs(actual.x-expected.x)<1e-7&&Math.abs(actual.y-expected.y)<1e-7,`${message}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);}
function fit(){$('[data-calibration-view="fit"]').click();}
function pan(button=2,{from={x:450,y:450},to={x:500,y:480},end='pointerup'}={}){const buttons=button===2?2:button===1?4:1;pointer('pointerdown',{...from,button,buttons});pointer('pointermove',{...to,button,buttons});pointer(end,{...to,button,buttons:0});}

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
  await t.test('wheel zoom stays anchored under the cursor, keeps crosshairs readable and exposes reset controls',async()=>{
    const modal=await openRuler();try{
      place(1,300,585);wheel({x:300,y:585});assert.ok(view().a>1);closePoint(visible({x:300,y:585}),{x:300,y:585},'cursor anchor stays fixed');
      closePoint(marked(1),{x:300,y:585},'marker follows its photographed point');
      const commands=draws.get($('#calibration-canvas'));assert.ok(commands.some(r=>r[0]==='moveTo'&&Math.abs(r[1]-279)<1e-7&&Math.abs(r[2]-585)<1e-7),'crosshair arm stays 21 screen pixels when zoomed');
      const zoomed=view().a;$('[data-calibration-view="zoom-out"]').click();assert.ok(view().a<zoomed);const smaller=view().a;$('[data-calibration-view="zoom-in"]').click();assert.ok(view().a>smaller);
      assert.ok($('[data-calibration-zoom]').textContent.includes('%'));fit();assert.equal(view().a,1);assert.equal(view().e,0);assert.equal(view().f,0);assert.deepEqual(marked(1),{x:300,y:585});
    }finally{modal.close();}
  });
  await t.test('right, middle and Space plus left drag pan the photo without relocating ruler points',async()=>{
    const modal=await openRuler();try{
      place(1,300,585);place(2,700,585);wheel({deltaY:-120});const initial={...view()};
      pan(2);closePoint({x:view().e,y:view().f},{x:initial.e+50,y:initial.f+30},'right drag moves view');
      const right={...view()};pan(1,{from:{x:500,y:480},to:{x:460,y:450}});closePoint({x:view().e,y:view().f},{x:right.e-40,y:right.f-30},'middle drag moves view');
      key(' ',{code:'Space'});const middle={...view()};pan(0,{from:{x:450,y:450},to:{x:470,y:460}});$('#calibration-canvas').dispatchEvent(new win.KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true,cancelable:true}));
      closePoint({x:view().e,y:view().f},{x:middle.e+20,y:middle.f+10},'Space plus left drag moves view');
      const context=new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true});$('#calibration-canvas').dispatchEvent(context);assert.equal(context.defaultPrevented,true);
      fit();assert.deepEqual(marked(1),{x:300,y:585});assert.deepEqual(marked(2),{x:700,y:585});
    }finally{modal.close();}
  });
  await t.test('cancelled pan restores its view and unrelated pointers cannot move or finish it',async()=>{
    const modal=await openRuler();try{
      wheel({deltaY:-120});const before={...view()};pointer('pointerdown',{button:2,buttons:2,x:450,y:450});
      pointer('pointermove',{id:8,button:2,buttons:2,x:600,y:600});pointer('pointercancel',{id:8});assert.deepEqual(view(),before);assert.equal(captured.has(7),true);
      wheel();assert.deepEqual(view(),before,'wheel must not change view during a drag');
      pointer('pointermove',{button:2,buttons:2,x:500,y:480});assert.notEqual(view().e,before.e);pointer('pointercancel',{button:2});assert.deepEqual(view(),before);assert.equal(captured.has(7),false);
      for(const end of ['lostpointercapture','blur','window-blur','released']){
        pointer('pointerdown',{button:2,buttons:2,x:450,y:450});pointer('pointermove',{button:2,buttons:2,x:490,y:470});
        if(end==='blur')$('#calibration-canvas').dispatchEvent(new win.Event('blur'));else if(end==='window-blur')win.dispatchEvent(new win.Event('blur'));else if(end==='released')pointer('pointermove',{button:2,buttons:0});else pointer(end,{button:2});
        assert.deepEqual(view(),before,`${end} restores the view`);assert.equal(captured.has(7),false);
      }
      fit();assert.deepEqual(marked(1),{x:300,y:585});assert.deepEqual(marked(2),{x:700,y:585});
    }finally{modal.close();}
  });
  await t.test('left clicks after zoom and pan retain image coordinates and recognition receives the original raster and metric scale',async()=>{
    const modal=await openRuler();try{
      const original=sources.get($('#calibration-canvas')).getContext('2d').getImageData(0,0,1000,900).data.slice();wheel({deltaY:-120});pan(2);
      const refs=[{x:250,y:350},{x:650,y:350}];refs.forEach((p,i)=>{const screen=visible(p);assert.ok(screen.x>0&&screen.x<1000&&screen.y>0&&screen.y<900);place(i+1,screen.x,screen.y);closePoint(marked(i+1),screen,'placed point matches the zoomed ruler mark');});
      fit();refs.forEach((p,i)=>closePoint(marked(i+1),p,'fit confirms original image coordinates'));wheel({deltaY:-120});pan(1);input($('#ruler-distance'),'100');$('#capture-continue').click();await waitFor(()=>posted.some(p=>p.url.includes('recognize-worker')));
      const sent=posted.find(p=>p.url.includes('recognize-worker')).message;assert.equal(sent.image.width,1000);assert.equal(sent.image.height,900);assert.ok(Math.abs(sent.options.pxPerMm-4)<1e-9);assert.deepEqual(sent.image.data,original,'navigation never resamples or crops the recognition image');$('#cancel-processing').click();
    }finally{modal.close();}
  });
  await t.test('mouse navigation and point placement respect the canvas position and CSS display size',async()=>{
    const modal=await openRuler();try{
      const canvas=$('#calibration-canvas');canvas.getBoundingClientRect=()=>({left:100,top:50,width:500,height:450,right:600,bottom:500});
      wheel({x:350,y:275,deltaY:-120});closePoint(visible({x:500,y:450}),{x:500,y:450},'zoom anchor uses canvas-local coordinates');
      const before={...view()};pan(2,{from:{x:350,y:275},to:{x:370,y:285}});closePoint({x:view().e,y:view().f},{x:before.e+40,y:before.f+20},'pan converts CSS delta to raster delta');
      const target={x:420,y:360},screen=visible(target);place(1,100+screen.x/2,50+screen.y/2);closePoint(marked(1),screen,'point lands under client-space cursor');fit();closePoint(marked(1),target,'point retains source coordinates after fit');
    }finally{modal.close();}
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
  await t.test('recognition result returns to the original photo, both rulers, distances and view for another calibrated run',async()=>{
    let additions=0;const modal=await openRuler(()=>{additions++;});try{
      $('#ruler-second').checked=true;$('#ruler-second').dispatchEvent(new win.Event('change'));sizeCanvas();
      const refs=[{x:100,y:100},{x:500,y:100},{x:600,y:100},{x:600,y:500}];refs.forEach((p,i)=>place(i+1,p.x,p.y));input($('#ruler-distance'),'100');input($('#ruler-second-distance'),'50');wheel({deltaY:-120});pan(2);
      const originalView={...view()},original=sources.get($('#calibration-canvas')).getContext('2d').getImageData(0,0,1000,900).data.slice();
      respond=(worker,message)=>{if(worker.url.includes('neural-worker'))worker.onmessage?.({data:{type:'error',id:message.id,message:'test uses measured contours'}});else worker.onmessage?.({data:{result:{contours:[{points:[{x:20,y:20},{x:80,y:20},{x:80,y:80},{x:20,y:80}]}],quality:{status:'ready',reasons:[]},mask:new Uint8Array(message.image.width*message.image.height)}}});};
      $('#capture-continue').click();await waitFor(()=>$('#capture-calibration-back'));assert.equal(additions,0);$('#capture-calibration-back').click();sizeCanvas();pointer('pointermove',{x:500,y:450});
      assert.equal($('#calibration-canvas').width,1000);assert.equal($('#calibration-canvas').height,900);assert.deepEqual(view(),originalView);assert.equal($('#ruler-second').checked,true);assert.equal($('#ruler-distance').value,'100');assert.equal($('#ruler-second-distance').value,'50');assert.deepEqual(sources.get($('#calibration-canvas')).getContext('2d').getImageData(0,0,1000,900).data,original);
      fit();refs.forEach((p,i)=>closePoint(marked(i+1),p,'back retains ruler positions in original photograph'));
      place(2,500,200);input($('#ruler-distance'),'125');const updated=[refs[0],{x:500,y:200},refs[2],refs[3]],expected=calibrateRulers({width:1000,height:900},updated,[125,50]);respond=null;const previousRuns=posted.filter(p=>p.url.includes('recognize-worker')).length;
      $('#capture-continue').click();await waitFor(()=>posted.filter(p=>p.url.includes('recognize-worker')).length>previousRuns);const sent=posted.filter(p=>p.url.includes('recognize-worker')).at(-1).message;assert.equal(sent.image.width,expected.width);assert.equal(sent.image.height,expected.height);assert.equal(sent.options.pxPerMm,expected.pxPerMm);assert.equal(additions,0);$('#cancel-processing').click();
    }finally{respond=null;modal.close();}
  });
  await t.test('a failed A4 result can return to manual rulers on the same original photograph',async()=>{
    posted.length=0;const modal=openCapture({onAdd:()=>assert.fail('returning to calibration must not add tools')});try{
      respond=(worker,message)=>{if(worker.url.includes('neural-worker'))worker.onmessage?.({data:{type:'error',id:message.id,message:'test uses measured contours'}});else worker.onmessage?.({data:{result:{contours:[],quality:{status:'retake',reasons:[]},mask:new Uint8Array(message.image.width*message.image.height)}}});};
      $('#sample-scan').click();await waitFor(()=>$('#capture-calibration-back'));assert.ok($('#trace-canvas'));$('#capture-calibration-back').click();sizeCanvas();assert.ok($('#a4-orientation'));assert.equal($('#ruler-distance'),null);$('#use-ruler').click();sizeCanvas();assert.ok($('#ruler-distance'));assert.equal($('#calibration-canvas').width,1000);assert.equal($('#calibration-canvas').height,900);
      respond=null;const previousRuns=posted.filter(p=>p.url.includes('recognize-worker')).length;$('#capture-continue').click();await waitFor(()=>posted.filter(p=>p.url.includes('recognize-worker')).length>previousRuns);assert.equal(posted.filter(p=>p.url.includes('recognize-worker')).at(-1).message.options.kind,'reference');$('#cancel-processing').click();
    }finally{respond=null;modal.close();}
  });
  await t.test('a reference-only case contour warns instead of claiming individual tools were recognized, with deliberate manual override',async()=>{
    let added=[];const modal=await openRuler(tools=>{added=tools;});try{
      respond=(worker,message)=>{if(worker.url.includes('neural-worker'))worker.onmessage?.({data:{type:'error',id:message.id,message:'test uses measured contours'}});else worker.onmessage?.({data:{result:{contours:[{points:[{x:100,y:100},{x:900,y:100},{x:900,y:800},{x:100,y:800}]}],quality:{status:'ready',reasons:[]},mask:new Uint8Array(message.image.width*message.image.height)}}});};
      $('#capture-continue').click();await waitFor(()=>$('#trace-items input[type=checkbox]'));
      assert.equal($('.recognition-status').classList.contains('ready'),false);assert.equal($('.recognition-status').classList.contains('retake'),true);
      assert.match($('.recognition-status').textContent,/Samostatné nástroje se nerozpoznaly/);assert.match($('.capture-sidebar').textContent,/obě značky měřítka/);assert.match($('.capture-sidebar').textContent,/kufříku nebo držáku/);
      const candidate=$('#trace-items input[type=checkbox]');assert.equal(candidate.checked,false);assert.equal($('#capture-add').disabled,true);assert.equal(added.length,0);assert.ok($('#capture-calibration-back'));
      candidate.checked=true;candidate.dispatchEvent(new win.Event('change',{bubbles:true}));assert.equal($('#capture-add').disabled,false);
      assert.match($('.recognition-status').textContent,/Samostatné nástroje se nerozpoznaly/,'manual selection must not claim instance recognition');
      $('#capture-add').click();await waitFor(()=>!$('#modal-root').children.length);assert.equal(added.length,1,'the user may deliberately add the whole measured object');
    }finally{respond=null;modal.close();}
  });
  await t.test('manually deselecting a genuine tool does not reclassify it as a reference-only failure',async()=>{
    const modal=await openRuler();try{
      respond=(worker,message)=>{if(worker.url.includes('neural-worker'))worker.onmessage?.({data:{type:'error',id:message.id,message:'test uses measured contours'}});else worker.onmessage?.({data:{result:{contours:[{points:[{x:200,y:500},{x:800,y:500},{x:800,y:700},{x:200,y:700}]},{points:[{x:100,y:100},{x:200,y:100},{x:200,y:200},{x:100,y:200}]}],quality:{status:'ready',reasons:[]},mask:new Uint8Array(message.image.width*message.image.height)}}});};
      $('#capture-continue').click();await waitFor(()=>$('#trace-items input[type=checkbox]'));
      const candidates=[...win.document.querySelectorAll('#trace-items input[type=checkbox]')];assert.deepEqual(candidates.map(candidate=>candidate.checked),[false,true]);assert.equal($('.recognition-status').classList.contains('ready'),true);
      candidates[1].checked=false;candidates[1].dispatchEvent(new win.Event('change',{bubbles:true}));assert.equal($('#capture-add').disabled,true);assert.equal($('.recognition-status').classList.contains('ready'),true);assert.doesNotMatch($('.capture-sidebar').textContent,/Samostatné nástroje se nerozpoznaly/);
    }finally{respond=null;modal.close();}
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
