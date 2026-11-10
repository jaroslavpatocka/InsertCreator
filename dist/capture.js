import { detectPaper, rectifyImageNative, calibrateSegment } from './trace.js';
import { calibrateRulers, rectifyRulersNative } from './ruler-calibration.js';
import { recognizeTools } from './recognize.js';
import {removePhotoBackground,MAX_BACKGROUND_PIXELS} from './background-client.js';
import {traceAlphaPhoto} from './photo-alpha.js';
import {mountPhotoSelection} from './capture-selection.js';
import {captureSelectionItem,captureSelectionMask,mergeCaptureCutout} from './capture-selection-result.js';
import { captureToolPoints, capturePhotoGeometry, captureItemDimensions, capturePocketDimensions, prepareCaptureFit, resizeCaptureItem, toolFromCaptureItem } from './capture-tools.js';
import { drawCaptureContours, drawCaptureToolPreview } from './capture-preview.js';
import { bindCanvasView, clampView, zoomViewAt, identityView, photoToView, viewToPhoto } from './capture-view.js';
import { mountCaptureGuide } from './capture-guide.js';
import { bindCaptureContextMenu } from './capture-context-menu.js';
import { bindCaptureContourEditor } from './capture-contour-editor.js';
import {flattenContour} from './capture-contour-edit.js';
import { icon, esc, openModal, download } from './ui.js';
import { t, plural, i18nError, errorText } from './i18n.js';
import { unit, inputValue, parseLength, fmtSize, fmtLen } from './units.js';
import { loadingMarkup, updateLoading } from './loading-ui.js';
import {DEFAULT_POCKET_MARGIN,validatePocketMargin} from './pocket-margin.js';

const LAYOUTS = [['auto', 'Automaticky podle místa v šuplíku'], ['photo', 'Zachovat rozložení z fotky (jeden modul)'], ['shared', 'Jeden modul pro všechny nástroje'], ['each', 'Samostatný modul pro každý nástroj']];
let lastLayout = 'auto', lastDepth = 12, lastPocketShape = 'ideal'; // The choices stay for the next photo of this session.
const MIN_DEPTH = .5, MAX_DEPTH = 99;
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

// Calibration owns one-finger point placement; a second finger cancels that
// preview and navigates the photo without changing the source calibration.
function bindCalibrationTouchNavigation(canvas,{onStart,onMove}){
  const points=new Map(),captures=new Set();let active=false,blocked=false,starting=false,suppressClick=false;
  const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const frame=()=>[...points.values()].slice(0,2).map(p=>({...p}));
  const release=id=>{if(!captures.delete(id))return;try{canvas.releasePointerCapture?.(id);}catch{}};
  const down=event=>{
    if(event.pointerType!=='touch')return;
    if(!points.size){blocked=false;suppressClick=false;}
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(blocked){stop(event);return;}
    if(points.size>=2){
      if(!active){starting=true;onStart();starting=false;active=true;suppressClick=true;for(const id of points.keys())try{canvas.setPointerCapture?.(id);captures.add(id);}catch{}}
      stop(event);
    }
  };
  const move=event=>{if(!points.has(event.pointerId))return;const before=frame();points.set(event.pointerId,{x:event.clientX,y:event.clientY});if(active){onMove(before,frame());stop(event);}else if(blocked)stop(event);};
  const finish=event=>{if(!points.has(event.pointerId)||starting)return;const owned=active||blocked;points.delete(event.pointerId);if(active){active=false;blocked=points.size>0;}release(event.pointerId);if(owned)stop(event);if(!points.size)blocked=false;};
  const clear=()=>{const ids=[...points.keys()];points.clear();active=false;blocked=false;ids.forEach(release);};
  const click=event=>{if(suppressClick){suppressClick=false;stop(event);}};
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',finish],['pointercancel',finish],['lostpointercapture',finish],['click',click]];
  for(const [name,listener] of listeners)canvas.addEventListener(name,listener,true);
  const cleanup=()=>{clear();for(const [name,listener] of listeners)canvas.removeEventListener(name,listener,true);};cleanup.cancel=clear;return cleanup;
}
const calibrationTouchFrame=points=>{const a=points[0],b=points[1]||a;return{x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:points.length>1?Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)):1};};

function validateA4Corners(image,corners,placed){
  const missing=placed.findIndex(value=>!value);
  if(missing>=0)throw i18nError('Označte všechny čtyři rohy A4. Chybí roh {n}.',{n:missing+1});
  if(corners.length!==4||corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>=image.width||p.y>=image.height))throw i18nError('Rohy A4 musí být uvnitř fotografie.');
  for(let i=0;i<4;i++){
    const a=corners[i],b=corners[(i+1)%4],c=corners[(i+2)%4];
    if(Math.hypot(b.x-a.x,b.y-a.y)<4||(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)<=1)throw i18nError('Rohy A4 musí tvořit čtyřúhelník v pořadí 1–4 po obvodu. Nesmějí se křížit ani ležet na přímce.');
  }
}

const uid = () => globalThis.crypto?.randomUUID?.() || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function canvasFromImage(image) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context=canvas.getContext('2d'),pixels=context.createImageData(image.width,image.height);pixels.data.set(image.data);context.putImageData(pixels,0,0);return canvas;
}

/** Raster demonstration, processed exactly like a photo; no pre-made output contours. */
function samplePhoto() {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 900;
  const c = canvas.getContext('2d');
  c.fillStyle = '#747b72'; c.fillRect(0, 0, 1000, 900);
  for (let y = 0; y < 900; y += 90) { c.strokeStyle = '#6d746b'; c.beginPath(); c.moveTo(0, y); c.lineTo(1000, y); c.stroke(); }
  c.shadowColor = '#26301f66'; c.shadowBlur = 18; c.shadowOffsetY = 6;
  c.fillStyle = '#fcfcf9'; c.fillRect(240, 75, 500, 707); c.shadowColor = 'transparent';
  c.fillStyle = '#414b43'; c.beginPath();
  for (const [i,[x,y]] of [[335,170],[358,135],[382,132],[369,170],[394,187],[424,161],[423,191],[397,221],[384,222],[377,533]].entries()) i ? c.lineTo(x,y) : c.moveTo(x,y);
  c.bezierCurveTo(410,554,405,597,373,612); c.bezierCurveTo(330,630,298,589,319,553); c.lineTo(337,530); c.lineTo(346,218); c.lineTo(326,200); c.closePath(); c.fill();
  c.fillStyle='#fcfcf9'; c.beginPath(); c.arc(358,575,15,0,Math.PI*2); c.fill();
  c.fillStyle='#6c736b'; c.beginPath();
  for(const [i,[x,y]] of [[574,250],[587,250],[590,268],[587,454],[574,454],[571,268]].entries())i?c.lineTo(x,y):c.moveTo(x,y);
  c.closePath();c.fill();c.fillStyle='#b34e31';c.beginPath();c.moveTo(558,445);c.lineTo(603,445);c.lineTo(608,466);c.lineTo(605,586);c.bezierCurveTo(600,613,560,613,555,586);c.lineTo(552,466);c.closePath();c.fill();
  return c.getImageData(0,0,canvas.width,canvas.height);
}

function inside(point, polygon) {
  let on = false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)on=!on;
  }
  return on;
}

function info(contour,scale){
  const minX=Math.min(...contour.points.map(p=>p.x)), minY=Math.min(...contour.points.map(p=>p.y));
  const maxX=Math.max(...contour.points.map(p=>p.x)), maxY=Math.max(...contour.points.map(p=>p.y));
  return {minX,minY,width:(maxX-minX)/scale,height:(maxY-minY)/scale,center:{x:(minX+maxX)/2,y:(minY+maxY)/2}};
}

export function openCapture({onAdd,toast=()=>{},maxDepth=()=>MAX_DEPTH}){
  const contourHistory={past:[],future:[]};
  const clearContourHistory=()=>{contourHistory.past=[];contourHistory.future=[];};
  let selectionUI=null,selectionIndex=null,selectionToken=null;
  let closed=false,controller=null,observer=null,cancelCalibration=null,calibrationCleanup=null,photoRun=0,guide=null,guided=false,contourEditor=null,resultContext=null,resultMaskPixels=null,resultPhoto=null,resultPhotoMask=false,resultView=identityView(),resultViewCleanup=null,detailView=identityView(),detailViewCanvas=null,detailViewIndex=null,detailViewCleanup=null,detailEditorCleanup=null,detailPhotoView=identityView();
  const state={step:0,outlineMode:document.querySelector('meta[name="insertcreator-background-service"]')?.content==='local-computer'?'background':'auto',reference:'a4',mode:'portrait',image:null,imageCanvas:null,corners:[],cornerPlaced:[],paperMode:'portrait',ruler:[],rulerMm:100,rulerSecond:false,rulerSecondMm:100,rulerPointer:null,calibrationView:{zoom:1,x:0,y:0},referencePoints:[],activePoint:0,detected:false,busy:false,work:null,scale:1,result:null,items:[],activeItem:null,showMask:false,showCutout:false,backgroundCutout:null,pocketMargin:DEFAULT_POCKET_MARGIN,pocketMarginText:undefined,error:'',progress:null,message:'Načítám fotografii…'};
  if(!document.getElementById('capture-guide-styles')){
    const stylesheet=document.createElement('link');stylesheet.id='capture-guide-styles';stylesheet.rel='stylesheet';
    stylesheet.href=new URL('./capture-guide.css',import.meta.url).href;document.head.append(stylesheet);
  }
  // state.message, quality reasons and worker errors stay Czech source text; t()/errorText() translate them on display.
  const blurCalibration=()=>cancelCalibration?.();window.addEventListener('blur',blurCalibration);
  const modal=openModal({title:t('Vyfoťte. Obrys připravíme my.'),subtitle:t('Automatické obrysy s možností ručních úprav.'),wide:true,body:'',footer:'',onClose:()=>{closed=true;selectionToken=null;selectionUI?.destroy();selectionUI=null;contourEditor?.destroy();contourEditor=null;resultViewCleanup?.();detailViewCleanup?.();detailEditorCleanup?.();resultContext?.();guide?.destroy();controller?.abort();observer?.disconnect();cancelCalibration?.();calibrationCleanup?.();window.removeEventListener('blur',blurCalibration);}});
  const privacyText=()=>t(state.outlineMode==='background'?'Fotka se pro odstranění pozadí předá serveru této aplikace na vašem PC. Neposílá se Liftu ani jiné externí službě.':'Fotka se zpracuje ve vašem zařízení a nikam se neodesílá.');
  const steps=()=>`<div class="capture-steps"><span class="${state.step===0?'active':'done'}">1 · ${t('Fotografie')}</span><span class="${state.step===1||state.step===3?'active':state.step===2?'done':''}">2 · ${t('Automatické rozpoznání')}</span><span class="${state.step===2?'active':''}">3 · ${t('Hotový obrys')}</span></div>`;
  const errorHTML=()=>`<div id="capture-error" role="alert" class="form-error" ${state.error?'':'hidden'}>${esc(state.error)}</div>`;
  const depthLimit=()=>Math.max(MIN_DEPTH,Math.min(MAX_DEPTH,maxDepth()));
  function setError(text){state.error=text;const el=modal.body.querySelector('#capture-error');if(el){el.textContent=text;el.hidden=!text;}}
  function reset(){clearContourHistory();photoRun++;controller?.abort();controller=null;cancelCalibration?.();calibrationCleanup?.();calibrationCleanup=null;cancelCalibration=null;state.step=0;state.error='';state.pocketMargin=DEFAULT_POCKET_MARGIN;state.pocketMarginText=undefined;state.busy=false;state.image=null;state.imageCanvas=null;state.work=null;state.backgroundCutout=null;state.showCutout=false;state.processingFailure=null;state.rejectedContours=[];state.pendingRevealed=false;state.items=[];state.activeItem=null;state.result=null;render();}
  function progress(event){
    if(closed)return;
    // Parallel recognisers report unrelated stage fractions. There is no shared
    // denominator, so explain the current work without claiming a total percent.
    const value=event.progress;
    state.progress=event.stage==='matting'&&Number.isInteger(event.completed)&&Number.isInteger(event.total)&&event.total>0?{value:event.completed,max:event.total}:null;
    if(event.message)state.message=value>=1?'Dokončuji rozpoznávání a ověřuji rozměry…':event.message;
    updateLoading(modal.body,{message:t(state.message),progress:state.progress});
  }
  function photoLoading(message='Otevírám fotografii a kontroluji její rozlišení…'){
    state.busy=true;
    const zone=modal.body.querySelector('.upload-zone');
    if(zone){
      zone.setAttribute('data-loading-busy','true');zone.removeAttribute('role');zone.removeAttribute('tabindex');
      zone.innerHTML=loadingMarkup({title:t('Připravuji fotografii'),message:t(message),detail:privacyText()});
    }
    modal.body.querySelectorAll('#sample-scan,#photo-reference').forEach(element=>element.disabled=true);
  }
  async function loadFile(file){
    if(!file||state.busy)return;
    setError('');
    if(file.size>20*1024*1024)return setError(t('Fotografie je větší než 20 MB. Vyberte menší soubor.'));
    const heic=/\.(heic|heif)$/i.test(file.name)||/^image\/hei[cf](?:-sequence)?(?:;|$)/i.test(file.type);
    if(!/^image\//i.test(file.type)&&!/\.(jpe?g|png|webp|avif|bmp|heic|heif)$/i.test(file.name))return setError(t('Vyberte fotografii z telefonu nebo soubor JPG, PNG či WebP.'));
    const run=++photoRun,current=()=>!closed&&photoRun===run;
    photoLoading();let bitmap,url;
    try{
      await frame();await frame();if(!current())return;
      // The system image decoder may support HEIC even when ImageBitmap does not
      // (notably phone browsers), so try both native paths before asking for JPG.
      try{
        try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}
        catch{if(!current())return;url=URL.createObjectURL(file);bitmap=new Image();bitmap.src=url;await bitmap.decode();}
      }catch{
        throw i18nError(heic?'Tento prohlížeč nedokáže otevřít HEIC. V telefonu fotku nasdílejte nebo uložte jako JPG a vyberte ji znovu.':'Fotografii se nepodařilo otevřít. Zkuste jinou fotku nebo soubor JPG, PNG či WebP.');
      }
      if(!current())return;
      const w=bitmap.width||bitmap.naturalWidth,h=bitmap.height||bitmap.naturalHeight;
      if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw i18nError('Fotografie nemá platné rozlišení. Zkuste jinou fotku.');
      if(w<100||h<100)throw i18nError('Fotografie je příliš malá. Vyfoťte nástroj znovu blíž a ostřeji.');
      if(w*h>MAX_BACKGROUND_PIXELS)throw i18nError('Fotografie přesahuje 64 megapixelů. Vyberte menší oblast; rozlišení se automaticky nesnižuje.');
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      if(canvas.width<16||canvas.height<16)throw i18nError('Fotografie má příliš úzký výřez. Vyfoťte celý papír a nástroje.');
      const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw i18nError('Zařízení nedokáže otevřít tuto fotografii v plném rozlišení. Použijte počítač nebo menší výřez.');ctx.drawImage(bitmap,0,0);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      canvas.width=1;canvas.height=1; // Release only the temporary decode surface, never resize source pixels.
      // Release the full camera bitmap before recognition allocates its working data.
      bitmap?.close?.();bitmap=null;if(url){URL.revokeObjectURL(url);url=null;}
      updateLoading(modal.body,{message:t('Hledám měřítko a připravuji nástroje k rozpoznání…')});
      await frame();if(!current())return;
      await beginPhoto(pixels);
    }catch(error){if(current()&&error.name!=='AbortError'){state.busy=false;setError(errorText(error)||t('Fotografii se nepodařilo otevřít.'));toast(t('Fotografii se nepodařilo zpracovat.'));}}
    finally{bitmap?.close?.();if(url)URL.revokeObjectURL(url);if(current()){state.busy=false;if(state.step===0)render();}}
  }
  async function beginPhoto(image){
    clearContourHistory();
    state.pocketMargin=DEFAULT_POCKET_MARGIN;state.pocketMarginText=undefined;
    state.image=image;state.imageCanvas=canvasFromImage(image);state.calibrationView={zoom:1,x:0,y:0};state.error='';state.items=[];state.result=null;
    const corners=detectPaper(image);state.detected=!!corners;state.cornerPlaced=Array(4).fill(!!corners);
    state.corners=corners||[{x:image.width*.1,y:image.height*.1},{x:image.width*.9,y:image.height*.1},{x:image.width*.9,y:image.height*.9},{x:image.width*.1,y:image.height*.9}];
    state.ruler=[{x:image.width*.3,y:image.height*.65},{x:image.width*.7,y:image.height*.65},{x:image.width*.8,y:image.height*.3},{x:image.width*.8,y:image.height*.7}];state.activePoint=0;state.rulerPointer=null;
    state.paperMode='portrait';state.mode=['ruler','tool'].includes(state.reference)?'ruler':'portrait';
    if(!['ruler','tool'].includes(state.reference)&&corners){
      const width=(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y)+Math.hypot(corners[2].x-corners[3].x,corners[2].y-corners[3].y))/2;
      const height=(Math.hypot(corners[3].x-corners[0].x,corners[3].y-corners[0].y)+Math.hypot(corners[2].x-corners[1].x,corners[2].y-corners[1].y))/2;
      state.mode=width>height?'landscape':'portrait';state.paperMode=state.mode;
      if(state.reference==='a4')await processPhoto();else{state.step=1;state.busy=false;render();}
    }else{state.step=1;state.busy=false;render();}
  }
  async function processPhoto(){
    if(state.mode!=='ruler'){try{validateA4Corners(state.image,state.corners,state.cornerPlaced);}catch(error){state.busy=false;state.step=1;state.error=errorText(error);render();return;}}
    clearContourHistory();state.items=[];state.result=null;state.work=null;state.referencePoints=[];state.backgroundCutout=null;state.showCutout=false;state.processingFailure=null;state.rejectedContours=[];state.pendingRevealed=false;state.error='';
    controller?.abort();const run=new AbortController();controller=run;
    const current=()=>!closed&&!run.signal.aborted&&controller===run;
    state.busy=true;state.step=3;state.activeItem=null;state.progress=null;state.message='Narovnávám papír a určuju skutečné rozměry…';render();
    try{
      await frame();await frame();if(!current())return;
      if(state.mode==='ruler'){
        if(state.rulerSecond){const calibrated=rectifyRulersNative(state.image,state.ruler,[state.rulerMm,state.rulerSecondMm]);state.work=calibrated.imageData;state.scale=calibrated.pxPerMm;state.referencePoints=calibrated.points;}
        else{state.scale=calibrateSegment(state.ruler[0],state.ruler[1],state.rulerMm);state.work=state.image;state.referencePoints=state.ruler.slice(0,2);}
      }
      else{const r=rectifyImageNative(state.image,state.corners,state.mode==='portrait'?210:297,state.mode==='portrait'?297:210);state.work=r.imageData;state.scale=r.pxPerMm;}
      if(state.outlineMode==='manual'){
        state.result={contours:[],mask:new Uint8Array(state.work.width*state.work.height),quality:{status:'review',reasons:[]}};state.busy=false;state.step=4;selectionIndex=null;render();return;
      }
      let recognitionImage=state.work,background=null;
      const embeddedAlpha=traceAlphaPhoto(state.work,{signal:run.signal});
      if(state.outlineMode==='background'&&!embeddedAlpha){
        // NN always receives the full, unrectified source at its decoded size.
        background=await removePhotoBackground(state.image,{signal:run.signal,onProgress:event=>{if(current())progress(event);}});
        if(!current())return;
        if(state.mode!=='ruler'){
          const r=rectifyImageNative(background.image,state.corners,state.mode==='portrait'?210:297,state.mode==='portrait'?297:210);
          if(r.imageData.width!==state.work.width||r.imageData.height!==state.work.height||r.pxPerMm!==state.scale)throw new Error('Maska a kalibrace nemají stejné souřadnice.');
          background={...background,image:r.imageData};
        }else if(state.rulerSecond){
          const r=rectifyRulersNative(background.image,state.ruler,[state.rulerMm,state.rulerSecondMm]);
          if(r.imageData.width!==state.work.width||r.imageData.height!==state.work.height||r.pxPerMm!==state.scale)throw new Error('Maska a kalibrace nemají stejné souřadnice.');
          background={...background,image:r.imageData};
        }
        recognitionImage=background.image;state.showCutout=true;state.backgroundCutout=background.image;
      }
      // A verified server alpha remains authoritative even when entirely opaque;
      // it must never silently start the legacy downsampled browser NN.
      const result=background?traceAlphaPhoto(recognitionImage,{force:true,source:state.work,signal:run.signal}):embeddedAlpha||await recognizeTools(recognitionImage,{pxPerMm:state.scale,kind:state.mode==='ruler'?'reference':'paper',signal:run.signal,onProgress:event=>{if(current())progress(event);}});
      if(!current())return;state.result=result;
      if(background){state.showCutout=true;state.backgroundCutout=background.image;state.result.backgroundRemoval={model:background.model,execution:background.execution,elapsedMs:background.elapsedMs};state.result.engine='background-server';state.result.neuralModel=background.model;state.result.neuralDisabled=false;}
      else if(result.engine==='alpha'){state.showCutout=true;state.backgroundCutout=state.work;}
      state.items=[];
      state.result.contours.forEach((contour,i)=>{
        try{
          const isReference=state.mode==='ruler'&&state.reference!=='tool'&&[0,2].some(j=>state.referencePoints[j]&&state.referencePoints.slice(j,j+2).every(p=>inside(p,contour.points)));
          const item={contour,info:info(contour,state.scale),pocketShape:lastPocketShape,isReference,checked:!isReference,name:t('Nástroj {n}',{n:i+1})};
          state.items.push(prepareCaptureFit(item,state.scale,{pocketMargin:state.pocketMargin}));
        }catch(error){state.rejectedContours.push({contour,index:i,reason:errorText(error)});}
      });
      if(state.rejectedContours.length||state.items.some(item=>item.pocketFitIssue)){
        state.result.requiresReview=true;
        state.result.quality={...state.result.quality,status:'review',reasons:[...(state.result.quality?.reasons||[]),'Některé kapsy se nepodařilo připravit. Označené obrysy zkontrolujte nebo znovu vyberte.']};
        if(state.rejectedContours.length)state.error=t('{n} obrysů nelze bezpečně převést na kapsu. Ostatní nástroje můžete použít.',{n:state.rejectedContours.length});
        if(!state.items.length)state.processingFailure={phase:'pockets',reason:state.rejectedContours[0]?.reason||''};
      }
      state.step=2;state.busy=false;state.showMask=false;render();
    }catch(error){
      if(!current()||error.name==='AbortError')return;
      state.busy=false;state.step=2;state.processingFailure={phase:state.backgroundCutout?'contours':'recognition',reason:errorText(error)};state.result=state.result?{...state.result,requiresReview:true,quality:{...state.result.quality,status:state.items.length?'review':'retake',reasons:[]}}:{contours:[],mask:new Uint8Array(state.work?.width*state.work?.height||0),quality:{status:'retake',reasons:[]}};state.error=errorText(error);render();
    }
  }
  function renderUpload(){
    modal.body.innerHTML=steps()+`<label class="field" style="max-width:340px"><span>${t('Měřítko na fotografii')}</span><select id="photo-reference"><option value="a4">${t('A4 papír · měřítko najdeme automaticky')}</option><option value="a4-manual">${t('A4 papír · rohy určím ručně')}</option><option value="ruler">${t('Pravítko · označím dvě známé značky')}</option><option value="tool">${t('Známý rozměr nástroje · i fotka z internetu')}</option></select></label><label class="field" style="max-width:340px"><span>${t('Výběr nástrojů')}</span><select id="photo-outline-mode"><option value="auto">${t('Automatický návrh a opravy výběrem')}</option><option value="background">${t('Nejdřív odstranit pozadí a stíny')}</option><option value="manual">${t('Vyberu nástroj přímo ve fotce')}</option></select></label><div class="upload-zone" tabindex="0" role="button" aria-label="${esc(t('Vybrat nebo přetáhnout fotografii'))}"><div class="upload-symbol">${icon('camera')}</div><strong>${t('Vyfoťte nástroj nebo vyberte existující fotku.')}</strong><p>${t('Použijte vlastní fotografii nebo obrázek z internetu. Pro skutečné milimetry označte známý rozměr; čelní snímek shora dává nejpřesnější tvar.')}</p><div class="upload-buttons"><button class="btn btn-primary" id="camera-pick">${icon('camera')}${t('Vyfotit')}</button><button class="btn btn-light" id="gallery-pick">${icon('upload')}${t('Vybrat fotku')}</button></div><small style="color:#92a086;margin-top:15px;font-size:10px">${t('Fotky z telefonu, JPG, PNG, WebP · nejvýše 20 MB')}</small><p data-photo-privacy style="margin:10px 0 0;font-size:12px;line-height:1.5">${(state.outlineMode==='background'?privacyText():t('Aplikace dostane jen fotku, kterou teď vyberete. Nevidí vaši galerii ani kameru, nečte z fotky polohu a nikam ji neodesílá.'))}</p></div><input type="file" accept="image/*,.heic,.heif" capture="environment" id="camera-file" hidden><input type="file" accept="image/*,.heic,.heif" id="gallery-file" hidden>${errorHTML()}<div class="capture-note"><div><b>${t('Automatické měřítko')}</b>${t('Najdeme rohy A4 a narovnáme perspektivu.')}</div><div><b>${t('Každý nástroj zvlášť')}</b>${t('Rozpoznáme oddělené nástroje, potlačíme stín a vyčistíme hrany.')}</div><div><b>${t('Rovnou do šuplíku')}</b>${t('Návrh lze opravit tahy Přidat/Ubrat nebo body na hraně.')}</div></div><button class="sample-button" id="sample-scan">${t('Vyzkoušet na ukázkové fotografii')}</button>`;
    modal.footer.innerHTML=`<span class="footnote">${privacyText()}</span><button class="btn btn-light" id="capture-cancel">${t('Zavřít')}</button>`;
    const outlineMode=modal.body.querySelector('#photo-outline-mode');outlineMode.value=state.outlineMode;outlineMode.onchange=()=>{state.outlineMode=outlineMode.value;const privacy=modal.body.querySelector('[data-photo-privacy]');if(privacy)privacy.textContent=state.outlineMode==='background'?privacyText():t('Aplikace dostane jen fotku, kterou teď vyberete. Nevidí vaši galerii ani kameru, nečte z fotky polohu a nikam ji neodesílá.');const foot=modal.footer.querySelector('.footnote');if(foot)foot.textContent=privacyText();};
    const reference=modal.body.querySelector('#photo-reference');reference.value=state.reference;reference.onchange=()=>state.reference=reference.value;
    const pick=selector=>{if(!state.busy)modal.body.querySelector(selector).click();};
    const zone=modal.body.querySelector('.upload-zone');zone.onclick=()=>pick('#gallery-file');zone.onkeydown=e=>{if(e.target===zone&&['Enter',' '].includes(e.key)){e.preventDefault();pick('#gallery-file');}};
    modal.body.querySelector('#camera-pick').onclick=e=>{e.stopPropagation();pick('#camera-file');};modal.body.querySelector('#gallery-pick').onclick=e=>{e.stopPropagation();pick('#gallery-file');};
    for(const el of modal.body.querySelectorAll('input[type=file]'))el.onchange=()=>loadFile(el.files[0]);
    zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragover');};zone.ondragleave=()=>zone.classList.remove('dragover');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragover');loadFile(e.dataTransfer.files[0]);};
    modal.body.querySelector('#sample-scan').onclick=async()=>{if(state.busy)return;const run=++photoRun;photoLoading('Hledám měřítko a připravuji nástroje k rozpoznání…');await frame();await frame();if(!closed&&photoRun===run)await beginPhoto(samplePhoto());};
    modal.footer.querySelector('#capture-cancel').onclick=modal.close;
  }
  function renderProcessing(){
    modal.body.innerHTML=steps()+`<div class="capture-grid"><div class="capture-canvas"><canvas id="processing-canvas" aria-label="${esc(t('Zpracovávaná fotografie'))}"></canvas><div class="auto-photo-sweep" aria-hidden="true"></div></div><div class="capture-sidebar auto-sidebar">${loadingMarkup({title:t('Automatické rozpoznávání'),message:t(state.message),detail:state.outlineMode==='background'?t('Původní rozlišení {width} × {height} px. Celá fotografie se zpracuje po částech bez zmenšení.',{width:state.image.width,height:state.image.height}):t('Hledám předměty, odděluji je od pozadí a zpřesňuji hrany. Kontrast ani body nemusíte nastavovat.'),progress:state.progress,hooks:{message:{id:'auto-progress-message'},progress:{id:'auto-progress-bar'}}})}<p class="muted-note">${t('Automatický návrh můžete opravit přímo na fotografii. Vlastní výběr funguje i bez neuronové sítě.')}</p></div></div>`;
    modal.footer.innerHTML=`<span class="footnote">${privacyText()}</span><button class="btn btn-light" id="cancel-processing">${t('Zrušit')}</button>`;
    const canvas=modal.body.querySelector('#processing-canvas'),displayScale=Math.min(1,1400/Math.max(state.image.width,state.image.height));canvas.width=Math.round(state.image.width*displayScale);canvas.height=Math.round(state.image.height*displayScale);canvas.getContext('2d').drawImage(state.imageCanvas,0,0,canvas.width,canvas.height); // Display only; NN receives state.image without resampling.
    modal.footer.querySelector('#cancel-processing').onclick=reset;
  }
  function renderCalibration(){
    const paper=state.mode!=='ruler',points=paper?state.corners:state.ruler,count=paper?4:state.rulerSecond?4:2;
    const cornerLabels=['1 · Levý horní roh','2 · Pravý horní roh','3 · Pravý dolní roh','4 · Levý dolní roh'];
    state.activePoint=Math.min(state.activePoint,count-1);
    modal.body.innerHTML=steps()+`<div class="capture-grid"><div class="calibration-preview"><div class="capture-canvas"><canvas id="calibration-canvas" tabindex="0" role="img" aria-label="${esc(t('Měřítko: vyberte bod tlačítkem nebo klávesou 1 až 4 a umístěte jej na značku. Šipky bod posunou, Shift zpřesnění zrychlí.'))}" aria-describedby="calibration-view-hint"></canvas></div><div class="calibration-toolbar" role="group" aria-label="${esc(t('Pohled na fotografii'))}"><button class="icon-btn" type="button" data-calibration-view="zoom-out" aria-label="${esc(t('Oddálit'))}">${icon('zoomOut')}</button><output data-calibration-zoom>100 %</output><button class="icon-btn" type="button" data-calibration-view="zoom-in" aria-label="${esc(t('Přiblížit'))}">${icon('zoomIn')}</button><button class="btn btn-light" type="button" data-calibration-view="fit">${icon('fit')}${t('Zobrazit vše')}</button></div><p class="calibration-view-hint" id="calibration-view-hint">${t('Kolečko: přiblížit · Pravé nebo prostřední tlačítko: posunout · Mezerník + tažení: posunout')}</p></div><div class="capture-sidebar"><h3>${t(paper?'Určete rohy A4.':state.reference==='tool'?'Označte známý rozměr nástroje.':'Jen měřítko. Obrys uděláme sami.')}</h3><p>${t(paper?(state.detected?'Rohy A4 můžete upřesnit. Fotografie a její původní rozlišení zůstávají zachované.':'Měřítko jsme nenašli automaticky. Postupně označte čtyři rohy papíru A4 přímo na fotografii.'):state.reference==='tool'?'Body 1 a 2 dejte na konce části, jejíž skutečnou délku znáte. Údaj zadejte ve zvolených jednotkách. Označení velikosti klíče není jeho celková délka. Bez známého rozměru nelze určit skutečné milimetry.':'Přesuňte body 1 a 2 na dvě značky pravítka. Čím dál jsou od sebe, tím lépe. Nástroj vyfoťte kolmo k podkladu.')}</p><p class="muted-note">${t(paper?'Vyberte roh tlačítkem nebo klávesou 1–4. Klikněte na roh a případně ho přetáhněte. Šipky posouvají o pixel, Shift o deset; Enter roh potvrdí.':'Vyberte bod a klikněte přesně na značku. Prázdný střed kříže nechává značku viditelnou; šipky posouvají bod po pixelu, Shift po deseti.')}</p><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px" role="group" aria-label="${esc(t(paper?'Rohy papíru A4':'Kalibrační body'))}">${Array.from({length:count},(_,i)=>`<button class="btn btn-light" style="min-height:44px" type="button" data-calibration-point="${i}" ${paper?`data-a4-point="${i}"`:`data-ruler-point="${i}"`} aria-pressed="${state.activePoint===i}">${paper?t(cornerLabels[i]):t('Bod {n}',{n:i+1})}</button>`).join('')}</div>${paper?`<p id="a4-corner-status" class="muted-note" aria-live="polite"></p><label class="field"><span>${t('Orientace papíru A4')}</span><select id="a4-orientation"><option value="portrait" ${state.mode==='portrait'?'selected':''}>${t('Na výšku · 210 × 297 mm')}</option><option value="landscape" ${state.mode==='landscape'?'selected':''}>${t('Na šířku · 297 × 210 mm')}</option></select></label><button class="btn btn-light" id="use-ruler" type="button" style="min-height:44px">${t('Místo A4 použít pravítko')}</button>`:`<label class="field"><span>${t('Skutečná vzdálenost mezi značkami')}</span><div class="input-wrap"><input id="ruler-distance" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${Number.isFinite(state.rulerMm)?inputValue(state.rulerMm):''}"><em>${unit()}</em></div></label><label class="check-row" style="margin:16px 0"><input id="ruler-second" type="checkbox" ${state.rulerSecond?'checked':''}>${t('Druhé kolmé pravítko (volitelné)')}</label>${state.rulerSecond?`<label class="field"><span>${t('Vzdálenost mezi body 3 a 4')}</span><div class="input-wrap"><input id="ruler-second-distance" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${Number.isFinite(state.rulerSecondMm)?inputValue(state.rulerSecondMm):''}"><em>${unit()}</em></div></label><p class="muted-note">${t('Body 3 a 4 označují druhý známý úsek, který je na stejném podkladu fyzicky kolmý k prvnímu. Obě pravítka opraví rozdílné měřítko délky a šířky i zešikmení; plnou perspektivu nenahrazují. Pro silnou perspektivu použijte A4 nebo novou fotku shora.')}</p>`:''}<button class="btn btn-light" id="use-a4" type="button" style="min-height:44px">${t('Místo pravítka určit rohy A4')}</button>`}${errorHTML()}</div></div>`;
    modal.footer.innerHTML=`<button class="btn btn-light" id="capture-back">${t('Jiná fotka')}</button><span class="footnote">${t(paper?'Rohy určují pouze měřítko. Obrysy nástrojů rozpoznáme automaticky.':'Pravítko slouží jen jako měřítko, konturu načteme automaticky.')}</span><button class="btn btn-primary" id="capture-continue">${t('Rozpoznat automaticky')} →</button>`;
    if(paper)modal.body.querySelector('#calibration-view-hint').textContent+=' · '+t('Dva prsty přibližují a posouvají fotografii. Jedním prstem nastavíte roh.');
    const distanceInput=modal.body.querySelector('#ruler-distance');if(distanceInput)distanceInput.oninput=e=>{state.rulerMm=parseLength(e.target.value);setError('');}; // any unit: "100", "4 in", "10 cm"
    modal.body.querySelector('#ruler-second-distance')?.addEventListener('input',e=>{state.rulerSecondMm=parseLength(e.target.value);setError('');});
    const secondInput=modal.body.querySelector('#ruler-second');if(secondInput)secondInput.onchange=e=>{state.rulerSecond=e.target.checked;state.activePoint=state.rulerSecond?2:0;state.rulerPointer=null;setError('');render();modal.body.querySelector('#calibration-canvas').focus();};
    modal.body.querySelector('#a4-orientation')?.addEventListener('change',event=>{state.mode=event.target.value;state.paperMode=state.mode;setError('');});
    modal.body.querySelector('#use-ruler')?.addEventListener('click',()=>{state.paperMode=state.mode;state.mode='ruler';state.activePoint=0;setError('');render();});
    modal.body.querySelector('#use-a4')?.addEventListener('click',()=>{state.mode=state.paperMode;state.activePoint=Math.max(0,state.cornerPlaced.findIndex(value=>!value));setError('');render();});
    const confirmCorner=index=>{state.cornerPlaced[index]=true;const next=state.cornerPlaced.findIndex(value=>!value);if(next>=0)state.activePoint=next;};
    const canvas=modal.body.querySelector('#calibration-canvas');canvas.width=state.image.width;canvas.height=state.image.height;canvas.style.cursor='crosshair';canvas.style.touchAction='none';let dragging=null,spaceDown=false;
    modal.body.querySelectorAll('[data-calibration-view],#a4-orientation').forEach(element=>{element.style.minHeight='44px';element.style.minWidth='44px';});
    // View coordinates are raster pixels; the measurement points always stay in the original photo.
    const local=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/(r.width||canvas.width),y:(e.clientY-r.top)*canvas.height/(r.height||canvas.height)};};
    const pos=e=>{const p=local(e),v=state.calibrationView;return{x:Math.max(0,Math.min(canvas.width-1,(p.x-v.x)/v.zoom)),y:Math.max(0,Math.min(canvas.height-1,(p.y-v.y)/v.zoom))};};
    const cursor=()=>canvas.style.cursor=dragging?.kind==='pan'?'grabbing':spaceDown?'grab':'crosshair';
    const finish=(cancel=false)=>{if(!dragging)return;const previous=dragging;dragging=null;if(cancel){if(previous.kind==='pan')state.calibrationView=previous.before;else{points[previous.index]=previous.before;if(paper)state.cornerPlaced[previous.index]=previous.beforePlaced;}}else if(paper&&previous.kind==='point'){state.cornerPlaced[previous.index]=true;if(!previous.beforePlaced)confirmCorner(previous.index);}if(!canvas.hasPointerCapture||canvas.hasPointerCapture(previous.id))canvas.releasePointerCapture?.(previous.id);cursor();drawCalibration();};
    const zoomAt=(factor,anchor={x:canvas.width/2,y:canvas.height/2})=>{if(dragging)return;const v=state.calibrationView,zoom=Math.max(1,Math.min(12,v.zoom*factor));state.calibrationView={zoom,x:anchor.x-(anchor.x-v.x)*zoom/v.zoom,y:anchor.y-(anchor.y-v.y)*zoom/v.zoom};constrainCalibrationView();state.rulerPointer=null;drawCalibration();};
    canvas.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?(canvas.getBoundingClientRect().height||canvas.height):1);if(Number.isFinite(delta))zoomAt(Math.exp(-Math.max(-240,Math.min(240,delta))*.0025),local(e));},{passive:false});
    canvas.oncontextmenu=e=>e.preventDefault();
    modal.body.querySelectorAll('[data-calibration-view]').forEach(button=>button.onclick=()=>{finish(true);if(button.dataset.calibrationView==='fit'){state.calibrationView={zoom:1,x:0,y:0};state.rulerPointer=null;drawCalibration();}else zoomAt(button.dataset.calibrationView==='zoom-in'?1.25:1/1.25);});
    const selectPoint=index=>{finish(true);state.activePoint=index;state.rulerPointer=null;canvas.focus();drawCalibration();};
    modal.body.querySelectorAll('[data-calibration-point]').forEach(button=>button.onclick=()=>selectPoint(Number(button.dataset.calibrationPoint)));
    canvas.onpointerdown=e=>{if(!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;if(![0,1,2].includes(e.button)||e.isPrimary===false||dragging)return;e.preventDefault();canvas.focus();if(e.button!==0||spaceDown){dragging={kind:'pan',id:e.pointerId,button:e.button,origin:local(e),before:{...state.calibrationView}};state.rulerPointer=null;cursor();canvas.setPointerCapture?.(e.pointerId);drawCalibration();return;}const p=pos(e),scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.width)/state.calibrationView.zoom;let nearest=state.activePoint,distance=(e.pointerType==='touch'?22:20)*scale;for(let i=0;i<count;i++){const d=Math.hypot(p.x-points[i].x,p.y-points[i].y);if(d<distance){nearest=i;distance=d;}}state.activePoint=nearest;dragging={kind:'point',id:e.pointerId,button:0,index:nearest,before:{...points[nearest]},beforePlaced:paper?state.cornerPlaced[nearest]:undefined};points[nearest]=p;state.rulerPointer=p;canvas.setPointerCapture?.(e.pointerId);setError('');drawCalibration();};
    canvas.onpointermove=e=>{if(dragging&&e.pointerId!==dragging.id)return;const mask=dragging?.button===2?2:dragging?.button===1?4:1;if(dragging&&!(e.buttons&mask)){state.rulerPointer=null;finish(true);return;}if(!dragging&&e.isPrimary===false)return;if(dragging?.kind==='pan'){const p=local(e);state.calibrationView={...dragging.before,x:dragging.before.x+p.x-dragging.origin.x,y:dragging.before.y+p.y-dragging.origin.y};constrainCalibrationView();}else{const p=pos(e);state.rulerPointer=p;if(dragging)points[dragging.index]=p;}drawCalibration();};
    canvas.onpointerup=e=>{if(dragging&&e.pointerId===dragging.id&&e.button===dragging.button)finish();};
    canvas.onpointercancel=e=>{if(dragging&&e.pointerId===dragging.id){state.rulerPointer=null;finish(true);}};
    canvas.onlostpointercapture=e=>{if(dragging&&e.pointerId===dragging.id){state.rulerPointer=null;finish(true);}};
    canvas.onpointerleave=()=>{if(!dragging){state.rulerPointer=null;drawCalibration();}};
    const touchCleanup=bindCalibrationTouchNavigation(canvas,{
      onStart:()=>{finish(true);state.rulerPointer=null;},
      onMove:(before,after)=>{
        const a=calibrationTouchFrame(before),b=calibrationTouchFrame(after),anchor=local({clientX:a.x,clientY:a.y}),nextAnchor=local({clientX:b.x,clientY:b.y});
        const view=zoomViewAt(state.calibrationView,b.distance/a.distance,anchor,canvas.width,canvas.height);
        state.calibrationView=clampView({...view,x:view.x+nextAnchor.x-anchor.x,y:view.y+nextAnchor.y-anchor.y},canvas.width,canvas.height);drawCalibration();
      }
    });
    canvas.onblur=()=>{spaceDown=false;state.rulerPointer=null;finish(true);touchCleanup.cancel();cursor();drawCalibration();};
    cancelCalibration=canvas.onblur;calibrationCleanup=touchCleanup;
    canvas.onkeydown=e=>{if(e.code==='Space'||e.key===' '){e.preventDefault();spaceDown=true;cursor();}else if(/^[1-4]$/.test(e.key)&&Number(e.key)<=count){e.preventDefault();selectPoint(Number(e.key)-1);}else if(['+','=','-','0'].includes(e.key)){e.preventDefault();finish(true);if(e.key==='0')modal.body.querySelector('[data-calibration-view="fit"]').click();else zoomAt(e.key==='-'?1/1.25:1.25);}else if(e.key==='Enter'&&paper){e.preventDefault();finish(true);confirmCorner(state.activePoint);setError('');drawCalibration();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();finish(true);state.rulerPointer=null;const p=points[state.activePoint],d=e.shiftKey?10:1;p.x=Math.max(0,Math.min(canvas.width-1,p.x+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0)));p.y=Math.max(0,Math.min(canvas.height-1,p.y+(e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0)));if(paper)state.cornerPlaced[state.activePoint]=true;setError('');drawCalibration();}else if(e.key==='Escape'&&dragging){e.preventDefault();e.stopPropagation();state.rulerPointer=null;finish(true);}};
    canvas.onkeyup=e=>{if(e.code==='Space'||e.key===' '){e.preventDefault();spaceDown=false;cursor();}};
    modal.footer.querySelector('#capture-back').onclick=reset;
    modal.footer.querySelector('#capture-continue').onclick=()=>{finish(true);try{if(paper){validateA4Corners(state.image,state.corners,state.cornerPlaced);}else{if(!(state.rulerMm>=1&&state.rulerMm<=5000)||state.rulerSecond&&!(state.rulerSecondMm>=1&&state.rulerSecondMm<=5000))throw i18nError('Zadejte skutečnou vzdálenost mezi značkami od {min} do {max}.',{min:fmtLen(1),max:fmtLen(5000)});if(state.rulerSecond)calibrateRulers(state.image,state.ruler,[state.rulerMm,state.rulerSecondMm]);else calibrateSegment(state.ruler[0],state.ruler[1],state.rulerMm);}processPhoto();}catch(error){setError(errorText(error));}};
    drawCalibration();
  }
  function constrainCalibrationView(){
    const v=state.calibrationView;v.x=Math.max(state.image.width*(1-v.zoom),Math.min(0,v.x));v.y=Math.max(state.image.height*(1-v.zoom),Math.min(0,v.y));
  }
  function drawCalibration(){
    const canvas=modal.body.querySelector('#calibration-canvas');if(!canvas)return;const c=canvas.getContext('2d'),scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.clientWidth||550),paper=state.mode!=='ruler',count=paper?4:state.rulerSecond?4:2;
    const v=state.calibrationView,project=p=>({x:p.x*v.zoom+v.x,y:p.y*v.zoom+v.y}),points=(paper?state.corners:state.ruler).slice(0,count).map(project);
    c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(state.imageCanvas,v.x,v.y,canvas.width*v.zoom,canvas.height*v.zoom);
    if(paper){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.strokeStyle='#fff';c.lineWidth=4*scale;c.stroke();c.strokeStyle='#577b67';c.lineWidth=2*scale;c.stroke();}
    else for(let j=0;j<count;j+=2){const a=points[j],b=points[j+1],length=Math.hypot(b.x-a.x,b.y-a.y),gap=Math.min(8*scale,length/3),dx=(b.x-a.x)/(length||1),dy=(b.y-a.y)/(length||1);c.beginPath();c.moveTo(a.x+dx*gap,a.y+dy*gap);c.lineTo(b.x-dx*gap,b.y-dy*gap);c.strokeStyle='#fff';c.lineWidth=3*scale;c.stroke();c.strokeStyle=j?'#237ca0':'#8c620a';c.lineWidth=1.25*scale;c.stroke();}
    const cross=(p,active=false)=>{const arm=(active?21:12)*scale,gap=3*scale;c.beginPath();c.moveTo(p.x-arm,p.y);c.lineTo(p.x-gap,p.y);c.moveTo(p.x+gap,p.y);c.lineTo(p.x+arm,p.y);c.moveTo(p.x,p.y-arm);c.lineTo(p.x,p.y-gap);c.moveTo(p.x,p.y+gap);c.lineTo(p.x,p.y+arm);c.strokeStyle='#fff';c.lineWidth=3*scale;c.stroke();c.strokeStyle=active?'#111':'#5b4a2e';c.lineWidth=1.2*scale;c.stroke();};
    points.forEach((p,i)=>{cross(p,i===state.activePoint);if(p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height)return;const lx=Math.max(11*scale,Math.min(canvas.width-11*scale,p.x+18*scale)),ly=Math.max(11*scale,Math.min(canvas.height-11*scale,p.y-18*scale));c.fillStyle=i===state.activePoint?'#efb649':'#fff';c.fillRect(lx-8*scale,ly-8*scale,16*scale,16*scale);c.strokeStyle='#473b25';c.lineWidth=scale;c.strokeRect(lx-8*scale,ly-8*scale,16*scale,16*scale);c.fillStyle='#30291c';c.font=`bold ${11*scale}px system-ui`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(i+1),lx,ly);});
    if(state.rulerPointer)cross(project(state.rulerPointer),true);
    const zoom=modal.body.querySelector('[data-calibration-zoom]');if(zoom)zoom.textContent=`${Math.round(v.zoom*100)} %`;
    const zoomOut=modal.body.querySelector('[data-calibration-view="zoom-out"]'),zoomIn=modal.body.querySelector('[data-calibration-view="zoom-in"]');
    if(zoomOut)zoomOut.disabled=v.zoom<=1;if(zoomIn)zoomIn.disabled=v.zoom>=12;
    modal.body.querySelectorAll('[data-calibration-point]').forEach(button=>{const index=Number(button.dataset.calibrationPoint),active=index===state.activePoint;if(paper){button.textContent=t(['1 · Levý horní roh','2 · Pravý horní roh','3 · Pravý dolní roh','4 · Levý dolní roh'][index])+(state.cornerPlaced[index]?' ✓':'');button.dataset.placed=String(state.cornerPlaced[index]);button.setAttribute('aria-label',t(['1 · Levý horní roh','2 · Pravý horní roh','3 · Pravý dolní roh','4 · Levý dolní roh'][index])+' · '+t(state.cornerPlaced[index]?'Potvrzeno':'Ještě nepotvrzeno'));}button.setAttribute('aria-pressed',String(active));button.classList.toggle('btn-primary',active);button.classList.toggle('btn-light',!active);});
    const status=modal.body.querySelector('#a4-corner-status');if(status)status.textContent=t('Potvrzené rohy A4: {count} ze 4.',{count:state.cornerPlaced.filter(Boolean).length});
  }
  function returnToCalibration(){
    if(closed||state.busy)return;
    controller?.abort();controller=null;
    clearContourHistory();state.step=1;state.busy=false;state.result=null;state.items=[];state.activeItem=null;state.work=null;state.referencePoints=[];state.rulerPointer=null;state.showMask=false;state.error='';
    render();modal.body.scrollTop=0;modal.body.querySelector('#calibration-canvas')?.focus({preventScroll:true});
  }
  function beginSelection(index=null){
    if(closed||state.busy)return;selectionIndex=Number.isInteger(index)&&state.items[index]?index:null;state.error='';state.step=4;render();
  }
  function addDrawnContour(model){
    if(closed||state.busy)return;
    const image=state.work||state.image,points=flattenContour(model.nodes).map(p=>({x:model.origin.x+p.x*state.scale,y:model.origin.y+p.y*state.scale}));
    const item=captureSelectionItem({contour:{points},method:'freehand'},{scale:state.scale,image,name:t('Nástroj {n}',{n:state.items.length+1}),pocketShape:'measured'});
    const previousIndex=state.activeItem,previousQuality=state.result?.quality,index=state.items.length,review={status:'review',score0to1:0,reasons:['Výběr byl upraven uživatelem. Zkontrolujte celý obrys, skutečný rozměr a výslednou kapsu.']};
    const rebuild=quality=>{state.result={...state.result,contours:state.items.map(i=>i.contour),mask:captureSelectionMask(state.items.map(i=>i.contour),image.width,image.height),width:image.width,height:image.height,requiresReview:true,quality};state.error='';state.processingFailure=null;state.showMask=false;state.showCutout=false;resultMaskPixels=null;render();modal.body.querySelector('#trace-canvas')?.focus({preventScroll:true});};
    state.items.push(item);state.activeItem=index;
    contourHistory.past.push({undo:()=>{const at=state.items.indexOf(item);if(at>=0)state.items.splice(at,1);state.activeItem=state.items[previousIndex]?previousIndex:state.items.length?0:null;rebuild(previousQuality||{status:'retake',reasons:[]});},redo:()=>{state.items.splice(Math.min(index,state.items.length),0,item);state.activeItem=state.items.indexOf(item);rebuild(review);}});
    if(contourHistory.past.length>50)contourHistory.past.shift();contourHistory.future=[];rebuild(review);
  }
  function renderSelection(){
    const image=state.work||state.image,token={};selectionToken=token;
    const previous=selectionIndex===null?null:state.items[selectionIndex];
    selectionUI=mountPhotoSelection({host:modal.body,footer:modal.footer,image,pxPerMm:state.scale,initialContour:previous?.contour||null,
      onCancel:()=>{if(closed||selectionToken!==token)return;state.step=2;render();},
      onApply:selection=>{
        if(closed||selectionToken!==token||state.step!==4)return;
        try{
          const item=captureSelectionItem(selection,{scale:state.scale,image,previous,name:t('Nástroj {n}',{n:state.items.length+1}),pocketShape:lastPocketShape});
          clearContourHistory();
          // Explicit user identity supersedes overlapping automatic fragments,
          // while preserving their data and every separately selected object.
          const chosen=captureSelectionMask([item.contour],image.width,image.height);
          for(let i=0;i<state.items.length;i++){
            if(i===selectionIndex||state.items[i].selectionSource)continue;
            const old=captureSelectionMask([state.items[i].contour],image.width,image.height);let overlap=0,area=0;
            for(let p=0;p<old.length;p++)if(old[p]){area++;overlap+=chosen[p];}
            if(overlap>Math.max(3,area*.05))state.items[i].checked=false;
          }
          if(state.backgroundCutout)state.backgroundCutout=mergeCaptureCutout(image,state.backgroundCutout,selection,{previous,others:state.items.filter((other,i)=>i!==selectionIndex&&other.checked)});
          if(selectionIndex===null){state.items.push(item);state.activeItem=state.items.length-1;}else{state.items[selectionIndex]=item;state.activeItem=selectionIndex;}
          state.result={...state.result,contours:state.items.map(i=>i.contour),mask:captureSelectionMask(state.items.map(i=>i.contour),image.width,image.height),width:image.width,height:image.height,requiresReview:true,quality:{status:'review',score0to1:0,reasons:['Výběr byl upraven uživatelem. Zkontrolujte celý obrys, skutečný rozměr a výslednou kapsu.']}};
          state.error='';state.processingFailure=null;state.step=2;state.showMask=false;render();
        }catch(error){state.step=2;state.error=errorText(error);render();}
      }
    });
  }

  function renderResultFailure(error){
    // This is a presentation failure, not evidence that the photo is unclear.
    // Retain every source contour, the mask, and the original calibration.
    state.busy=false;state.processingFailure={phase:'preview',reason:errorText(error)};state.error=errorText(error);
    contourEditor?.destroy();contourEditor=null;resultContext?.();resultContext=null;resultViewCleanup?.();resultViewCleanup=null;guide?.destroy();guide=null;
    modal.body.innerHTML=steps()+`<div class="capture-canvas"><canvas id="capture-recovery-canvas"></canvas></div><h3>${t('Připravené obrysy se nepodařilo zobrazit.')}</h3><p>${t('Fotografie, maska a {n} nalezených obrysů zůstaly zachované.',{n:state.result?.contours?.length||state.items.length})}</p>${errorHTML()}<button class="btn btn-primary" id="capture-retry-result">${t('Znovu zobrazit obrysy')}</button><button class="btn btn-light" id="capture-select-new">${t('Vybrat další nástroj ve fotce')}</button>`;
    modal.footer.innerHTML=`<button class="btn btn-light" id="capture-calibration-back">${t('Zpět k měřítku')}</button><button class="btn btn-light" id="capture-recovery-close">${t('Zavřít')}</button>`;
    // Even a missing canvas context cannot destroy the retained result.
    try{const pixels=resultPixels(),canvas=modal.body.querySelector('#capture-recovery-canvas');canvas.width=pixels.width;canvas.height=pixels.height;canvas.getContext('2d')?.putImageData(pixels,0,0);}catch{}
    modal.body.querySelector('#capture-retry-result').onclick=()=>{state.processingFailure=null;state.error='';render();};
    modal.body.querySelector('#capture-select-new').onclick=()=>beginSelection();
    modal.footer.querySelector('#capture-calibration-back').onclick=returnToCalibration;
    modal.footer.querySelector('#capture-recovery-close').onclick=modal.close;
  }
  function renderResult(){
    const technicalFailure=Boolean(state.processingFailure),quality=state.result?.quality||{status:'retake',reasons:[]},automaticallyReady=quality.status==='ready',hasCandidates=(automaticallyReady||quality.status==='review')&&state.items.length>0,referenceOnly=hasCandidates&&state.items.every(item=>item.isReference),ready=hasCandidates&&!referenceOnly;
    modal.body.innerHTML=steps()+`<div class="capture-grid"><div class="capture-canvas"><canvas id="trace-canvas" role="img" aria-label="${esc(t('Automaticky rozpoznané obrysy nástrojů'))}"></canvas></div><div class="capture-sidebar auto-sidebar"><div class="recognition-status ${ready?(automaticallyReady?'ready':'review'):'retake'}">${icon(ready?(automaticallyReady?'check':'edit'):'camera')}${referenceOnly?t('Samostatné nástroje se nerozpoznaly.'):ready?t(automaticallyReady?'Rozpoznáno automaticky':'Kontury potřebují kontrolu'):t('Vyberte nástroj přímo ve fotce')}</div><h3>${technicalFailure?t('Zpracování fotografie se nepodařilo dokončit.'):referenceOnly?t('Obrysy obsahují značky měřítka.'):ready?t(automaticallyReady?'Obrysy jsou připravené.':'Nalezené obrysy můžete upravit.'):t('Z fotky není hrana dost jistá.')}</h3><p>${technicalFailure?t(state.backgroundCutout?'Pozadí je odstraněné. Při přípravě obrysů nebo kapes došlo k technické chybě.':'Došlo k technické chybě zpracování. Původní fotografie a měřítko zůstaly zachované.'):referenceOnly?t('Nalezené obrysy obsahují obě značky měřítka, proto nejsou automaticky vybrané. Jednotlivé nástroje uvnitř kufříku nebo držáku se neoddělily. Pro samostatné obrysy je vyjměte a vyfoťte odděleně na jednolitém kontrastním podkladu.'):ready?t(automaticallyReady?'Měřítko, oddělení pozadí i vyhlazení už jsou hotové. Stačí pojmenovat nástroje a přidat je do sestavy.':'Zkontrolujte nalezené obrysy. Kliknutím na hranu přidáte bod a upravíte tvar před přidáním.'):t('Vyberte nástroj ve fotce. Použijte Přidat pro materiál a Ubrat pro pozadí nebo stín. Nečitelnou hranu můžete určit body.')}</p>${errorHTML()}${ready&&state.result?.enhanced?`<p class="tip" data-photo-enhanced>${t(state.result.enhanced==='plain-background'?"Fotku jsme pro rozpoznání automaticky upravili: oddělili jsme jednolité pozadí a potlačili vnitřní odlesky. Původní fotka, poloha a měřítko zůstávají zachované.":state.result.enhanced==='light-background'?'Fotku jsme pro rozpoznání automaticky upravili: oddělili jsme světlé pozadí a potlačili vnitřní odlesky. Původní fotka, poloha a měřítko zůstávají zachované.':'Fotku jsme pro rozpoznání automaticky upravili: světlé nástroje jsme oddělili od tmavé vložky. Poloha a rozměry obrysů se tím nezměnily.')}</p>`:''}${!automaticallyReady&&!technicalFailure?`<div class="issue-box">${quality.reasons.map(r=>`<p>${esc(t(r))}</p>`).join('')||`<p>${t('Použijte rozptýlené světlo, oddělené předměty a kontrastní podklad.')}</p>`}</div>`:''}${state.result?.pendingContours?.length?`<div class="issue-box" id="capture-pending-info"><p>${t('Nejisté oblasti ({n}) nejsou automaticky považované za nástroje. Původní fotografie a průhlednost zůstávají zachované.',{n:state.result.pendingContours.length})}</p><button class="btn btn-light" id="capture-show-pending" ${state.pendingRevealed?'disabled':''}>${t(state.pendingRevealed?'Nejisté oblasti jsou zobrazené a nezaškrtnuté.':'Zobrazit nejisté oblasti')}</button></div>`:''}${hasCandidates?`<label class="field full-span"><span>${t('Tvar kapsy')}</span><select id="capture-pocket-shape"><option value="ideal" ${lastPocketShape==='ideal'?'selected':''}>${t('Hladká kapsa (+2 %)')}</option><option value="hybrid" ${lastPocketShape==='hybrid'?'selected':''}>${t('Vyvážený obrys (50 : 50)')}</option><option value="functional" ${lastPocketShape==='functional'?'selected':''}>${t('Pravidelné tvary podél osy')}</option><option value="measured" ${lastPocketShape==='measured'?'selected':''}>${t('Naměřený obrys')}</option></select></label><p id="capture-pocket-shape-note" class="muted-note full-span">${t(lastPocketShape==='ideal'?'Vyhlazený tvar s 2% rezervou. Běžná vůle kapsy se přidá navíc.':'Vyvážený obrys je napůl mezi naměřeným obrysem a pravidelnými tvary. Přerušovaná čára ukazuje osu. Vůli nastavte pro tento modul nebo jednotlivou kapsu.')}</p><div id="capture-guide" class="full-span"></div><div id="trace-items" class="trace-items full-span"></div><p id="trace-summary" class="full-span"></p><p id="capture-size-summary" class="muted-note full-span" aria-live="polite"></p><label class="field full-span" id="capture-layout-field"><span>${t('Přidat jako')}</span><select id="capture-layout">${LAYOUTS.map(([id,label])=>`<option value="${id}" ${lastLayout===id?'selected':''}>${t(label)}</option>`).join('')}</select></label><label class="field full-span"><span>${t('Vůle kapes v novém modulu')}</span><div class="input-wrap"><input id="capture-pocket-margin" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(state.pocketMarginText??inputValue(state.pocketMargin,{digits:6}))}"><em>${unit()}</em></div></label><p class="muted-note full-span">${t('Vůle je na každé straně: 1 mm přidá 2 mm k délce i šířce kapsy. Modrá čára ukazuje výslednou kapsu.')}</p><label class="field full-span"><span>${t('Hloubka kapsy')}</span><div class="input-wrap"><input id="capture-depth" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(state.depth??inputValue(Math.min(lastDepth,depthLimit())))}"><em>${unit()}</em></div></label><p class="trace-depth-note full-span">${t('Platí pro všechny nástroje. Jinou hloubku zadejte přímo v seznamu. Nejvýše {max} při současné výšce inzertu.',{max:fmtLen(depthLimit())})}</p><label class="check-row"><input id="trace-mask" type="checkbox">${t('Kontrastní náhled')}</label>`:''}${state.backgroundCutout?`<label class="check-row"><input id="capture-background-preview" type="checkbox" ${state.showCutout?'checked':''}>${t('Náhled bez pozadí')}</label><button class="btn btn-light block-button" id="capture-background-download">${t('Stáhnout PNG bez pozadí')}</button><p class="muted-note">${t('Průhledná maska a výrobní obrys jsou oddělené. Ověřte tenké části a hlavy šroubů podle originálu.')}</p>`:''}<button class="btn btn-primary block-button" id="capture-select-new">${t('Vybrat další nástroj ve fotce')}</button>${hasCandidates?`<button class="btn btn-light block-button" id="capture-select-replace">${t('Znovu vybrat aktivní nástroj')}</button>`:''}<button class="btn btn-light block-button" id="retake-photo">${icon('camera')}${t('Vybrat jinou fotku')}</button><p class="muted-note full-span">${t('Rozměry jsou bez vůle kapsy. Hloubka se z fotografie neměří, zadejte ji podle nástroje.')}</p></div></div>`;
    modal.footer.innerHTML=`<button class="btn btn-light" id="capture-calibration-back">${t(state.mode==='ruler'?'Zpět k měřítku':'Upravit rohy A4')}</button><span class="footnote">${ready?t('Kliknutím na obrys přidáte bod. Tažením bod přesunete.'):t('Fotografie a měřítko zůstávají zachované.')}</span><button class="btn btn-primary" id="capture-add" ${hasCandidates?'':'disabled'}>${hasCandidates?t('Přidat do šuplíku'):t('Nejprve vyberte obrys')}</button>`;
    const canvas=modal.body.querySelector('#trace-canvas');canvas.width=state.work?.width||state.image.width;canvas.height=state.work?.height||state.image.height;
    const cutoutPreview=modal.body.querySelector('#capture-background-preview');if(cutoutPreview)cutoutPreview.onchange=()=>{state.showCutout=cutoutPreview.checked;if(state.showCutout){state.showMask=false;const mask=modal.body.querySelector('#trace-mask');if(mask)mask.checked=false;}resultPhoto=null;drawResult();};
    const cutoutDownload=modal.body.querySelector('#capture-background-download');if(cutoutDownload)cutoutDownload.onclick=()=>{
      const image=state.backgroundCutout,run=photoRun;if(!image||closed||state.busy)return;cutoutDownload.disabled=true;
      try{canvasFromImage(image).toBlob(blob=>{if(closed||photoRun!==run||state.backgroundCutout!==image)return;cutoutDownload.disabled=false;if(blob)download('nastroje-bez-pozadi.png',blob,'image/png');else setError(t('PNG se nepodařilo připravit.'));},'image/png');}catch(error){cutoutDownload.disabled=false;setError(errorText(error));}
    };
    const pendingButton=modal.body.querySelector('#capture-show-pending');if(pendingButton)pendingButton.onclick=showPendingContours;
    modal.body.querySelector('#capture-select-new').onclick=()=>beginSelection();
    const reselect=modal.body.querySelector('#capture-select-replace');if(reselect)reselect.onclick=()=>beginSelection(state.activeItem??0);
    modal.body.querySelector('#retake-photo').onclick=reset;modal.footer.querySelector('#capture-calibration-back').onclick=returnToCalibration;
    canvas.tabIndex=0;canvas.setAttribute('aria-haspopup','menu');
    canvas.title=t('Nástroj vyberte v paletě nad fotografií. Kolečko přibližuje; mezerník a tažení posouvají náhled.')+' '+t('Pravé kliknutí na nástroj zobrazí údaje a možnosti úprav.');
    resultViewCleanup=bindCanvasView(canvas,{getView:()=>resultView,setView:view=>{resultView=view;},draw:drawResult,canTouchPan:()=>!contourEditor?.dragging&&resultView.zoom>1,onNavigationStart:()=>contourEditor?.cancel()});
    contourEditor=bindCaptureContourEditor(canvas,{getItems:()=>state.items,getActiveIndex:()=>state.activeItem,onSelect:index=>guided?(index===state.activeItem?null:guide.open(index)):selectActiveItem(index),getPhotoScale:()=>state.scale,getView:()=>resultView,getPocketMargin:()=>state.pocketMargin,isBusy:()=>closed||state.busy,onUpdate:index=>{if(Number.isInteger(index))syncListItem(index);guide?.refresh({geometryChanged:true,index});updateSummary();drawResult();},onRedraw:drawResult,onCreateContour:addDrawnContour,sessionHistory:contourHistory,onError:message=>setError(message)});
    if(hasCandidates){
      modal.body.querySelector('#capture-pocket-shape').onchange=e=>{
        const previous=lastPocketShape,next=e.target.value;
        try{
          const prepared=state.items.map(item=>prepareCaptureFit({...item,pocketShape:next},state.scale,{pocketMargin:state.pocketMargin}));
          prepared.forEach((item,index)=>{delete state.items[index].pocketFitIssue;delete state.items[index].pocketFitNotice;Object.assign(state.items[index],item);});
          lastPocketShape=next;modal.body.querySelector('#capture-pocket-shape-note').textContent=t(next==='ideal'?'Vyhlazený tvar s 2% rezervou. Běžná vůle kapsy se přidá navíc.':'Vyvážený obrys je napůl mezi naměřeným obrysem a pravidelnými tvary. Přerušovaná čára ukazuje osu. Vůli nastavte pro tento modul nebo jednotlivou kapsu.');setError('');state.items.forEach((_,index)=>syncListItem(index));updateSummary();guide?.refresh();drawResult();
        }catch(error){e.target.value=previous;setError(errorText(error));}
      };

      modal.body.querySelector('#capture-pocket-margin').oninput=e=>{
        state.pocketMarginText=e.target.value;
        try{state.pocketMargin=validatePocketMargin(parseLength(state.pocketMarginText));setError('');guide?.refresh();drawResult();}
        catch(error){setError(errorText(error));}
      };
      modal.body.querySelector('#trace-mask').onchange=e=>{state.showMask=e.target.checked;if(state.showMask){state.showCutout=false;const toggle=modal.body.querySelector('#capture-background-preview');if(toggle)toggle.checked=false;}drawResult();};
      const layoutSelect=modal.body.querySelector('#capture-layout');
      const layoutHint=document.createElement('small');layoutHint.id='capture-layout-hint';layoutHint.textContent=t('Zachová polohu, natočení a rozestupy vybraných nástrojů v jednom modulu. Mezi nástroji musí zbýt místo na vůli kapes a stěny.');
      layoutSelect.setAttribute('aria-describedby',layoutHint.id);layoutSelect.after(layoutHint);
      const updateLayoutHint=()=>{layoutHint.hidden=lastLayout!=='photo';};
      layoutSelect.onchange=e=>{lastLayout=e.target.value;updateLayoutHint();};updateLayoutHint();
      modal.body.querySelector('#capture-depth').oninput=e=>{state.depth=e.target.value;setError('');for(const field of modal.body.querySelectorAll('[data-depth]'))field.placeholder=e.target.value;guide?.refresh();};
      const list=modal.body.querySelector('#trace-items');list.oninput=e=>{if(e.target.dataset.depth!=null){const item=state.items[Number(e.target.dataset.depth)];if(item)item.depth=e.target.value;setError('');if(!guided)guide?.refresh();return;}const index=Number(e.target.dataset.name);if(e.target.matches('input[type=text]')&&state.items[index]){state.items[index].name=e.target.value.slice(0,80);if(!guided)guide?.refresh();}};
      list.onchange=e=>{const index=Number(e.target.dataset.item);if(e.target.matches('input[type=checkbox]')&&state.items[index]){state.items[index].checked=e.target.checked;updateSummary();drawResult();if(!guided)guide?.refresh();}};
      const selectItem=e=>{const row=e.target.closest('[data-trace-index]');if(row)selectActiveItem(Number(row.dataset.traceIndex));};
      list.onfocusin=selectItem;list.onpointerdown=selectItem;
      list.innerHTML=state.items.map((item,i)=>`<div class="trace-item ${state.activeItem===i?'is-active':''}" data-trace-index="${i}" data-active="${state.activeItem===i}"><input type="checkbox" data-item="${i}" ${item.checked?'checked':''} aria-label="${esc(t('Přidat {name}',{name:item.name}))}"><input type="text" data-name="${i}" aria-label="${esc(t('Název nástroje {n}',{n:i+1}))}" value="${esc(item.name)}" maxlength="80" style="width:100%;min-width:55px;background:transparent;border:0;border-bottom:1px solid #e0e5d8;font:inherit;padding:5px 2px;color:#58684d"><input type="text" class="trace-depth" inputmode="decimal" autocomplete="off" spellcheck="false" data-depth="${i}" value="${esc(item.depth||'')}" placeholder="${esc(modal.body.querySelector('#capture-depth').value)}" title="${esc(t('Hloubka kapsy tohoto nástroje'))}" aria-label="${esc(t('Hloubka kapsy nástroje {n}',{n:i+1}))}"><span data-capture-dimensions style="white-space:nowrap">${fmtSize(item.info.width,item.info.height)}</span></div>`).join('');
      guide=mountCaptureGuide({host:modal.body.querySelector('#capture-guide'),items:state.items,
        getDepth:()=>modal.body.querySelector('#capture-depth').value,getMaxDepth:depthLimit,getPocketMargin:()=>state.pocketMargin,
        getDimensions:index=>captureItemDimensions(state.items[index],state.scale),
        onSelect:selectActiveItem,
        onUpdate:(index,patch)=>{Object.assign(state.items[index],patch);syncListItem(index);setError('');updateSummary();drawResult();},
        onResize:(index,dimensions)=>{const measured=resizeCaptureItem(state.items[index],state.scale,dimensions);syncListItem(index);setError('');return measured;},
        onModeChange:active=>{guided=active;modal.body.querySelector('.capture-grid').classList.toggle('is-guided',active);list.hidden=active;updateSummary();},
        onFinish:()=>list.querySelector('[data-active="true"]')?.scrollIntoView?.({block:'nearest'}),
        onError:message=>setError(typeof message==='string'?message:errorText(message))
      });
      resultContext=bindCaptureContextMenu(canvas,{
        getItems:()=>state.items,getActiveIndex:()=>state.activeItem,isBusy:()=>closed||state.busy,
        getScale:()=>canvas.width/Math.max(250,canvas.clientWidth||550)/resultView.zoom,getPoints:item=>capturePhotoGeometry(item,state.scale).points,
        toPhoto:point=>viewToPhoto(resultView,point),fromPhoto:point=>photoToView(resultView,point),
        onSelect:index=>guided?(index===state.activeItem?null:guide.open(index)):selectActiveItem(index),
        getDescription:item=>{
          const measured=captureItemDimensions(item,state.scale),raw=item.depth?.trim()||modal.body.querySelector('#capture-depth').value,depth=parseLength(raw);
          return `${item.name.trim()||t('Nástroj')} · ${fmtSize(measured.length,measured.width)} · ${t('Hloubka kapsy')}: ${Number.isFinite(depth)?fmtLen(depth):raw}`;
        },
        onEdit:(index,field)=>{
          guide.open(index);
          const input=modal.body.querySelector(`#capture-guide-${field}`);
          input?.scrollIntoView?.({block:'nearest'});input?.focus({preventScroll:true});
        }
      });
      modal.footer.querySelector('#capture-add').onclick=async()=>{
        if(state.busy||!contourEditor.validate()||!guide.validate())return;
        let pocketMargin;
        try{pocketMargin=state.pocketMarginText===undefined?validatePocketMargin(state.pocketMargin):validatePocketMargin(parseLength(state.pocketMarginText));}
        catch(error){setError(errorText(error));modal.body.querySelector('#capture-pocket-margin').focus();return;}

        const chosen=state.items.filter(i=>i.checked);if(state.busy||!chosen.length)return;
        if(chosen.some(i=>i.info.width>3000||i.info.height>3000||i.contour.points.length>6000)){setError(t('Měřítko neodpovídá velikosti nástrojů. Zkontrolujte vzdálenost na pravítku nebo použijte celou A4.'));return;}
        const general=modal.body.querySelector('#capture-depth').value,limit=depthLimit(),depthOf=i=>parseLength(i.depth?.trim()||general),valid=d=>Number.isFinite(d)&&d>=MIN_DEPTH&&d<=limit+1e-9;
        const wrong=chosen.find(i=>!valid(depthOf(i)));
        if(wrong){setError(t('Hloubka kapsy u nástroje {name} musí být od {min} do {max}. Hlubší kapsa potřebuje vyšší inzert.',{name:wrong.name.trim()||t('Nástroj'),min:fmtLen(MIN_DEPTH),max:fmtLen(limit)}));return;}
        if(valid(parseLength(general)))lastDepth=parseLength(general);
        const run=photoRun,layout=lastLayout;
        state.busy=true;updateSummary();
        try{
          // Leave a paint opportunity before contour conversion and the caller's
          // potentially synchronous layout work block the main thread.
          await frame();await new Promise(resolve=>setTimeout(resolve,0));
          if(closed||photoRun!==run)return;
          const tools=chosen.map(i=>toolFromCaptureItem(i,{scale:state.scale,depth:depthOf(i),id:uid(),preservePosition:layout==='photo'}));
          await onAdd(tools,{layout,pocketMargin});if(!closed)modal.close();
        }catch(error){if(closed)return;state.busy=false;setError(errorText(error));updateSummary();}
      };
      state.items.forEach((_,index)=>syncListItem(index));
      updateSummary();
    }
    drawResult();
  }
  function showPendingContours(){
    if(state.busy||state.pendingRevealed)return;
    let rejected=0;
    for(const [index,contour] of (state.result?.pendingContours||[]).entries()){
      try{const item={contour,info:info(contour,state.scale),pocketShape:lastPocketShape,isReference:false,checked:false,contrastNeedsReview:true,name:t('Nejistá oblast {n}',{n:index+1})};state.items.push(prepareCaptureFit(item,state.scale,{pocketMargin:state.pocketMargin}));}catch{rejected++;}
    }
    state.pendingRevealed=true;
    if(rejected)state.error=t('{n} obrysů nelze bezpečně převést na kapsu. Ostatní nástroje můžete použít.',{n:rejected});
    render();
  }
  function selectActiveItem(index){
    if(!state.items[index])return;state.activeItem=index;contourEditor?.refresh();
    for(const row of modal.body.querySelectorAll('[data-trace-index]')){
      const active=Number(row.dataset.traceIndex)===index;row.classList.toggle('is-active',active);row.dataset.active=String(active);
    }
    drawResult();
  }
  function syncListItem(index){
    const item=state.items[index],row=modal.body.querySelector(`[data-trace-index="${index}"]`);if(!row)return;
    row.querySelector('[data-name]').value=item.name;row.querySelector('[data-depth]').value=item.depth||'';
    const checkbox=row.querySelector('[data-item]');checkbox.checked=item.checked;checkbox.setAttribute('aria-label',t('Přidat {name}',{name:item.name}));
    const measured=captureItemDimensions(item,state.scale),label=row.querySelector('[data-capture-dimensions]');
    let warning=row.querySelector('[data-capture-fit-issue]');
    const notice=item.contrastNeedsReview?t('Tato oblast nemá potvrzenou hranu nástroje. Pro přidání ji nejprve ověřte podle fotografie a výslovně zaškrtněte.'):item.pocketFitIssue?t('Zobrazen je naměřený obrys bez 2% rezervy. Zkontrolujte ho a pro přidání jej výslovně zaškrtněte.'):item.pocketFitNotice?.filledOffsetHoles?t('Kapsa uzavírá drobný vnitřní výřez. Zkontrolujte její tvar v náhledu.'):'';
    if(notice){if(!warning){warning=document.createElement('small');warning.dataset.captureFitIssue=String(index);warning.id='capture-fit-issue-'+index;warning.style.gridColumn='1 / -1';warning.style.color='#8a5a1c';row.append(warning);}warning.textContent=notice;checkbox.setAttribute('aria-describedby',warning.id);}else{warning?.remove();checkbox.removeAttribute('aria-describedby');}
    label.textContent=fmtSize(measured.length,measured.width);label.title=t(item.selectionSource?'Uživatelsky vybraný obrys; přesnost ověřte podle originálu.':item.editedPoints?'Rozměry upraveného obrysu.':'Naměřený nástroj bez rezervy a vůle kapsy.');
  }
  function updateSizeSummary(){
    const label=modal.body.querySelector('#capture-size-summary');if(!label)return;
    const item=state.items[state.activeItem]||state.items.find(item=>item.checked)||state.items[0];
    if(!item){label.textContent='';return;}
    const measured=captureItemDimensions(item,state.scale),pocket=capturePocketDimensions(item,state.scale,{pocketMargin:state.pocketMargin});
    label.textContent=t(item.selectionSource?'Vybraný obrys: {tool}. Výsledná kapsa: {pocket}.':item.editedPoints?'Upravený obrys: {tool}. Výsledná kapsa: {pocket}.':'Nástroj: {tool}. Výsledná kapsa: {pocket}.',{tool:fmtSize(measured.length,measured.width),pocket:fmtSize(pocket.length,pocket.width)});
  }
  function updateSummary(){
    if(state.busy){resultContext?.dismiss();contourEditor?.cancel();}
    const count=state.items.filter(i=>i.checked).length,el=modal.body.querySelector('#trace-summary'),button=modal.footer.querySelector('#capture-add');
    const layout=modal.body.querySelector('#capture-layout-field');if(layout)layout.hidden=guided||count<2;
    if(el)el.textContent=t('{tools} · měřítko načteno',{tools:plural(count,['{n} nástroj připraven','{n} nástroje připraveny','{n} nástrojů připraveno'])});
    modal.body.querySelectorAll('input,select,#retake-photo').forEach(element=>{if(!element.closest('.capture-contour-palette,.capture-contour-details'))element.disabled=state.busy;});
    guide?.setBusy(state.busy);
    const back=modal.footer.querySelector('#capture-calibration-back');if(back)back.disabled=state.busy;
    contourEditor?.refresh();
    if(button){
      button.disabled=state.busy||count===0||!['ready','review'].includes(state.result?.quality.status);
      if(state.busy){button.setAttribute('data-loading-busy','true');if(!button.querySelector('[data-loading-ui]'))button.innerHTML=loadingMarkup({title:t('Přidávám nástroje do šuplíku…'),compact:true});}
      else{button.removeAttribute('data-loading-busy');button.textContent=count?t('Přidat do šuplíku ({n})',{n:count}):t('Vyberte alespoň jeden nástroj');}
    }
  }
  function resultPixels(){
    const image=state.work||state.image;
    if(state.showCutout&&state.backgroundCutout){
      const source=state.backgroundCutout,pixels=new Uint8ClampedArray(source.data.length);
      for(let p=0;p<source.width*source.height;p++){const a=source.data[p*4+3]/255,x=p%source.width,y=Math.floor(p/source.width),background=(Math.floor(x/20)+Math.floor(y/20))%2?228:248;for(let c=0;c<3;c++)pixels[p*4+c]=Math.round(source.data[p*4+c]*a+background*(1-a));pixels[p*4+3]=255;}
      return new ImageData(pixels,source.width,source.height);
    }
    if(!state.showMask||!state.result?.mask)return image;
    if(!resultMaskPixels){
      const pixels=new Uint8ClampedArray(image.width*image.height*4);
      for(let i=0;i<state.result.mask.length;i++){const v=state.result.mask[i]?44:249;pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=v;pixels[i*4+3]=255;}
      resultMaskPixels=new ImageData(pixels,image.width,image.height);
    }
    return resultMaskPixels;
  }
  function drawResult(){
    const canvas=modal.body.querySelector('#trace-canvas');if(!canvas)return;const ctx=canvas.getContext('2d'),image=state.work||state.image;
    updateSizeSummary();
    const photo=()=>{const mode=state.showCutout?'cutout':state.showMask?'mask':'original';if(!resultPhoto||resultPhotoMask!==mode){resultPhoto=canvasFromImage(resultPixels());resultPhotoMask=mode;}return resultPhoto;};
    const zoomed=resultView.zoom>1;
    if(zoomed){ctx.save();ctx.setTransform(resultView.zoom,0,0,resultView.zoom,resultView.x,resultView.y);ctx.drawImage(photo(),0,0);}
    else ctx.putImageData(resultPixels(),0,0);
    const scale=canvas.width/Math.max(250,canvas.clientWidth||550)/resultView.zoom;
    if(['ready','review'].includes(state.result?.quality.status))drawCaptureContours(ctx,state.items,{activeIndex:state.activeItem,scale,photoScale:state.scale,pocketMargin:state.pocketMargin});
    contourEditor?.refresh();contourEditor?.draw(ctx,scale);
    if(zoomed)ctx.restore();
    const detail=modal.body.querySelector('#capture-guide-preview');
    if(detail&&state.items[state.activeItem]){
      // The guide replaces this canvas when it opens a tool; each tool starts from its full view.
      if(detail!==detailViewCanvas||detailViewIndex!==state.activeItem){
        detailViewCleanup?.();detailEditorCleanup?.();detailView=identityView();detailViewCanvas=detail;detailViewIndex=state.activeItem;
        detail.title=canvas.title;
        detailViewCleanup=bindCanvasView(detail,{getView:()=>detailView,setView:view=>{detailView=view;},draw:drawResult,canTouchPan:()=>!contourEditor?.dragging&&detailView.zoom>1,onNavigationStart:()=>contourEditor?.cancel()});
        detailEditorCleanup=contourEditor?.bindSurface(detail,{getView:()=>detailPhotoView});
      }
      detailPhotoView=drawCaptureToolPreview(detail,photo(),state.items[state.activeItem],state.activeItem,detailView,state.scale,state.pocketMargin,contourEditor?.draggingSurface===detail?detailPhotoView:null);
      if(contourEditor){const context=detail.getContext('2d');context.save();context.setTransform(detailPhotoView.zoom,0,0,detailPhotoView.zoom,detailPhotoView.x,detailPhotoView.y);contourEditor.draw(context,detail.width/(detail.getBoundingClientRect().width||320)/detailPhotoView.zoom,detail);context.restore();}
    }
  }
  function render(){
    if(closed)return;selectionToken=null;selectionUI?.destroy();selectionUI=null;contourEditor?.destroy();contourEditor=null;resultContext?.();resultContext=null;resultViewCleanup?.();resultViewCleanup=null;detailViewCleanup?.();detailViewCleanup=null;detailEditorCleanup?.();detailEditorCleanup=null;detailViewCanvas=null;resultView=identityView();guide?.destroy();guide=null;guided=false;resultMaskPixels=null;resultPhoto=null;cancelCalibration?.();calibrationCleanup?.();calibrationCleanup=null;cancelCalibration=null;observer?.disconnect();
    if(state.step===0)renderUpload();else if(state.step===1)renderCalibration();else if(state.step===3)renderProcessing();else if(state.step===4)renderSelection();else{try{renderResult();}catch(error){renderResultFailure(error);}}
    const canvas=modal.body.querySelector('canvas');if(canvas&&typeof ResizeObserver==='function'&&state.step!==3&&state.step!==4){observer=new ResizeObserver(()=>{if(!closed)state.step===1?drawCalibration():drawResult();});observer.observe(canvas);}
  }
  render();return modal;
}
