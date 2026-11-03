import { detectPaper, rectifyImage, calibrateSegment } from './trace.js';
import { calibrateRulers, rectifyRulers } from './ruler-calibration.js';
import { recognizeTools } from './recognize.js';
import { icon, esc, openModal } from './ui.js';
import { t, plural, i18nError, errorText } from './i18n.js';
import { unit, inputValue, parseLength, fmtSize, fmtLen } from './units.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const uid = () => globalThis.crypto?.randomUUID?.() || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function canvasFromImage(image) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0); return canvas;
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

export function openCapture({onAdd,toast=()=>{}}){
  let closed=false,controller=null,observer=null,cancelCalibration=null;
  const state={step:0,reference:'a4',mode:'portrait',image:null,imageCanvas:null,corners:[],ruler:[],rulerMm:100,rulerSecond:false,rulerSecondMm:100,rulerPointer:null,referencePoints:[],activePoint:0,detected:false,busy:false,work:null,scale:1,result:null,items:[],showMask:false,error:'',progress:0,message:'Načítám fotografii…'};
  // state.message, quality reasons and worker errors stay Czech source text; t()/errorText() translate them on display.
  const blurCalibration=()=>cancelCalibration?.();window.addEventListener('blur',blurCalibration);
  const modal=openModal({title:t('Vyfoťte. Obrys připravíme my.'),subtitle:t('Automatické měřítko, rozpoznání nástroje i čisté hrany. Bez kreslení bodů.'),wide:true,body:'',footer:'',onClose:()=>{closed=true;controller?.abort();observer?.disconnect();cancelCalibration?.();window.removeEventListener('blur',blurCalibration);}});
  const steps=()=>`<div class="capture-steps"><span class="${state.step===0?'active':'done'}">1 · ${t('Fotografie')}</span><span class="${state.step===1||state.step===3?'active':state.step===2?'done':''}">2 · ${t('Automatické rozpoznání')}</span><span class="${state.step===2?'active':''}">3 · ${t('Hotový obrys')}</span></div>`;
  const errorHTML=()=>`<div id="capture-error" role="alert" class="form-error" ${state.error?'':'hidden'}>${esc(state.error)}</div>`;
  function setError(text){state.error=text;const el=modal.body.querySelector('#capture-error');if(el){el.textContent=text;el.hidden=!text;}}
  function reset(){controller?.abort();controller=null;state.step=0;state.error='';state.busy=false;state.image=null;state.work=null;state.items=[];state.result=null;render();}
  function progress(event){
    if(closed)return;
    state.progress=Math.max(state.progress,Math.min(.98,Number(event.progress)||0));
    if(event.message)state.message=event.message;
    const label=modal.body.querySelector('#auto-progress-message'),bar=modal.body.querySelector('#auto-progress-bar');
    if(label)label.textContent=t(state.message);
    if(bar)bar.style.width=`${Math.round(state.progress*100)}%`;
  }
  async function loadFile(file){
    if(!file||state.busy)return;
    setError('');
    if(file.size>20*1024*1024)return setError(t('Fotografie je větší než 20 MB. Vyberte menší soubor.'));
    const heic=/\.(heic|heif)$/i.test(file.name)||/^image\/hei[cf](?:-sequence)?(?:;|$)/i.test(file.type);
    if(!/^image\//i.test(file.type)&&!/\.(jpe?g|png|webp|avif|bmp|heic|heif)$/i.test(file.name))return setError(t('Vyberte fotografii z telefonu nebo soubor JPG, PNG či WebP.'));
    state.busy=true;let bitmap,url;
    const button=modal.body.querySelector('#gallery-pick');if(button)button.textContent=t('Načítám…');
    modal.body.querySelector('.upload-zone')?.setAttribute('aria-busy','true');
    modal.body.querySelectorAll('.upload-zone button,#sample-scan,#photo-reference').forEach(element=>element.disabled=true);
    try{
      await frame();if(closed)return;
      // The system image decoder may support HEIC even when ImageBitmap does not
      // (notably phone browsers), so try both native paths before asking for JPG.
      try{
        try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}
        catch{if(closed)return;url=URL.createObjectURL(file);bitmap=new Image();bitmap.src=url;await bitmap.decode();}
      }catch{
        throw i18nError(heic?'Tento prohlížeč nedokáže otevřít HEIC. V telefonu fotku nasdílejte nebo uložte jako JPG a vyberte ji znovu.':'Fotografii se nepodařilo otevřít. Zkuste jinou fotku nebo soubor JPG, PNG či WebP.');
      }
      if(closed)return;
      const w=bitmap.width||bitmap.naturalWidth,h=bitmap.height||bitmap.naturalHeight;
      if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw i18nError('Fotografie nemá platné rozlišení. Zkuste jinou fotku.');
      if(w<100||h<100)throw i18nError('Fotografie je příliš malá. Vyfoťte nástroj znovu blíž a ostřeji.');
      const ratio=Math.min(1,1400/Math.max(w,h)),canvas=document.createElement('canvas');canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
      if(canvas.width<16||canvas.height<16)throw i18nError('Fotografie má příliš úzký výřez. Vyfoťte celý papír a nástroje.');
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      // Release the full camera bitmap before recognition allocates its working data.
      bitmap?.close?.();bitmap=null;if(url){URL.revokeObjectURL(url);url=null;}
      await beginPhoto(pixels);
    }catch(error){if(!closed&&error.name!=='AbortError'){state.busy=false;setError(errorText(error)||t('Fotografii se nepodařilo otevřít.'));toast(t('Fotografii se nepodařilo zpracovat.'));}}
    finally{bitmap?.close?.();if(url)URL.revokeObjectURL(url);if(!closed){state.busy=false;if(state.step===0)render();}}
  }
  async function beginPhoto(image){
    state.image=image;state.imageCanvas=canvasFromImage(image);state.error='';state.items=[];state.result=null;
    const corners=detectPaper(image);state.detected=!!corners;
    state.corners=corners||[{x:image.width*.1,y:image.height*.1},{x:image.width*.9,y:image.height*.1},{x:image.width*.9,y:image.height*.9},{x:image.width*.1,y:image.height*.9}];
    state.ruler=[{x:image.width*.3,y:image.height*.65},{x:image.width*.7,y:image.height*.65},{x:image.width*.8,y:image.height*.3},{x:image.width*.8,y:image.height*.7}];state.activePoint=0;state.rulerPointer=null;
    state.mode=state.reference==='ruler'?'ruler':'portrait';
    if(state.reference==='a4'&&corners){
      const width=(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y)+Math.hypot(corners[2].x-corners[3].x,corners[2].y-corners[3].y))/2;
      const height=(Math.hypot(corners[3].x-corners[0].x,corners[3].y-corners[0].y)+Math.hypot(corners[2].x-corners[1].x,corners[2].y-corners[1].y))/2;
      state.mode=width>height?'landscape':'portrait';
      await processPhoto();
    }else{state.step=1;state.busy=false;render();}
  }
  async function processPhoto(){
    controller?.abort();const run=new AbortController();controller=run;
    const current=()=>!closed&&!run.signal.aborted&&controller===run;
    state.busy=true;state.step=3;state.progress=.02;state.message='Narovnávám papír a určuju skutečné rozměry…';render();
    try{
      await frame();await frame();if(!current())return;
      if(state.mode==='ruler'){
        if(state.rulerSecond){const calibrated=rectifyRulers(state.image,state.ruler,[state.rulerMm,state.rulerSecondMm]);state.work=calibrated.imageData;state.scale=calibrated.pxPerMm;state.referencePoints=calibrated.points;}
        else{state.scale=calibrateSegment(state.ruler[0],state.ruler[1],state.rulerMm);state.work=state.image;state.referencePoints=state.ruler.slice(0,2);}
      }
      else{const r=rectifyImage(state.image,state.corners,state.mode==='portrait'?210:297,state.mode==='portrait'?297:210,1100);state.work=r.imageData;state.scale=r.pxPerMm;}
      const result=await recognizeTools(state.work,{pxPerMm:state.scale,kind:state.mode==='ruler'?'reference':'paper',signal:run.signal,onProgress:event=>{if(current())progress(event);}});
      if(!current())return;state.result=result;
      state.items=state.result.contours.map((contour,i)=>({contour,info:info(contour,state.scale),checked:!(state.mode==='ruler'&&[0,2].some(j=>state.referencePoints[j]&&state.referencePoints.slice(j,j+2).every(p=>inside(p,contour.points)))),name:t('Nástroj {n}',{n:i+1})})).filter(item=>item.info.width>=2&&item.info.height>=2);
      state.step=2;state.busy=false;state.showMask=false;render();
    }catch(error){
      if(!current()||error.name==='AbortError')return;
      state.busy=false;state.step=2;state.items=[];state.result={contours:[],mask:new Uint8Array(state.work?.width*state.work?.height||0),quality:{status:'retake',reasons:['Rozpoznávání se nepodařilo dokončit. Zkuste fotografii načíst znovu.']}};state.error=errorText(error);render();
    }
  }
  function renderUpload(){
    modal.body.innerHTML=steps()+`<label class="field" style="max-width:340px"><span>${t('Měřítko na fotografii')}</span><select id="photo-reference"><option value="a4">${t('A4 papír · měřítko najdeme automaticky')}</option><option value="ruler">${t('Pravítko · označím dvě známé značky')}</option></select></label><div class="upload-zone" tabindex="0" role="button" aria-label="${esc(t('Vybrat nebo přetáhnout fotografii'))}"><div class="upload-symbol">${icon('camera')}</div><strong>${t('Vy jen vyfotíte. Zbytek zařídíme.')}</strong><p>${t('Nástroje položte odděleně na bílý papír A4, aby se nedotýkaly. Vyfoťte celý list shora, ideálně na tmavším stole.')}</p><div class="upload-buttons"><button class="btn btn-primary" id="camera-pick">${icon('camera')}${t('Vyfotit')}</button><button class="btn btn-light" id="gallery-pick">${icon('upload')}${t('Vybrat fotku')}</button></div><small style="color:#92a086;margin-top:15px;font-size:10px">${t('Fotky z telefonu, JPG, PNG, WebP · nejvýše 20 MB')}</small></div><input type="file" accept="image/*,.heic,.heif" capture="environment" id="camera-file" hidden><input type="file" accept="image/*,.heic,.heif" id="gallery-file" hidden>${errorHTML()}<div class="capture-note"><div><b>${t('Automatické měřítko')}</b>${t('Najdeme rohy A4 a narovnáme perspektivu.')}</div><div><b>${t('Každý nástroj zvlášť')}</b>${t('Rozpoznáme oddělené nástroje, potlačíme stín a vyčistíme hrany.')}</div><div><b>${t('Rovnou do šuplíku')}</b>${t('Bez prahů a kreslení bodů. Jen pojmenujete a přidáte.')}</div></div><button class="sample-button" id="sample-scan">${t('Vyzkoušet na ukázkové fotografii')}</button>`;
    modal.footer.innerHTML=`<span class="footnote">${t('Fotka se zpracuje ve vašem zařízení a nikam se neodesílá.')}</span><button class="btn btn-light" id="capture-cancel">${t('Zavřít')}</button>`;
    const reference=modal.body.querySelector('#photo-reference');reference.value=state.reference;reference.onchange=()=>state.reference=reference.value;
    const pick=selector=>{if(!state.busy)modal.body.querySelector(selector).click();};
    const zone=modal.body.querySelector('.upload-zone');zone.onclick=()=>pick('#gallery-file');zone.onkeydown=e=>{if(e.target===zone&&['Enter',' '].includes(e.key)){e.preventDefault();pick('#gallery-file');}};
    modal.body.querySelector('#camera-pick').onclick=e=>{e.stopPropagation();pick('#camera-file');};modal.body.querySelector('#gallery-pick').onclick=e=>{e.stopPropagation();pick('#gallery-file');};
    for(const el of modal.body.querySelectorAll('input[type=file]'))el.onchange=()=>loadFile(el.files[0]);
    zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragover');};zone.ondragleave=()=>zone.classList.remove('dragover');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragover');loadFile(e.dataTransfer.files[0]);};
    modal.body.querySelector('#sample-scan').onclick=async()=>{if(state.busy)return;state.busy=true;await frame();if(!closed)await beginPhoto(samplePhoto());};
    modal.footer.querySelector('#capture-cancel').onclick=modal.close;
  }
  function renderProcessing(){
    modal.body.innerHTML=steps()+`<div class="capture-grid"><div class="capture-canvas"><canvas id="processing-canvas" aria-label="${esc(t('Zpracovávaná fotografie'))}"></canvas><div class="auto-photo-sweep"></div></div><div class="capture-sidebar auto-sidebar"><div class="auto-status-symbol">${icon('spark')}</div><h3>${t('Pracuji za vás.')}</h3><p>${t('Hledám předměty, odděluji je od pozadí a zpřesňuji hrany. Kontrast ani body nemusíte nastavovat.')}</p><div class="auto-progress" role="progressbar" aria-label="${esc(t('Automatické rozpoznávání'))}"><div id="auto-progress-bar" style="width:${Math.round(state.progress*100)}%"></div></div><p id="auto-progress-message" aria-live="polite">${esc(t(state.message))}</p><p class="muted-note">${t('První použití může chvíli trvat, než se načte rozpoznávač. Další fotky už využijí uložené soubory.')}</p></div></div>`;
    modal.footer.innerHTML=`<span class="footnote">${t('Fotografie zůstává ve vašem zařízení.')}</span><button class="btn btn-light" id="cancel-processing">${t('Zrušit')}</button>`;
    const canvas=modal.body.querySelector('#processing-canvas');canvas.width=state.image.width;canvas.height=state.image.height;canvas.getContext('2d').putImageData(state.image,0,0);
    modal.footer.querySelector('#cancel-processing').onclick=reset;
  }
  function renderCalibration(){
    const missing=state.mode!=='ruler'&&!state.detected;
    if(missing){
      modal.body.innerHTML=steps()+`<div class="auto-retake"><div class="upload-symbol">${icon('camera')}</div><h3>${t('Potřebuji vidět celý papír.')}</h3><p>${t('Rohy A4 nejsou dostatečně zřetelné, takže by měřítko bylo jen odhad. Položte papír na tmavší podklad a vyfoťte celý list shora.')}</p><button class="btn btn-primary" id="retake-missing">${t('Vyfotit znovu')}</button><button class="section-link" id="use-ruler" style="margin-top:18px">${t('Místo A4 použít pravítko')}</button></div>`;
      modal.footer.innerHTML=`<span class="footnote">${t('Bez správného měřítka nelze vytvořit přesný inzert.')}</span><button class="btn btn-light" id="capture-cancel">${t('Zavřít')}</button>`;
      modal.body.querySelector('#retake-missing').onclick=reset;modal.body.querySelector('#use-ruler').onclick=()=>{state.mode='ruler';render();};modal.footer.querySelector('#capture-cancel').onclick=modal.close;return;
    }
    const count=state.rulerSecond?4:2;state.activePoint=Math.min(state.activePoint,count-1);
    modal.body.innerHTML=steps()+`<div class="capture-grid"><div class="capture-canvas"><canvas id="calibration-canvas" tabindex="0" role="img" aria-label="${esc(t('Měřítko: vyberte bod tlačítkem nebo klávesou 1 až 4 a umístěte jej na značku. Šipky bod posunou, Shift zpřesnění zrychlí.'))}"></canvas></div><div class="capture-sidebar"><h3>${t('Jen měřítko. Obrys uděláme sami.')}</h3><p>${t('Přesuňte body 1 a 2 na dvě značky pravítka. Čím dál jsou od sebe, tím lépe. Nástroj vyfoťte kolmo k podkladu.')}</p><p class="muted-note">${t('Vyberte bod a klikněte přesně na značku. Prázdný střed kříže nechává značku viditelnou; šipky posouvají bod po pixelu, Shift po deseti.')}</p><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px" role="group" aria-label="${esc(t('Kalibrační body'))}">${Array.from({length:count},(_,i)=>`<button class="btn btn-light" type="button" data-ruler-point="${i}" aria-pressed="${state.activePoint===i}">${t('Bod {n}',{n:i+1})}</button>`).join('')}</div><label class="field"><span>${t('Skutečná vzdálenost mezi značkami')}</span><div class="input-wrap"><input id="ruler-distance" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${Number.isFinite(state.rulerMm)?inputValue(state.rulerMm):''}"><em>${unit()}</em></div></label><label class="check-row" style="margin:16px 0"><input id="ruler-second" type="checkbox" ${state.rulerSecond?'checked':''}>${t('Druhé kolmé pravítko (volitelné)')}</label>${state.rulerSecond?`<label class="field"><span>${t('Vzdálenost mezi body 3 a 4')}</span><div class="input-wrap"><input id="ruler-second-distance" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${Number.isFinite(state.rulerSecondMm)?inputValue(state.rulerSecondMm):''}"><em>${unit()}</em></div></label><p class="muted-note">${t('Body 3 a 4 označují druhý známý úsek, který je na stejném podkladu fyzicky kolmý k prvnímu. Obě pravítka opraví rozdílné měřítko délky a šířky i zešikmení; plnou perspektivu nenahrazují. Pro silnou perspektivu použijte A4 nebo novou fotku shora.')}</p>`:''}${errorHTML()}</div></div>`;
    modal.footer.innerHTML=`<button class="btn btn-light" id="capture-back">${t('Jiná fotka')}</button><span class="footnote">${t('Pravítko slouží jen jako měřítko, konturu načteme automaticky.')}</span><button class="btn btn-primary" id="capture-continue">${t('Rozpoznat automaticky')} →</button>`;
    modal.body.querySelector('#ruler-distance').oninput=e=>{state.rulerMm=parseLength(e.target.value);setError('');}; // any unit: "100", "4 in", "10 cm"
    modal.body.querySelector('#ruler-second-distance')?.addEventListener('input',e=>{state.rulerSecondMm=parseLength(e.target.value);setError('');});
    modal.body.querySelector('#ruler-second').onchange=e=>{state.rulerSecond=e.target.checked;state.activePoint=state.rulerSecond?2:0;state.rulerPointer=null;setError('');render();modal.body.querySelector('#calibration-canvas').focus();};
    const canvas=modal.body.querySelector('#calibration-canvas');canvas.width=state.image.width;canvas.height=state.image.height;canvas.style.cursor='crosshair';canvas.style.touchAction='none';let dragging=null;
    const pos=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width-1,(e.clientX-r.left)*canvas.width/(r.width||canvas.width))),y:Math.max(0,Math.min(canvas.height-1,(e.clientY-r.top)*canvas.height/(r.height||canvas.height)))};};
    const finish=(cancel=false)=>{if(!dragging)return;const previous=dragging;dragging=null;if(cancel)state.ruler[previous.index]=previous.before;if(!canvas.hasPointerCapture||canvas.hasPointerCapture(previous.id))canvas.releasePointerCapture?.(previous.id);drawCalibration();};
    const selectPoint=index=>{finish(true);state.activePoint=index;state.rulerPointer=null;canvas.focus();drawCalibration();};
    modal.body.querySelectorAll('[data-ruler-point]').forEach(button=>button.onclick=()=>selectPoint(Number(button.dataset.rulerPoint)));
    canvas.onpointerdown=e=>{if(e.button!==0||e.isPrimary===false||dragging)return;e.preventDefault();canvas.focus();const p=pos(e),scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.width);let nearest=state.activePoint,distance=20*scale;for(let i=0;i<count;i++){const d=Math.hypot(p.x-state.ruler[i].x,p.y-state.ruler[i].y);if(d<distance){nearest=i;distance=d;}}state.activePoint=nearest;dragging={id:e.pointerId,index:nearest,before:{...state.ruler[nearest]}};state.ruler[nearest]=p;state.rulerPointer=p;canvas.setPointerCapture?.(e.pointerId);setError('');drawCalibration();};
    canvas.onpointermove=e=>{if(dragging&&e.pointerId!==dragging.id)return;if(dragging&&e.buttons===0){state.rulerPointer=null;finish(true);return;}if(!dragging&&e.isPrimary===false)return;const p=pos(e);state.rulerPointer=p;if(dragging)state.ruler[dragging.index]=p;drawCalibration();};
    canvas.onpointerup=e=>{if(dragging&&e.pointerId===dragging.id)finish();};
    canvas.onpointercancel=e=>{if(dragging&&e.pointerId===dragging.id){state.rulerPointer=null;finish(true);}};
    canvas.onlostpointercapture=e=>{if(dragging&&e.pointerId===dragging.id){state.rulerPointer=null;finish(true);}};
    canvas.onpointerleave=()=>{if(!dragging){state.rulerPointer=null;drawCalibration();}};
    canvas.onblur=()=>{state.rulerPointer=null;finish(true);drawCalibration();};
    cancelCalibration=canvas.onblur;
    canvas.onkeydown=e=>{if(/^[1-4]$/.test(e.key)&&Number(e.key)<=count){e.preventDefault();selectPoint(Number(e.key)-1);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();finish(true);state.rulerPointer=null;const p=state.ruler[state.activePoint],d=e.shiftKey?10:1;p.x=Math.max(0,Math.min(canvas.width-1,p.x+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0)));p.y=Math.max(0,Math.min(canvas.height-1,p.y+(e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0)));setError('');drawCalibration();}else if(e.key==='Escape'&&dragging){e.preventDefault();e.stopPropagation();state.rulerPointer=null;finish(true);}};
    modal.footer.querySelector('#capture-back').onclick=reset;
    modal.footer.querySelector('#capture-continue').onclick=()=>{finish(true);if(!(state.rulerMm>=1&&state.rulerMm<=5000)||state.rulerSecond&&!(state.rulerSecondMm>=1&&state.rulerSecondMm<=5000))return setError(t('Zadejte skutečnou vzdálenost mezi značkami od {min} do {max}.',{min:fmtLen(1),max:fmtLen(5000)}));try{if(state.rulerSecond)calibrateRulers(state.image,state.ruler,[state.rulerMm,state.rulerSecondMm]);else calibrateSegment(state.ruler[0],state.ruler[1],state.rulerMm);processPhoto();}catch(error){setError(errorText(error));}};
    drawCalibration();
  }
  function drawCalibration(){
    const canvas=modal.body.querySelector('#calibration-canvas');if(!canvas)return;const c=canvas.getContext('2d'),scale=canvas.width/(canvas.getBoundingClientRect().width||canvas.clientWidth||550),count=state.rulerSecond?4:2;
    c.putImageData(state.image,0,0);
    for(let j=0;j<count;j+=2){const a=state.ruler[j],b=state.ruler[j+1],length=Math.hypot(b.x-a.x,b.y-a.y),gap=Math.min(8*scale,length/3),dx=(b.x-a.x)/(length||1),dy=(b.y-a.y)/(length||1);c.beginPath();c.moveTo(a.x+dx*gap,a.y+dy*gap);c.lineTo(b.x-dx*gap,b.y-dy*gap);c.strokeStyle='#fff';c.lineWidth=3*scale;c.stroke();c.strokeStyle=j?'#237ca0':'#8c620a';c.lineWidth=1.25*scale;c.stroke();}
    const cross=(p,active=false)=>{const arm=(active?21:12)*scale,gap=3*scale;c.beginPath();c.moveTo(p.x-arm,p.y);c.lineTo(p.x-gap,p.y);c.moveTo(p.x+gap,p.y);c.lineTo(p.x+arm,p.y);c.moveTo(p.x,p.y-arm);c.lineTo(p.x,p.y-gap);c.moveTo(p.x,p.y+gap);c.lineTo(p.x,p.y+arm);c.strokeStyle='#fff';c.lineWidth=3*scale;c.stroke();c.strokeStyle=active?'#111':'#5b4a2e';c.lineWidth=1.2*scale;c.stroke();};
    state.ruler.slice(0,count).forEach((p,i)=>{cross(p,i===state.activePoint);const lx=Math.max(11*scale,Math.min(canvas.width-11*scale,p.x+18*scale)),ly=Math.max(11*scale,Math.min(canvas.height-11*scale,p.y-18*scale));c.fillStyle=i===state.activePoint?'#efb649':'#fff';c.fillRect(lx-8*scale,ly-8*scale,16*scale,16*scale);c.strokeStyle='#473b25';c.lineWidth=scale;c.strokeRect(lx-8*scale,ly-8*scale,16*scale,16*scale);c.fillStyle='#30291c';c.font=`bold ${11*scale}px system-ui`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(i+1),lx,ly);});
    if(state.rulerPointer)cross(state.rulerPointer,true);
    modal.body.querySelectorAll('[data-ruler-point]').forEach(button=>{const active=Number(button.dataset.rulerPoint)===state.activePoint;button.setAttribute('aria-pressed',String(active));button.classList.toggle('btn-primary',active);button.classList.toggle('btn-light',!active);});
  }
  function renderResult(){
    const quality=state.result?.quality||{status:'retake',reasons:[]},ready=quality.status==='ready'&&state.items.length>0;
    modal.body.innerHTML=steps()+`<div class="capture-grid"><div class="capture-canvas"><canvas id="trace-canvas" role="img" aria-label="${esc(t('Automaticky rozpoznané obrysy nástrojů'))}"></canvas></div><div class="capture-sidebar auto-sidebar"><div class="recognition-status ${ready?'ready':'retake'}">${icon(ready?'check':'camera')}${ready?t('Rozpoznáno automaticky'):t('Tuhle fotku raději zopakujte')}</div><h3>${ready?t('Obrysy jsou připravené.'):t('Z fotky není hrana dost jistá.')}</h3><p>${ready?t('Měřítko, oddělení pozadí i vyhlazení už jsou hotové. Stačí pojmenovat nástroje a přidat je do sestavy.'):t('Nebudeme po vás chtít kreslit konturu. Pořiďte novou fotku v lepším světle; nerozpoznanou hranu by bylo nutné hádat.')}</p>${!ready?`<div class="issue-box">${quality.reasons.map(r=>`<p>${esc(t(r))}</p>`).join('')||`<p>${t('Použijte rozptýlené světlo, oddělené předměty a kontrastní podklad.')}</p>`}</div>`:''}${ready?`<div id="trace-items" class="trace-items full-span"></div><p id="trace-summary" class="full-span"></p><label class="check-row"><input id="trace-mask" type="checkbox">${t('Kontrastní náhled')}</label>`:''}<button class="btn btn-light block-button" id="retake-photo">${icon('camera')}${t('Vybrat jinou fotku')}</button>${errorHTML()}<p class="muted-note full-span">${t('Rozměry níže jsou bez vůle kapsy. Hloubku kapsy nastavíte v šuplíku; z fotografie se neměří.')}</p></div></div>`;
    modal.footer.innerHTML=`<button class="btn btn-light" id="capture-back">${t('Jiná fotka')}</button><span class="footnote">${ready?t('Bez posuvníků. Bez ruční úpravy bodů.'):t('Přesný inzert začíná čitelnou fotografií.')}</span><button class="btn btn-primary" id="capture-add" ${ready?'':'disabled'}>${ready?t('Přidat do šuplíku'):t('Potřebuji lepší fotografii')}</button>`;
    const canvas=modal.body.querySelector('#trace-canvas');canvas.width=state.work?.width||state.image.width;canvas.height=state.work?.height||state.image.height;
    modal.body.querySelector('#retake-photo').onclick=reset;modal.footer.querySelector('#capture-back').onclick=reset;
    if(ready){
      modal.body.querySelector('#trace-mask').onchange=e=>{state.showMask=e.target.checked;drawResult();};
      const list=modal.body.querySelector('#trace-items');list.oninput=e=>{const index=Number(e.target.dataset.name);if(e.target.matches('input[type=text]')&&state.items[index])state.items[index].name=e.target.value.slice(0,80);};
      list.onchange=e=>{const index=Number(e.target.dataset.item);if(e.target.matches('input[type=checkbox]')&&state.items[index]){state.items[index].checked=e.target.checked;updateSummary();drawResult();}};
      list.innerHTML=state.items.map((item,i)=>`<div class="trace-item"><input type="checkbox" data-item="${i}" ${item.checked?'checked':''} aria-label="${esc(t('Přidat {name}',{name:item.name}))}"><input type="text" data-name="${i}" aria-label="${esc(t('Název nástroje {n}',{n:i+1}))}" value="${esc(item.name)}" maxlength="80" style="width:100%;min-width:55px;background:transparent;border:0;border-bottom:1px solid #e0e5d8;font:inherit;padding:5px 2px;color:#58684d"><span style="white-space:nowrap">${fmtSize(item.info.width,item.info.height)}</span></div>`).join('');
      modal.footer.querySelector('#capture-add').onclick=async()=>{
        const chosen=state.items.filter(i=>i.checked);if(state.busy||!chosen.length)return;
        if(chosen.some(i=>i.info.width>3000||i.info.height>3000||i.contour.points.length>6000)){setError(t('Měřítko neodpovídá velikosti nástrojů. Zkontrolujte vzdálenost na pravítku nebo použijte celou A4.'));return;}
        const tools=chosen.map(i=>({id:uid(),name:i.name.trim()||t('Nástroj'),points:i.contour.points.map(p=>({x:+((p.x-i.info.minX)/state.scale).toFixed(4),y:+((p.y-i.info.minY)/state.scale).toFixed(4)})),depth:12,x:0,y:0,rotation:0,locked:false,moduleId:null}));
        state.busy=true;updateSummary();try{await onAdd(tools);modal.close();}catch(error){state.busy=false;setError(errorText(error));updateSummary();}
      };
      updateSummary();
    }
    drawResult();
  }
  function updateSummary(){
    const count=state.items.filter(i=>i.checked).length,el=modal.body.querySelector('#trace-summary'),button=modal.footer.querySelector('#capture-add');
    if(el)el.textContent=t('{tools} · měřítko načteno',{tools:plural(count,['{n} nástroj připraven','{n} nástroje připraveny','{n} nástrojů připraveno'])});
    if(button){button.disabled=state.busy||count===0||state.result?.quality.status!=='ready';button.textContent=state.busy?t('Přidávám…'):count?t('Přidat do šuplíku ({n})',{n:count}):t('Vyberte alespoň jeden nástroj');}
  }
  function drawResult(){
    const canvas=modal.body.querySelector('#trace-canvas');if(!canvas)return;const ctx=canvas.getContext('2d'),image=state.work||state.image;
    if(state.showMask&&state.result?.mask){const pixels=new Uint8ClampedArray(image.width*image.height*4);for(let i=0;i<state.result.mask.length;i++){const v=state.result.mask[i]?44:249;pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=v;pixels[i*4+3]=255;}ctx.putImageData(new ImageData(pixels,image.width,image.height),0,0);}else ctx.putImageData(image,0,0);
    const scale=canvas.width/Math.max(250,canvas.clientWidth||550);
    if(state.result?.quality.status==='ready')for(const [i,item] of state.items.entries()){ctx.beginPath();item.contour.points.forEach((p,j)=>j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=item.checked?'#efb74e22':'#ffffff60';ctx.fill();ctx.strokeStyle=item.checked?'#e3a62e':'#9caa97';ctx.lineWidth=(item.checked?1.5:1)*scale;ctx.stroke();const p=item.info.center;ctx.beginPath();ctx.arc(p.x,p.y,10*scale,0,Math.PI*2);ctx.fillStyle='#efb74e';ctx.fill();ctx.fillStyle='#384830';ctx.font=`bold ${10*scale}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),p.x,p.y);}
  }
  function render(){
    if(closed)return;cancelCalibration?.();cancelCalibration=null;observer?.disconnect();
    if(state.step===0)renderUpload();else if(state.step===1)renderCalibration();else if(state.step===3)renderProcessing();else renderResult();
    const canvas=modal.body.querySelector('canvas');if(canvas&&typeof ResizeObserver==='function'&&state.step!==3){observer=new ResizeObserver(()=>{if(!closed)state.step===1?drawCalibration():drawResult();});observer.observe(canvas);}
  }
  render();return modal;
}
