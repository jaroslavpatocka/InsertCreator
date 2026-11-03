import {bounds,transformedPoints,autoArrange,resizeModule,validateLayout,exportSVG,exportDXF,exportSTL,exportFitSTL,printStats,zipFiles,createDemoProject} from './geometry.js';
import {printPreview,createCamera3D,normalizeCamera3D} from './preview3d.js';
import {createViewControls} from './view-controls.js';
import {exportFitPDF} from './fit-sheet.js';
import {openCapture} from './capture.js';
import {mountLibraryFolders} from './catalog-ui.js';
import {esc,icon,openModal,closeModal,toast,download} from './ui.js';
import {uid,clone,validateProject,readLocal,writeLocal,blankProject} from './model.js';
import {automaticFingerGrips,pocketOutline,validateFingerGrips} from './finger-grip.js';
import {runSmartLayout} from './smart-layout-client.js';
import {findToolSets,setCoherence} from './tool-sets.js';
// `t` is used for tool variables throughout this file, so the translator is imported as `tr`.
import {t as tr,plural,i18nError,errorText,getLang,setLang,onLangChange,LANGS,LANG_NAMES,fmtNum} from './i18n.js';
import {unit,unitFor,getAppUnit,setAppUnit,setProjectUnit,UNITS,fmtLen,fmtSize,inputValue,parseLength} from './units.js';

const $=s=>document.querySelector(s);
const fmt=(v,d=1)=>fmtNum(v,d);
const sizeShort=(w,h,u=unit())=>fmtSize(w,h,{unit:u,digits:u==='in'?2:0});
const localizeDemo=p=>({...p,name:tr(p.name),tools:p.tools.map(x=>({...x,name:tr(x.name)})),modules:(p.modules||[]).map(m=>({...m,name:tr(m.name)}))});
const demoProject=()=>validateProject({...localizeDemo(createDemoProject()),id:uid()});
function applyDocumentText(){
  document.documentElement.lang=getLang();document.title=tr('Šuplík Studio — místo pro každý nástroj');
  document.querySelector('meta[name=description]')?.setAttribute('content',tr('Z fotky nástroje k přesnému inzertu. Český editor modulárních organizérů do šuplíku s lokálním zpracováním a exportem STL, SVG a DXF.'));
}
/** Typed length of a length <input> in mm. An untouched field returns its exact stored value (no display rounding). */
function readLength(el){if(el.dataset.mm!==undefined&&el.value===el.getAttribute('value'))return Number(el.dataset.mm);const v=parseLength(el.value,el.dataset.unit||unit());return Number.isFinite(v)?Math.round(v*1e4)/1e4:NaN;}
/** Validated length in mm within the field's data-min/data-max, or null after a translated toast. */
function lengthFrom(el){
  const v=readLength(el),min=Number(el.dataset.min),max=Number(el.dataset.max),u=el.dataset.unit||unit();
  if(!Number.isFinite(v)){toast(tr('Zadejte platnou délku, například 12, 12,5 mm nebo 3 1/2 in.'));return null;}
  if(v<min-.02||v>max+.02){toast(tr('Zadejte hodnotu od {min} do {max}.',{min:fmtLen(min,{unit:u}),max:fmtLen(max,{unit:u})}));return null;}
  return Math.min(max,Math.max(min,v));
}
const slug=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'suplik';
const paths=points=>points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')+'Z';
const palette=['#acb998','#a4b9a9','#b4bd9e','#aebda1','#bdb7a1','#b3bda8'];
const storageKey='suplik-studio-projects-v1',libraryKey='suplik-studio-library-v1';
let projects=readLocal(storageKey,[]);
if(!Array.isArray(projects))projects=[];
projects=projects.flatMap(p=>{try{return[validateProject(p)]}catch{return[]}});
let project=projects.find(p=>p.id===readLocal('suplik-studio-current',''))||projects[0];
if(!project){project=demoProject();projects=[project];}
let library=readLocal(libraryKey,null);
if(!Array.isArray(library))library=localizeDemo(createDemoProject()).tools.map(t=>({...clone(t),x:0,y:0,moduleId:null}));
library=library.flatMap(t=>{try{return[validateProject({...blankProject(),tools:[t]}).tools[0]];}catch{return[];}});
let selected=project.tools[0]?.id||null,selectedModule=null,inspectorTab='drawer',view='2d',zoom=1,snap=true,showGrid=true,showLabels=true,tipVisible=!readLocal('suplik-hide-tip',false);
let undoStack=[],redoStack=[],drag=null,storageFailed=false,moveMode=false;
let camera3D=createCamera3D(),cameraFrame={width:1000,height:600,zoom:1},viewControls=null;
let smartLayoutRun=null;
const smartModeKey='suplik-studio-smart-mode';
let smartMode=readLocal(smartModeKey,'sets');if(!['sets','compact'].includes(smartMode))smartMode='sets';writeLocal(smartModeKey,smartMode);
const tool=()=>project.tools.find(t=>t.id===selected);
const moduleFor=(t=tool())=>project.modules.find(m=>m.id===(t?.moduleId||selectedModule));
const errors=()=>validateLayout(project);
function remember(){undoStack.push(clone(project));if(undoStack.length>40)undoStack.shift();redoStack=[];}
function persist(){
  project.updatedAt=new Date().toISOString();const index=projects.findIndex(p=>p.id===project.id);if(index>=0)projects[index]=clone(project);else projects.push(clone(project));
  const ok=writeLocal(storageKey,projects)&&writeLocal('suplik-studio-current',project.id);
  if(!ok&&!storageFailed)toast(tr('Úložiště prohlížeče je plné nebo vypnuté. Uložte projekt jako JSON.'));storageFailed=!ok;return ok;
}
function commit(fn,message){remember();fn();persist();render();if(message)toast(message);}
function smartMessage(message){const text=String(message||'Porovnávám rozvržení…'),match=text.match(/^Hledám místo pro celé kapsy včetně prstů \((\d+) vhodných dvojic\)…$/);return match?tr('Hledám místo pro celé kapsy včetně prstů ({n} vhodných dvojic)…',{n:match[1]}):tr(text);}
const same=value=>JSON.stringify(value);
const layoutArea=p=>p.modules.reduce((sum,m)=>sum+(m.width-.5)*(m.height-.5),0);
const placedTools=p=>{const ids=new Set(p.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=p.width+1e-6&&m.y+m.height<=p.height+1e-6).map(m=>m.id));return new Set(p.tools.filter(t=>ids.has(t.moduleId)).map(t=>t.id));};
function layoutMetric(p){const modules=p.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=p.width+1e-6&&m.y+m.height<=p.height+1e-6),bbox=modules.length?(Math.max(...modules.map(m=>m.x+m.width))-Math.min(...modules.map(m=>m.x)))*(Math.max(...modules.map(m=>m.y+m.height))-Math.min(...modules.map(m=>m.y))):0;return{placed:placedTools(p).size,area:layoutArea(p),modules:p.modules.length,bbox};}
function betterLayout(a,b,mode='compact'){if(a.placed!==b.placed)return a.placed>b.placed;if(mode==='sets'&&a.setScore!==b.setScore)return a.setScore>b.setScore;return a.area<b.area-1e-6||(Math.abs(a.area-b.area)<=1e-6&&(a.modules<b.modules||(a.modules===b.modules&&a.bbox<b.bbox-1e-6)));}
function checkLayoutTransition(before,next){
  const placed=placedTools(before),after=placedTools(next),lost=before.tools.find(t=>placed.has(t.id)&&!after.has(t.id));
  if(lost)throw i18nError('Nástroj „{name}“ by se už nevešel. Zvětšete šuplík nebo uvolněte místo.',{name:lost.name});
  const modules=next.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=next.width+1e-6&&m.y+m.height<=next.height+1e-6),insideIds=new Set(modules.map(m=>m.id));
  const placedIssue=validateLayout({...next,modules,tools:next.tools.filter(t=>insideIds.has(t.moduleId))})[0];if(placedIssue)throw Error(placedIssue.message);
  const unplacedIds=new Set(next.tools.filter(t=>!after.has(t.id)).map(t=>t.id));
  const outsideIds=new Set(next.modules.filter(m=>!insideIds.has(m.id)&&next.tools.some(t=>t.moduleId===m.id)&&next.tools.filter(t=>t.moduleId===m.id).every(t=>unplacedIds.has(t.id))).map(m=>m.id));
  const issue=validateLayout(next).find(i=>!(i.type==='outside'&&i.ids.length===1&&(unplacedIds.has(i.ids[0])||outsideIds.has(i.ids[0]))));if(issue)throw Error(issue.message);
}
function checkedSmartResult(before,result,mode='compact'){
  if(!result||!Array.isArray(result.tools)||!Array.isArray(result.modules)||result.tools.length!==before.tools.length)throw Error(tr('Chytré rozvržení nevrátilo úplnou sestavu.'));
  const checked=validateProject({...before,tools:result.tools,modules:result.modules}),rawTools=new Map(result.tools.map(t=>[t.id,t])),newModules=new Map(checked.modules.map(m=>[m.id,m]));
  const oldModules=new Map(before.modules.map(m=>[m.id,m])),placements=new Set(['x','y','rotation','moduleId','fingerGrips']);
  const members=id=>before.tools.filter(t=>t.moduleId===id);
  const fixedIds=new Set(before.modules.filter(m=>m.locked||!members(m.id).length||members(m.id).some(t=>t.locked)).map(m=>m.id));
  const rebuildable=m=>mode==='sets'&&!fixedIds.has(m.id)&&m.sizeMode!=='manual'&&(m.grouped===true||m.setLayout==='uniform');
  const protectedIds=new Set(before.modules.filter(m=>fixedIds.has(m.id)||m.sizeMode==='manual'||(!rebuildable(m)&&(m.grouped||m.setLayout==='uniform'||members(m.id).length>1))).map(m=>m.id));
  const rawModules=new Map(result.modules.map(m=>[m.id,m]));
  const next={...clone(before),tools:[],modules:checked.modules.map(m=>({...clone(oldModules.get(m.id)||{}),...clone(rawModules.get(m.id)),...m}))};
  for(const t of before.tools){
    const raw=rawTools.get(t.id),valid=checked.tools.find(n=>n.id===t.id);if(!raw||!valid)throw Error(tr('V chytrém rozvržení chybí nástroj.'));
    for(const key of Object.keys(t))if(!placements.has(key)&&same(raw[key])!==same(t[key]))throw i18nError('Chytré rozvržení změnilo údaje nástroje „{name}“.',{name:t.name});
    if(Object.keys(raw).some(key=>!Object.hasOwn(t,key)&&!placements.has(key)))throw Error(tr('Chytré rozvržení změnilo údaje nástroje.'));
    const item={...clone(t),x:valid.x,y:valid.y,rotation:valid.rotation,moduleId:valid.moduleId};
    if(Object.hasOwn(t,'fingerGrips')){if(!Object.hasOwn(raw,'fingerGrips')||same(raw.fingerGrips)!==same(t.fingerGrips))throw Error(tr('Chytré rozvržení změnilo nastavené výřezy pro prsty.'));}
    else if(Object.hasOwn(raw,'fingerGrips')){
      const m=newModules.get(valid.moduleId),count=checked.tools.filter(n=>n.moduleId===valid.moduleId).length;
      if(!m?.grouped||(oldModules.has(m.id)&&!rebuildable(oldModules.get(m.id)))||count<2||same(valid.fingerGrips)!==same(automaticFingerGrips(t,{radius:9})))throw Error(tr('Chytré rozvržení přidalo neplatné výřezy pro prsty.'));
      item.fingerGrips=valid.fingerGrips;
    }
    if((t.locked||fixedIds.has(t.moduleId))&&['x','y','rotation','moduleId'].some(key=>same(item[key])!==same(t[key])))throw Error(tr('Chytré rozvržení přesunulo zamčený nástroj.'));
    if(protectedIds.has(t.moduleId)&&!fixedIds.has(t.moduleId)){
      const old=oldModules.get(t.moduleId),m=newModules.get(t.moduleId);
      if(!m||item.moduleId!==t.moduleId||item.rotation!==t.rotation||Math.abs(item.x-t.x-(m.x-old.x))>1e-6||Math.abs(item.y-t.y-(m.y-old.y))>1e-6)throw Error(tr('Chytré rozvržení změnilo vzájemnou polohu nástrojů ve společném nebo ručním modulu.'));
    }
    next.tools.push(item);
  }
  for(const id of protectedIds){
    const old=oldModules.get(id),m=newModules.get(id);
    if(!m||['id','name','width','height','locked'].some(key=>same(m[key])!==same(old[key]))||(fixedIds.has(id)&&(m.x!==old.x||m.y!==old.y))||(m.sizeMode||'auto')!==(old.sizeMode||'auto')||!!m.grouped!==!!old.grouped)throw Error(tr('Chytré rozvržení změnilo zamčený, ruční nebo společný modul.'));
    next.modules[next.modules.findIndex(m=>m.id===id)]={...clone(old),x:m.x,y:m.y};
  }
  checkLayoutTransition(before,next);return next;
}
async function smartArrangeProject(){
  const before=clone(project),mode=smartMode,definitions=mode==='sets'?findToolSets(before).sets:[],controller=new AbortController(),job={controller,key:same(project),done:false};
  const modal=openModal({title:tr('Chytré rozvržení'),subtitle:mode==='sets'?tr('Sady nástrojů: společný směr a sjednocené moduly.'):tr('Nejmenší plocha: porovnám bezpečné varianty a společné moduly.'),body:tr('<div class="smart-layout-progress" role="status" aria-live="polite"><p data-smart-message>Připravuji výpočet…</p><progress data-smart-progress max="1" value="0" aria-label="Průběh chytrého rozvržení"></progress><small data-smart-percent>0 %</small></div>'),footer:tr('<span class="footnote">Sestavu můžete během výpočtu ponechat beze změny.</span><button class="btn btn-light" data-smart-cancel>Zrušit</button>'),onClose:()=>{if(!job.done)controller.abort();}});
  smartLayoutRun=job;
  const finishUI=(title,body)=>{modal.body.innerHTML=`<div class="smart-layout-result"><h3>${esc(title)}</h3>${body}</div>`;modal.footer.innerHTML=`<span></span><button class="btn btn-primary" data-smart-close>${tr('Hotovo')}</button>`;modal.footer.querySelector('[data-smart-close]').onclick=modal.close;};
  modal.el.querySelector('[data-smart-cancel]').onclick=()=>{controller.abort();modal.close();toast(tr('Chytré rozvržení zrušeno. Sestava se nezměnila.'));};
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    if(controller.signal.aborted||smartLayoutRun!==job||!modal.el.isConnected)return;
    const result=await runSmartLayout(before,{mode,signal:controller.signal,onProgress:event=>{
      if(smartLayoutRun!==job||controller.signal.aborted||!modal.el.isConnected)return;
      const value=Math.max(0,Math.min(1,Number(event?.progress)||0));job.lastMessage=event?.message?smartMessage(event.message):job.lastMessage;modal.body.querySelector('[data-smart-progress]').value=value;modal.body.querySelector('[data-smart-percent]').textContent=Math.round(value*100)+' %';modal.body.querySelector('[data-smart-message]').textContent=smartMessage(event?.message);
    }});
    if(controller.signal.aborted||smartLayoutRun!==job||!modal.el.isConnected)return;
    if(same(project)!==job.key)throw Error(tr('Sestava se během výpočtu změnila. Spusťte chytré rozvržení znovu.'));
    const next=checkedSmartResult(before,result,mode),oldMetric=layoutMetric(before),newMetric=layoutMetric(next),beforeArea=oldMetric.area,afterArea=newMetric.area,saving=beforeArea>0?(beforeArea-afterArea)/beforeArea*100:0;
    oldMetric.setScore=mode==='sets'?setCoherence(before,definitions).score:0;newMetric.setScore=mode==='sets'?setCoherence(next,definitions).score:0;
    const setSummary=mode==='sets'?toolSetResultSummary(definitions,before,next,result):'';
    if(!betterLayout(newMetric,oldMetric,mode)){job.done=true;finishUI(job.lastMessage||tr('Lepší bezpečné rozvržení nebylo nalezeno.'),tr('<p>Stávající sestava zůstala beze změny.</p>')+setSummary);return;}
    const shared=next.modules.filter(m=>next.tools.filter(t=>t.moduleId===m.id).length>1).length;
    job.done=true;commit(()=>project=next);
    const setsImproved=mode==='sets'&&newMetric.setScore>oldMetric.setScore;
    const title=setsImproved?tr('Sady sjednoceny'):saving>0?tr('Úspora plochy {percent} %',{percent:fmt(saving,saving<.1?3:1)}):newMetric.placed>oldMetric.placed?tr('Více nástrojů má své místo.'):tr('Rozvržení je kompaktnější.');
    const areaNote=afterArea>beforeArea+1e-6?(newMetric.placed>oldMetric.placed?tr('<p>Plocha modulů vzrostla, protože mají místo další nástroje.</p>'):tr('<p>Plocha modulů vzrostla kvůli sjednocení zvolených sad.</p>')):Math.abs(afterArea-beforeArea)<=1e-6?tr('<p>Celková plocha modulů zůstala stejná.</p>'):'';
    finishUI(title,`<p>${tr('Vnější půdorysy modulů: {before} → {after} {unit}',{before:fmt(beforeArea/(unit()==='in'?645.16:1),unit()==='in'?2:0),after:fmt(afterArea/(unit()==='in'?645.16:1),unit()==='in'?2:0),unit:unit()==='in'?'in²':'mm²'})}</p>${areaNote}<p>${tr('Umístěné nástroje: {before} → {after}',{before:oldMetric.placed,after:newMetric.placed})}</p><p>${tr('{before} → {after} modulů · Společné moduly: {shared}. Výsledek můžete vrátit tlačítkem Zpět.',{before:before.modules.length,after:next.modules.length,shared})}</p>${setSummary}`);
  }catch(error){if(!controller.signal.aborted&&smartLayoutRun===job&&modal.el.isConnected){job.done=true;finishUI(tr('Rozvržení se nepodařilo použít.'),`<p>${esc(errorText(error))}</p>`);}}
  finally{if(smartLayoutRun===job)smartLayoutRun=null;}
}
function splitModule(){
  const m=moduleFor();if(!m)return;const own=project.tools.filter(t=>t.moduleId===m.id);if(own.length<2)return;
  if(m.locked||own.some(t=>t.locked))throw Error(tr('Nejprve odemkněte společný modul.'));
  const next=clone(project);next.modules=next.modules.filter(n=>n.id!==m.id);next.tools.filter(t=>t.moduleId===m.id).forEach(t=>t.moduleId=null);
  const result=autoArrange(next);next.tools=result.tools;next.modules=result.modules;checkLayoutTransition(project,next);
  commit(()=>project=next,tr('Společný modul rozdělen. Změnu můžete vrátit tlačítkem Zpět.'));
}
// Tool set editor: project.toolSets is independent of product catalog sets.
const setLayoutNames=()=>({auto:tr('Automaticky'),uniform:tr('Stejné samostatné moduly'),shared:tr('Společný modul')});
function applyToolSets(sets,message){const clean=validateProject({...project,toolSets:sets}).toolSets;if(!Array.isArray(clean))throw Error(tr('Sady se nepodařilo ověřit.'));commit(()=>project.toolSets=clean,message);}
function openToolSets(){
  const manual=project.toolSets??[],known=new Set(manual.map(s=>s.id)),suggested=findToolSets(project).sets.filter(s=>s.source==='suggested'&&!known.has(s.id));
  const names=s=>s.toolIds.map(id=>project.tools.find(t=>t.id===id)?.name).filter(Boolean).join(', ');
  const modal=openModal({title:tr('Sady nástrojů'),subtitle:tr('Pojmenované sady a návrhy podle podobného tvaru.'),wide:true,body:`<label class="field"><span>${tr("Režim chytrého rozvržení")}</span><select data-smart-mode><option value="sets" ${smartMode==='sets'?'selected':''}>${tr("Sady nástrojů")}</option><option value="compact" ${smartMode==='compact'?'selected':''}>${tr("Nejmenší plocha")}</option></select></label><p class="muted-note">${tr("Sady nástrojů sjednocují směr a moduly. Nejmenší plocha upřednostní úsporu místa. Volba rozvržení sady se použije při Chytrém rozvržení.")}</p><button class="btn btn-primary tool-set-new" data-new-set>${icon('plus')}Nová sada</button><h3>${tr("Moje sady")}</h3><div class="tool-set-cards">${manual.map(s=>`<article class="tool-set-card" data-manual-set="${esc(s.id)}"><div><h4>${esc(s.name)}</h4><p>${esc(names(s))}</p><small>${esc(setLayoutNames()[s.layout])}</small></div><div class="selected-actions"><button class="btn btn-light" data-set-edit="${esc(s.id)}">${tr("Upravit")}</button><button class="btn btn-light" data-set-delete="${esc(s.id)}">${tr("Smazat sadu")}</button></div></article>`).join('')||tr('<p class="muted-note">Zatím žádná uložená sada. Členy můžete vybrat i podle vlastního pořadí či účelu.</p>')}</div><h3>${tr("Návrhy podle podobnosti")}</h3><p class="muted-note">${tr("Podobný tvar je návrh. Před uložením můžete změnit členy, název i způsob rozvržení.")}</p><div class="tool-set-cards">${suggested.map(s=>`<article class="tool-set-card" data-suggested-set="${esc(s.id)}"><div><h4>${esc(s.name)}</h4><p>${esc(names(s))}</p></div><button class="btn btn-light" data-set-adopt="${esc(s.id)}">${tr("Prohlédnout a převzít")}</button></article>`).join('')||tr('<p class="muted-note">Další návrhy nejsou k dispozici. Vlastní sadu můžete vytvořit z libovolných nástrojů.</p>')}</div>`,footer:tr('<span class="footnote">Smazání sady ponechá nástroje a jejich moduly.</span><button class="btn btn-primary" data-tool-sets-close>Hotovo</button>')});
  modal.el.querySelector('[data-tool-sets-close]').onclick=modal.close;
  modal.el.querySelector('[data-smart-mode]').onchange=e=>{smartMode=e.target.value==='compact'?'compact':'sets';writeLocal(smartModeKey,smartMode);};
  modal.body.addEventListener('click',e=>{
    try{
      if(e.target.closest('[data-new-set]'))editToolSet();
      const edit=e.target.closest('[data-set-edit]'),adopt=e.target.closest('[data-set-adopt]'),remove=e.target.closest('[data-set-delete]');
      if(edit)editToolSet(project.toolSets.find(s=>s.id===edit.dataset.setEdit));
      if(adopt)editToolSet({...suggested.find(s=>s.id===adopt.dataset.setAdopt),id:uid()},false);
      if(remove){applyToolSets((project.toolSets??[]).filter(s=>s.id!==remove.dataset.setDelete),tr('Sada smazána.'));openToolSets();}
    }catch(error){toast(errorText(error));}
  });
}
function editToolSet(seed=null,existing=true){
  const draft=seed?clone(seed):{id:uid(),name:tr('Nová sada'),toolIds:[],layout:'auto'};
  const editing=existing&&(project.toolSets??[]).some(s=>s.id===draft.id);
  const modal=openModal({title:editing?'Upravit sadu':tr('Nová sada'),subtitle:tr('Nástroj může být právě v jedné uložené sadě.'),wide:true,body:`${input(tr('Název sady'),draft.name,'setName',{type:'text',unit:'',scope:'set'})}<label class="field"><span>${tr("Rozvržení sady")}</span><select data-set-layout>${Object.entries(setLayoutNames()).map(([key,name])=>`<option value="${key}" ${draft.layout===key?'selected':''}>${name}</option>`).join('')}</select></label><p class="muted-note">${tr("Stejné samostatné moduly mají shodnou šířku i hloubku a každý vlastní nástroj. Společný modul obsahuje celou sadu.")}</p><div class="tool-set-member-heading"><strong>${tr("Členové sady")}</strong><span data-set-member-count></span></div><div class="tool-set-members">${project.tools.map(t=>{const other=(project.toolSets??[]).find(s=>s.id!==draft.id&&s.toolIds.includes(t.id));return `<label class="tool-set-member"><input type="checkbox" data-set-tool="${esc(t.id)}" ${draft.toolIds.includes(t.id)?'checked':''}><span><strong>${esc(t.name)}</strong>${other?`<small>${tr('V sadě „{name}“. Výběrem jej přesunete do této sady.',{name:esc(other.name)})}</small>`:''}</span></label>`;}).join('')||tr('<p class="muted-note">Nejdřív přidejte nástroje do šuplíku.</p>')}</div><p class="form-error" data-set-error role="status"></p>`,footer:tr('<button class="btn btn-light" data-set-cancel>Zpět na sady</button><button class="btn btn-primary" data-set-save>Uložit sadu</button>')});
  const count=()=>modal.body.querySelector('[data-set-member-count]').textContent=tr('Vybráno: {n}',{n:modal.body.querySelectorAll('[data-set-tool]:checked').length});
  modal.body.addEventListener('change',count);count();modal.el.querySelector('[data-set-cancel]').onclick=openToolSets;
  modal.el.querySelector('[data-set-save]').onclick=()=>{
    try{
      const name=modal.body.querySelector('[data-field=setName]').value.trim(),toolIds=[...modal.body.querySelectorAll('[data-set-tool]:checked')].map(el=>el.dataset.setTool),selectedIds=new Set(toolIds);
      if(!name)throw Error(tr('Zadejte název sady.'));if(!toolIds.length)throw Error(tr('Vyberte alespoň jeden nástroj.'));
      const item={id:draft.id,name:name.slice(0,100),toolIds,layout:modal.body.querySelector('[data-set-layout]').value};let replaced=false;
      const sets=(project.toolSets??[]).flatMap(s=>{if(s.id===draft.id){replaced=true;return[item];}const ids=s.toolIds.filter(id=>!selectedIds.has(id));return ids.length?[{...s,toolIds:ids}]:[];});
      if(!replaced)sets.push(item);applyToolSets(sets,tr('Sada uložena.'));openToolSets();
    }catch(error){modal.body.querySelector('[data-set-error]').textContent=errorText(error);}
  };
}
function selectedToolSetPanel(t){
  const manual=(project.toolSets??[]).find(s=>s.toolIds.includes(t.id)),suggested=manual?null:findToolSets(project).sets.find(s=>s.source==='suggested'&&s.toolIds.includes(t.id));
  return `<div class="selected-tool-set">${manual?`<small>${tr('Sada: {name}',{name:esc(manual.name)})}</small>`:suggested?`<small>${tr('Návrh sady: {name}',{name:esc(suggested.name)})}</small>`:''}<button class="btn btn-light" data-action="tool-set-current">${manual?'Upravit sadu':suggested?tr('Prohlédnout návrh sady'):tr('Vytvořit sadu s nástrojem')}</button></div>`;
}
function editSelectedToolSet(){const t=tool();if(!t)return;const manual=(project.toolSets??[]).find(s=>s.toolIds.includes(t.id));if(manual)return editToolSet(manual);const suggested=findToolSets(project).sets.find(s=>s.source==='suggested'&&s.toolIds.includes(t.id));editToolSet(suggested?{...suggested,id:uid()}:{id:uid(),name:tr('Nová sada'),toolIds:[t.id],layout:'auto'},false);}
function removeToolSetMember(id){if(Object.hasOwn(project,'toolSets'))project.toolSets=project.toolSets.map(s=>({...s,toolIds:s.toolIds.filter(member=>member!==id)})).filter(s=>s.toolIds.length);}
function toolSetResultSummary(definitions,before,next,result){
  const old=setCoherence(before,definitions),after=setCoherence(next,definitions),records=result.stats?.setSummary??[],warnings=Array.isArray(result.stats?.warnings)?result.stats.warnings:Array.isArray(result.warnings)?result.warnings:[];
  const rows=definitions.map(s=>{const satisfied=after.satisfied.includes(s.id),record=records.find(r=>r.id===s.id),status=satisfied?(old.satisfied.includes(s.id)?tr('Zůstává sjednocená'):'Sjednocena'):tr('Zatím nesjednocena');let reason=!satisfied?(record?.reason||tr('Celou sadu se nepodařilo bezpečně umístit podle zvolené volby.')):'';if(!satisfied&&s.layout==='shared')reason+=tr(' Zvolte stejné moduly nebo upravte rozměry šuplíku či tiskovou plochu.');return `<li><strong>${esc(s.name)}: ${status}</strong>${record?.applied?` · ${esc(setLayoutNames()[record.applied]||record.applied)}`:''}${reason?`<p>${esc(reason)}</p>`:''}</li>`;}).join('');
  return `<div class="tool-set-result"><h4>${tr("Sady nástrojů")}</h4>${definitions.length?`<p>${tr('Sjednocené sady: {before} → {after}',{before:old.satisfied.length,after:after.satisfied.length})}</p><ul>${rows}</ul>`:tr('<p>Žádná sada nebyla nalezena. Vlastní sadu můžete vytvořit v nabídce Sady nástrojů.</p>')}${warnings.length?`<ul class="tool-set-warnings">${warnings.map(message=>`<li>${esc(message)}</li>`).join('')}</ul>`:''}</div>`;
}
// End tool set editor.
const toolUnit=t=>unitFor(t?.unit),moduleUnit=m=>unitFor(m?.unit);
const unitBadge=u=>u?`<span class="unit-badge" title="${tr('Vlastní jednotky: {unit}',{unit:u})}">${u}</span>`:'';
function unitSelect(label,value,scope){return `<label class="field unit-field"><span>${label}</span><select data-field="unit" data-scope="${scope}" aria-label="${label}"><option value="" ${value?'':'selected'}>${tr('Podle šuplíku ({unit})',{unit:unit()})}</option>${UNITS.map(u=>`<option value="${u}" ${value===u?'selected':''}>${u}</option>`).join('')}</select></label>`;}
function arrange(message=true){const result=autoArrange(project);project.tools=result.tools;project.modules=result.modules;if(message)toast(result.unplaced.length?plural(result.unplaced.length,['{n} nástroj se nevešel. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.','{n} nástroje se nevešly. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.','{n} nástrojů se nevešlo. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.']):tr('Rozložení hotové. Zamčené moduly zůstaly na svém místě.'));return result;}
function thumb(t){const b=bounds({...t,x:0,y:0,rotation:0});return `<svg viewBox="${-3} ${-3} ${b.width+6} ${b.height+6}" aria-hidden="true"><path d="${paths(transformedPoints({...t,x:0,y:0,rotation:0}))}" fill="${t.id===selected?'#c79c53':'#9fae90'}" stroke="none"/></svg>`;}
// Every numeric field is a length: shown in the effective unit, stored in mm, typed text may carry any unit.
function input(label,value,key,{unit:u,min=0,max=3000,scope='project',type='length'}={}){
  if(type==='text')return `<label class="field"><span>${label}</span><div class="input-wrap"><input type="text" value="${esc(value)}" data-field="${key}" data-scope="${scope}" aria-label="${label}"></div></label>`;
  u=u||unit();
  return `<label class="field"><span>${label}</span><div class="input-wrap"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(inputValue(value,{unit:u}))}" data-length data-mm="${esc(value)}" data-unit="${u}" data-min="${min}" data-max="${max}" data-field="${key}" data-scope="${scope}" aria-label="${label} (${u})"><em>${u}</em></div></label>`;
}
function drawerPanel(){return `<div class="panel-header"><h2 class="panel-title">${icon('ruler')} ${tr('Rozměry šuplíku')}</h2><span>${unit()}</span></div><div class="panel-body"><div class="fields-row">${input(tr('Šířka · zleva doprava'),project.width,'width',{min:42})}${input(tr('Hloubka · zepředu dozadu'),project.height,'height',{min:42})}</div>${input(tr('Výška inzertu'),project.insertHeight,'insertHeight',{min:3,max:100})}<label class="field"><span>${tr('Jednotky šuplíku')}</span><select data-field="unit" data-scope="project" aria-label="${tr('Jednotky šuplíku')}"><option value="" ${project.unit?'':'selected'}>${tr('Podle aplikace ({unit})',{unit:getAppUnit()})}</option>${UNITS.map(u=>`<option value="${u}" ${project.unit===u?'selected':''}>${u}</option>`).join('')}</select></label><p class="muted-note unit-hint">${tr('Lze zadat i jiné jednotky: 12 in, 3 1/2" nebo 30 cm.')}</p><details class="advanced"><summary>${tr('Další nastavení')}</summary><div class="fields-row">${input(tr('Rastr modulů'),project.grid,'grid',{min:10,max:100})}${input(tr('Vůle kolem nástroje'),project.clearance,'clearance',{min:0,max:5})}</div><div class="fields-row">${input(tr('Tloušťka dna'),project.base,'base',{min:1,max:20})}${input(tr('Minimální stěna'),project.wall,'wall',{min:1,max:15})}</div><div class="toggle-row"><span>${tr('Přichytit k rastru')}</span><button class="switch ${snap?'on':''}" data-action="snap" role="switch" aria-checked="${snap}" aria-label="${tr('Přichytit k rastru')}"></button></div></details><button class="btn btn-soft block-button" data-action="expand">${icon('expand')} ${tr('Rozšířit sestavu')}</button><p class="muted-note">${tr('Hotové moduly zamkněte. Další nástroje přidáte i z jiné fotografie.')}</p></div>`;}

function safePocket(tool,clearance=project.clearance){try{return pocketOutline(tool,clearance);}catch{return transformedPoints(tool,clearance);}}
function fingerGripPreview(t,grips=t.fingerGrips??[],showCircles=false){
  const local={...t,x:0,y:0,rotation:0,fingerGrips:grips},raw=transformedPoints(local),outline=safePocket(local);
  const xs=outline.map(p=>p.x),ys=outline.map(p=>p.y),x=Math.min(...xs)-5,y=Math.min(...ys)-5,w=Math.max(...xs)-x+5,h=Math.max(...ys)-y+5;
  const minX=Math.min(...t.points.map(p=>p.x)),minY=Math.min(...t.points.map(p=>p.y));
  return `<svg class="finger-grip-preview" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="${tr('Kapsa s výřezy pro prsty a původní obrys nástroje')}"><path class="grip-pocket" d="${paths(outline)}"/><path class="grip-tool" d="${paths(raw)}"/>${showCircles?grips.filter(g=>[g.x,g.y,g.radius].every(Number.isFinite)&&g.radius>0).map((g,i)=>`<g><circle class="grip-circle" cx="${g.x-minX}" cy="${g.y-minY}" r="${g.radius}"/><text x="${g.x-minX}" y="${g.y-minY}" class="grip-number">${i+1}</text></g>`).join(''):''}</svg>`;
}
function fingerGripPanel(t){
  const grips=t.fingerGrips??[],legacy=!Object.prototype.hasOwnProperty.call(t,'fingerGrips'),u=toolUnit(t);
  return `<section class="finger-grip-panel"><strong>${tr('Výřezy pro prsty')} <span>${grips.length}</span></strong>${fingerGripPreview(t)}<div class="grip-legend"><span>${tr('Kapsa včetně výřezů')}</span><span>${tr('Původní nástroj')}</span></div><p class="muted-note">${grips.length?tr('Stejná hloubka jako kapsa: {depth}.',{depth:fmtLen(t.depth,{unit:u})}):legacy?tr('Tento nástroj zatím výřezy nemá. Přidání změní výrobní kapsu.'):tr('Výřezy jsou vypnuté. Automatické rozložení je znovu nepřidá.')}</p>${grips.length?`<ul class="grip-summary">${grips.map((g,i)=>`<li>${i+1}. X ${fmtLen(g.x,{unit:u,suffix:false})} · Y ${fmtLen(g.y,{unit:u,suffix:false})} · Ø ${fmtLen(g.radius*2,{unit:u})}</li>`).join('')}</ul>`:''}<div class="selected-actions"><button class="btn btn-light" data-action="finger-grips">${grips.length?tr('Upravit výřezy'):tr('Přidat další výřez')}</button><button class="btn btn-light" data-action="finger-grips-auto">${legacy?tr('Přidat výřezy pro prsty'):tr('Automaticky umístit')}</button>${grips.length?`<button class="btn btn-light" data-action="finger-grips-clear">${tr('Smazat všechny')}</button>`:''}</div></section>`;
}
function fingerGripCandidate(id,grips){
  const next=clone(project),t=next.tools.find(t=>t.id===id);if(!t)throw i18nError('Nástroj už není v sestavě.');
  t.fingerGrips=validateFingerGrips(grips);pocketOutline(t,next.clearance);
  const previous=project.tools.find(t=>t.id===id),m=project.modules.find(m=>m.id===previous.moduleId);
  if(!m||(!m.locked&&!previous.locked&&m.sizeMode!=='manual')){
    const placedIds=new Set(project.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=project.width+1e-6&&m.y+m.height<=project.height+1e-6).map(m=>m.id));
    const result=autoArrange(next),unplaced=new Set(result.unplaced),displaced=project.tools.find(t=>placedIds.has(t.moduleId)&&unplaced.has(t.id));
    if(displaced)throw i18nError('Pro výřezy není dost místa. Nástroj „{name}“ by se už nevešel do šuplíku. Zvětšete šuplík nebo uvolněte místo.',{name:displaced.name});
    next.tools=result.tools;next.modules=result.modules;
  }
  const changed=next.tools.find(t=>t.id===id),ids=new Set([id,m?.id,changed.moduleId].filter(Boolean));
  const issue=validateLayout(next).find(issue=>issue.ids.some(id=>ids.has(id)));
  if(issue)throw m&&(m.locked||previous.locked||m.sizeMode==='manual')?i18nError('Výřezy se nevejdou do stávajícího modulu. Zvětšete modul nebo odemkněte jeho polohu. {issue}',{issue:errorText(issue)}):i18nError('Nástroj s výřezy se nevejde. Zvětšete šuplík nebo uvolněte místo. {issue}',{issue:errorText(issue)});
  return next;
}
function setFingerGrips(grips){const t=tool();if(!t)return;const next=fingerGripCandidate(t.id,grips);commit(()=>project=next,tr('Výřezy pro prsty uloženy.'));}
function editFingerGrips(){
  const t=tool();if(!t)return;let draft=clone(t.fingerGrips??[]);const u=toolUnit(t);
  const modal=openModal({title:tr('Výřezy pro prsty'),subtitle:t.name,wide:true,body:'',footer:`<span class="footnote">${tr('Poloha ({unit}) se měří od levého horního rohu původního nástroje. Hloubka výřezů odpovídá kapse.',{unit:u})}</span><button class="btn btn-primary" data-grips-save>${tr('Uložit výřezy')}</button>`});
  const numeric=el=>{const v=readLength(el);if(!Number.isFinite(v))throw i18nError('Zadejte platnou číselnou polohu a průměr výřezu.');return v;};
  const readDraft=omitId=>[...modal.body.querySelectorAll('[data-grip-row]')].filter(row=>row.dataset.gripRow!==omitId).map(row=>({id:row.dataset.gripRow,x:numeric(row.querySelector('[data-field=fingerX]')),y:numeric(row.querySelector('[data-field=fingerY]')),radius:numeric(row.querySelector('[data-field=fingerDiameter]'))/2}));
  const preview=()=>{
    try{const candidate={...t,fingerGrips:validateFingerGrips(draft)};pocketOutline(candidate,project.clearance);modal.body.querySelector('[data-grip-preview]').innerHTML=fingerGripPreview(t,draft,true);modal.body.querySelector('[data-grip-error]').textContent='';}
    catch(error){modal.body.querySelector('[data-grip-error]').textContent=errorText(error);}
  };
  const redraw=()=>{
    modal.body.innerHTML=`<div class="grip-editor"><div><div data-grip-preview>${fingerGripPreview(t,draft,true)}</div><div class="grip-legend"><span>${tr('Kapsa včetně výřezů')}</span><span>${tr('Původní nástroj')}</span></div><p class="muted-note">${tr('Kruhy ukazují místo pro prsty. Průměr určuje jejich skutečnou velikost.')}</p></div><div><div class="grip-edit-actions"><button class="btn btn-light" data-grip-add ${draft.length>=12?'disabled':''}>${tr('Přidat další')}</button><button class="btn btn-light" data-grip-auto>${tr('Automaticky umístit')}</button><button class="btn btn-light" data-grip-clear ${draft.length?'':'disabled'}>${tr('Smazat všechny')}</button></div><div class="grip-rows">${draft.map((g,i)=>`<div class="grip-row" data-grip-row="${esc(g.id)}"><div class="grip-row-head"><strong>${tr('Výřez {n}',{n:i+1})}</strong><button class="icon-btn" data-grip-delete="${esc(g.id)}" aria-label="${tr('Smazat výřez {n}',{n:i+1})}">${icon('trash')}</button></div><div class="fields-row three">${input(tr('Poloha X'),g.x,'fingerX',{unit:u,scope:'grip',min:-6000,max:6000})}${input(tr('Poloha Y'),g.y,'fingerY',{unit:u,scope:'grip',min:-6000,max:6000})}${input(tr('Průměr'),g.radius*2,'fingerDiameter',{unit:u,scope:'grip',min:4,max:80})}</div></div>`).join('')||`<p class="muted-note">${tr('Žádné výřezy. Přidejte vlastní nebo je nechte automaticky umístit.')}</p>`}</div><p class="form-error" data-grip-error role="status"></p></div></div>`;preview();
  };
  const update=()=>{try{draft=readDraft();preview();}catch(error){modal.body.querySelector('[data-grip-error]').textContent=errorText(error);}};
  modal.body.addEventListener('input',update);modal.body.addEventListener('change',update);
  modal.body.addEventListener('click',e=>{
    try{
      const remove=e.target.closest('[data-grip-delete]');
      if(remove){draft=readDraft(remove.dataset.gripDelete);redraw();}
      if(e.target.closest('[data-grip-clear]')){draft=[];redraw();}
      if(e.target.closest('[data-grip-auto]')){draft=automaticFingerGrips(t,{radius:9});redraw();}
      if(e.target.closest('[data-grip-add]')){draft=readDraft();const p=t.points[Math.floor(t.points.length*((draft.length+1)*.381966%1))];draft.push({id:uid(),x:p.x,y:p.y,radius:9});redraw();}
    }catch(error){modal.body.querySelector('[data-grip-error]').textContent=errorText(error);}
  });
  modal.el.querySelector('[data-grips-save]').onclick=()=>{try{const next=fingerGripCandidate(t.id,readDraft());commit(()=>project=next,tr('Výřezy pro prsty uloženy.'));modal.close();}catch(error){modal.body.querySelector('[data-grip-error]').textContent=errorText(error);}};
  redraw();
}
function showDrawerDimensions(){inspectorTab='drawer';render();if(window.innerWidth<=760)$('#drawer-settings')?.scrollIntoView({block:'start',behavior:'smooth'});}
function moduleSizing(m){const u=moduleUnit(m),count=project.tools.filter(t=>t.moduleId===m.id).length;return `<div class="module-sizing"><strong>${m.sizeMode==='manual'?tr('Rozměry modulu · ruční'):tr('Rozměry modulu · automatické')}${unitBadge(m.unit)}</strong><small>${tr('Jmenovité {size}',{size:fmtSize(m.width,m.height,{unit:u})})}<br>${tr('Vnější {size}',{size:fmtSize(m.width-.5,m.height-.5,{unit:u})})}${count>1?`<br>${tr('Nástrojů ve společném modulu: {n}',{n:count})}`:''}</small>${unitSelect(tr('Jednotky modulu'),m.unit,'module')}<div class="selected-actions"><button class="btn btn-light" data-action="resize-module">${icon('ruler')}${tr('Upravit rozměry modulu')}</button>${project.tools.some(t=>t.moduleId===m.id)?`<button class="btn btn-light" data-action="size-module-auto">${tr('Podle nástroje')}</button>`:''}${count>1?`<button class="btn btn-light" data-action="split-module">${tr('Rozdělit modul')}</button>`:''}</div></div>`;}
function editModuleSize(){
  const m=moduleFor();if(!m)return;
  const fields=(w,h,u)=>`${input(tr('Jmenovitá šířka'),w,'moduleWidth',{unit:u,min:5,max:3000})}${input(tr('Jmenovitá hloubka'),h,'moduleHeight',{unit:u,min:5,max:3000})}`;
  const modal=openModal({title:tr('Rozměry modulu'),subtitle:m.name,body:`<div class="fields-row" data-module-fields>${fields(m.width,m.height,moduleUnit(m))}</div>${unitSelect(tr('Jednotky modulu'),m.unit,'module-modal')}<p class="muted-note">${tr('Skutečné vnější rozměry jsou o {gap} menší kvůli mezeře mezi moduly. Obrys nástroje zůstane stejně velký.',{gap:fmtLen(.5,{unit:moduleUnit(m)})})}</p>`,footer:`<span class="footnote">${tr('Zamknutí určuje polohu; ruční rozměr zůstane i při dalším rozložení.')}</span><button class="btn btn-primary" data-resize-module>${tr('Uložit rozměry')}</button>`});
  const read=()=>[readLength(modal.el.querySelector('[data-field=moduleWidth]')),readLength(modal.el.querySelector('[data-field=moduleHeight]'))];
  const pick=modal.el.querySelector('[data-scope=module-modal]');pick.value=m.unit||'';
  // Switching the unit here re-displays the typed sizes in the chosen unit.
  pick.onchange=()=>{const [w,h]=read();if(Number.isFinite(w)&&Number.isFinite(h))modal.el.querySelector('[data-module-fields]').innerHTML=fields(w,h,unitFor(pick.value));};
  modal.el.querySelector('[data-resize-module]').onclick=()=>{
    const [width,height]=read(),u=pick.value;
    if(!Number.isFinite(width)||!Number.isFinite(height))return toast(tr('Zadejte platnou délku, například 12, 12,5 mm nebo 3 1/2 in.'));
    try{const next=resizeModule(project,m.id,{width,height,mode:'manual'}),nm=next.modules.find(x=>x.id===m.id);if(nm){if(u)nm.unit=u;else delete nm.unit;}commit(()=>project=next,tr('Rozměry modulu uloženy.'));modal.close();}catch(error){toast(errorText(error));}
  };
}
function sizeModuleAutomatically(){const m=moduleFor();if(!m)return;const next=resizeModule(project,m.id,{mode:'auto'});commit(()=>project=next,tr('Velikost modulu upravena podle nástroje.'));}

function selectedPanel(){const t=tool(),m=moduleFor();if(!t&&!m)return `<div class="panel-header"><h2 class="panel-title">${tr('Vlastnosti nástroje')}</h2></div><div class="empty-note">${tr('Vyberte nástroj v náhledu nebo v seznamu.')}</div>`;if(!t)return `<div class="panel-header"><h2 class="panel-title">${tr('Prázdný modul')}</h2><button class="icon-btn" data-action="drawer-tab" aria-label="${tr('Rozměry šuplíku')}">${icon('ruler')}</button></div><div class="panel-body">${moduleSizing(m)}<p class="muted-note">${m.locked?tr('Výplňový modul · zamčená poloha'):tr('Výplňový modul · volná poloha')}</p><div class="selected-actions"><button class="btn btn-light" data-action="lock">${icon(m.locked?'unlock':'lock')}${m.locked?tr('Odemknout'):tr('Zamknout')}</button><button class="btn btn-danger" data-action="delete">${icon('trash')}${tr('Smazat')}</button></div></div>`;
return `<div class="panel-header"><h2 class="panel-title">${icon('wrench')} ${tr('Vybraný nástroj')}${unitBadge(t.unit)}</h2><button class="icon-btn" data-action="drawer-tab" aria-label="${tr('Rozměry šuplíku')}">${icon('ruler')}</button></div><div class="panel-body">${input(tr('Název'),t.name,'name',{type:'text',scope:'tool'})}<div class="fields-row">${input(tr('Šířka kontury'),bounds(t).width,'toolWidth',{unit:toolUnit(t),scope:'tool',min:2,max:2000})}${input(tr('Hloubka kapsy'),t.depth,'depth',{unit:toolUnit(t),scope:'tool',min:.5,max:project.insertHeight-project.base})}</div>${unitSelect(tr('Jednotky nástroje'),t.unit,'tool')}${selectedToolSetPanel(t)}${fingerGripPanel(t)}${m?moduleSizing(m):`<div class="issue-box">${tr('Nástroj čeká na umístění.')}</div>`}<div class="selected-actions"><button class="btn btn-light" data-action="rotate">${icon('rotate')}${tr('Otočit 90°')}</button><button class="btn btn-light" data-action="lock">${icon(m?.locked?'unlock':'lock')}${m?.locked?tr('Odemknout'):tr('Zamknout')}</button><button class="btn btn-light" data-action="duplicate">${icon('copy')}${tr('Kopie')}</button><button class="btn btn-danger" data-action="delete" aria-label="${tr('Smazat nástroj')}">${icon('trash')}</button></div><p class="muted-note">${m?.locked?tr('Zamčený modul automatické rozvržení nepřesune.'):tr('Na mobilu klepněte na Přesunout, potom přetáhněte modul. Zamknutím zachováte jeho polohu.')}</p></div>`;}
function prefsControls(){
  const own=project.unit?tr('Tento šuplík používá vlastní jednotky: {unit}',{unit:project.unit}):tr('Výchozí jednotky aplikace');
  return `<div class="prefs"><div class="pref-switch" role="group" aria-label="${tr('Jazyk')}">${LANGS.map(l=>`<button data-action="set-lang" data-value="${l}" class="${getLang()===l?'active':''}" aria-pressed="${getLang()===l}" lang="${l}" title="${LANG_NAMES[l]}">${l.toUpperCase()}</button>`).join('')}</div><div class="pref-switch ${project.unit?'overridden':''}" role="group" aria-label="${tr('Výchozí jednotky aplikace')}" title="${own}">${UNITS.map(u=>`<button data-action="set-unit" data-value="${u}" class="${getAppUnit()===u?'active':''}" aria-pressed="${getAppUnit()===u}">${u}</button>`).join('')}</div></div>`;
}
// Sidebar list of all drawers (desktop). On mobile the sidebar is hidden and openProjects() stays the entry point.
const initials=name=>String(name).trim().split(/\s+/).filter(w=>/^[\p{L}\d]/u.test(w)).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'#';
function drawerList(){
  const items=projects.map(saved=>{
    const p=saved.id===project.id?project:saved,active=p.id===project.id,size=fmtSize(p.width,p.height,{unit:p.unit||getAppUnit()}),count=plural(p.tools.length,['{n} nástroj','{n} nástroje','{n} nástrojů']);
    return `<li class="drawer-item ${active?'active':''}"><button class="drawer-card" data-drawer-open="${esc(p.id)}" ${active?'aria-current="true"':''} title="${esc(p.name)} · ${size}"><span class="mini-icon" aria-hidden="true">${esc(initials(p.name))}</span><span class="drawer-text"><strong>${esc(p.name)}</strong><small>${size} · ${count}</small></span></button>${active?'':`<button class="icon-btn drawer-remove" data-drawer-remove="${esc(p.id)}" aria-label="${tr('Smazat šuplík {name}',{name:esc(p.name)})}" title="${tr('Smazat šuplík {name}',{name:esc(p.name)})}">${icon('trash')}</button>`}</li>`;
  }).join('');
  return `<section class="drawer-section" aria-labelledby="drawer-list-label"><div class="drawer-section-head"><div class="sidebar-label" id="drawer-list-label">${tr('MOJE ŠUPLÍKY')}</div></div><button class="drawer-new" data-action="new-drawer" title="${tr('Nový šuplík')}">${icon('plus')}<span>${tr('Nový šuplík')}</span></button><ul class="drawer-list">${items}</ul><div class="drawer-extra"><button data-action="import-json" title="${tr('Otevřít JSON')}">${icon('upload')}<span>${tr('Otevřít JSON')}</span></button><button data-action="demo-drawer" title="${tr('Ukázkový šuplík')}">${icon('spark')}<span>${tr('Ukázkový šuplík')}</span></button></div></section>`;
}
function removeDrawer(id){
  const p=projects.find(p=>p.id===id);if(!p||id===project.id)return;
  if(!window.confirm(tr('Smazat šuplík „{name}“? Tuto akci nelze vrátit.',{name:p.name})))return;
  projects=projects.filter(p=>p.id!==id);writeLocal(storageKey,projects);render();toast(tr('Šuplík „{name}“ smazán.',{name:p.name}));
}
function render(){
  viewControls?.dispose();viewControls=null;
  setProjectUnit(project.unit);
  const issues=errors(),unplaced=project.tools.filter(t=>!project.modules.some(m=>m.id===t.moduleId));
  const occupied=project.modules.reduce((s,m)=>s+m.width*m.height,0),usage=Math.min(100,Math.round(occupied/(project.width*project.height)*100)),lockedCount=project.modules.filter(m=>m.locked).length;
  const drawerSize=fmtSize(project.width,project.height);
  $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand" href="#" aria-label="Šuplík Studio" data-action="home"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span class="brand-name">šuplík<small>STUDIO</small></span></a><nav class="sidebar-nav" aria-label="${tr('Hlavní navigace')}"><button class="nav-item active" data-action="home">${icon('drawer')}<span>${tr('Můj šuplík')}</span></button><button class="nav-item" data-action="library">${icon('wrench')}<span>${tr('Knihovna nástrojů')}</span></button></nav><div class="sidebar-separator"></div>${drawerList()}<div class="sidebar-bottom"><button class="nav-item" data-action="help">${icon('help')}<span>${tr('Jak na to')}</span></button><div class="sidebar-separator" style="margin:18px 0"></div><div class="local-tag">${icon('shield')} ${tr('Všechno zůstává u vás')}</div><p>${tr('Fotky zpracovává váš prohlížeč.')}<br>${tr('Bez cloudu. Bez předplatného.')}</p></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${tr('Dílna')} <span>/</span> <b>${tr('Organizér nářadí')}</b></div><div class="top-actions">${prefsControls()}<span class="save-state">${icon(storageFailed?'info':'check')} <span class="save-text">${storageFailed?tr('Stáhněte zálohu'):tr('Uloženo v zařízení')}</span></span><button class="btn btn-light" data-action="save-project" aria-label="${tr('Uložit projekt')}">${icon('download')} <span class="btn-label">${tr('Uložit projekt')}</span></button><span class="avatar" title="${tr('Lokální dílna')}">JD</span></div></header><div class="page"><div class="page-heading"><div><p class="eyebrow">${tr('MÍSTO PRO KAŽDÝ NÁSTROJ')}</p><div class="name-edit"><h1>${esc(project.name)}</h1><button class="icon-btn" data-action="rename" aria-label="${tr('Přejmenovat šuplík')}">${icon('edit')}</button></div><p class="subtitle">${tr('Od fotky k pořádku. Přesně podle vaší dílny.')}</p><button class="drawer-dimensions" data-action="drawer-tab">${icon('ruler')}<span>${tr('Rozměry šuplíku')}</span><small>${drawerSize}</small></button></div><div class="heading-actions"><button class="btn btn-light" data-action="add-shape">${icon('plus')} ${tr('Prázdný modul')}</button><button class="btn btn-primary" data-action="capture">${icon('camera')} <span>${tr('Přidat nástroj')}</span></button></div></div><div class="steps" aria-label="${tr('Postup')}"><button class="step done" data-action="capture"><span class="step-num">01</span>${tr('Vyfotit nástroj')}</button><span class="step-chevron">›</span><button class="step done" data-action="capture"><span class="step-num">02</span>${tr('Rozpoznat obrys')}</button><span class="step-chevron">›</span><span class="step active"><span class="step-num">03</span>${tr('Rozvrhnout')}</span><span class="step-chevron">›</span><button class="step" data-action="export"><span class="step-num">04</span>${tr('Vyrobit')}</button></div><div class="workbench"><div class="workspace-col"><section class="workspace" aria-label="${tr('Editor sestavy')}"><div class="workspace-header"><div class="workspace-header-title">${icon('drawer')} ${tr('Náhled šuplíku')} <small>${drawerSize}</small></div><div class="segmented" aria-label="${tr('Režim náhledu')}"><button data-action="2d" class="${view==='2d'?'active':''}" aria-pressed="${view==='2d'}">${icon('grid')}2D</button><button data-action="3d" class="${view==='3d'?'active':''}" aria-pressed="${view==='3d'}">${icon('cube')}3D</button></div></div><div class="board-toolbar"><div class="tool-group"><button class="icon-btn" data-action="undo" aria-label="${tr('Zpět (Ctrl+Z)')}" ${undoStack.length?'':'disabled'}>${icon('undo')}</button><button class="icon-btn" data-action="redo" aria-label="${tr('Znovu (Ctrl+Shift+Z)')}" ${redoStack.length?'':'disabled'}>${icon('redo')}</button><span class="toolbar-sep"></span><button class="icon-btn ${showGrid?'active':''}" data-action="grid" aria-label="${tr('Zobrazit rastr')}" aria-pressed="${showGrid}">${icon('grid')}</button><button class="tiny-button" data-action="labels" aria-pressed="${showLabels}">${icon('eye')} ${tr('Popisky')}</button></div><div class="tool-group"><button class="tiny-button ${moveMode?'active':''}" data-action="move-mode" aria-pressed="${moveMode}">${icon('move')}${moveMode?tr('Hotovo'):tr('Přesunout')}</button><button class="tiny-button" data-action="auto">${icon('spark')} ${tr('Auto rozložení')}</button><button class="tiny-button smart-layout-button" data-action="smart-layout">${icon('spark')} ${tr('Chytré rozvržení')}</button></div></div><div class="board-area" id="board-area"><svg class="board-svg ${moveMode?'moving':''} ${view==='3d'?'view-3d':''}" id="board-svg" role="img" aria-label="${tr('Rozložení modulů a nástrojů v šuplíku')}"></svg>${!project.modules.length&&view==='2d'?`<div class="board-empty">${icon('drawer')}<h3>${tr('Začněte jedním nástrojem')}</h3><p>${tr('Vyfoťte ho na A4 papíru nebo vložte z uložené knihovny.')}</p><button class="btn btn-primary" data-action="capture">${icon('camera')} ${tr('Přidat nástroj')}</button></div>`:''}${view==='3d'?'<div class="view-3d-hint">'+esc(tr('Levé tlačítko: otáčet · Pravé: posouvat · Kolečko: přiblížit'))+'</div>':''}</div><div class="board-footer"><div class="legend"><span><i></i>${tr('Modul')}</span><span><i></i>${tr('Vybraný nástroj')}</span></div><div class="key-hint">${view==='2d'?tr('Tažením přesunete modul')+' <kbd>R</kbd> '+tr('otočit'):tr('Pohled kamerou')}</div><div class="tool-group"><button class="icon-btn" data-action="zoom-out" aria-label="${tr('Oddálit')}">${icon('zoomOut')}</button><span data-zoom-value>${Math.round((view==='3d'?camera3D.zoom:zoom)*100)} %</span><button class="icon-btn" data-action="zoom-in" aria-label="${tr('Přiblížit')}">${icon('zoomIn')}</button><button class="icon-btn" data-action="fit" aria-label="${tr('Zobrazit vše')}">${icon('fit')}</button></div></div></section><div class="metrics"><div class="metric"><div class="metric-icon">${icon('wrench')}</div><div><strong>${project.tools.length} <small>${plural(project.tools.length,['nástroj','nástroje','nástrojů'])}</small></strong><p>${unplaced.length?tr('{n} čeká na umístění',{n:unplaced.length}):tr('Každý má svoje místo')}</p></div></div><div class="metric"><div class="metric-icon">${icon('grid')}</div><div><strong>${project.modules.length} <small>${plural(project.modules.length,['modul','moduly','modulů'])}</small></strong><p>${tr('{n} zamčených · rozšiřitelné',{n:lockedCount})}</p></div></div><div class="metric"><div class="metric-icon">${icon('drawer')}</div><div><strong>${usage} <small>${tr('% plochy')}</small></strong><p>${tr('{n} % na další nástroje',{n:Math.max(0,100-usage)})}</p></div></div></div>${issues.length?`<div class="issue-box" role="status">${issues.slice(0,3).map(i=>`<p>${esc(errorText(i))}</p>`).join('')}${issues.length>3?`<p>${tr('A dalších {n} upozornění.',{n:issues.length-3})}</p>`:''}<button class="section-link" data-action="auto">${tr('Přepočítat rozvržení')}</button></div>`:''}${tipVisible?`<div class="tip">${icon('lightbulb')}<div><strong>${tr('Vaše dílna poroste. Sestava taky.')}</strong> ${tr('Zamkněte hotové moduly a přidejte další nástroje. Auto rozložení zachová jejich polohu.')}</div><button class="icon-btn" data-action="hide-tip" aria-label="${tr('Skrýt tip')}">${icon('close')}</button></div>`:''}</div><aside class="inspector" aria-label="${tr('Nastavení a nástroje')}"><section class="panel" id="drawer-settings">${inspectorTab==='tool'?selectedPanel():drawerPanel()}</section><section class="panel"><div class="panel-header"><h2 class="panel-title">${tr('Nástroje v sestavě')}</h2><span>${project.tools.length.toString().padStart(2,'0')}</span></div><button class="btn btn-light tool-sets-open" data-action="tool-sets">${tr('Sady nástrojů')}</button><div class="tool-list">${project.tools.map(t=>`<button class="tool-row ${selected===t.id?'selected':''}" data-select="${esc(t.id)}" aria-pressed="${selected===t.id}"><span class="tool-thumb">${thumb(t)}</span><span><strong>${esc(t.name)}${unitBadge(t.unit)}</strong><small>${sizeShort(bounds(t).width,bounds(t).height,toolUnit(t))}${!t.moduleId?' · '+tr('neumístěno'):''}</small></span>${icon(project.modules.find(m=>m.id===t.moduleId)?.locked?'lock':'chevron')}</button>`).join('')||`<div class="empty-note">${tr('Zatím žádné nástroje.')}</div>`}</div><button class="add-tool-row" data-action="capture">${icon('plus')} ${tr('Přidat další nástroj')}</button></section><div class="export-card"><div class="ready">${icon(issues.length?'info':'check')} ${issues.length?tr('Zkontrolujte sestavu'):tr('Sestava připravena')}</div><p>${issues.length?tr('Před výrobou opravte označené rozměry nebo překryvy.'):tr('STL pro 3D tisk, SVG a DXF pro výřez. Vše v reálných milimetrech.')}</p><button class="btn btn-dark block-button" data-action="export">${icon('download')} ${tr('Připravit export')} ${icon('arrow')}</button></div></aside></div><footer class="footer-line"><span>${tr('Navrženo ve skutečných rozměrech. Vyrobeno pro vaši dílnu.')}</span><button data-action="help">${tr('Návod a inspirace')}</button><span class="app-version">STUDIO / 1.2</span></footer></div></main></div><nav class="mobile-nav" aria-label="${tr('Mobilní navigace')}"><button class="active" data-action="home">${icon('drawer')}${tr('Šuplík')}</button><button data-action="library">${icon('wrench')}${tr('Knihovna')}</button><button class="camera-nav" data-action="capture" aria-label="${tr('Vyfotit nástroj')}">${icon('camera')}</button><button data-action="projects">${icon('folder')}${tr('Šuplíky')}</button><button data-action="export">${icon('download')}${tr('Export')}</button></nav>`;
  renderBoard();
}

function renderBoard(){
  const svg=$('#board-svg');if(!svg)return;
  if(view==='3d'){
    render3D(svg);
    if(!viewControls)viewControls=createViewControls(svg,{getCamera:()=>camera3D,setCamera:value=>camera3D=value,getFrame:()=>({width:cameraFrame.width*cameraFrame.zoom/camera3D.zoom,height:cameraFrame.height*cameraFrame.zoom/camera3D.zoom}),render:renderCameraFrame});
    return;
  }
  const pad=34,w=project.width+pad*2,h=project.height+pad*2;
  svg.setAttribute('viewBox',`${-pad+(w-w/zoom)/2} ${-pad+(h-h/zoom)/2} ${w/zoom} ${h/zoom}`);
  const issues=errors(),bad=new Set(issues.flatMap(x=>x.ids));
  let html=`<defs><pattern id="module-grid" width="${project.grid}" height="${project.grid}" patternUnits="userSpaceOnUse"><path d="M ${project.grid} 0 L 0 0 0 ${project.grid}" fill="none" stroke="#dce4d2" stroke-width=".65"/></pattern><pattern id="empty-hatch" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="#e4e9dc" stroke-width=".45"/></pattern><filter id="softshadow" x="-10%" y="-10%" width="125%" height="125%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#5b6846" flood-opacity=".08"/></filter></defs><rect x="-2" y="-2" width="${project.width+4}" height="${project.height+4}" rx="5" fill="#eff2e9" stroke="#c5cfb9" stroke-width="1.1"/><rect x="0" y="0" width="${project.width}" height="${project.height}" rx="3" fill="${showGrid?'url(#module-grid)':'#f4f7ee'}"/>`;
  html+=`<g stroke="#a4af97" stroke-width=".6"><path d="M0 -17H${project.width} M0 -21v8 M${project.width} -21v8"/><path d="M-17 0V${project.height} M-21 0h8 M-21 ${project.height}h8"/></g><rect x="${project.width/2-29}" y="-24" width="58" height="14" fill="#fbfcf9"/><text x="${project.width/2}" y="-14" text-anchor="middle" fill="#93a083" font-size="8.5">${fmtLen(project.width)}</text><text transform="translate(-23 ${project.height/2}) rotate(-90)" text-anchor="middle" fill="#93a083" font-size="8.5">${fmtLen(project.height)}</text>`;
  for(const [i,m] of project.modules.entries()){
    const ts=project.tools.filter(t=>t.moduleId===m.id),sel=ts.some(t=>t.id===selected)||selectedModule===m.id,isBad=bad.has(m.id)||ts.some(t=>bad.has(t.id));
    html+=`<g class="module" data-module="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.name)}${m.locked?' — '+tr('zamčený'):''}"><rect x="${m.x+.9}" y="${m.y+.9}" width="${m.width-1.8}" height="${m.height-1.8}" rx="3" fill="${sel?'#fcf0d7':palette[i%palette.length]+'20'}" stroke="${isBad?'#cb7d60':sel?'#dab06b':'#becdac'}" stroke-width="${sel?1.4:.8}" filter="url(#softshadow)"/>`;
    if(!ts.length)html+=`<rect x="${m.x+5}" y="${m.y+5}" width="${m.width-10}" height="${m.height-10}" fill="url(#empty-hatch)" rx="2"/><text x="${m.x+m.width/2}" y="${m.y+m.height/2}" fill="#a2af92" text-anchor="middle" font-size="8">${tr('PRÁZDNÝ MODUL')}</text>`;
    for(const t of ts){const b=bounds(t);html+=`<path class="tool-outline" d="${paths(safePocket(t))}" fill="${sel?'#e4b96c40':'#a8b99855'}" stroke="${isBad?'#bd775e':sel?'#be9555':'#90a67c'}" stroke-width=".8"/><path d="${paths(transformedPoints(t))}" fill="${sel?'#c99c4d2b':'#b7c6a377'}" stroke="${sel?'#bd975c':'#99ac86'}" stroke-width=".55"/>`;
      // Small etched centre detail reinforces the contour without changing the manufacturing outline.
      if(b.height>80&&b.width<65)html+=`<path d="M${b.x+b.width/2} ${b.y+b.height*.58}v${b.height*.24}" stroke="${sel?'#d3ad70':'#a9b896'}" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>`;
    }
    if(showLabels){const own=ts.find(t=>t.unit)?.unit||m.unit,label=(ts[0]?.name||m.name)+(own?` · ${own}`:''),max=Math.max(9,Math.floor(m.width/4.5));html+=`<rect x="${m.x+6}" y="${m.y+m.height-15}" width="${Math.min(m.width-12,label.length*3.7+10)}" height="10" rx="2" fill="${sel?'#fff6e6':'#f3f6ee'}" opacity=".88"/><text x="${m.x+10}" y="${m.y+m.height-7.5}" fill="${sel?'#ab8547':'#8c9b7a'}" font-size="6.3">${esc(label.length>max?label.slice(0,max-1)+'…':label)}</text>`;}
    if(m.locked)html+=`<g transform="translate(${m.x+m.width-13} ${m.y+5}) scale(.33)" color="#8b9b78">${icon('lock')}</g>`;
    html+='</g>';
  }
  if(!project.modules.length&&showGrid)html+=`<text x="${project.width/2}" y="${project.height-14}" text-anchor="middle" font-size="7" fill="#b2bca5">${tr('{cols} × {rows} polí · {grid}',{cols:Math.floor(project.width/project.grid),rows:Math.floor(project.height/project.grid),grid:fmtLen(project.grid)})}</text>`;
  else if(project.modules.length&&showLabels){const unusedY=Math.max(...project.modules.map(m=>m.y+m.height));if(project.height-unusedY>36)html+=`<text x="${project.width/2}" y="${unusedY+(project.height-unusedY)/2}" text-anchor="middle" font-size="8" fill="#b0bca1" letter-spacing=".8">${tr('PROSTOR PRO DALŠÍ NÁPADY')}</text>`;}
  svg.innerHTML=html;
}
function render3D(svg){
  const rect=svg.getBoundingClientRect(),viewport={width:rect.width||svg.clientWidth||1000,height:rect.height||svg.clientHeight||600};
  const preview=printPreview(project,selected,selectedModule,camera3D,viewport);
  camera3D=preview.camera;cameraFrame={...preview.frame,zoom:camera3D.zoom};
  svg.setAttribute('viewBox',preview.viewBox);svg.innerHTML=preview.html;
}
function renderCameraFrame(){
  const svg=$('#board-svg');if(view!=='3d'||!svg)return;render3D(svg);
  const label=$('[data-zoom-value]');if(label)label.textContent=Math.round(camera3D.zoom*100)+' %';
}

function switchProject(p){persist();project=clone(p);selected=project.tools[0]?.id||null;selectedModule=null;inspectorTab='drawer';undoStack=[];redoStack=[];zoom=1;camera3D=createCamera3D();persist();closeModal();render();}
function addTools(tools){
  if(project.tools.length+tools.length>300)throw i18nError('V jednom projektu může být nejvýše 300 nástrojů. Založte další projekt.');
  if(project.insertHeight-project.base<.5)throw i18nError('Výška inzertu musí být alespoň o {gap} větší než tloušťka dna.',{gap:fmtLen(.5)});
  const prepared=tools.map(t=>{
    const item=validateProject({...blankProject(),tools:[{...t,id:uid(),depth:Math.min(t.depth||12,project.insertHeight-project.base),locked:false,moduleId:null}]}).tools[0];
    if(!Object.prototype.hasOwnProperty.call(t,'fingerGrips'))item.fingerGrips=automaticFingerGrips(item,{radius:9});
    pocketOutline(item,project.clearance);return item;
  });
  let unplaced=0;
  commit(()=>{for(const item of prepared){project.tools.push(item);if(!library.some(l=>l.name===item.name&&JSON.stringify(l.points)===JSON.stringify(item.points)&&JSON.stringify(l.fingerGrips)===JSON.stringify(item.fingerGrips)))library.push({...clone(item),x:0,y:0,moduleId:null});}writeLocal(libraryKey,library);selected=project.tools.at(-1)?.id;inspectorTab='tool';const added=new Set(prepared.map(x=>x.id));unplaced=arrange(false).unplaced.filter(id=>added.has(id)).length;});
  // One toast for the whole addition (e.g. a catalogue tool set), including tools that did not fit.
  toast(plural(tools.length,['Přidán {n} nástroj. Kontura je také v knihovně.','Přidány {n} nástroje. Kontury jsou také v knihovně.','Přidáno {n} nástrojů. Kontury jsou také v knihovně.'])+(unplaced?' '+plural(unplaced,['{n} nástroj se nevešel. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.','{n} nástroje se nevešly. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.','{n} nástrojů se nevešlo. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.']):''));
}
function capture(){openCapture({onAdd:addTools,toast});}
function undo(){if(!undoStack.length)return;redoStack.push(clone(project));project=undoStack.pop();persist();render();}
function redo(){if(!redoStack.length)return;undoStack.push(clone(project));project=redoStack.pop();persist();render();}
const invalidLength=()=>toast(tr('Zadejte platnou délku, například 12, 12,5 mm nebo 3 1/2 in.'));
function rename(){const m=openModal({title:tr('Pojmenujte svůj šuplík'),subtitle:tr('Název vám pomůže rozlišit uložené projekty.'),body:input(tr('Název šuplíku'),project.name,'projectName',{type:'text'}),footer:`<span></span><button class="btn btn-primary" data-confirm>${tr('Přejmenovat')}</button>`});m.el.querySelector('[data-confirm]').onclick=()=>{const name=m.el.querySelector('input').value.trim();if(!name)return toast(tr('Zadejte název projektu.'));commit(()=>project.name=name.slice(0,100));m.close();};}
function expand(){const placedIds=new Set(project.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=project.width+1e-6&&m.y+m.height<=project.height+1e-6).map(m=>m.id));const m=openModal({title:tr('Dílna poroste. Sestava taky.'),subtitle:tr('Umístěné moduly se zamknou a zůstanou přesně na svém místě.'),body:`<p class="help-intro">${tr('Přidejte prostor v rastru {grid}. Zamčené moduly se při příštím automatickém rozložení nepřesunou.',{grid:fmtLen(project.grid)})}</p><div class="fields-row">${input(tr('Nová šířka'),project.width+project.grid,'expandWidth',{min:project.width})}${input(tr('Nová hloubka'),project.height,'expandHeight',{min:project.height})}</div><div class="tip">${icon('lock')} ${tr('Zamkne se {n} umístěných modulů. Nové nástroje se umístí do volného místa.',{n:placedIds.size})}</div>`,footer:`<span class="footnote">${tr('Polohu můžete později odemknout u každého nástroje.')}</span><button class="btn btn-primary" data-confirm>${tr('Rozšířit sestavu')}</button>`});m.el.querySelector('[data-confirm]').onclick=()=>{const w=readLength(m.el.querySelector('[data-field=expandWidth]')),h=readLength(m.el.querySelector('[data-field=expandHeight]'));if(!Number.isFinite(w)||!Number.isFinite(h))return invalidLength();if(w<project.width-.02||h<project.height-.02||w>3000.02||h>3000.02)return toast(tr('Nové rozměry musí být větší nebo stejné, nejvýše {max}.',{max:fmtLen(3000)}));commit(()=>{project.width=Math.min(3000,Math.max(project.width,w));project.height=Math.min(3000,Math.max(project.height,h));project.modules.forEach(m=>{if(placedIds.has(m.id))m.locked=true;});project.tools.forEach(t=>{if(placedIds.has(t.moduleId))t.locked=true;});},tr('Sestava rozšířena. Umístěné moduly jsou zamčené.'));m.close();};}
function addShape(){const m=openModal({title:tr('Přidat modul nebo jednoduchý tvar'),subtitle:tr('Výplň volného místa, přihrádka nebo kapsa se známým rozměrem.'),body:`<label class="field"><span>${tr('Typ')}</span><select id="shape-type"><option value="blank">${tr('Prázdný plný modul')}</option><option value="rect">${tr('Obdélníková kapsa')}</option><option value="circle">${tr('Kruhová kapsa')}</option></select></label>${input(tr('Název'),tr('Nový modul'),'shapeName',{type:'text'})}<div class="fields-row">${input(tr('Šířka / průměr'),84,'shapeWidth',{min:5,max:2000})}${input(tr('Hloubka'),84,'shapeHeight',{min:5,max:2000})}</div>`,footer:`<span class="footnote">${tr('Modul se umístí do prvního volného místa v rastru.')}</span><button class="btn btn-primary" data-confirm>${tr('Přidat do sestavy')}</button>`});m.el.querySelector('[data-confirm]').onclick=()=>{const type=m.el.querySelector('#shape-type').value,name=m.el.querySelector('[data-field=shapeName]').value.trim()||tr('Nový modul'),w=readLength(m.el.querySelector('[data-field=shapeWidth]')),h=readLength(m.el.querySelector('[data-field=shapeHeight]'));if(!Number.isFinite(w)||!Number.isFinite(h))return invalidLength();if(!(w>=5&&w<=2000&&h>=5&&h<=2000))return toast(tr('Zadejte rozměry od {min} do {max}.',{min:fmtLen(5),max:fmtLen(2000)}));if(type!=='blank'){const points=type==='rect'?[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}]:Array.from({length:64},(_,i)=>({x:w/2+Math.cos(i*Math.PI/32)*w/2,y:w/2+Math.sin(i*Math.PI/32)*w/2}));try{addTools([{name,points,depth:12,x:0,y:0,rotation:0}]);m.close();}catch(error){toast(errorText(error));}return;}
    if(project.modules.length>=400)return toast(tr('V projektu může být nejvýše 400 modulů.'));const width=Math.ceil(w/project.grid)*project.grid,height=Math.ceil(h/project.grid)*project.grid;let pos=null;
    for(let y=0;y+height<=project.height&&!pos;y+=project.grid)for(let x=0;x+width<=project.width;x+=project.grid)if(!project.modules.some(o=>x<o.x+o.width&&x+width>o.x&&y<o.y+o.height&&y+height>o.y)){pos={x,y};break;}
    if(!pos)return toast(tr('Modul se nevejde. Zmenšete jej nebo rozšiřte sestavu.'));
    commit(()=>{const item={id:uid(),name,x:pos.x,y:pos.y,width,height,locked:true};project.modules.push(item);selected=null;selectedModule=item.id;inspectorTab='tool';},tr('Prázdný modul přidán a zamčen.'));m.close();};}

function saveToLibrary(tools){let n=0;for(const x of tools){const item=validateProject({...blankProject(),tools:[{...x,id:uid()}]}).tools[0];if(!library.some(l=>l.name===item.name&&JSON.stringify(l.points)===JSON.stringify(item.points))){library.push(item);n++;}}if(n)writeLocal(libraryKey,library);return n;}
function openLibrary(){const mine=()=>({body:`<div class="library-grid">${library.map((t,i)=>`<div class="library-item"><span class="tool-thumb">${thumb(t)}</span><div><strong>${esc(t.name)}${unitBadge(t.unit)}</strong><p>${fmtSize(bounds(t).width,bounds(t).height,{unit:toolUnit(t)})}</p></div><button class="btn btn-light" data-library-add="${i}" aria-label="${tr('Přidat {name} do sestavy',{name:esc(t.name)})}">${icon('plus')}</button><button class="icon-btn" data-library-remove="${i}" aria-label="${tr('Odstranit {name} z knihovny',{name:esc(t.name)})}">${icon('trash')}</button></div>`).join('')||`<p class="empty-note">${tr('Vyfoťte první nástroj nebo vyberte obrys z Katalogu.')}</p>`}</div>`,footer:`<span class="footnote">${tr('Knihovna je uložená v tomto prohlížeči.')}</span><button class="btn btn-primary" data-capture>${icon('camera')}${tr('Vyfotit nástroj')}</button>`});const m=openModal({title:tr('Vaše knihovna nástrojů'),subtitle:tr('Jednou načtený obrys můžete použít v každém dalším šuplíku.'),wide:true});mountLibraryFolders(m,{mine,onAdd:tools=>{addTools(tools);m.close();},onSave:saveToLibrary});m.el.onclick=e=>{const add=e.target.closest('[data-library-add]'),remove=e.target.closest('[data-library-remove]');if(add){try{addTools([clone(library[Number(add.dataset.libraryAdd)])]);m.close();}catch(error){toast(errorText(error));}}if(remove){library.splice(Number(remove.dataset.libraryRemove),1);writeLocal(libraryKey,library);openLibrary();}if(e.target.closest('[data-capture]'))capture();};}
function createDrawer(){
  const draft=blankProject(),u=getAppUnit();
  const modal=openModal({title:tr('Nový šuplík'),subtitle:tr('Zadejte název a skutečné vnitřní rozměry šuplíku.'),body:`${input(tr('Název šuplíku'),'','drawerName',{type:'text'})}<div class="fields-row">${input(tr('Vnitřní šířka'),draft.width,'drawerWidth',{unit:u,min:42,max:3000})}${input(tr('Vnitřní hloubka'),draft.height,'drawerHeight',{unit:u,min:42,max:3000})}</div><p class="muted-note unit-hint">${tr('Lze zadat i jiné jednotky: 12 in, 3 1/2" nebo 30 cm.')}</p>`,footer:`<span class="footnote">${tr('Každý šuplík má vlastní rozměry a sestavu.')}</span><button class="btn btn-primary" data-create-drawer>${tr('Vytvořit šuplík')}</button>`});
  modal.el.querySelector('[data-create-drawer]').onclick=()=>{
    const name=modal.el.querySelector('[data-field=drawerName]').value.trim();if(!name)return toast(tr('Zadejte název šuplíku.'));
    const width=readLength(modal.el.querySelector('[data-field=drawerWidth]')),height=readLength(modal.el.querySelector('[data-field=drawerHeight]'));if(!Number.isFinite(width)||!Number.isFinite(height))return invalidLength();
    if(width<42-.02||height<42-.02||width>3000.02||height>3000.02)return toast(tr('Zadejte hodnotu od {min} do {max}.',{min:fmtLen(42,{unit:u}),max:fmtLen(3000,{unit:u})}));
    try{const next=validateProject({...draft,name,width:Math.min(3000,Math.max(42,width)),height:Math.min(3000,Math.max(42,height))});switchProject(next);toast(tr('Nový šuplík vytvořen.'));}catch(error){toast(errorText(error));}
  };
}
function openProjects(){persist();const m=openModal({title:tr('Moje šuplíky'),subtitle:tr('Každý šuplík má vlastní název, rozměry a sestavu. Pro přenos si stáhněte JSON.'),body:`<button class="btn btn-primary" data-new>${icon('plus')}${tr('Nový šuplík')}</button><button class="btn btn-light" data-import>${icon('upload')}${tr('Otevřít JSON')}</button>${projects.map(p=>`<div class="project-card"><div><h3>${esc(p.name)}</h3><p>${fmtSize(p.width,p.height,{unit:p.unit||getAppUnit()})} · ${plural(p.tools.length,['{n} nástroj','{n} nástroje','{n} nástrojů'])} · ${plural(p.modules.length,['{n} modul','{n} moduly','{n} modulů'])}${p.id===project.id?' · '+tr('otevřený'):''}</p></div><button class="btn btn-light" data-open="${esc(p.id)}">${tr('Otevřít')}</button>${p.id!==project.id?`<button class="icon-btn" data-remove-project="${esc(p.id)}" aria-label="${tr('Smazat šuplík {name}',{name:esc(p.name)})}">${icon('trash')}</button>`:''}</div>`).join('')}`,footer:`<span class="footnote">${tr('Smazání dat prohlížeče odstraní místní šuplíky. JSON je vaše přenosná záloha.')}</span><button class="btn btn-light" data-demo>${tr('Ukázkový šuplík')}</button>`});m.el.onclick=e=>{if(e.target.closest('[data-new]'))createDrawer();if(e.target.closest('[data-import]'))$('#project-file').click();if(e.target.closest('[data-demo]'))switchProject(demoProject());const op=e.target.closest('[data-open]'),rm=e.target.closest('[data-remove-project]');if(op)switchProject(projects.find(p=>p.id===op.dataset.open));if(rm){projects=projects.filter(p=>p.id!==rm.dataset.removeProject);writeLocal(storageKey,projects);render();openProjects();}};}
function help(){
  const card=(h,p)=>`<div class="help-card"><h3>${h}</h3><p>${p}</p></div>`,ref=(name,url,link,p)=>`<div class="help-card"><h3>${name}</h3><a href="${url}" target="_blank" rel="noopener noreferrer">${link} ↗</a><p>${p}</p></div>`;
  openModal({title:tr('Z fotky do šuplíku'),subtitle:tr('Čtyři kroky. Žádný CAD. Vše přímo ve vašem zařízení.'),wide:true,body:`<div class="help-grid">${card(tr('01 / Vyfoťte nástroj'),tr('Položte nástroje na bílou A4, odděleně od sebe. Celý papír musí být vidět. Fotografujte co nejvíc kolmo a v rozptýleném světle bez tvrdého stínu. Můžete použít i pravítko.'))}${card(tr('02 / Obrys připravíme automaticky'),tr('Aplikace najde A4 a narovná perspektivu. Lokální rozpoznávání oddělí předměty od pozadí a zpřesní obrys podle skutečných hran. Kontrast, odstranění šumu a vyhlazení zvolí samo. U pravítka označíte jen dvě známé značky pro měřítko.'))}${card(tr('03 / Rozvrhněte sestavu'),tr('Zadejte vnitřní rozměr šuplíku. Auto rozložení zkouší otočení a umístí obdélníkové moduly do rastru. Je to praktická heuristika, nemusí najít nejúspornější možné řešení. Vytištěné moduly zamkněte a přidávejte další kolem nich.'))}${card(tr('04 / Exportujte a vyrobte'),tr('Zvolte úspornou otevřenou konstrukci nebo plný blok. Dno může být hladké, s patkami Gridfinity, kapsami pro magnety nebo připravené k lepení. Nejdřív přiložte nástroj na PDF v měřítku 1:1 nebo vytiskněte tenkou zkoušku vůle. SVG/DXF slouží pro pěnu či CNC.'))}</div><h3 style="margin-top:27px">${tr('Alternativy, ze kterých vychází návrh')}</h3><p class="help-intro">${tr('Průzkum vlastností na oficiálních webech. Vlastní implementace; kód těchto aplikací se nepřebírá.')}</p><div class="help-grid">${ref('Outline App','https://github.com/georgslazdans/outline-app',tr('Open source editor kontur'),tr('Inspirace: kalibrace fotografie a převod obrysů do výrobních rozměrů.'))}${ref('Tracefinity','https://github.com/tracefinity/tracefinity',tr('Vlastní hostování a knihovna'),tr('Inspirace: opakované použití nástrojů a projekty sestav.'))}${ref('Binforge','https://binforge.app/',tr('Plánování modulů v šuplíku'),tr('Inspirace: jednoduchá práce s rozměry, rastr a samostatné exporty.'))}${ref('TracetoForge','https://tracetoforge.com/',tr('Fotografie → vlastní vložka'),tr('Inspirace: kontrola měřítka, vůle a rozložení více nástrojů.'))}</div><div class="tip" style="margin-top:20px">${icon('shield')} ${tr('Fotografie se nikam neodesílají. Detekce kombinuje lokální model U²-Net a hrany v původní fotce. Pokud snímek nedává dost jistoty, vyžádá novou fotku. U zcela neviditelné hrany nelze skutečný tvar spolehlivě dopočítat.')}</div><p class="muted-note" style="margin-top:15px">${tr('Jednotky: rozměry lze zadávat v mm i palcích (např. 12 in, 3 1/2" nebo 30 cm). Výchozí jednotky přepnete v horní liště, vlastní jednotky šuplíku v Rozměrech šuplíku. Exportované soubory jsou vždy v milimetrech.')}</p><p class="muted-note" style="margin-top:15px">${tr('Na mobilu: přidejte stránku na plochu přes nabídku prohlížeče. Po prvním načtení může editor díky uloženým souborům pracovat i offline. Projekty mezi zařízeními přenesete přes JSON.')}</p>`,footer:`<span class="footnote">${tr('Šuplík Studio 1.2 · vlastní editor bez účtu a předplatného.')}</span><button class="btn btn-dark" data-modal-close-extra>${tr('Rozumím, jdeme tvořit')}</button>`}).el.querySelector('[data-modal-close-extra]').onclick=closeModal;
}

const bottomNames=()=>({plain:tr('Hladké dno'),grid:tr('Gridfinity · patky 42 mm'),magnet:tr('Magnety'),adhesive:tr('Lepidlo / oboustranná páska')});
const volumeText=cm3=>unit()==='in'?`${fmt(cm3/16.387064,2)} in³`:`${fmt(cm3)} cm³`;
let exportFormat='stl',exportScope='all';
function openExport(){
  const m=moduleFor(),selectedId=m?.id||null;
  if(exportScope==='selected'&&!selectedId)exportScope='all';
  const entries=exportScope==='selected'?project.modules.filter(m=>m.id===selectedId):project.modules;
  const opts={moduleId:exportScope==='selected'?selectedId:null};
  const issues=exportScope==='selected'?validateLayout({...project,modules:entries,tools:project.tools.filter(t=>t.moduleId===selectedId)}):errors();
  const formats={stl:['STL',tr('3D tisk')],svg:['SVG',tr('Pěna · laser')],dxf:['DXF','CAD · CNC'],json:['JSON',tr('Záloha projektu')]};
  let stats=null,printError='';
  if(exportFormat==='stl'&&!issues.length&&entries.length){try{stats=printStats(project,opts);}catch(e){printError=errorText(e);}}
  const bottoms=bottomNames(),mmNote=unit()!=='mm'?`<p class="muted-note">${tr('Exportované soubory jsou vždy v milimetrech, i když editor zobrazuje {unit}.',{unit:unit()})}</p>`:'';
  const modal=openModal({title:tr('Připraveno k výrobě'),subtitle:tr('Vyberte provedení. Každý modul se stáhne zvlášť v jednom ZIPu.'),body:`<div class="format-grid">${Object.entries(formats).map(([key,[title,desc]])=>`<button class="format ${exportFormat===key?'active':''}" data-format="${key}"><strong>${title}</strong><span>${desc}</span></button>`).join('')}</div>${exportFormat!=='json'?`<label class="field"><span>${tr('Co exportovat')}</span><select id="export-scope"><option value="all" ${exportScope==='all'?'selected':''}>${tr('Celou sestavu')}</option><option value="selected" ${exportScope==='selected'?'selected':''} ${selectedId?'':'disabled'}>${tr('Vybraný modul')}${m?' · '+esc(m.name):''}</option></select></label>`:''}${exportFormat==='stl'?`<label class="print-toggle"><input id="print-light" type="checkbox" ${project.printMode==='light'?'checked':''}><span><strong>${tr('Úsporný tisk')}</strong><small>${tr('Tenké dno a stěny kolem nástroje. Okolí zůstane otevřené.')}</small></span>${icon('spark')}</label><label class="field"><span>${tr('Dno a uchycení')}</span><select id="print-bottom">${Object.entries(bottoms).map(([key,label])=>`<option value="${key}" ${project.bottomMode===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted-note">${project.bottomMode==='grid'?tr('Patky pro podložku Gridfinity. Rastr a rozměry modulů musí být v násobcích 42 mm.'):project.bottomMode==='magnet'?tr('Čtyři kapsy zespodu pro magnety 6 × 2 mm. Strop nad magnetem se automaticky zesílí.'):project.bottomMode==='adhesive'?tr('Rovné spodní plochy pro lepidlo či tenkou oboustrannou pásku. Tloušťku pásky přičtěte k výšce sestavy.'):tr('Rovné dno pro volné položení do šuplíku.')}</p>${stats?`<div class="print-summary"><strong>${tr('{volume} modelu',{volume:volumeText(stats.volumeCm3)})}${stats.savingPercent>0?`<em>${tr('−{n} % proti plnému bloku',{n:fmt(stats.savingPercent,0)})}</em>`:''}</strong><span>${tr('Výška nejvyššího dílu {height} · dno {base}',{height:fmtLen(stats.heightMm),base:fmtLen(stats.effectiveBaseMm)})}</span><small>${tr('Objem geometrie. Skutečnou spotřebu a čas určí slicer podle výplně a nastavení.')}</small>${(stats.notes||[]).map(note=>`<small>${esc(errorText(note))}</small>`).join('')}</div>`:''}<details class="advanced"><summary>${tr('Tiskárna a další možnosti')}</summary><div class="fields-row">${input(tr('Tisková plocha · šířka'),project.bedWidth,'bedWidth',{min:50,max:2000})}${input(tr('Tisková plocha · hloubka'),project.bedHeight,'bedHeight',{min:50,max:2000})}</div><label class="check-row"><input id="limit-bed" type="checkbox" ${project.limitToBed?'checked':''}>${tr('Rozvrhovat podle tiskové plochy')}</label>${project.bottomMode==='magnet'?`<div class="fields-row">${input(tr('Průměr kapsy'),project.magnetDiameter,'magnetDiameter',{min:3,max:20})}${input(tr('Hloubka kapsy'),project.magnetDepth,'magnetDepth',{min:1,max:8})}</div>`:''}<p class="muted-note">${tr('Rozměry tiskárny se ukládají s projektem. Zamčené moduly se při přepočítání nepřesunou.')}</p></details><div id="bed-warnings"></div>`:''}${(issues.length||printError)&&exportFormat!=='json'?`<div class="issue-box">${issues.slice(0,3).map(i=>`<p>${esc(errorText(i))}</p>`).join('')}${printError?`<p>${esc(printError)}</p>`:''}<button class="section-link" data-repack>${tr('Přepočítat rozvržení')}</button></div>`:''}${exportFormat==='svg'||exportFormat==='dxf'?`<p class="muted-note">${tr('Černá / MODULES = obrys modulu, červená / POCKETS = kapsa včetně vůle. Všechny rozměry jsou v mm.')}</p>`:''}${exportFormat!=='json'?mmNote:''}${exportFormat==='json'?`<p class="muted-note">${tr('Uloží kontury, rozměry, provedení a polohy modulů. Na jiném zařízení otevřete JSON přes Moje šuplíky.')}</p>`:`<details class="advanced fit-check"><summary>${tr('Nejdřív ověřit velikost')}</summary><p>${tr('Přiložte nástroj na papír nebo zkuste tenký rámeček. Nemusíte hned tisknout celý inzert.')}</p><div class="test-actions"><button class="btn btn-light" data-fit-pdf ${issues.length||!entries.length?'disabled':''}>${icon('print')}${tr('PDF v měřítku 1:1')}</button><button class="btn btn-light" data-fit-stl ${issues.length||!entries.length?'disabled':''}>${icon('cube')}${tr('Tenká zkouška STL')}</button></div><p class="muted-note">${tr('PDF tiskněte na 100 % a přeměřte kontrolní úsečku 100 mm. Fotografie nemusí zachytit nejširší část vysokého nástroje.')}</p></details>`}`,footer:`<span class="footnote">${exportFormat==='stl'?tr('STL v mm · samostatné uzavřené díly'):tr('Soubory vznikají ve vašem zařízení')}</span><button class="btn btn-primary" data-do-export ${exportFormat!=='json'&&(issues.length||!entries.length||printError)?'disabled':''}>${icon('download')}${tr('Stáhnout {format}',{format:exportFormat==='stl'&&exportScope==='all'?'ZIP':exportFormat.toUpperCase()})}</button>`});
  const redraw=()=>{const scroll=modal.body.scrollTop;openExport();const body=document.querySelector('.modal-body');if(body)body.scrollTop=scroll;};
  const setting=(key,value)=>{remember();project[key]=value;persist();render();redraw();};
  modal.el.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>{exportFormat=b.dataset.format;redraw();});
  modal.el.querySelector('#export-scope')?.addEventListener('change',e=>{exportScope=e.target.value;redraw();});
  modal.el.querySelector('#print-light')?.addEventListener('change',e=>setting('printMode',e.target.checked?'light':'solid'));
  modal.el.querySelector('#print-bottom')?.addEventListener('change',e=>setting('bottomMode',e.target.value));
  modal.el.querySelector('#limit-bed')?.addEventListener('change',e=>setting('limitToBed',e.target.checked));
  modal.el.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{const v=lengthFrom(el);if(v!==null)setting(el.dataset.field,v);});
  const oversized=entries.filter(m=>!((m.width-.5<=project.bedWidth&&m.height-.5<=project.bedHeight)||(m.height-.5<=project.bedWidth&&m.width-.5<=project.bedHeight)));
  const bed=modal.el.querySelector('#bed-warnings');if(bed&&oversized.length){bed.innerHTML=`<div class="issue-box">${plural(oversized.length,['{n} modul se nevejde na tiskovou plochu. Zkontrolujte tiskárnu a přepočítejte sestavu.','{n} moduly se nevejdou na tiskovou plochu. Zkontrolujte tiskárnu a přepočítejte sestavu.','{n} modulů se nevejde na tiskovou plochu. Zkontrolujte tiskárnu a přepočítejte sestavu.'])}<br><button class="section-link" data-repack>${tr('Přepočítat rozvržení')}</button></div>`;if(project.limitToBed)modal.el.querySelector('[data-do-export]').disabled=true;}
  modal.el.querySelectorAll('[data-repack]').forEach(b=>b.onclick=()=>{commit(()=>arrange());redraw();});
  const fitFiles=()=>entries.map((m,i)=>({name:`${String(i+1).padStart(2,'0')}-${slug(m.name)}-zkouska.stl`,data:exportFitSTL(project,{moduleId:m.id})}));
  modal.el.querySelector('[data-fit-pdf]')?.addEventListener('click',()=>{try{download(slug(project.name)+'-meritko-1-1.pdf',exportFitPDF(project,opts),'application/pdf');toast(tr('PDF připraveno. Tiskněte na 100 % bez přizpůsobení stránce.'));}catch(e){toast(errorText(e));}});
  modal.el.querySelector('[data-fit-stl]')?.addEventListener('click',()=>{try{const files=fitFiles();if(files.length===1)download(files[0].name,files[0].data,'model/stl');else download(slug(project.name)+'-zkousky.zip',zipFiles(files),'application/zip');toast(tr('Tenké zkoušky jsou připravené. Mají stejnou vůli jako finální kapsy.'));}catch(e){toast(errorText(e));}});
  modal.el.querySelector('[data-do-export]').onclick=async e=>{
    const button=e.currentTarget;button.disabled=true;button.innerHTML=`<span class="spinner"></span> ${tr('Připravuji…')}`;
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,30)));
    try{
      const name=slug(project.name);
      if(exportFormat==='json')saveJSON();
      else if(exportFormat==='svg')download(name+'.svg',exportSVG(project,opts),'image/svg+xml');
      else if(exportFormat==='dxf')download(name+'.dxf',exportDXF(project,opts),'application/dxf');
      else if(exportScope==='selected')download(slug(m.name)+'.stl',exportSTL(project,opts),'model/stl');
      else{
        // Manufacturing files and the bundled read-me are always in millimetres.
        const files=entries.map((m,i)=>({name:`${String(i+1).padStart(2,'0')}-${slug(m.name)}.stl`,data:exportSTL(project,{moduleId:m.id})}));
        files.push({name:'sestava.svg',data:exportSVG(project)},{name:'projekt.json',data:JSON.stringify({schemaVersion:1,app:'Suplik Studio',project},null,2)},{name:tr('CTETE-ME.txt'),data:`Šuplík Studio
${project.name}
${project.printMode==='light'?tr('Úsporná otevřená konstrukce'):tr('Plný blok s kapsami')} · ${bottoms[project.bottomMode]}
${tr('Rastr {grid} mm · vůle {clearance} mm',{grid:project.grid,clearance:project.clearance})}
${tr('Všechny STL jsou v milimetrech. Vložte dnem na tiskovou podložku.')}
${(stats?.notes||[]).map(note=>errorText(note)).join('\n')}
${tr('Nejprve ověřte vůli pomocí PDF 1:1 nebo tenké zkoušky STL v aplikaci.')}

${entries.map((m,i)=>`${i+1}. ${m.name}: ${tr('{w} × {h} mm, poloha {x},{y} mm',{w:m.width-.5,h:m.height-.5,x:m.x,y:m.y})}${m.locked?' '+tr('(zamčeno)'):''}`).join('\n')}`});
        download(name+'-moduly.zip',zipFiles(files),'application/zip');
      }
      modal.close();toast(tr('Soubor je připravený ve stažených souborech.'));
    }catch(error){toast(errorText(error));button.disabled=false;button.innerHTML=icon('download')+' '+tr('Zkusit znovu');}
  };
}

function saveJSON(){download(slug(project.name)+'.json',JSON.stringify({schemaVersion:1,app:'Suplik Studio',project},null,2),'application/json');}


const actions={
 'move-mode':()=>{moveMode=!moveMode;render();if(moveMode)toast(tr('Přetáhněte modul. Tlačítkem Hotovo obnovíte posouvání stránky.'));},
 home:()=>{closeModal();window.scrollTo({top:0,behavior:'smooth'});},capture,library:openLibrary,projects:openProjects,help,rename,expand,'add-shape':addShape,'resize-module':editModuleSize,'size-module-auto':sizeModuleAutomatically,export:openExport,
 'save-project':()=>{persist();saveJSON();toast(tr('Projekt uložen jako přenosný JSON.'));},
 'set-lang':lang=>{setLang(lang);},
 'new-drawer':createDrawer,'import-json':()=>$('#project-file').click(),'demo-drawer':()=>switchProject(demoProject()),
 'set-unit':u=>{setAppUnit(u);render();if(project.unit&&project.unit!==u)toast(tr('Tento šuplík má vlastní jednotky ({unit}). Změníte je v Rozměrech šuplíku.',{unit:project.unit}));},
 'drawer-tab':showDrawerDimensions,
 'edit-contour':capture,'finger-grips':editFingerGrips,'finger-grips-auto':()=>{const t=tool();if(t)setFingerGrips(automaticFingerGrips(t,{radius:9}));},'finger-grips-clear':()=>setFingerGrips([]),
 auto:()=>commit(()=>arrange()),'smart-layout':smartArrangeProject,'split-module':splitModule,'tool-sets':openToolSets,'tool-set-current':editSelectedToolSet,
 undo,redo,
 snap:()=>{snap=!snap;render();},grid:()=>{showGrid=!showGrid;render();},labels:()=>{showLabels=!showLabels;render();},
 '2d':()=>{view='2d';render();},'3d':()=>{view='3d';render();},
 'zoom-in':()=>{if(view==='3d')camera3D=normalizeCamera3D({...camera3D,zoom:camera3D.zoom*1.25});else zoom=Math.min(3,zoom+.25);render();},'zoom-out':()=>{if(view==='3d')camera3D=normalizeCamera3D({...camera3D,zoom:camera3D.zoom/1.25});else zoom=Math.max(.5,zoom-.25);render();},fit:()=>{if(view==='3d')camera3D=createCamera3D();else zoom=1;render();},
 'hide-tip':()=>{tipVisible=false;writeLocal('suplik-hide-tip',true);render();},
 rotate:()=>{const t=tool(),m=moduleFor();if(!t)return;if(m?.locked)return toast(tr('Nejprve odemkněte polohu modulu.'));commit(()=>{const b=bounds(t);t.rotation=(t.rotation+90)%360;const next=bounds(t);t.x=b.x+(b.width-next.width)/2;t.y=b.y+(b.height-next.height)/2;},tr('Nástroj otočen. Pokud přesahuje modul, spusťte Auto rozložení.'));},
 lock:()=>{const m=moduleFor();if(!m)return;commit(()=>{m.locked=!m.locked;project.tools.filter(t=>t.moduleId===m.id).forEach(t=>t.locked=m.locked);},m.locked?tr('Poloha modulu je odemčená.'):tr('Poloha modulu je zamčená.'));},
 duplicate:()=>{const t=tool();if(t)addTools([{...clone(t),name:t.name+' · '+tr('kopie')}]);},
 delete:()=>{const t=tool(),m=moduleFor();if(!t&&!m)return;commit(()=>{if(t){removeToolSetMember(t.id);project.tools=project.tools.filter(x=>x.id!==t.id);project.modules=project.modules.filter(x=>x.id!==t.moduleId||project.tools.some(o=>o.moduleId===x.id));selected=project.tools[0]?.id||null;}else project.modules=project.modules.filter(x=>x.id!==m.id);selectedModule=null;},tr('Odstraněno ze sestavy. Akci můžete vrátit tlačítkem Zpět.'));}
};
$('#app').addEventListener('click',e=>{const open=e.target.closest('[data-drawer-open]'),remove=e.target.closest('[data-drawer-remove]');if(remove){removeDrawer(remove.dataset.drawerRemove);return;}if(open){const p=projects.find(p=>p.id===open.dataset.drawerOpen);if(p&&p.id!==project.id)switchProject(p);return;}const sel=e.target.closest('[data-select]');if(sel){selected=sel.dataset.select;selectedModule=null;inspectorTab='tool';render();return;}const group=e.target.closest('[data-module]');if(group&&(view==='3d'||!moveMode)){const m=project.modules.find(m=>m.id===group.dataset.module),t=project.tools.find(t=>t.moduleId===m?.id);selected=t?.id||null;selectedModule=t?null:m?.id;inspectorTab='tool';render();return;}const a=e.target.closest('[data-action]');if(a){e.preventDefault();try{actions[a.dataset.action]?.(a.dataset.value);}catch(error){toast(errorText(error));}}});
$('#app').addEventListener('change',e=>{
  const el=e.target.closest('[data-field]');if(!el)return;const field=el.dataset.field,scope=el.dataset.scope;let value=el.value.trim();
  if(el.hasAttribute('data-length')){value=lengthFrom(el);if(value===null){render();return;}}
    if(scope==='tool'){
    const t=tool();if(!t)return;
    if(field==='unit'){commit(()=>{if(value)t.unit=value;else delete t.unit;});return;}
    if(field==='name'&&!value){render();return;}
    if(field==='toolWidth'){const ratio=value/bounds(t).width;if(t.points.some(p=>p.x*ratio>3000||p.y*ratio>3000)){toast(tr('Kontura nesmí v žádném směru přesáhnout {max}.',{max:fmtLen(3000)}));render();return;}}if(field==='toolWidth'&&moduleFor()?.locked){toast(tr('Pro změnu rozměru nejdřív odemkněte modul.'));render();return;}
    let scaled=null;
    if(field==='toolWidth'){
      const ratio=value/bounds(t).width;scaled={...t,points:t.points.map(p=>({x:p.x*ratio,y:p.y*ratio}))};
      try{if(Object.prototype.hasOwnProperty.call(t,'fingerGrips'))scaled.fingerGrips=validateFingerGrips(t.fingerGrips.map(g=>({...g,x:g.x*ratio,y:g.y*ratio})));pocketOutline(scaled,project.clearance);}
      catch(error){toast(tr('Velikost kontury nelze změnit. U výřezů použijte „Automaticky umístit“ a zkuste to znovu. {error}',{error:errorText(error)}));render();return;}
    }
    commit(()=>{if(scaled){t.points=scaled.points;if(Object.prototype.hasOwnProperty.call(scaled,'fingerGrips'))t.fingerGrips=scaled.fingerGrips;}else t[field]=typeof value==='string'?value.slice(0,100):value;});
  }else if(scope==='module'){const m=moduleFor();if(!m||field!=='unit')return;commit(()=>{if(value)m.unit=value;else delete m.unit;});}
  else commit(()=>project[field]=value);
});
$('#app').addEventListener('pointerdown',e=>{
  if(view==='3d'||e.button!==0)return;
  if(e.pointerType==='touch'&&!moveMode)return;
  const group=e.target.closest('[data-module]'),svg=$('#board-svg');if(!group||!svg)return;
  const m=project.modules.find(m=>m.id===group.dataset.module);if(!m)return;
  const t=project.tools.find(t=>t.moduleId===m.id);selected=t?.id||null;selectedModule=t?null:m.id;inspectorTab='tool';
  if(view==='3d'||m.locked){render();if(m.locked)toast(tr('Poloha modulu je zamčená. Odemkněte ji ve vlastnostech.'));return;}
  e.preventDefault();const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());
  drag={pointer:e.pointerId,id:m.id,start:p,x:m.x,y:m.y,snapshot:clone(project),moved:false};svg.setPointerCapture(e.pointerId);renderBoard();
});
$('#app').addEventListener('pointermove',e=>{
  if(view==='3d'||!drag)return;const svg=$('#board-svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());const m=project.modules.find(m=>m.id===drag.id);if(!m)return;
  const dx=q.x-drag.start.x,dy=q.y-drag.start.y;if(Math.hypot(dx,dy)<2&&!drag.moved)return;drag.moved=true;
  let x=drag.x+dx,y=drag.y+dy;if(snap){x=Math.round(x/project.grid)*project.grid;y=Math.round(y/project.grid)*project.grid;}x=Math.max(0,Math.min(project.width-m.width,x));y=Math.max(0,Math.min(project.height-m.height,y));
  const sx=x-m.x,sy=y-m.y;m.x=x;m.y=y;project.tools.filter(t=>t.moduleId===m.id).forEach(t=>{t.x+=sx;t.y+=sy;});renderBoard();
});
function endDrag(){if(!drag)return;if(drag.moved){const invalid=errors().some(i=>i.ids.includes(drag.id)&&i.type==='overlap');if(invalid){project=drag.snapshot;toast(tr('Tady už je jiný modul. Zkuste volné místo.'));}else{undoStack.push(drag.snapshot);redoStack=[];persist();}}drag=null;render();}
$('#app').addEventListener('pointerup',endDrag);$('#app').addEventListener('pointercancel',()=>{if(drag){project=drag.snapshot;drag=null;render();}});
$('#app').addEventListener('keydown',e=>{const group=e.target.closest('[data-module]');if(group&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const m=project.modules.find(m=>m.id===group.dataset.module),t=project.tools.find(t=>t.moduleId===m.id);selected=t?.id||null;selectedModule=t?null:m.id;inspectorTab='tool';render();}});
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||$('#modal-root').children.length)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='r')actions.rotate();else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();actions.delete();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();actions['save-project']();}});
$('#project-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>12*1024*1024)return toast(tr('Projekt je příliš velký. Maximum je 12 MB.'));try{const data=JSON.parse(await file.text());if(data.schemaVersion&&data.schemaVersion!==1)throw i18nError('Tato verze projektu zatím není podporovaná.');const imported=validateProject(data);imported.id=uid();switchProject(imported);toast(tr('Projekt otevřen. Původní projekty zůstaly uložené.'));}catch(error){toast(tr('Projekt nelze otevřít: {error}',{error:errorText(error)}));}});
onLangChange(()=>{applyDocumentText();render();});
applyDocumentText();persist();render();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
