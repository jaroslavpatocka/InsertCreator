import {createManufacturingClient} from './manufacturing-client.js';
import {esc} from './ui.js';
import {t,errorText,getLang} from './i18n.js';
import {fmtSize,unit} from './units.js';

const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));

/** A static, lazy 3D carousel. Its worker is independent of export analysis. */
export function createExportPreview({project,entries=project?.modules||[],client}={}){
  const snapshot=copy(project||{}),ids=new Set(entries.map(entry=>entry.id));
  const preferences={lang:getLang(),unit:unit()};
  const modules=(snapshot.modules||[]).filter(module=>ids.has(module.id));
  const ownsClient=!client,worker=client||createManufacturingClient(),controller=new AbortController();
  const cache=new Map(),failed=new Set();let root=null,track=null,active=0,running=false,disposed=false,scrollTimer=null;
  const html=`<section class="export-preview" data-export-preview aria-roledescription="${esc(t('Karusel'))}" aria-label="${esc(t('Náhledy exportovaných modulů'))}"><div class="export-preview__heading"><h3>${esc(t('Náhledy exportovaných modulů'))}</h3><div class="export-preview__controls"><button type="button" class="icon-btn" data-preview-prev aria-label="${esc(t('Předchozí modul'))}" disabled>‹</button><span data-preview-counter aria-live="polite" aria-atomic="true">${modules.length?`1 / ${modules.length}`:'0 / 0'}</span><button type="button" class="icon-btn" data-preview-next aria-label="${esc(t('Další modul'))}" ${modules.length<2?'disabled':''}>›</button></div></div>${modules.length?`<div class="export-preview__track" data-preview-track tabindex="0" aria-label="${esc(t('Procházet náhledy modulů'))}">${modules.map((module,index)=>`<article class="export-preview__slide" data-preview-slide="${index}" role="group" aria-roledescription="${esc(t('Snímek'))}" aria-label="${index+1} / ${modules.length}"><div class="export-preview__image" data-preview-image="${index}"><p class="export-preview__placeholder">${esc(t('Připravuji náhled…'))}</p></div><div class="export-preview__caption"><strong>${esc(module.name||t('Modul'))}</strong><span>${esc(fmtSize(module.width,module.height))}</span></div><p class="export-preview__status" data-preview-status="${index}"></p></article>`).join('')}</div><p class="export-preview__hint">${esc(t('Statické náhledy odpovídají nastavení u 3D náhledu.'))}</p>`:`<p class="export-preview__empty">${esc(t('Pro náhled označte alespoň jeden modul.'))}</p>`}</section>`;

  const imageAt=index=>root?.querySelector(`[data-preview-image="${index}"]`);
  const statusAt=index=>root?.querySelector(`[data-preview-status="${index}"]`);
  const near=index=>Math.abs(index-active)<=1;
  function paint(index,result){
    const slot=imageAt(index),status=statusAt(index);if(!slot)return;
    // HTML is produced by our local mesher; project names are escaped there.
    slot.innerHTML=`<svg viewBox="${esc(result.viewBox)}" role="img" aria-label="${esc(t('3D náhled modulu {name}',{name:modules[index].name||t('Modul')}))}" focusable="false">${result.html}</svg>`;
    for(const node of slot.querySelectorAll('[tabindex], [role="button"]')){node.removeAttribute('tabindex');if(node.getAttribute('role')==='button')node.removeAttribute('role');}
    slot.removeAttribute('aria-busy');
    if(status)status.textContent=result.stats?.reducedDetail?t('Zjednodušený náhled. Výrobní soubor zůstává úplný.'):result.warnings?.[0]||'';
  }
  function trim(){
    // Keep at most three generated SVGs, even when the drawer has thousands of modules.
    for(const index of cache.keys())if(!near(index)){
      cache.delete(index);const slot=imageAt(index);if(slot)slot.innerHTML=`<p class="export-preview__placeholder">${esc(t('Připravuji náhled…'))}</p>`;
      const status=statusAt(index);if(status)status.textContent='';
    }
  }
  async function pump(){
    if(running||disposed||!root?.isConnected)return;
    running=true;
    try{
      while(!disposed&&root?.isConnected){
        const index=[active,active+1,active-1].find(index=>index>=0&&index<modules.length&&!cache.has(index)&&!failed.has(index));
        if(index===undefined)break;
        const slot=imageAt(index);slot?.setAttribute('aria-busy','true');
        try{
          // Keep the complete assembly for connector planning; the renderer fits and
          // displays this module only. No project or manufacturing setting is edited.
          const result=await worker.run('preview',{...snapshot,previewModuleIds:[modules[index].id],previewCuts:false},{...preferences,signal:controller.signal,viewport:{width:560,height:280},camera:{yaw:Math.PI/4,pitch:.7,zoom:1,panX:0,panY:0}});
          if(disposed||!root?.isConnected)return;
          if(near(index)){cache.set(index,result);paint(index,result);trim();}
        }catch(error){
          if(disposed||error?.name==='AbortError')return;
          failed.add(index);slot?.removeAttribute('aria-busy');
          if(slot)slot.innerHTML=`<p class="export-preview__placeholder export-preview__error">${esc(t('Náhled nelze zobrazit.'))}</p>`;
          const status=statusAt(index);if(status)status.textContent=errorText(error);
        }
      }
    }finally{running=false;}
  }
  function activate(index,{scroll=false}={}){
    if(disposed||!modules.length)return;
    active=Math.max(0,Math.min(modules.length-1,index));
    root.querySelector('[data-preview-prev]').disabled=active===0;
    root.querySelector('[data-preview-next]').disabled=active===modules.length-1;
    root.querySelector('[data-preview-counter]').textContent=`${active+1} / ${modules.length}`;
    if(scroll&&track){const left=active*track.clientWidth,reduced=root.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;if(typeof track.scrollTo==='function')track.scrollTo({left,behavior:reduced?'auto':'smooth'});else track.scrollLeft=left;}
    trim();pump();
  }
  const onPrevious=()=>activate(active-1,{scroll:true}),onNext=()=>activate(active+1,{scroll:true});
  const onKey=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();activate(event.key==='Home'?0:event.key==='End'?modules.length-1:active+(event.key==='ArrowLeft'?-1:1),{scroll:true});
  };
  const onScroll=()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(track?.clientWidth)activate(Math.round(track.scrollLeft/track.clientWidth));},100);};
  function mount(element){
    if(disposed||root)return;
    root=element?.matches?.('[data-export-preview]')?element:element?.querySelector('[data-export-preview]');
    if(!root)return;
    track=root.querySelector('[data-preview-track]');
    root.querySelector('[data-preview-prev]')?.addEventListener('click',onPrevious);
    root.querySelector('[data-preview-next]')?.addEventListener('click',onNext);
    track?.addEventListener('keydown',onKey);track?.addEventListener('scroll',onScroll,{passive:true});
    pump();
  }
  function dispose(){
    if(disposed)return;disposed=true;clearTimeout(scrollTimer);controller.abort();
    root?.querySelector('[data-preview-prev]')?.removeEventListener('click',onPrevious);
    root?.querySelector('[data-preview-next]')?.removeEventListener('click',onNext);
    track?.removeEventListener('keydown',onKey);track?.removeEventListener('scroll',onScroll);
    if(ownsClient)worker.dispose();cache.clear();root=null;track=null;
  }
  return{html,mount,dispose};
}
