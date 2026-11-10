import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {mountPhotoSelection,validateSelectionContour,interpolateSelectionStroke,makeSelectionCutout} from '../dist/capture-selection.js';
import {setLang} from '../dist/i18n.js';

const rectangle=(x=20,y=20,w=80,h=50)=>({points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t,{engine={},initialContour=null,square=false,delayEncode=false,width=200,height=120}={}){
  const win=new Window({url:'http://localhost/'}),backings=new WeakMap();
  for(const key of ['document','localStorage','HTMLElement'])globalThis[key]=win[key];globalThis.window=win;
  setLang('cs',{save:false});
  const backing=element=>{let value=backings.get(element);if(!value){value=createCanvas(element.width,element.height);backings.set(element,value);}if(value.width!==element.width)value.width=element.width;if(value.height!==element.height)value.height=element.height;return value;};
  win.HTMLCanvasElement.prototype.getContext=function(type){if(type!=='2d')return null;if(!Object.hasOwn(this,'width'))for(const key of ['width','height']){const descriptor=Object.getOwnPropertyDescriptor(win.HTMLCanvasElement.prototype,key);Object.defineProperty(this,key,{get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);const native=backings.get(this);if(native&&native[key]!==this[key])native[key]=this[key];},configurable:true});}const context=backing(this).getContext('2d');if(!context.selectionWrapped){const original=context.drawImage.bind(context);context.drawImage=(image,...args)=>original(backings.has(image)?backing(image):image,...args);context.selectionWrapped=true;}return context;};
  const pendingEncodes=[];win.HTMLCanvasElement.prototype.toBlob=function(callback){const blob=new win.Blob([backing(this).toBuffer('image/png')],{type:'image/png'});if(delayEncode)pendingEncodes.push(()=>callback(blob));else callback(blob);};
  const rect={left:20,top:30,width:square?400:600,height:square?400:380};win.HTMLCanvasElement.prototype.getBoundingClientRect=()=>rect;
  win.document.body.innerHTML='<div id="body"></div><div id="footer"></div>';
  const image={width,height,data:new Uint8ClampedArray(width*height*4)};for(let i=0;i<image.data.length;i+=4){image.data[i]=100;image.data[i+1]=110;image.data[i+2]=120;image.data[i+3]=255;}
  const original=image.data.slice(),applied=[],cancelled=[],calls=[],lightingCalls=[],downloads=[];
  const dependencies={
    prepareSelectionLighting:async(source,options)=>{lightingCalls.push({source,options});const data=source.data.slice();for(let i=0;i<data.length;i+=4)data[i]=160;return{image:{...source,data},diagnostics:{clippedPixels:0,requiresManual:false}};},
    selectPhotoRegion:async(source,options)=>{calls.push({source,options});return{contours:[rectangle()],quality:{status:'review',needsManual:false},diagnostics:{}};},
    tracePhotoBoundary:async(source,options)=>{calls.push({source,options});return{contours:[{points:options.points}],quality:{status:'review',needsManual:true},diagnostics:{segments:[{fallback:true}]}};},...engine
  };
  const editor=mountPhotoSelection({host:win.document.querySelector('#body'),footer:win.document.querySelector('#footer'),image,pxPerMm:2,initialContour,onApply:value=>applied.push(value),onCancel:()=>cancelled.push(true),onDownload:value=>downloads.push(value),engine:dependencies});
  const canvas=win.document.querySelector('canvas');canvas.getBoundingClientRect=()=>rect;
  const pointer=(type,point,options={})=>{const view=editor.getState().view,event=new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:rect.left+(point.x*view.zoom+view.x)*rect.width/canvas.width,clientY:rect.top+(point.y*view.zoom+view.y)*rect.height/canvas.height,...options});canvas.dispatchEvent(event);return event;};
  const click=point=>{pointer('pointerdown',point);pointer('pointerup',point);};
  const mode=name=>win.document.querySelector(`[data-selection-mode="${name}"]`).click();
  const action=name=>win.document.querySelector(`[data-selection-action="${name}"]`).click();
  const preview=name=>win.document.querySelector(`[data-selection-preview="${name}"]`).click();
  const roi=()=>{mode('roi');pointer('pointerdown',{x:10,y:10});pointer('pointerup',{x:150,y:100});};
  t.after(async()=>{editor.destroy();await win.happyDOM.close();});
  return{win,editor,canvas,image,original,calls,lightingCalls,applied,cancelled,mode,action,preview,pointer,click,roi,backing,downloads,pendingEncodes};
}

test('manual source-pixel outline works without automatic extraction and applies exactly once without fit or scale changes',async t=>{
  const f=fixture(t,{engine:{selectPhotoRegion:()=>{throw new Error('Automatic engine must not run');}}});await tick();f.mode('manual');
  const expected=rectangle().points;for(const p of expected)f.click(p);await f.editor.determine();f.action('apply');f.action('apply');
  assert.equal(f.applied.length,1);assert.deepEqual(f.applied[0].contour.points,expected);assert.equal(f.applied[0].pxPerMm,2);assert.equal(f.applied[0].quality.status,'review');assert.equal(f.applied[0].quality.manual,true);assert.equal(f.applied[0].method,'manual-polygon');assert.equal(f.calls.length,0);assert.deepEqual(f.image.data,f.original);
});

test('ROI and continuous brush use source coordinates under zoom, latest opposite stroke replaces conflicting seeds',async t=>{
  const f=fixture(t);await tick();f.roi();assert.deepEqual(f.editor.getState().roi,{x:10,y:10,width:140,height:90});
  f.win.document.querySelector('[data-selection-zoom="in"]').click();f.mode('foreground');const brush=f.win.document.querySelector('[data-selection-brush]');brush.value='2';
  f.pointer('pointerdown',{x:30,y:40});f.pointer('pointermove',{x:100,y:40});f.pointer('pointerup',{x:100,y:40});let state=f.editor.getState();assert.ok(state.foreground.length>60);assert.equal(state.foreground.at(-1).x,100);assert.ok(state.foreground.every(p=>Math.abs(p.y-40)<1e-9));
  for(let i=1;i<state.foreground.length;i++)assert.ok(Math.hypot(state.foreground[i].x-state.foreground[i-1].x,state.foreground[i].y-state.foreground[i-1].y)<=state.foreground[i].r*.5+1e-8);
  f.mode('background');f.click({x:60,y:40});state=f.editor.getState();assert.ok(state.background.length);assert.ok(state.foreground.every(p=>state.background.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=p.r+q.r)));
  await f.editor.determine();assert.equal(f.calls.length,1);assert.equal(f.calls[0].source,f.image);assert.equal(f.calls[0].options.lighting,'corrected');assert.deepEqual(f.calls[0].options.roi,state.roi);assert.ok(f.calls[0].options.preparedLighting);assert.deepEqual(f.image.data,f.original);
});

test('multiple components require explicit choice and apply exactly one selected source contour',async t=>{
  const left=rectangle(20,20,40,40),right=rectangle(100,20,40,40),f=fixture(t,{engine:{selectPhotoRegion:async()=>({contours:[left,right],quality:{status:'review'},diagnostics:{}})}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});await f.editor.determine();
  assert.equal(f.editor.getState().selected,-1);assert.equal(f.win.document.querySelector('[data-selection-action="apply"]').disabled,true);f.mode('pick');f.click({x:120,y:40});f.action('apply');assert.equal(f.applied.length,1);assert.deepEqual(f.applied[0].contour,right);
});

test('undo restores a whole stroke, pointer cancellation rolls back only its unfinished action',async t=>{
  const f=fixture(t);await tick();f.roi();f.mode('foreground');f.pointer('pointerdown',{x:30,y:30});f.pointer('pointermove',{x:80,y:30});f.pointer('pointerup',{x:80,y:30});const state=f.editor.getState();assert.ok(state.foreground.length>1);
  f.pointer('pointerdown',{x:30,y:60});f.pointer('pointermove',{x:80,y:60});f.pointer('pointercancel',{x:80,y:60});assert.deepEqual(f.editor.getState().foreground,state.foreground);f.action('undo');assert.deepEqual(f.editor.getState().foreground,[]);assert.deepEqual(f.editor.getState().roi,state.roi);
});

test('editing aborts an active calculation and a late stale result cannot enable Apply',async t=>{
  let complete,captured;const f=fixture(t,{engine:{selectPhotoRegion:(image,options)=>{captured=options;return new Promise(resolve=>complete=resolve);}}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});const work=f.editor.determine();assert.equal(f.editor.getState().busy,true);f.mode('background');assert.equal(captured.signal.aborted,true);f.click({x:120,y:80});complete({contours:[rectangle()],quality:{status:'review'},diagnostics:{}});await work;assert.deepEqual(f.editor.getState().contours,[]);assert.equal(f.win.document.querySelector('[data-selection-action="apply"]').disabled,true);
});

test('cancel aborts calculation and lighting work, destroys listeners, and never commits a draft',async t=>{
  let complete,captured;const f=fixture(t,{engine:{selectPhotoRegion:(image,options)=>{captured=options;return new Promise(resolve=>complete=resolve);}}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});const work=f.editor.determine();f.action('cancel');assert.equal(captured.signal.aborted,true);assert.equal(f.cancelled.length,1);assert.equal(f.editor.getState().disposed,true);complete({contours:[rectangle()]});await work;f.action('apply');f.action('cancel');assert.equal(f.cancelled.length,1);assert.deepEqual(f.applied,[]);
});

test('working-copy preview changes rendered pixels, original preview restores them and silhouette is a real image',async t=>{
  const f=fixture(t,{initialContour:rectangle()});await tick();assert.equal(f.editor.getState().preview,'corrected');const context=f.backing(f.canvas).getContext('2d'),v=f.editor.getState().view,p={x:Math.round(170*v.zoom+v.x),y:Math.round(100*v.zoom+v.y)},pixel=()=>[...context.getImageData(p.x,p.y,1,1).data];
  assert.deepEqual(pixel(),[160,110,120,255]);f.preview('original');assert.deepEqual(pixel(),[100,110,120,255]);f.preview('mask');await tick();assert.deepEqual(pixel(),[0,0,0,255]);const inner={x:Math.round(60*v.zoom+v.x),y:Math.round(40*v.zoom+v.y)};assert.deepEqual([...context.getImageData(inner.x,inner.y,1,1).data],[255,255,255,255],'silhouette shows pure white material against black background');assert.deepEqual(f.image.data,f.original);
  const checkbox=f.win.document.querySelector('[data-selection-lighting]');checkbox.checked=false;checkbox.dispatchEvent(new f.win.Event('change',{bubbles:true}));assert.equal(f.editor.getState().lighting,false);assert.equal(f.editor.getState().preview,'original');assert.equal(f.win.document.querySelector('[data-selection-action="apply"]').disabled,true);
});

test('magnetic anchors use the deterministic boundary API and explicitly preserve fallback metadata',async t=>{
  const f=fixture(t);await tick();f.mode('magnetic');for(const p of rectangle().points)f.click(p);await f.editor.determine();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.closed,true);assert.deepEqual(f.calls[0].options.points,rectangle().points);assert.match(f.win.document.querySelector('.capture-selection-status').textContent,/nejasná/);f.action('apply');assert.equal(f.applied[0].diagnostics.segments[0].fallback,true);assert.equal(f.applied[0].quality.status,'review');
});

test('manual numeric point entry and keyboard editing stay inside the source image and reject crossing polygons',async t=>{
  const f=fixture(t);await tick();f.mode('manual');const x=f.win.document.querySelector('[data-selection-coordinate="x"]'),y=f.win.document.querySelector('[data-selection-coordinate="y"]');for(const p of rectangle().points){x.value=p.x;y.value=p.y;f.action('add-point');}f.canvas.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(f.editor.getState().anchors.at(-1).x,21);f.action('undo');assert.equal(f.editor.getState().anchors.at(-1).x,20);await f.editor.determine();assert.equal(f.editor.getState().selected,0);
  assert.throws(()=>validateSelectionContour([{x:0,y:0},{x:20,y:20},{x:20,y:0},{x:0,y:20}],200,120),/kříží/);assert.throws(()=>validateSelectionContour(rectangle(190,20,20,20),200,120),/fotografii/);
});

test('a second touch cancels the partial stroke before pinch zoom and cannot add accidental points',async t=>{
  const f=fixture(t);await tick();f.roi();f.mode('foreground');f.pointer('pointerdown',{x:40,y:40},{pointerType:'touch',pointerId:11});f.pointer('pointermove',{x:80,y:40},{pointerType:'touch',pointerId:11});assert.ok(f.editor.getState().foreground.length);f.pointer('pointerdown',{x:120,y:80},{pointerType:'touch',pointerId:12,isPrimary:false});assert.deepEqual(f.editor.getState().foreground,[]);const before=f.editor.getState().view.zoom;f.pointer('pointermove',{x:160,y:100},{pointerType:'touch',pointerId:12,isPrimary:false});assert.ok(f.editor.getState().view.zoom>before);f.pointer('pointerup',{x:160,y:100},{pointerType:'touch',pointerId:12,isPrimary:false});f.pointer('pointerup',{x:80,y:40},{pointerType:'touch',pointerId:11});assert.deepEqual(f.editor.getState().foreground,[]);
});

test('brush interpolation spans a thin connector without omitted centers',()=>{const result=interpolateSelectionStroke({x:1,y:2},{x:101,y:2},.5);assert.equal(result.length,400);assert.deepEqual(result.at(-1),{x:101,y:2,r:.5});});

test('400 px square mobile surface preserves photo proportions and source coordinates after actual backing resize',async t=>{
  const f=fixture(t,{square:true});await tick();assert.equal(f.canvas.width,f.canvas.height);const view=f.editor.getState().view;assert.equal(view.x,0);assert.ok(view.y>0,'wide photo is letterboxed rather than stretched on a square surface');assert.ok(Math.abs(view.zoom*200-f.canvas.width)<1e-8);f.mode('manual');for(const p of rectangle().points)f.click(p);await f.editor.determine();f.action('apply');assert.deepEqual(f.applied[0].contour,rectangle());
});

test('unrepresentable hard-background hole reports the engine reason and cannot be silently applied as a filled outline',async t=>{
  const reason='Označený otvor nelze převést na jediný vnější obrys.',f=fixture(t,{engine:{selectPhotoRegion:async()=>({contours:[],quality:{status:'retake',needsManual:true,reasons:[reason]},diagnostics:{protectedInteriorHoles:1}})}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});await f.editor.determine();assert.ok(f.win.document.querySelector('.capture-selection-status').textContent.includes(reason));assert.equal(f.win.document.querySelector('[data-selection-action="apply"]').disabled,true);f.action('apply');assert.deepEqual(f.applied,[]);
});

const holeMask=(width=200,height=120)=>{const mask=new Uint8Array(width*height);for(let y=20;y<70;y++)for(let x=20;x<100;x++)mask[y*width+x]=+(x<40||x>=60||y<30||y>=50);return mask;};
const canvasPixel=(f,x,y)=>{const view=f.editor.getState().view;return[...f.backing(f.canvas).getContext('2d').getImageData(Math.round(x*view.zoom+view.x),Math.round(y*view.zoom+view.y),1,1).data];};

test('cutout alpha multiplies source transparency without changing RGB, dimensions, crop or original data',()=>{
  const image={width:3,height:1,data:new Uint8ClampedArray([12,34,56,255,78,90,123,128,140,150,160,200])},before=image.data.slice(),output=makeSelectionCutout(image,new Float32Array([1,.5,0]));assert.equal(output.width,3);assert.equal(output.height,1);assert.deepEqual([...output.data],[12,34,56,255,78,90,123,64,140,150,160,0]);assert.deepEqual(image.data,before);assert.throws(()=>makeSelectionCutout(image,new Uint8Array([255,0,1])),/mask/);
});

test('real mask preserves an internal BG hole in silhouette, checkerboard cutout and actual encoded PNG even without an applicable outer contour',async t=>{
  const mask=holeMask(),f=fixture(t,{engine:{selectPhotoRegion:async()=>({width:200,height:120,mask,contours:[],quality:{status:'retake',needsManual:true,reasons:['Vnitřní otvor vyžaduje více obrysů.']},diagnostics:{protectedInteriorHoles:1}})}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});await f.editor.determine();assert.equal(f.editor.getState().preview,'cutout');assert.equal(f.win.document.querySelector('[data-selection-action="apply"]').disabled,true);assert.equal(f.win.document.querySelector('[data-selection-action="download"]').disabled,false);
  assert.deepEqual(canvasPixel(f,70,40),[100,110,120,255],'cutout uses original RGB, not the corrected red=160 copy');assert.notDeepEqual(canvasPixel(f,50,40),[100,110,120,255],'the internal hole displays the checkerboard');f.preview('mask');await tick();assert.deepEqual(canvasPixel(f,50,40),[0,0,0,255]);assert.deepEqual(canvasPixel(f,70,40),[255,255,255,255]);
  mask.fill(1);const exported=await f.editor.downloadPng();assert.equal(f.downloads.length,1);assert.equal(exported.blob.type,'image/png');assert.equal(exported.image.width,200);assert.equal(exported.image.height,120);assert.equal(exported.image.data[(40*200+50)*4+3],0,'the result owns an immutable mask copy');
  const decoded=await loadImage(Buffer.from(await exported.blob.arrayBuffer()));assert.equal(decoded.width,200);assert.equal(decoded.height,120);const png=createCanvas(200,120),context=png.getContext('2d');context.drawImage(decoded,0,0);const rgba=context.getImageData(0,0,200,120).data,expected=holeMask();for(let p=0;p<expected.length;p++){assert.equal(rgba[p*4+3],expected[p]*255);if(expected[p])assert.deepEqual([...rgba.slice(p*4,p*4+3)],[...f.original.slice(p*4,p*4+3)]);}assert.deepEqual(f.image.data,f.original);
});

test('editing invalidates cutout export and undo restores the immutable hole mask without vector filling it',async t=>{
  const f=fixture(t,{engine:{selectPhotoRegion:async()=>({mask:holeMask(),contours:[],quality:{status:'retake',needsManual:true},diagnostics:{}})}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});await f.editor.determine();f.mode('background');f.click({x:120,y:80});assert.equal(f.editor.getState().canDownload,false);assert.equal(f.win.document.querySelector('[data-selection-action="download"]').disabled,true);assert.equal(await f.editor.downloadPng(),null);f.action('undo');assert.equal(f.editor.getState().canDownload,true);f.preview('mask');await tick();assert.deepEqual(canvasPixel(f,50,40),[0,0,0,255]);const png=await f.editor.downloadPng();assert.equal(png.image.data[(40*200+50)*4+3],0);assert.equal(f.downloads.length,1);
});

test('a PNG encoded after a new edit or cancellation cannot trigger a stale download callback',async t=>{
  const f=fixture(t,{delayEncode:true,engine:{selectPhotoRegion:async()=>({mask:holeMask(),contours:[rectangle()],quality:{status:'review'},diagnostics:{}})}});await tick();f.roi();f.mode('foreground');f.click({x:30,y:30});await f.editor.determine();const pending=f.editor.downloadPng();await tick();assert.equal(f.pendingEncodes.length,1);f.mode('background');f.click({x:120,y:80});f.pendingEncodes.shift()();assert.equal(await pending,null);assert.equal(f.downloads.length,0);assert.equal(f.win.document.querySelector('[data-selection-action="download"]').disabled,true);
});

test('manual polygon cutout is a vector fallback while automatic output without a valid raster cannot invent one',async t=>{
  const manual=fixture(t,{initialContour:rectangle()});await tick();const png=await manual.editor.downloadPng();assert.equal(png.image.data[(40*200+70)*4+3],255);assert.equal(png.image.data[(100*200+170)*4+3],0);assert.deepEqual([...png.image.data.slice((40*200+70)*4,(40*200+70)*4+3)],[100,110,120]);
  const automatic=fixture(t);await tick();automatic.roi();automatic.mode('foreground');automatic.click({x:30,y:30});await automatic.editor.determine();assert.equal(automatic.editor.getState().canDownload,false);assert.equal(await automatic.editor.downloadPng(),null);
});

test('repeated large-mask results keep undo mask storage within sixteen MiB without forty deep copies per history entry',async t=>{
  const width=700,height=700,mask=holeMask(width,height),f=fixture(t,{width,height,engine:{selectPhotoRegion:async()=>({width,height,mask,contours:[rectangle()],quality:{status:'review'},diagnostics:{}})}});await tick();f.roi();f.mode('foreground');for(let i=0;i<42;i++){f.click({x:30+i%2,y:30});await f.editor.determine();}const state=f.editor.getState();assert.ok(state.historyMaskBytes<=16*1024*1024);assert.ok(state.historyMaskBytes>15*1024*1024,'the budget retains recent useful undo masks');f.action('undo');assert.equal(f.editor.getState().hasRaster,true);const png=await f.editor.downloadPng();assert.equal(png.image.data[(40*width+50)*4+3],0);
});
