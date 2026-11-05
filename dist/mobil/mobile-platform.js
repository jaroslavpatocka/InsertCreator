// Browser capabilities are optional; ordinary photo upload and downloading
// remain available without camera, installation or file sharing APIs.
let installed=false,deferredInstall=null;
export const mobileInstallState=()=>({available:!!deferredInstall,standalone:!!(globalThis.navigator?.standalone||globalThis.matchMedia?.('(display-mode: standalone)').matches)});
export function installGuidance(){
  return typeof document!=='undefined'&&document.documentElement.lang==='en'
    ? 'iPhone / iPad: open the HTTPS address in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome and choose Install app or Add to Home screen. On local HTTP, use Take photo or Choose photo; the camera/file picker offered depends on your phone. Offline use, native sharing and app installation need HTTPS. Projects remain in this browser, so export a JSON backup before clearing its data.'
    : 'iPhone / iPad: otevřete HTTPS adresu v Safari, klepněte na Sdílet a Přidat na plochu. Android: otevřete adresu v Chrome a vyberte Nainstalovat aplikaci nebo Přidat na plochu. V místní síti přes HTTP použijte Vyfotit nebo Vybrat fotku; nabídku fotoaparátu a souborů určuje telefon. Offline provoz, systémové sdílení a instalace aplikace vyžadují HTTPS. Projekty zůstávají v tomto prohlížeči, proto před smazáním jeho dat uložte zálohu JSON.';
}
export async function installMobileApp(){
  const prompt=deferredInstall;if(!prompt)return false;deferredInstall=null;
  try{await prompt.prompt();return(await prompt.userChoice)?.outcome==='accepted';}catch{return false;}
}
export function initMobilePlatform(){
  if(installed||typeof window==='undefined'||typeof document==='undefined')return;installed=true;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;});
  window.addEventListener('appinstalled',()=>{deferredInstall=null;});
  // Safari's visible viewport follows the keyboard more reliably than dvh.
  const viewport=window.visualViewport,root=document.documentElement;
  const update=()=>{
    const height=viewport?.height||window.innerHeight;
    if(Number.isFinite(height)&&height>0){root.style.setProperty('--mobile-visible-height',height+'px');root.style.setProperty('--mobile-vh',height+'px');}
    if(Number.isFinite(viewport?.offsetTop))root.style.setProperty('--mobile-visible-top',viewport.offsetTop+'px');
    const editable=document.activeElement?.matches?.('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]');
    root.classList.toggle('mobile-keyboard-open',!!editable&&window.innerHeight-height>120);
  };
  viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);
  window.addEventListener('resize',update);document.addEventListener('focusin',update);document.addEventListener('focusout',()=>requestAnimationFrame(update));update();
}
