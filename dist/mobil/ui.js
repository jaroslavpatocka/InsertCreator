import {t} from './i18n.js';

const paths={
 camera:'M14 4h-4L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 drawer:'M3 4h18v16H3z M3 11h18 M9 7h6 M9 15h6',
 library:'M4 4h4v16H4z M11 4h4v16h-4z M18 4l3-1 4 15-3 1z',
 folder:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
 help:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4 M12 17h.01 M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
 plus:'M12 5v14 M5 12h14',
 close:'M6 6l12 12 M6 18 18 6',
 check:'M5 12l4 4L19 6',
 chevron:'m9 5 7 7-7 7',
 down:'m5 9 7 7 7-7',
 download:'M12 3v12 m-5-5 5 5 5-5 M4 16v4h16v-4',
 upload:'M12 16V4 m-5 5 5-5 5 5 M4 17v4h16v-4',
 save:'m3 3 15 0 3 3v15H3z M7 3v6h10V3 M7 21v-8h10v8',
 undo:'M9 5 3 10l6 5 M3 10h10a6 6 0 0 1 6 6',
 redo:'m15 5 6 5-6 5 M21 10H11a6 6 0 0 0-6 6',
 move:'M12 3v18 M3 12h18 m-12-6 3-3 3 3 m-6 12 3 3 3-3 M6 9l-3 3 3 3 m12-6 3 3-3 3',
 rotate:'M20 7V2l-5 5h5 M20 7a9 9 0 1 0 1 8',
 zoomIn:'M10 6v8 M6 10h8 M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 zoomOut:'M6 10h8 M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 fit:'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
 cube:'m12 2 10 5v10l-10 5-10-5V7z M2 7l10 5 10-5 M12 12v10 M7 4.5l10 5',
 ruler:'m3 17 14-14 4 4L7 21z M6 14l2 2 m1-5 2 2 m1-5 2 2 m1-5 2 2',
 wrench:'M14 6a5 5 0 0 0-6.7 6.7L2 18l4 4 5.3-5.3A5 5 0 0 0 18 10l-4 4-4-4z',
 spark:'m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
 lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
 unlock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 7-2 M12 14v3',
 trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
 copy:'M8 8h13v13H8z M16 8V3H3v13h5',
 edit:'m3 17 12-12 4 4L7 21H3z m10-10 4 4 M15 5l2-2 4 4-2 2',
 image:'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M9 7h.01',
 shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z m-4 10 3 3 5-6',
 lightbulb:'M9 17h6 M9 21h6 M8 14a6 6 0 1 1 8 0l-1 3H9z',
 more:'M5 12h.01 M12 12h.01 M19 12h.01',
 expand:'M3 8V3h5 M21 16v5h-5 M3 3l6 6 M21 21l-6-6 M16 3h5v5 M8 21H3v-5',
 arrow:'M4 12h16 m-6-6 6 6-6 6',
 file:'M4 2h10l6 6v14H4z M14 2v6h6 M8 13h8 M8 17h6',
 reset:'M3 11a9 9 0 1 1 1 6 M3 4v7h7',
 info:'M12 10v7 M12 7h.01 M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
 eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 print:'M6 8V2h12v6 M6 18H3V8h18v10h-3 M6 14h12v8H6z M17 11h.01'
};
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon=(name)=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.grid}"/></svg>`;
let activeModal=null;
export function closeModal(){activeModal?.close();}
export function openModal({title,subtitle='',body='',footer='',wide=false,onClose}){
  closeModal();
  const previousFocus=document.activeElement;
  const root=document.querySelector('#modal-root');
  root.innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-btn" data-modal-close aria-label="${esc(t('Zavřít'))}">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot">${footer}</div></section></div>`;
  document.body.style.overflow='hidden';
  const el=root.querySelector('.modal');
  const close=()=>{if(activeModal?.el!==el)return;moveFileTray(document.body);root.innerHTML='';document.body.style.overflow='';document.removeEventListener('keydown',handleKey);activeModal=null;onClose?.();if(previousFocus?.isConnected)previousFocus.focus();};
  const handleKey=e=>{
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const targets=[...el.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);
      if(!targets.length){e.preventDefault();el.focus();return;}
      if(e.shiftKey&&document.activeElement===targets[0]){e.preventDefault();targets.at(-1).focus();}
      else if(!e.shiftKey&&document.activeElement===targets.at(-1)){e.preventDefault();targets[0].focus();}
    }
  };
  root.querySelector('[data-modal-close]').onclick=close;
  root.querySelector('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))close();};
  document.addEventListener('keydown',handleKey);
  activeModal={el,body:el.querySelector('.modal-body'),footer:el.querySelector('.modal-foot'),close};
  moveFileTray(el);
  requestAnimationFrame(()=>el.focus());return activeModal;
}
let toastTimer;
export function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4700);}
export function download(name,data,type='application/octet-stream'){
  const blob=new Blob([data],{type});
  if(isMobileDownload()){queueMobileFile(name,blob);return;}
  const url=URL.createObjectURL(blob);saveFileLink(name,url);setTimeout(()=>URL.revokeObjectURL(url),30000);
}

const mobileFiles=[];
let fileTray=null;
const mobileText=(cs,en)=>document.documentElement.lang==='en'?en:cs;
function isMobileDownload(){return /iPhone|iPad|iPod|Android/i.test(globalThis.navigator?.userAgent||'')||!!globalThis.matchMedia?.('(pointer: coarse)').matches;}
function saveFileLink(name,url){const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();}
function moveFileTray(parent){if(fileTray?.isConnected&&fileTray.parentNode!==parent)parent.append(fileTray);}
function removeMobileFile(item){const at=mobileFiles.indexOf(item);if(at<0)return;mobileFiles.splice(at,1);URL.revokeObjectURL(item.url);renderMobileFiles();}
function shareableFile(item){try{const file=new File([item.blob],item.name,{type:item.blob.type});return typeof navigator.share==='function'&&(!navigator.canShare||navigator.canShare({files:[file]}))?file:null;}catch{return null;}}
function queueMobileFile(name,blob){
  // Keep the Blob URL until explicit dismissal: iOS may open a preview first
  // and save it later. An asynchronous export has no user activation left.
  mobileFiles.push({name:String(name),blob,url:URL.createObjectURL(blob)});
  renderMobileFiles();
}
function renderMobileFiles(){
  if(!mobileFiles.length){fileTray?.remove();fileTray=null;return;}
  if(!fileTray){fileTray=document.createElement('section');fileTray.className='mobile-file-tray';fileTray.setAttribute('role','region');}
  fileTray.setAttribute('aria-label',mobileText('Soubory k uložení','Files ready to save'));
  fileTray.innerHTML=`<div class="mobile-file-tray__heading"><strong>${mobileText('Soubor je připravený','Your file is ready')}</strong><button type="button" class="icon-btn" data-files-close aria-label="${mobileText('Zavřít připravené soubory','Dismiss prepared files')}">${icon('close')}</button></div><ul class="mobile-file-tray__list">${mobileFiles.map((item,i)=>`<li><strong>${esc(item.name)}</strong><small>${Math.max(1,Math.ceil(item.blob.size/1024))} KB</small><div class="mobile-file-tray__actions">${shareableFile(item)?`<button type="button" class="btn btn-primary" data-file-share="${i}">${mobileText('Uložit / sdílet','Save / share')}</button>`:''}<button type="button" class="btn btn-light" data-file-save="${i}">${mobileText('Stáhnout','Download')}</button><button type="button" class="icon-btn" data-file-remove="${i}" aria-label="${mobileText('Odebrat soubor','Dismiss file')}: ${esc(item.name)}">${icon('close')}</button></div></li>`).join('')}</ul><p class="mobile-file-tray__status" role="status">${mobileText('Klepnutím uložte soubor do zařízení.','Tap to save the file to your device.')}</p>`;
  fileTray.querySelector('[data-files-close]').onclick=()=>{for(const item of [...mobileFiles])removeMobileFile(item);};
  fileTray.querySelectorAll('[data-file-remove]').forEach(button=>button.onclick=()=>removeMobileFile(mobileFiles[Number(button.dataset.fileRemove)]));
  fileTray.querySelectorAll('[data-file-save]').forEach(button=>button.onclick=()=>{const item=mobileFiles[Number(button.dataset.fileSave)];saveFileLink(item.name,item.url);fileTray.querySelector('[role=status]').textContent=mobileText('Stahování zahájeno. V Safari lze soubor uložit také z náhledu přes Sdílet.','Download started. In Safari, you can also save the preview through Share.');});
  fileTray.querySelectorAll('[data-file-share]').forEach(button=>button.onclick=()=>{
    const item=mobileFiles[Number(button.dataset.fileShare)],file=shareableFile(item);if(!file)return;
    // Call immediately in the click handler, before any await: Web Share is
    // gated on transient activation in both Safari and Chromium.
    let sharing;try{sharing=navigator.share({files:[file],title:item.name});}catch(error){sharing=Promise.reject(error);}
    button.disabled=true;
    Promise.resolve(sharing).then(()=>{if(fileTray)fileTray.querySelector('[role=status]').textContent=mobileText('Soubor byl předán ke sdílení.','File passed to the share sheet.');}).catch(error=>{if(fileTray)fileTray.querySelector('[role=status]').textContent=error?.name==='AbortError'?mobileText('Sdílení zrušeno. Soubor zůstává připravený.','Sharing cancelled. Your file is still ready.'):mobileText('Sdílení není dostupné. Použijte Stáhnout.','Sharing is unavailable. Use Download.');}).finally(()=>{if(button.isConnected)button.disabled=false;});
  });
  (activeModal?.el||document.body).append(fileTray);
}
