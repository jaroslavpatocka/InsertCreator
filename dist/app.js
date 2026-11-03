import {bounds,transformedPoints,autoArrange,resizeModule,validateLayout,exportSVG,exportDXF,exportSTL,exportFitSTL,printStats,zipFiles,createDemoProject} from './geometry.js';
import {printPreview,createCamera3D,normalizeCamera3D} from './preview3d.js';
import {createViewControls} from './view-controls.js';
import {exportFitPDF} from './fit-sheet.js';
import {openCapture} from './capture.js';
import {esc,icon,openModal,closeModal,toast,download} from './ui.js';
import {uid,clone,validateProject,readLocal,writeLocal,blankProject} from './model.js';
import {automaticFingerGrips,pocketOutline,validateFingerGrips} from './finger-grip.js';
import {runSmartLayout} from './smart-layout-client.js';

const $=s=>document.querySelector(s);
const fmt=(v,d=1)=>Number(v).toLocaleString('cs-CZ',{maximumFractionDigits:d});
const slug=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'suplik';
const paths=points=>points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')+'Z';
const palette=['#acb998','#a4b9a9','#b4bd9e','#aebda1','#bdb7a1','#b3bda8'];
const storageKey='suplik-studio-projects-v1',libraryKey='suplik-studio-library-v1';
let projects=readLocal(storageKey,[]);
if(!Array.isArray(projects))projects=[];
projects=projects.flatMap(p=>{try{return[validateProject(p)]}catch{return[]}});
let project=projects.find(p=>p.id===readLocal('suplik-studio-current',''))||projects[0];
if(!project){project=validateProject({...createDemoProject(),id:uid()});projects=[project];}
let library=readLocal(libraryKey,null);
if(!Array.isArray(library))library=createDemoProject().tools.map(t=>({...clone(t),x:0,y:0,moduleId:null}));
library=library.flatMap(t=>{try{return[validateProject({...blankProject(),tools:[t]}).tools[0]];}catch{return[];}});
let selected=project.tools[0]?.id||null,selectedModule=null,inspectorTab='drawer',view='2d',zoom=1,snap=true,showGrid=true,showLabels=true,tipVisible=!readLocal('suplik-hide-tip',false);
let undoStack=[],redoStack=[],drag=null,storageFailed=false,moveMode=false;
let camera3D=createCamera3D(),cameraFrame={width:1000,height:600,zoom:1},viewControls=null;
let smartLayoutRun=null;
const tool=()=>project.tools.find(t=>t.id===selected);
const moduleFor=(t=tool())=>project.modules.find(m=>m.id===(t?.moduleId||selectedModule));
const errors=()=>validateLayout(project);
function remember(){undoStack.push(clone(project));if(undoStack.length>40)undoStack.shift();redoStack=[];}
function persist(){
  project.updatedAt=new Date().toISOString();const index=projects.findIndex(p=>p.id===project.id);if(index>=0)projects[index]=clone(project);else projects.push(clone(project));
  const ok=writeLocal(storageKey,projects)&&writeLocal('suplik-studio-current',project.id);
  if(!ok&&!storageFailed)toast('Úložiště prohlížeče je plné nebo vypnuté. Uložte projekt jako JSON.');storageFailed=!ok;return ok;
}
function commit(fn,message){remember();fn();persist();render();if(message)toast(message);}
const same=value=>JSON.stringify(value);
const layoutArea=p=>p.modules.reduce((sum,m)=>sum+(m.width-.5)*(m.height-.5),0);
const placedTools=p=>{const ids=new Set(p.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=p.width+1e-6&&m.y+m.height<=p.height+1e-6).map(m=>m.id));return new Set(p.tools.filter(t=>ids.has(t.moduleId)).map(t=>t.id));};
function layoutMetric(p){const modules=p.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=p.width+1e-6&&m.y+m.height<=p.height+1e-6),bbox=modules.length?(Math.max(...modules.map(m=>m.x+m.width))-Math.min(...modules.map(m=>m.x)))*(Math.max(...modules.map(m=>m.y+m.height))-Math.min(...modules.map(m=>m.y))):0;return{placed:placedTools(p).size,area:layoutArea(p),modules:p.modules.length,bbox};}
function betterLayout(a,b){return a.placed>b.placed||(a.placed===b.placed&&(a.area<b.area-1e-6||(Math.abs(a.area-b.area)<=1e-6&&(a.modules<b.modules||(a.modules===b.modules&&a.bbox<b.bbox-1e-6)))));}
function checkLayoutTransition(before,next){
  const placed=placedTools(before),after=placedTools(next),lost=before.tools.find(t=>placed.has(t.id)&&!after.has(t.id));
  if(lost)throw Error(`Nástroj „${lost.name}“ by se už nevešel. Zvětšete šuplík nebo uvolněte místo.`);
  const modules=next.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=next.width+1e-6&&m.y+m.height<=next.height+1e-6),insideIds=new Set(modules.map(m=>m.id));
  const placedIssue=validateLayout({...next,modules,tools:next.tools.filter(t=>insideIds.has(t.moduleId))})[0];if(placedIssue)throw Error(placedIssue.message);
  const unplacedIds=new Set(next.tools.filter(t=>!after.has(t.id)).map(t=>t.id));
  const outsideIds=new Set(next.modules.filter(m=>!insideIds.has(m.id)&&next.tools.some(t=>t.moduleId===m.id)&&next.tools.filter(t=>t.moduleId===m.id).every(t=>unplacedIds.has(t.id))).map(m=>m.id));
  const issue=validateLayout(next).find(i=>!(i.type==='outside'&&i.ids.length===1&&(unplacedIds.has(i.ids[0])||outsideIds.has(i.ids[0]))));if(issue)throw Error(issue.message);
}
function checkedSmartResult(before,result){
  if(!result||!Array.isArray(result.tools)||!Array.isArray(result.modules)||result.tools.length!==before.tools.length)throw Error('Chytré rozvržení nevrátilo úplnou sestavu.');
  const checked=validateProject({...before,tools:result.tools,modules:result.modules}),rawTools=new Map(result.tools.map(t=>[t.id,t])),newModules=new Map(checked.modules.map(m=>[m.id,m]));
  const oldModules=new Map(before.modules.map(m=>[m.id,m])),placements=new Set(['x','y','rotation','moduleId','fingerGrips']);
  const members=id=>before.tools.filter(t=>t.moduleId===id);
  const fixedIds=new Set(before.modules.filter(m=>m.locked||!members(m.id).length||members(m.id).some(t=>t.locked)).map(m=>m.id));
  const protectedIds=new Set(before.modules.filter(m=>fixedIds.has(m.id)||m.sizeMode==='manual'||m.grouped||members(m.id).length>1).map(m=>m.id));
  const rawModules=new Map(result.modules.map(m=>[m.id,m]));
  const next={...clone(before),tools:[],modules:checked.modules.map(m=>({...clone(oldModules.get(m.id)||{}),...clone(rawModules.get(m.id)),...m}))};
  for(const t of before.tools){
    const raw=rawTools.get(t.id),valid=checked.tools.find(n=>n.id===t.id);if(!raw||!valid)throw Error('V chytrém rozvržení chybí nástroj.');
    for(const key of Object.keys(t))if(!placements.has(key)&&same(raw[key])!==same(t[key]))throw Error(`Chytré rozvržení změnilo údaje nástroje „${t.name}“.`);
    if(Object.keys(raw).some(key=>!Object.hasOwn(t,key)&&!placements.has(key)))throw Error('Chytré rozvržení změnilo údaje nástroje.');
    const item={...clone(t),x:valid.x,y:valid.y,rotation:valid.rotation,moduleId:valid.moduleId};
    if(Object.hasOwn(t,'fingerGrips')){if(!Object.hasOwn(raw,'fingerGrips')||same(raw.fingerGrips)!==same(t.fingerGrips))throw Error('Chytré rozvržení změnilo nastavené výřezy pro prsty.');}
    else if(Object.hasOwn(raw,'fingerGrips')){
      const m=newModules.get(valid.moduleId),count=checked.tools.filter(n=>n.moduleId===valid.moduleId).length;
      if(!m?.grouped||oldModules.has(m.id)||count<2||same(valid.fingerGrips)!==same(automaticFingerGrips(t,{radius:9})))throw Error('Chytré rozvržení přidalo neplatné výřezy pro prsty.');
      item.fingerGrips=valid.fingerGrips;
    }
    if((t.locked||fixedIds.has(t.moduleId))&&['x','y','rotation','moduleId'].some(key=>same(item[key])!==same(t[key])))throw Error('Chytré rozvržení přesunulo zamčený nástroj.');
    if(protectedIds.has(t.moduleId)&&!fixedIds.has(t.moduleId)){
      const old=oldModules.get(t.moduleId),m=newModules.get(t.moduleId);
      if(!m||item.moduleId!==t.moduleId||item.rotation!==t.rotation||Math.abs(item.x-t.x-(m.x-old.x))>1e-6||Math.abs(item.y-t.y-(m.y-old.y))>1e-6)throw Error('Chytré rozvržení změnilo vzájemnou polohu nástrojů ve společném nebo ručním modulu.');
    }
    next.tools.push(item);
  }
  for(const id of protectedIds){
    const old=oldModules.get(id),m=newModules.get(id);
    if(!m||['id','name','width','height','locked'].some(key=>same(m[key])!==same(old[key]))||(fixedIds.has(id)&&(m.x!==old.x||m.y!==old.y))||(m.sizeMode||'auto')!==(old.sizeMode||'auto')||!!m.grouped!==!!old.grouped)throw Error('Chytré rozvržení změnilo zamčený, ruční nebo společný modul.');
    next.modules[next.modules.findIndex(m=>m.id===id)]={...clone(old),x:m.x,y:m.y};
  }
  checkLayoutTransition(before,next);return next;
}
async function smartArrangeProject(){
  const before=clone(project),controller=new AbortController(),job={controller,key:same(project),done:false};
  const modal=openModal({title:'Chytré rozvržení',subtitle:'Porovnám bezpečné varianty a společné moduly.',body:'<div class="smart-layout-progress" role="status" aria-live="polite"><p data-smart-message>Připravuji výpočet…</p><progress data-smart-progress max="1" value="0" aria-label="Průběh chytrého rozvržení"></progress><small data-smart-percent>0 %</small></div>',footer:'<span class="footnote">Sestavu můžete během výpočtu ponechat beze změny.</span><button class="btn btn-light" data-smart-cancel>Zrušit</button>',onClose:()=>{if(!job.done)controller.abort();}});
  smartLayoutRun=job;
  const finishUI=(title,body)=>{modal.body.innerHTML=`<div class="smart-layout-result"><h3>${esc(title)}</h3>${body}</div>`;modal.footer.innerHTML='<span></span><button class="btn btn-primary" data-smart-close>Hotovo</button>';modal.footer.querySelector('[data-smart-close]').onclick=modal.close;};
  modal.el.querySelector('[data-smart-cancel]').onclick=()=>{controller.abort();modal.close();toast('Chytré rozvržení zrušeno. Sestava se nezměnila.');};
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    if(controller.signal.aborted||smartLayoutRun!==job||!modal.el.isConnected)return;
    const result=await runSmartLayout(before,{signal:controller.signal,onProgress:event=>{
      if(smartLayoutRun!==job||controller.signal.aborted||!modal.el.isConnected)return;
      const value=Math.max(0,Math.min(1,Number(event?.progress)||0));job.lastMessage=event?.message||job.lastMessage;modal.body.querySelector('[data-smart-progress]').value=value;modal.body.querySelector('[data-smart-percent]').textContent=Math.round(value*100)+' %';modal.body.querySelector('[data-smart-message]').textContent=event?.message||'Porovnávám rozvržení…';
    }});
    if(controller.signal.aborted||smartLayoutRun!==job||!modal.el.isConnected)return;
    if(same(project)!==job.key)throw Error('Sestava se během výpočtu změnila. Spusťte chytré rozvržení znovu.');
    const next=checkedSmartResult(before,result),oldMetric=layoutMetric(before),newMetric=layoutMetric(next),beforeArea=oldMetric.area,afterArea=newMetric.area,saving=beforeArea>0?(beforeArea-afterArea)/beforeArea*100:0;
    if(!betterLayout(newMetric,oldMetric)){job.done=true;finishUI(job.lastMessage||'Lepší bezpečné rozvržení nebylo nalezeno.','<p>Stávající sestava zůstala beze změny.</p>');return;}
    const shared=next.modules.filter(m=>next.tools.filter(t=>t.moduleId===m.id).length>1).length;
    job.done=true;commit(()=>project=next);
    const title=saving>0?`Úspora plochy ${fmt(saving,saving<.1?3:1)} %`:newMetric.placed>oldMetric.placed?'Více nástrojů má své místo.':'Rozvržení je kompaktnější.';
    const areaNote=afterArea>beforeArea+1e-6?'<p>Plocha modulů vzrostla, protože mají místo další nástroje.</p>':Math.abs(afterArea-beforeArea)<=1e-6?'<p>Celková plocha modulů zůstala stejná.</p>':'';
    finishUI(title,`<p>Vnější půdorysy modulů: ${fmt(beforeArea,0)} → ${fmt(afterArea,0)} mm²</p>${areaNote}<p>Umístěné nástroje: ${oldMetric.placed} → ${newMetric.placed}</p><p>${before.modules.length} → ${next.modules.length} modulů · Společné moduly: ${shared}. Výsledek můžete vrátit tlačítkem Zpět.</p>`);
  }catch(error){if(!controller.signal.aborted&&smartLayoutRun===job&&modal.el.isConnected){job.done=true;finishUI('Rozvržení se nepodařilo použít.',`<p>${esc(error.message)}</p>`);}}
  finally{if(smartLayoutRun===job)smartLayoutRun=null;}
}
function splitModule(){
  const m=moduleFor();if(!m)return;const own=project.tools.filter(t=>t.moduleId===m.id);if(own.length<2)return;
  if(m.locked||own.some(t=>t.locked))throw Error('Nejprve odemkněte společný modul.');
  const next=clone(project);next.modules=next.modules.filter(n=>n.id!==m.id);next.tools.filter(t=>t.moduleId===m.id).forEach(t=>t.moduleId=null);
  const result=autoArrange(next);next.tools=result.tools;next.modules=result.modules;checkLayoutTransition(project,next);
  commit(()=>project=next,'Společný modul rozdělen. Změnu můžete vrátit tlačítkem Zpět.');
}
function arrange(message=true){const result=autoArrange(project);project.tools=result.tools;project.modules=result.modules;if(message)toast(result.unplaced.length?`${result.unplaced.length} nástrojů se nevešlo. Zkontrolujte rozměry šuplíku a tiskové plochy nebo odemkněte moduly.`:'Rozložení hotové. Zamčené moduly zůstaly na svém místě.');return result;}
function thumb(t){const b=bounds({...t,x:0,y:0,rotation:0});return `<svg viewBox="${-3} ${-3} ${b.width+6} ${b.height+6}" aria-hidden="true"><path d="${paths(transformedPoints({...t,x:0,y:0,rotation:0}))}" fill="${t.id===selected?'#c79c53':'#9fae90'}" stroke="none"/></svg>`;}
function input(label,value,key,{unit='mm',min=0,max=3000,step=1,scope='project',type='number'}={}){return `<label class="field"><span>${label}</span><div class="input-wrap"><input type="${type}" value="${esc(value)}" data-field="${key}" data-scope="${scope}" ${type==='number'?`min="${min}" max="${max}" step="${step}"`:''} aria-label="${label}">${unit?`<em>${unit}</em>`:''}</div></label>`;}
function drawerPanel(){return `<div class="panel-header"><h2 class="panel-title">${icon('ruler')} Rozměry šuplíku</h2><span>mm</span></div><div class="panel-body"><div class="fields-row">${input('Šířka · zleva doprava',project.width,'width',{min:42})}${input('Hloubka · zepředu dozadu',project.height,'height',{min:42})}</div>${input('Výška inzertu',project.insertHeight,'insertHeight',{min:3,max:100})}<details class="advanced"><summary>Další nastavení</summary><div class="fields-row">${input('Rastr modulů',project.grid,'grid',{min:10,max:100})}${input('Vůle kolem nástroje',project.clearance,'clearance',{min:0,max:5,step:.1})}</div><div class="fields-row">${input('Tloušťka dna',project.base,'base',{min:1,max:20,step:.2})}${input('Minimální stěna',project.wall,'wall',{min:1,max:15,step:.2})}</div><div class="toggle-row"><span>Přichytit k rastru</span><button class="switch ${snap?'on':''}" data-action="snap" role="switch" aria-checked="${snap}" aria-label="Přichytit k rastru"></button></div></details><button class="btn btn-soft block-button" data-action="expand">${icon('expand')} Rozšířit sestavu</button><p class="muted-note">Hotové moduly zamkněte. Další nástroje přidáte i z jiné fotografie.</p></div>`;}

function safePocket(tool,clearance=project.clearance){try{return pocketOutline(tool,clearance);}catch{return transformedPoints(tool,clearance);}}
function fingerGripPreview(t,grips=t.fingerGrips??[],showCircles=false){
  const local={...t,x:0,y:0,rotation:0,fingerGrips:grips},raw=transformedPoints(local),outline=safePocket(local);
  const xs=outline.map(p=>p.x),ys=outline.map(p=>p.y),x=Math.min(...xs)-5,y=Math.min(...ys)-5,w=Math.max(...xs)-x+5,h=Math.max(...ys)-y+5;
  const minX=Math.min(...t.points.map(p=>p.x)),minY=Math.min(...t.points.map(p=>p.y));
  return `<svg class="finger-grip-preview" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Kapsa s výřezy pro prsty a původní obrys nástroje"><path class="grip-pocket" d="${paths(outline)}"/><path class="grip-tool" d="${paths(raw)}"/>${showCircles?grips.filter(g=>[g.x,g.y,g.radius].every(Number.isFinite)&&g.radius>0).map((g,i)=>`<g><circle class="grip-circle" cx="${g.x-minX}" cy="${g.y-minY}" r="${g.radius}"/><text x="${g.x-minX}" y="${g.y-minY}" class="grip-number">${i+1}</text></g>`).join(''):''}</svg>`;
}
function fingerGripPanel(t){
  const grips=t.fingerGrips??[],legacy=!Object.prototype.hasOwnProperty.call(t,'fingerGrips');
  return `<section class="finger-grip-panel"><strong>Výřezy pro prsty <span>${grips.length}</span></strong>${fingerGripPreview(t)}<div class="grip-legend"><span>Kapsa včetně výřezů</span><span>Původní nástroj</span></div><p class="muted-note">${grips.length?`Stejná hloubka jako kapsa: ${fmt(t.depth)} mm.`:legacy?'Tento nástroj zatím výřezy nemá. Přidání změní výrobní kapsu.':'Výřezy jsou vypnuté. Automatické rozložení je znovu nepřidá.'}</p>${grips.length?`<ul class="grip-summary">${grips.map((g,i)=>`<li>${i+1}. X ${fmt(g.x)} · Y ${fmt(g.y)} · Ø ${fmt(g.radius*2)} mm</li>`).join('')}</ul>`:''}<div class="selected-actions"><button class="btn btn-light" data-action="finger-grips">${grips.length?'Upravit výřezy':'Přidat další výřez'}</button><button class="btn btn-light" data-action="finger-grips-auto">${legacy?'Přidat výřezy pro prsty':'Automaticky umístit'}</button>${grips.length?'<button class="btn btn-light" data-action="finger-grips-clear">Smazat všechny</button>':''}</div></section>`;
}
function fingerGripCandidate(id,grips){
  const next=clone(project),t=next.tools.find(t=>t.id===id);if(!t)throw Error('Nástroj už není v sestavě.');
  t.fingerGrips=validateFingerGrips(grips);pocketOutline(t,next.clearance);
  const previous=project.tools.find(t=>t.id===id),m=project.modules.find(m=>m.id===previous.moduleId);
  if(!m||(!m.locked&&!previous.locked&&m.sizeMode!=='manual')){
    const placedIds=new Set(project.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=project.width+1e-6&&m.y+m.height<=project.height+1e-6).map(m=>m.id));
    const result=autoArrange(next),unplaced=new Set(result.unplaced),displaced=project.tools.find(t=>placedIds.has(t.moduleId)&&unplaced.has(t.id));
    if(displaced)throw Error(`Pro výřezy není dost místa. Nástroj „${displaced.name}“ by se už nevešel do šuplíku. Zvětšete šuplík nebo uvolněte místo.`);
    next.tools=result.tools;next.modules=result.modules;
  }
  const changed=next.tools.find(t=>t.id===id),ids=new Set([id,m?.id,changed.moduleId].filter(Boolean));
  const issue=validateLayout(next).find(issue=>issue.ids.some(id=>ids.has(id)));
  if(issue)throw Error(m&&(m.locked||previous.locked||m.sizeMode==='manual')?'Výřezy se nevejdou do stávajícího modulu. Zvětšete modul nebo odemkněte jeho polohu. '+issue.message:'Nástroj s výřezy se nevejde. Zvětšete šuplík nebo uvolněte místo. '+issue.message);
  return next;
}
function setFingerGrips(grips){const t=tool();if(!t)return;const next=fingerGripCandidate(t.id,grips);commit(()=>project=next,'Výřezy pro prsty uloženy.');}
function editFingerGrips(){
  const t=tool();if(!t)return;let draft=clone(t.fingerGrips??[]);
  const modal=openModal({title:'Výřezy pro prsty',subtitle:t.name,wide:true,body:'',footer:'<span class="footnote">Poloha je v milimetrech od levého horního rohu původního nástroje. Hloubka výřezů odpovídá kapse.</span><button class="btn btn-primary" data-grips-save>Uložit výřezy</button>'});
  const numeric=el=>{if(!el.value||!Number.isFinite(Number(el.value)))throw Error('Zadejte platnou číselnou polohu a průměr výřezu.');return Number(el.value);};
  const readDraft=omitId=>[...modal.body.querySelectorAll('[data-grip-row]')].filter(row=>row.dataset.gripRow!==omitId).map(row=>({id:row.dataset.gripRow,x:numeric(row.querySelector('[data-field=fingerX]')),y:numeric(row.querySelector('[data-field=fingerY]')),radius:numeric(row.querySelector('[data-field=fingerDiameter]'))/2}));
  const preview=()=>{
    try{const candidate={...t,fingerGrips:validateFingerGrips(draft)};pocketOutline(candidate,project.clearance);modal.body.querySelector('[data-grip-preview]').innerHTML=fingerGripPreview(t,draft,true);modal.body.querySelector('[data-grip-error]').textContent='';}
    catch(error){modal.body.querySelector('[data-grip-error]').textContent=error.message;}
  };
  const redraw=()=>{
    modal.body.innerHTML=`<div class="grip-editor"><div><div data-grip-preview>${fingerGripPreview(t,draft,true)}</div><div class="grip-legend"><span>Kapsa včetně výřezů</span><span>Původní nástroj</span></div><p class="muted-note">Kruhy ukazují místo pro prsty. Průměr určuje jejich skutečnou velikost.</p></div><div><div class="grip-edit-actions"><button class="btn btn-light" data-grip-add ${draft.length>=12?'disabled':''}>Přidat další</button><button class="btn btn-light" data-grip-auto>Automaticky umístit</button><button class="btn btn-light" data-grip-clear ${draft.length?'':'disabled'}>Smazat všechny</button></div><div class="grip-rows">${draft.map((g,i)=>`<div class="grip-row" data-grip-row="${esc(g.id)}"><div class="grip-row-head"><strong>Výřez ${i+1}</strong><button class="icon-btn" data-grip-delete="${esc(g.id)}" aria-label="Smazat výřez ${i+1}">${icon('trash')}</button></div><div class="fields-row three">${input('Poloha X',g.x,'fingerX',{scope:'grip',min:-6000,max:6000,step:.1})}${input('Poloha Y',g.y,'fingerY',{scope:'grip',min:-6000,max:6000,step:.1})}${input('Průměr',g.radius*2,'fingerDiameter',{scope:'grip',min:4,max:80,step:.5})}</div></div>`).join('')||'<p class="muted-note">Žádné výřezy. Přidejte vlastní nebo je nechte automaticky umístit.</p>'}</div><p class="form-error" data-grip-error role="status"></p></div></div>`;preview();
  };
  const update=()=>{try{draft=readDraft();preview();}catch(error){modal.body.querySelector('[data-grip-error]').textContent=error.message;}};
  modal.body.addEventListener('input',update);modal.body.addEventListener('change',update);
  modal.body.addEventListener('click',e=>{
    try{
      const remove=e.target.closest('[data-grip-delete]');
      if(remove){draft=readDraft(remove.dataset.gripDelete);redraw();}
      if(e.target.closest('[data-grip-clear]')){draft=[];redraw();}
      if(e.target.closest('[data-grip-auto]')){draft=automaticFingerGrips(t,{radius:9});redraw();}
      if(e.target.closest('[data-grip-add]')){draft=readDraft();const p=t.points[Math.floor(t.points.length*((draft.length+1)*.381966%1))];draft.push({id:uid(),x:p.x,y:p.y,radius:9});redraw();}
    }catch(error){modal.body.querySelector('[data-grip-error]').textContent=error.message;}
  });
  modal.el.querySelector('[data-grips-save]').onclick=()=>{try{const next=fingerGripCandidate(t.id,readDraft());commit(()=>project=next,'Výřezy pro prsty uloženy.');modal.close();}catch(error){modal.body.querySelector('[data-grip-error]').textContent=error.message;}};
  redraw();
}
function showDrawerDimensions(){inspectorTab='drawer';render();if(window.innerWidth<=760)$('#drawer-settings')?.scrollIntoView({block:'start',behavior:'smooth'});}
function moduleSizing(m){const count=project.tools.filter(t=>t.moduleId===m.id).length;return `<div class="module-sizing"><strong>Rozměry modulu · ${m.sizeMode==='manual'?'ruční':'automatické'}</strong><small>Jmenovité ${fmt(m.width)} × ${fmt(m.height)} mm<br>Vnější ${fmt(m.width-.5)} × ${fmt(m.height-.5)} mm${count>1?`<br>Nástrojů ve společném modulu: ${count}`:''}</small><div class="selected-actions"><button class="btn btn-light" data-action="resize-module">${icon('ruler')}Upravit rozměry modulu</button>${project.tools.some(t=>t.moduleId===m.id)?'<button class="btn btn-light" data-action="size-module-auto">Podle nástroje</button>':''}${count>1?'<button class="btn btn-light" data-action="split-module">Rozdělit modul</button>':''}</div></div>`;}
function editModuleSize(){
  const m=moduleFor();if(!m)return;
  const modal=openModal({title:'Rozměry modulu',subtitle:m.name,body:`<div class="fields-row">${input('Jmenovitá šířka',m.width,'moduleWidth',{min:5,max:3000,step:.1})}${input('Jmenovitá hloubka',m.height,'moduleHeight',{min:5,max:3000,step:.1})}</div><p class="muted-note">Skutečné vnější rozměry jsou o 0,5 mm menší kvůli mezeře mezi moduly. Obrys nástroje zůstane stejně velký.</p>`,footer:'<span class="footnote">Zamknutí určuje polohu; ruční rozměr zůstane i při dalším rozložení.</span><button class="btn btn-primary" data-resize-module>Uložit rozměry</button>'});
  modal.el.querySelector('[data-resize-module]').onclick=()=>{
    try{const next=resizeModule(project,m.id,{width:Number(modal.el.querySelector('[data-field=moduleWidth]').value),height:Number(modal.el.querySelector('[data-field=moduleHeight]').value),mode:'manual'});commit(()=>project=next,'Rozměry modulu uloženy.');modal.close();}catch(error){toast(error.message);}
  };
}
function sizeModuleAutomatically(){const m=moduleFor();if(!m)return;const next=resizeModule(project,m.id,{mode:'auto'});commit(()=>project=next,'Velikost modulu upravena podle nástroje.');}

function selectedPanel(){const t=tool(),m=moduleFor();if(!t&&!m)return `<div class="panel-header"><h2 class="panel-title">Vlastnosti nástroje</h2></div><div class="empty-note">Vyberte nástroj v náhledu nebo v seznamu.</div>`;if(!t)return `<div class="panel-header"><h2 class="panel-title">Prázdný modul</h2><button class="icon-btn" data-action="drawer-tab" aria-label="Rozměry šuplíku">${icon('ruler')}</button></div><div class="panel-body">${moduleSizing(m)}<p class="muted-note">Výplňový modul · ${m.locked?'zamčená':'volná'} poloha</p><div class="selected-actions"><button class="btn btn-light" data-action="lock">${icon(m.locked?'unlock':'lock')}${m.locked?'Odemknout':'Zamknout'}</button><button class="btn btn-danger" data-action="delete">${icon('trash')}Smazat</button></div></div>`;
return `<div class="panel-header"><h2 class="panel-title">${icon('wrench')} Vybraný nástroj</h2><button class="icon-btn" data-action="drawer-tab" aria-label="Rozměry šuplíku">${icon('ruler')}</button></div><div class="panel-body">${input('Název',t.name,'name',{type:'text',unit:'',scope:'tool'})}<div class="fields-row">${input('Šířka kontury',Math.round(bounds(t).width*10)/10,'toolWidth',{scope:'tool',min:2,max:2000,step:.1})}${input('Hloubka kapsy',t.depth,'depth',{scope:'tool',min:.5,max:project.insertHeight-project.base,step:.5})}</div>${fingerGripPanel(t)}${m?moduleSizing(m):'<div class="issue-box">Nástroj čeká na umístění.</div>'}<div class="selected-actions"><button class="btn btn-light" data-action="rotate">${icon('rotate')}Otočit 90°</button><button class="btn btn-light" data-action="lock">${icon(m?.locked?'unlock':'lock')}${m?.locked?'Odemknout':'Zamknout'}</button><button class="btn btn-light" data-action="duplicate">${icon('copy')}Kopie</button><button class="btn btn-danger" data-action="delete" aria-label="Smazat nástroj">${icon('trash')}</button></div><p class="muted-note">${m?.locked?'Zamčený modul automatické rozvržení nepřesune.':'Na mobilu klepněte na Přesunout, potom přetáhněte modul. Zamknutím zachováte jeho polohu.'}</p></div>`;}
function render(){
  viewControls?.dispose();viewControls=null;
  const issues=errors(),unplaced=project.tools.filter(t=>!project.modules.some(m=>m.id===t.moduleId));
  const occupied=project.modules.reduce((s,m)=>s+m.width*m.height,0),usage=Math.min(100,Math.round(occupied/(project.width*project.height)*100));
  $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand" href="#" aria-label="Šuplík Studio" data-action="home"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span class="brand-name">šuplík<small>STUDIO</small></span></a><nav class="sidebar-nav" aria-label="Hlavní navigace"><button class="nav-item active" data-action="home">${icon('drawer')}<span>Můj šuplík</span></button><button class="nav-item" data-action="library">${icon('wrench')}<span>Knihovna nástrojů</span></button><button class="nav-item" data-action="projects">${icon('folder')}<span>Moje šuplíky</span></button></nav><div class="sidebar-separator"></div><div class="sidebar-label">AKTUÁLNÍ ŠUPLÍK</div><button class="project-mini" data-action="projects"><div class="mini-icon">${icon('grid')}</div><div><strong>${esc(project.name)}</strong><span>${fmt(project.width)} × ${fmt(project.height)} mm</span></div></button><div class="sidebar-bottom"><button class="nav-item" data-action="help">${icon('help')}<span>Jak na to</span></button><div class="sidebar-separator" style="margin:18px 0"></div><div class="local-tag">${icon('shield')} Všechno zůstává u vás</div><p>Fotky zpracovává váš prohlížeč.<br>Bez cloudu. Bez předplatného.</p></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">Dílna <span>/</span> <b>Organizér nářadí</b></div><div class="top-actions"><span class="save-state">${icon(storageFailed?'info':'check')} ${storageFailed?'Stáhněte zálohu':'Uloženo v zařízení'}</span><button class="btn btn-light" data-action="save-project">${icon('download')} Uložit projekt</button><span class="avatar" title="Lokální dílna">JD</span></div></header><div class="page"><div class="page-heading"><div><p class="eyebrow">MÍSTO PRO KAŽDÝ NÁSTROJ</p><div class="name-edit"><h1>${esc(project.name)}</h1><button class="icon-btn" data-action="rename" aria-label="Přejmenovat šuplík">${icon('edit')}</button></div><p class="subtitle">Od fotky k pořádku. Přesně podle vaší dílny.</p><button class="drawer-dimensions" data-action="drawer-tab">${icon('ruler')}<span>Rozměry šuplíku</span><small>${fmt(project.width)} × ${fmt(project.height)} mm</small></button></div><div class="heading-actions"><button class="btn btn-light" data-action="add-shape">${icon('plus')} Prázdný modul</button><button class="btn btn-primary" data-action="capture">${icon('camera')} <span>Přidat nástroj</span></button></div></div><div class="steps" aria-label="Postup"><button class="step done" data-action="capture"><span class="step-num">01</span>Vyfotit nástroj</button><span class="step-chevron">›</span><button class="step done" data-action="capture"><span class="step-num">02</span>Rozpoznat obrys</button><span class="step-chevron">›</span><span class="step active"><span class="step-num">03</span>Rozvrhnout</span><span class="step-chevron">›</span><button class="step" data-action="export"><span class="step-num">04</span>Vyrobit</button></div><div class="workbench"><div class="workspace-col"><section class="workspace" aria-label="Editor sestavy"><div class="workspace-header"><div class="workspace-header-title">${icon('drawer')} Náhled šuplíku <small>${fmt(project.width)} × ${fmt(project.height)} mm</small></div><div class="segmented" aria-label="Režim náhledu"><button data-action="2d" class="${view==='2d'?'active':''}" aria-pressed="${view==='2d'}">${icon('grid')}2D</button><button data-action="3d" class="${view==='3d'?'active':''}" aria-pressed="${view==='3d'}">${icon('cube')}3D</button></div></div><div class="board-toolbar"><div class="tool-group"><button class="icon-btn" data-action="undo" aria-label="Zpět (Ctrl+Z)" ${undoStack.length?'':'disabled'}>${icon('undo')}</button><button class="icon-btn" data-action="redo" aria-label="Znovu (Ctrl+Shift+Z)" ${redoStack.length?'':'disabled'}>${icon('redo')}</button><span class="toolbar-sep"></span><button class="icon-btn ${showGrid?'active':''}" data-action="grid" aria-label="Zobrazit rastr" aria-pressed="${showGrid}">${icon('grid')}</button><button class="tiny-button" data-action="labels" aria-pressed="${showLabels}">${icon('eye')} Popisky</button></div><div class="tool-group"><button class="tiny-button ${moveMode?'active':''}" data-action="move-mode" aria-pressed="${moveMode}">${icon('move')}${moveMode?'Hotovo':'Přesunout'}</button><button class="tiny-button" data-action="auto">${icon('spark')} Auto rozložení</button><button class="tiny-button smart-layout-button" data-action="smart-layout">${icon('spark')} Chytré rozvržení</button></div></div><div class="board-area" id="board-area"><svg class="board-svg ${moveMode?'moving':''} ${view==='3d'?'view-3d':''}" id="board-svg" role="img" aria-label="Rozložení modulů a nástrojů v šuplíku"></svg>${!project.modules.length&&view==='2d'?`<div class="board-empty">${icon('drawer')}<h3>Začněte jedním nástrojem</h3><p>Vyfoťte ho na A4 papíru nebo vložte z uložené knihovny.</p><button class="btn btn-primary" data-action="capture">${icon('camera')} Přidat nástroj</button></div>`:''}${view==='3d'?'<div class="view-3d-hint">Levé tlačítko: otáčet · Pravé: posouvat · Kolečko: přiblížit</div>':''}</div><div class="board-footer"><div class="legend"><span><i></i>Modul</span><span><i></i>Vybraný nástroj</span></div><div class="key-hint">${view==='2d'?'Tažením přesunete modul <kbd>R</kbd> otočit':'Pohled kamerou'}</div><div class="tool-group"><button class="icon-btn" data-action="zoom-out" aria-label="Oddálit">${icon('zoomOut')}</button><span data-zoom-value>${Math.round((view==='3d'?camera3D.zoom:zoom)*100)} %</span><button class="icon-btn" data-action="zoom-in" aria-label="Přiblížit">${icon('zoomIn')}</button><button class="icon-btn" data-action="fit" aria-label="Zobrazit vše">${icon('fit')}</button></div></div></section><div class="metrics"><div class="metric"><div class="metric-icon">${icon('wrench')}</div><div><strong>${project.tools.length} <small>nástrojů</small></strong><p>${unplaced.length?`${unplaced.length} čeká na umístění`:'Každý má svoje místo'}</p></div></div><div class="metric"><div class="metric-icon">${icon('grid')}</div><div><strong>${project.modules.length} <small>modulů</small></strong><p>${project.modules.filter(m=>m.locked).length} zamčených · rozšiřitelné</p></div></div><div class="metric"><div class="metric-icon">${icon('drawer')}</div><div><strong>${usage} <small>% plochy</small></strong><p>${Math.max(0,100-usage)} % na další nástroje</p></div></div></div>${issues.length?`<div class="issue-box" role="status">${issues.slice(0,3).map(i=>`<p>${esc(i.message)}</p>`).join('')}${issues.length>3?`<p>A dalších ${issues.length-3} upozornění.</p>`:''}<button class="section-link" data-action="auto">Přepočítat rozvržení</button></div>`:''}${tipVisible?`<div class="tip">${icon('lightbulb')}<div><strong>Vaše dílna poroste. Sestava taky.</strong> Zamkněte hotové moduly a přidejte další nástroje. Auto rozložení zachová jejich polohu.</div><button class="icon-btn" data-action="hide-tip" aria-label="Skrýt tip">${icon('close')}</button></div>`:''}</div><aside class="inspector" aria-label="Nastavení a nástroje"><section class="panel" id="drawer-settings">${inspectorTab==='tool'?selectedPanel():drawerPanel()}</section><section class="panel"><div class="panel-header"><h2 class="panel-title">Nástroje v sestavě</h2><span>${project.tools.length.toString().padStart(2,'0')}</span></div><div class="tool-list">${project.tools.map(t=>`<button class="tool-row ${selected===t.id?'selected':''}" data-select="${esc(t.id)}" aria-pressed="${selected===t.id}"><span class="tool-thumb">${thumb(t)}</span><span><strong>${esc(t.name)}</strong><small>${fmt(bounds(t).width,0)} × ${fmt(bounds(t).height,0)} mm${!t.moduleId?' · neumístěno':''}</small></span>${icon(project.modules.find(m=>m.id===t.moduleId)?.locked?'lock':'chevron')}</button>`).join('')||'<div class="empty-note">Zatím žádné nástroje.</div>'}</div><button class="add-tool-row" data-action="capture">${icon('plus')} Přidat další nástroj</button></section><div class="export-card"><div class="ready">${icon(issues.length?'info':'check')} ${issues.length?'Zkontrolujte sestavu':'Sestava připravena'}</div><p>${issues.length?'Před výrobou opravte označené rozměry nebo překryvy.':'STL pro 3D tisk, SVG a DXF pro výřez. Vše v reálných milimetrech.'}</p><button class="btn btn-dark block-button" data-action="export">${icon('download')} Připravit export ${icon('arrow')}</button></div></aside></div><footer class="footer-line"><span>Navrženo v milimetrech. Vyrobeno pro vaši dílnu.</span><button data-action="help">Návod a inspirace</button><span class="app-version">STUDIO / 1.2</span></footer></div></main></div><nav class="mobile-nav" aria-label="Mobilní navigace"><button class="active" data-action="home">${icon('drawer')}Šuplík</button><button data-action="library">${icon('wrench')}Knihovna</button><button class="camera-nav" data-action="capture" aria-label="Vyfotit nástroj">${icon('camera')}</button><button data-action="projects">${icon('folder')}Šuplíky</button><button data-action="export">${icon('download')}Export</button></nav>`;
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
  html+=`<g stroke="#a4af97" stroke-width=".6"><path d="M0 -17H${project.width} M0 -21v8 M${project.width} -21v8"/><path d="M-17 0V${project.height} M-21 0h8 M-21 ${project.height}h8"/></g><rect x="${project.width/2-29}" y="-24" width="58" height="14" fill="#fbfcf9"/><text x="${project.width/2}" y="-14" text-anchor="middle" fill="#93a083" font-size="8.5">${fmt(project.width)} mm</text><text transform="translate(-23 ${project.height/2}) rotate(-90)" text-anchor="middle" fill="#93a083" font-size="8.5">${fmt(project.height)} mm</text>`;
  for(const [i,m] of project.modules.entries()){
    const ts=project.tools.filter(t=>t.moduleId===m.id),sel=ts.some(t=>t.id===selected)||selectedModule===m.id,isBad=bad.has(m.id)||ts.some(t=>bad.has(t.id));
    html+=`<g class="module" data-module="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.name)}${m.locked?' — zamčený':''}"><rect x="${m.x+.9}" y="${m.y+.9}" width="${m.width-1.8}" height="${m.height-1.8}" rx="3" fill="${sel?'#fcf0d7':palette[i%palette.length]+'20'}" stroke="${isBad?'#cb7d60':sel?'#dab06b':'#becdac'}" stroke-width="${sel?1.4:.8}" filter="url(#softshadow)"/>`;
    if(!ts.length)html+=`<rect x="${m.x+5}" y="${m.y+5}" width="${m.width-10}" height="${m.height-10}" fill="url(#empty-hatch)" rx="2"/><text x="${m.x+m.width/2}" y="${m.y+m.height/2}" fill="#a2af92" text-anchor="middle" font-size="8">PRÁZDNÝ MODUL</text>`;
    for(const t of ts){const b=bounds(t);html+=`<path class="tool-outline" d="${paths(safePocket(t))}" fill="${sel?'#e4b96c40':'#a8b99855'}" stroke="${isBad?'#bd775e':sel?'#be9555':'#90a67c'}" stroke-width=".8"/><path d="${paths(transformedPoints(t))}" fill="${sel?'#c99c4d2b':'#b7c6a377'}" stroke="${sel?'#bd975c':'#99ac86'}" stroke-width=".55"/>`;
      // Small etched centre detail reinforces the contour without changing the manufacturing outline.
      if(b.height>80&&b.width<65)html+=`<path d="M${b.x+b.width/2} ${b.y+b.height*.58}v${b.height*.24}" stroke="${sel?'#d3ad70':'#a9b896'}" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>`;
    }
    if(showLabels){const label=ts[0]?.name||m.name,max=Math.max(9,Math.floor(m.width/4.5));html+=`<rect x="${m.x+6}" y="${m.y+m.height-15}" width="${Math.min(m.width-12,label.length*3.7+10)}" height="10" rx="2" fill="${sel?'#fff6e6':'#f3f6ee'}" opacity=".88"/><text x="${m.x+10}" y="${m.y+m.height-7.5}" fill="${sel?'#ab8547':'#8c9b7a'}" font-size="6.3">${esc(label.length>max?label.slice(0,max-1)+'…':label)}</text>`;}
    if(m.locked)html+=`<g transform="translate(${m.x+m.width-13} ${m.y+5}) scale(.33)" color="#8b9b78">${icon('lock')}</g>`;
    html+='</g>';
  }
  if(!project.modules.length&&showGrid)html+=`<text x="${project.width/2}" y="${project.height-14}" text-anchor="middle" font-size="7" fill="#b2bca5">${Math.floor(project.width/project.grid)} × ${Math.floor(project.height/project.grid)} polí · ${fmt(project.grid)} mm</text>`;
  else if(project.modules.length&&showLabels){const unusedY=Math.max(...project.modules.map(m=>m.y+m.height));if(project.height-unusedY>36)html+=`<text x="${project.width/2}" y="${unusedY+(project.height-unusedY)/2}" text-anchor="middle" font-size="8" fill="#b0bca1" letter-spacing=".8">PROSTOR PRO DALŠÍ NÁPADY</text>`;}
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
  if(project.tools.length+tools.length>300)throw Error('V jednom projektu může být nejvýše 300 nástrojů. Založte další projekt.');
  if(project.insertHeight-project.base<.5)throw Error('Výška inzertu musí být alespoň o 0,5 mm větší než tloušťka dna.');
  const prepared=tools.map(t=>{
    const item=validateProject({...blankProject(),tools:[{...t,id:uid(),depth:Math.min(t.depth||12,project.insertHeight-project.base),locked:false,moduleId:null}]}).tools[0];
    if(!Object.prototype.hasOwnProperty.call(t,'fingerGrips'))item.fingerGrips=automaticFingerGrips(item,{radius:9});
    pocketOutline(item,project.clearance);return item;
  });
  commit(()=>{for(const item of prepared){project.tools.push(item);if(!library.some(l=>l.name===item.name&&JSON.stringify(l.points)===JSON.stringify(item.points)&&JSON.stringify(l.fingerGrips)===JSON.stringify(item.fingerGrips)))library.push({...clone(item),x:0,y:0,moduleId:null});}writeLocal(libraryKey,library);selected=project.tools.at(-1)?.id;inspectorTab='tool';arrange(false);},`Přidáno ${tools.length} ${tools.length===1?'nástroj':'nástrojů'}. Kontury jsou také v knihovně.`);
}
function capture(){openCapture({onAdd:addTools,toast});}
function undo(){if(!undoStack.length)return;redoStack.push(clone(project));project=undoStack.pop();persist();render();}
function redo(){if(!redoStack.length)return;undoStack.push(clone(project));project=redoStack.pop();persist();render();}
function rename(){const m=openModal({title:'Pojmenujte svůj šuplík',subtitle:'Název vám pomůže rozlišit uložené projekty.',body:input('Název šuplíku',project.name,'projectName',{type:'text',unit:''}),footer:'<span></span><button class="btn btn-primary" data-confirm>Přejmenovat</button>'});m.el.querySelector('[data-confirm]').onclick=()=>{const name=m.el.querySelector('input').value.trim();if(!name)return toast('Zadejte název projektu.');commit(()=>project.name=name.slice(0,100));m.close();};}
function expand(){const placedIds=new Set(project.modules.filter(m=>m.x>=0&&m.y>=0&&m.x+m.width<=project.width+1e-6&&m.y+m.height<=project.height+1e-6).map(m=>m.id));const m=openModal({title:'Dílna poroste. Sestava taky.',subtitle:'Umístěné moduly se zamknou a zůstanou přesně na svém místě.',body:`<p class="help-intro">Přidejte prostor v rastru ${fmt(project.grid)} mm. Zamčené moduly se při příštím automatickém rozložení nepřesunou.</p><div class="fields-row">${input('Nová šířka',project.width+project.grid,'expandWidth',{min:project.width,step:project.grid})}${input('Nová hloubka',project.height,'expandHeight',{min:project.height,step:project.grid})}</div><div class="tip">${icon('lock')} Zamkne se ${placedIds.size} umístěných modulů. Nové nástroje se umístí do volného místa.</div>`,footer:'<span class="footnote">Polohu můžete později odemknout u každého nástroje.</span><button class="btn btn-primary" data-confirm>Rozšířit sestavu</button>'});m.el.querySelector('[data-confirm]').onclick=()=>{const w=Number(m.el.querySelector('[data-field=expandWidth]').value),h=Number(m.el.querySelector('[data-field=expandHeight]').value);if(!Number.isFinite(w)||!Number.isFinite(h)||w<project.width||h<project.height||w>3000||h>3000)return toast('Nové rozměry musí být větší nebo stejné, nejvýše 3000 mm.');commit(()=>{project.width=w;project.height=h;project.modules.forEach(m=>{if(placedIds.has(m.id))m.locked=true;});project.tools.forEach(t=>{if(placedIds.has(t.moduleId))t.locked=true;});},'Sestava rozšířena. Umístěné moduly jsou zamčené.');m.close();};}
function addShape(){const m=openModal({title:'Přidat modul nebo jednoduchý tvar',subtitle:'Výplň volného místa, přihrádka nebo kapsa se známým rozměrem.',body:`<label class="field"><span>Typ</span><select id="shape-type"><option value="blank">Prázdný plný modul</option><option value="rect">Obdélníková kapsa</option><option value="circle">Kruhová kapsa</option></select></label>${input('Název','Nový modul','shapeName',{type:'text',unit:''})}<div class="fields-row">${input('Šířka / průměr',84,'shapeWidth',{min:5,max:2000})}${input('Hloubka',84,'shapeHeight',{min:5,max:2000})}</div>`,footer:'<span class="footnote">Modul se umístí do prvního volného místa v rastru.</span><button class="btn btn-primary" data-confirm>Přidat do sestavy</button>'});m.el.querySelector('[data-confirm]').onclick=()=>{const type=m.el.querySelector('#shape-type').value,name=m.el.querySelector('[data-field=shapeName]').value.trim()||'Nový modul',w=Number(m.el.querySelector('[data-field=shapeWidth]').value),h=Number(m.el.querySelector('[data-field=shapeHeight]').value);if(!(w>=5&&w<=2000&&h>=5&&h<=2000))return toast('Zadejte rozměry od 5 do 2000 mm.');if(type!=='blank'){const points=type==='rect'?[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}]:Array.from({length:64},(_,i)=>({x:w/2+Math.cos(i*Math.PI/32)*w/2,y:w/2+Math.sin(i*Math.PI/32)*w/2}));try{addTools([{name,points,depth:12,x:0,y:0,rotation:0}]);m.close();}catch(error){toast(error.message);}return;}
    if(project.modules.length>=400)return toast('V projektu může být nejvýše 400 modulů.');const width=Math.ceil(w/project.grid)*project.grid,height=Math.ceil(h/project.grid)*project.grid;let pos=null;
    for(let y=0;y+height<=project.height&&!pos;y+=project.grid)for(let x=0;x+width<=project.width;x+=project.grid)if(!project.modules.some(o=>x<o.x+o.width&&x+width>o.x&&y<o.y+o.height&&y+height>o.y)){pos={x,y};break;}
    if(!pos)return toast('Modul se nevejde. Zmenšete jej nebo rozšiřte sestavu.');
    commit(()=>{const item={id:uid(),name,x:pos.x,y:pos.y,width,height,locked:true};project.modules.push(item);selected=null;selectedModule=item.id;inspectorTab='tool';},'Prázdný modul přidán a zamčen.');m.close();};}

function openLibrary(){const m=openModal({title:'Vaše knihovna nástrojů',subtitle:'Jednou načtený obrys můžete použít v každém dalším šuplíku.',wide:true,body:`<div class="library-grid">${library.map((t,i)=>`<div class="library-item"><span class="tool-thumb">${thumb(t)}</span><div><strong>${esc(t.name)}</strong><p>${fmt(bounds(t).width)} × ${fmt(bounds(t).height)} mm</p></div><button class="btn btn-light" data-library-add="${i}" aria-label="Přidat ${esc(t.name)} do sestavy">${icon('plus')}</button><button class="icon-btn" data-library-remove="${i}" aria-label="Odstranit ${esc(t.name)} z knihovny">${icon('trash')}</button></div>`).join('')||'<p class="empty-note">Vyfoťte první nástroj. Kontury se sem uloží automaticky.</p>'}</div>`,footer:`<span class="footnote">Knihovna je uložená v tomto prohlížeči.</span><button class="btn btn-primary" data-capture>${icon('camera')}Vyfotit nástroj</button>`});m.el.onclick=e=>{const add=e.target.closest('[data-library-add]'),remove=e.target.closest('[data-library-remove]');if(add){try{addTools([clone(library[Number(add.dataset.libraryAdd)])]);m.close();}catch(error){toast(error.message);}}if(remove){library.splice(Number(remove.dataset.libraryRemove),1);writeLocal(libraryKey,library);openLibrary();}if(e.target.closest('[data-capture]'))capture();};}
function createDrawer(){
  const draft=blankProject();
  const modal=openModal({title:'Nový šuplík',subtitle:'Zadejte název a skutečné vnitřní rozměry v milimetrech.',body:`${input('Název šuplíku','','drawerName',{type:'text',unit:''})}<div class="fields-row">${input('Vnitřní šířka',draft.width,'drawerWidth',{min:42,max:3000,step:.1})}${input('Vnitřní hloubka',draft.height,'drawerHeight',{min:42,max:3000,step:.1})}</div>`,footer:'<span class="footnote">Každý šuplík má vlastní rozměry a sestavu.</span><button class="btn btn-primary" data-create-drawer>Vytvořit šuplík</button>'});
  modal.el.querySelector('[data-create-drawer]').onclick=()=>{
    const name=modal.el.querySelector('[data-field=drawerName]').value.trim();if(!name)return toast('Zadejte název šuplíku.');
    try{const next=validateProject({...draft,name,width:Number(modal.el.querySelector('[data-field=drawerWidth]').value),height:Number(modal.el.querySelector('[data-field=drawerHeight]').value)});switchProject(next);toast('Nový šuplík vytvořen.');}catch(error){toast(error.message);}
  };
}
function openProjects(){persist();const m=openModal({title:'Moje šuplíky',subtitle:'Každý šuplík má vlastní název, rozměry a sestavu. Pro přenos si stáhněte JSON.',body:`<button class="btn btn-primary" data-new>${icon('plus')}Nový šuplík</button><button class="btn btn-light" data-import>${icon('upload')}Otevřít JSON</button>${projects.map(p=>`<div class="project-card"><div><h3>${esc(p.name)}</h3><p>${fmt(p.width)} × ${fmt(p.height)} mm · ${p.tools.length} nástrojů · ${p.modules.length} modulů${p.id===project.id?' · otevřený':''}</p></div><button class="btn btn-light" data-open="${esc(p.id)}">Otevřít</button>${p.id!==project.id?`<button class="icon-btn" data-remove-project="${esc(p.id)}" aria-label="Smazat šuplík ${esc(p.name)}">${icon('trash')}</button>`:''}</div>`).join('')}`,footer:'<span class="footnote">Smazání dat prohlížeče odstraní místní šuplíky. JSON je vaše přenosná záloha.</span><button class="btn btn-light" data-demo>Ukázkový šuplík</button>'});m.el.onclick=e=>{if(e.target.closest('[data-new]'))createDrawer();if(e.target.closest('[data-import]'))$('#project-file').click();if(e.target.closest('[data-demo]'))switchProject(validateProject({...createDemoProject(),id:uid()}));const op=e.target.closest('[data-open]'),rm=e.target.closest('[data-remove-project]');if(op)switchProject(projects.find(p=>p.id===op.dataset.open));if(rm){projects=projects.filter(p=>p.id!==rm.dataset.removeProject);writeLocal(storageKey,projects);openProjects();}};}
function help(){openModal({title:'Z fotky do šuplíku',subtitle:'Čtyři kroky. Žádný CAD. Vše přímo ve vašem zařízení.',wide:true,body:`<div class="help-grid"><div class="help-card"><h3>01 / Vyfoťte nástroj</h3><p>Položte nástroje na bílou A4, odděleně od sebe. Celý papír musí být vidět. Fotografujte co nejvíc kolmo a v rozptýleném světle bez tvrdého stínu. Můžete použít i pravítko.</p></div><div class="help-card"><h3>02 / Obrys připravíme automaticky</h3><p>Aplikace najde A4 a narovná perspektivu. Lokální rozpoznávání oddělí předměty od pozadí a zpřesní obrys podle skutečných hran. Kontrast, odstranění šumu a vyhlazení zvolí samo. U pravítka označíte jen dvě známé značky pro měřítko.</p></div><div class="help-card"><h3>03 / Rozvrhněte sestavu</h3><p>Zadejte vnitřní rozměr šuplíku. Auto rozložení zkouší otočení a umístí obdélníkové moduly do rastru. Je to praktická heuristika, nemusí najít nejúspornější možné řešení. Vytištěné moduly zamkněte a přidávejte další kolem nich.</p></div><div class="help-card"><h3>04 / Exportujte a vyrobte</h3><p>Zvolte úspornou otevřenou konstrukci nebo plný blok. Dno může být hladké, s patkami Gridfinity, kapsami pro magnety nebo připravené k lepení. Nejdřív přiložte nástroj na PDF v měřítku 1:1 nebo vytiskněte tenkou zkoušku vůle. SVG/DXF slouží pro pěnu či CNC.</p></div></div><h3 style="margin-top:27px">Alternativy, ze kterých vychází návrh</h3><p class="help-intro">Průzkum vlastností na oficiálních webech. Vlastní implementace; kód těchto aplikací se nepřebírá.</p><div class="help-grid"><div class="help-card"><h3>Outline App</h3><a href="https://github.com/georgslazdans/outline-app" target="_blank" rel="noopener noreferrer">Open source editor kontur ↗</a><p>Inspirace: kalibrace fotografie a převod obrysů do výrobních rozměrů.</p></div><div class="help-card"><h3>Tracefinity</h3><a href="https://github.com/tracefinity/tracefinity" target="_blank" rel="noopener noreferrer">Vlastní hostování a knihovna ↗</a><p>Inspirace: opakované použití nástrojů a projekty sestav.</p></div><div class="help-card"><h3>Binforge</h3><a href="https://binforge.app/" target="_blank" rel="noopener noreferrer">Plánování modulů v šuplíku ↗</a><p>Inspirace: jednoduchá práce s rozměry, rastr a samostatné exporty.</p></div><div class="help-card"><h3>TracetoForge</h3><a href="https://tracetoforge.com/" target="_blank" rel="noopener noreferrer">Fotografie → vlastní vložka ↗</a><p>Inspirace: kontrola měřítka, vůle a rozložení více nástrojů.</p></div></div><div class="tip" style="margin-top:20px">${icon('shield')} Fotografie se nikam neodesílají. Detekce kombinuje lokální model U²-Net a hrany v původní fotce. Pokud snímek nedává dost jistoty, vyžádá novou fotku. U zcela neviditelné hrany nelze skutečný tvar spolehlivě dopočítat.</div><p class="muted-note" style="margin-top:15px">Na mobilu: přidejte stránku na plochu přes nabídku prohlížeče. Po prvním načtení může editor díky uloženým souborům pracovat i offline. Projekty mezi zařízeními přenesete přes JSON.</p>`,footer:'<span class="footnote">Šuplík Studio 1.2 · vlastní editor bez účtu a předplatného.</span><button class="btn btn-dark" data-modal-close-extra>Rozumím, jdeme tvořit</button>'}).el.querySelector('[data-modal-close-extra]').onclick=closeModal;}

const bottomNames={plain:'Hladké dno',grid:'Gridfinity · patky 42 mm',magnet:'Magnety',adhesive:'Lepidlo / oboustranná páska'};
let exportFormat='stl',exportScope='all';
function openExport(){
  const m=moduleFor(),selectedId=m?.id||null;
  if(exportScope==='selected'&&!selectedId)exportScope='all';
  const entries=exportScope==='selected'?project.modules.filter(m=>m.id===selectedId):project.modules;
  const opts={moduleId:exportScope==='selected'?selectedId:null};
  const issues=exportScope==='selected'?validateLayout({...project,modules:entries,tools:project.tools.filter(t=>t.moduleId===selectedId)}):errors();
  const formats={stl:['STL','3D tisk'],svg:['SVG','Pěna · laser'],dxf:['DXF','CAD · CNC'],json:['JSON','Záloha projektu']};
  let stats=null,printError='';
  if(exportFormat==='stl'&&!issues.length&&entries.length){try{stats=printStats(project,opts);}catch(e){printError=e.message;}}
  const modal=openModal({title:'Připraveno k výrobě',subtitle:'Vyberte provedení. Každý modul se stáhne zvlášť v jednom ZIPu.',body:`<div class="format-grid">${Object.entries(formats).map(([key,[title,desc]])=>`<button class="format ${exportFormat===key?'active':''}" data-format="${key}"><strong>${title}</strong><span>${desc}</span></button>`).join('')}</div>${exportFormat!=='json'?`<label class="field"><span>Co exportovat</span><select id="export-scope"><option value="all" ${exportScope==='all'?'selected':''}>Celou sestavu</option><option value="selected" ${exportScope==='selected'?'selected':''} ${selectedId?'':'disabled'}>Vybraný modul${m?' · '+esc(m.name):''}</option></select></label>`:''}${exportFormat==='stl'?`<label class="print-toggle"><input id="print-light" type="checkbox" ${project.printMode==='light'?'checked':''}><span><strong>Úsporný tisk</strong><small>Tenké dno a stěny kolem nástroje. Okolí zůstane otevřené.</small></span>${icon('spark')}</label><label class="field"><span>Dno a uchycení</span><select id="print-bottom">${Object.entries(bottomNames).map(([key,label])=>`<option value="${key}" ${project.bottomMode===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted-note">${project.bottomMode==='grid'?'Patky pro podložku Gridfinity. Rastr a rozměry modulů musí být v násobcích 42 mm.':project.bottomMode==='magnet'?'Čtyři kapsy zespodu pro magnety 6 × 2 mm. Strop nad magnetem se automaticky zesílí.':project.bottomMode==='adhesive'?'Rovné spodní plochy pro lepidlo či tenkou oboustrannou pásku. Tloušťku pásky přičtěte k výšce sestavy.':'Rovné dno pro volné položení do šuplíku.'}</p>${stats?`<div class="print-summary"><strong>${fmt(stats.volumeCm3)} cm³ modelu${stats.savingPercent>0?`<em>−${fmt(stats.savingPercent,0)} % proti plnému bloku</em>`:''}</strong><span>Výška nejvyššího dílu ${fmt(stats.heightMm)} mm · dno ${fmt(stats.effectiveBaseMm)} mm</span><small>Objem geometrie. Skutečnou spotřebu a čas určí slicer podle výplně a nastavení.</small>${(stats.notes||[]).map(note=>`<small>${esc(note)}</small>`).join('')}</div>`:''}<details class="advanced"><summary>Tiskárna a další možnosti</summary><div class="fields-row">${input('Tisková plocha · šířka',project.bedWidth,'bedWidth',{min:50,max:2000})}${input('Tisková plocha · hloubka',project.bedHeight,'bedHeight',{min:50,max:2000})}</div><label class="check-row"><input id="limit-bed" type="checkbox" ${project.limitToBed?'checked':''}>Rozvrhovat podle tiskové plochy</label>${project.bottomMode==='magnet'?`<div class="fields-row">${input('Průměr kapsy',project.magnetDiameter,'magnetDiameter',{min:3,max:20,step:.1})}${input('Hloubka kapsy',project.magnetDepth,'magnetDepth',{min:1,max:8,step:.1})}</div>`:''}<p class="muted-note">Rozměry tiskárny se ukládají s projektem. Zamčené moduly se při přepočítání nepřesunou.</p></details><div id="bed-warnings"></div>`:''}${(issues.length||printError)&&exportFormat!=='json'?`<div class="issue-box">${issues.slice(0,3).map(i=>`<p>${esc(i.message)}</p>`).join('')}${printError?`<p>${esc(printError)}</p>`:''}<button class="section-link" data-repack>Přepočítat rozvržení</button></div>`:''}${exportFormat==='svg'||exportFormat==='dxf'?'<p class="muted-note">Černá / MODULES = obrys modulu, červená / POCKETS = kapsa včetně vůle. Všechny rozměry jsou v mm.</p>':''}${exportFormat==='json'?'<p class="muted-note">Uloží kontury, rozměry, provedení a polohy modulů. Na jiném zařízení otevřete JSON přes Moje projekty.</p>':`<details class="advanced fit-check"><summary>Nejdřív ověřit velikost</summary><p>Přiložte nástroj na papír nebo zkuste tenký rámeček. Nemusíte hned tisknout celý inzert.</p><div class="test-actions"><button class="btn btn-light" data-fit-pdf ${issues.length||!entries.length?'disabled':''}>${icon('print')}PDF v měřítku 1:1</button><button class="btn btn-light" data-fit-stl ${issues.length||!entries.length?'disabled':''}>${icon('cube')}Tenká zkouška STL</button></div><p class="muted-note">PDF tiskněte na 100 % a přeměřte kontrolní úsečku 100 mm. Fotografie nemusí zachytit nejširší část vysokého nástroje.</p></details>`}`,footer:`<span class="footnote">${exportFormat==='stl'?'STL v mm · samostatné uzavřené díly':'Soubory vznikají ve vašem zařízení'}</span><button class="btn btn-primary" data-do-export ${exportFormat!=='json'&&(issues.length||!entries.length||printError)?'disabled':''}>${icon('download')}Stáhnout ${exportFormat==='stl'&&exportScope==='all'?'ZIP':exportFormat.toUpperCase()}</button>`});
  const redraw=()=>{const scroll=modal.body.scrollTop;openExport();const body=document.querySelector('.modal-body');if(body)body.scrollTop=scroll;};
  const setting=(key,value)=>{remember();project[key]=value;persist();render();redraw();};
  modal.el.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>{exportFormat=b.dataset.format;redraw();});
  modal.el.querySelector('#export-scope')?.addEventListener('change',e=>{exportScope=e.target.value;redraw();});
  modal.el.querySelector('#print-light')?.addEventListener('change',e=>setting('printMode',e.target.checked?'light':'solid'));
  modal.el.querySelector('#print-bottom')?.addEventListener('change',e=>setting('bottomMode',e.target.value));
  modal.el.querySelector('#limit-bed')?.addEventListener('change',e=>setting('limitToBed',e.target.checked));
  modal.el.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{const v=Number(el.value);if(!el.value||!Number.isFinite(v)||v<Number(el.min)||v>Number(el.max)){toast('Zadejte rozměr v uvedeném rozsahu.');return;}setting(el.dataset.field,v);});
  const oversized=entries.filter(m=>!((m.width-.5<=project.bedWidth&&m.height-.5<=project.bedHeight)||(m.height-.5<=project.bedWidth&&m.width-.5<=project.bedHeight)));
  const bed=modal.el.querySelector('#bed-warnings');if(bed&&oversized.length){bed.innerHTML=`<div class="issue-box">${oversized.length} modulů se nevejde na tiskovou plochu. Zkontrolujte tiskárnu a přepočítejte sestavu.<br><button class="section-link" data-repack>Přepočítat rozvržení</button></div>`;if(project.limitToBed)modal.el.querySelector('[data-do-export]').disabled=true;}
  modal.el.querySelectorAll('[data-repack]').forEach(b=>b.onclick=()=>{commit(()=>arrange());redraw();});
  const fitFiles=()=>entries.map((m,i)=>({name:`${String(i+1).padStart(2,'0')}-${slug(m.name)}-zkouska.stl`,data:exportFitSTL(project,{moduleId:m.id})}));
  modal.el.querySelector('[data-fit-pdf]')?.addEventListener('click',()=>{try{download(slug(project.name)+'-meritko-1-1.pdf',exportFitPDF(project,opts),'application/pdf');toast('PDF připraveno. Tiskněte na 100 % bez přizpůsobení stránce.');}catch(e){toast(e.message);}});
  modal.el.querySelector('[data-fit-stl]')?.addEventListener('click',()=>{try{const files=fitFiles();if(files.length===1)download(files[0].name,files[0].data,'model/stl');else download(slug(project.name)+'-zkousky.zip',zipFiles(files),'application/zip');toast('Tenké zkoušky jsou připravené. Mají stejnou vůli jako finální kapsy.');}catch(e){toast(e.message);}});
  modal.el.querySelector('[data-do-export]').onclick=async e=>{
    const button=e.currentTarget;button.disabled=true;button.innerHTML='<span class="spinner"></span> Připravuji…';
    await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,30)));
    try{
      const name=slug(project.name);
      if(exportFormat==='json')saveJSON();
      else if(exportFormat==='svg')download(name+'.svg',exportSVG(project,opts),'image/svg+xml');
      else if(exportFormat==='dxf')download(name+'.dxf',exportDXF(project,opts),'application/dxf');
      else if(exportScope==='selected')download(slug(m.name)+'.stl',exportSTL(project,opts),'model/stl');
      else{
        const files=entries.map((m,i)=>({name:`${String(i+1).padStart(2,'0')}-${slug(m.name)}.stl`,data:exportSTL(project,{moduleId:m.id})}));
        files.push({name:'sestava.svg',data:exportSVG(project)},{name:'projekt.json',data:JSON.stringify({schemaVersion:1,app:'Suplik Studio',project},null,2)},{name:'CTETE-ME.txt',data:`Šuplík Studio
${project.name}
${project.printMode==='light'?'Úsporná otevřená konstrukce':'Plný blok s kapsami'} · ${bottomNames[project.bottomMode]}
Rastr ${project.grid} mm · vůle ${project.clearance} mm
Všechny STL jsou v milimetrech. Vložte dnem na tiskovou podložku.
${(stats?.notes||[]).join('\n')}
Nejprve ověřte vůli pomocí PDF 1:1 nebo tenké zkoušky STL v aplikaci.

${entries.map((m,i)=>`${i+1}. ${m.name}: ${m.width-.5} × ${m.height-.5} mm, poloha ${m.x},${m.y} mm${m.locked?' (zamčeno)':''}`).join('\n')}`});
        download(name+'-moduly.zip',zipFiles(files),'application/zip');
      }
      modal.close();toast('Soubor je připravený ve stažených souborech.');
    }catch(error){toast(error.message);button.disabled=false;button.innerHTML=icon('download')+' Zkusit znovu';}
  };
}

function saveJSON(){download(slug(project.name)+'.json',JSON.stringify({schemaVersion:1,app:'Suplik Studio',project},null,2),'application/json');}


const actions={
 'move-mode':()=>{moveMode=!moveMode;render();if(moveMode)toast('Přetáhněte modul. Tlačítkem Hotovo obnovíte posouvání stránky.');},
 home:()=>{closeModal();window.scrollTo({top:0,behavior:'smooth'});},capture,library:openLibrary,projects:openProjects,help,rename,expand,'add-shape':addShape,'resize-module':editModuleSize,'size-module-auto':sizeModuleAutomatically,export:openExport,
 'save-project':()=>{persist();saveJSON();toast('Projekt uložen jako přenosný JSON.');},
 'drawer-tab':showDrawerDimensions,
 'edit-contour':capture,'finger-grips':editFingerGrips,'finger-grips-auto':()=>{const t=tool();if(t)setFingerGrips(automaticFingerGrips(t,{radius:9}));},'finger-grips-clear':()=>setFingerGrips([]),
 auto:()=>commit(()=>arrange()),'smart-layout':smartArrangeProject,'split-module':splitModule,
 undo,redo,
 snap:()=>{snap=!snap;render();},grid:()=>{showGrid=!showGrid;render();},labels:()=>{showLabels=!showLabels;render();},
 '2d':()=>{view='2d';render();},'3d':()=>{view='3d';render();},
 'zoom-in':()=>{if(view==='3d')camera3D=normalizeCamera3D({...camera3D,zoom:camera3D.zoom*1.25});else zoom=Math.min(3,zoom+.25);render();},'zoom-out':()=>{if(view==='3d')camera3D=normalizeCamera3D({...camera3D,zoom:camera3D.zoom/1.25});else zoom=Math.max(.5,zoom-.25);render();},fit:()=>{if(view==='3d')camera3D=createCamera3D();else zoom=1;render();},
 'hide-tip':()=>{tipVisible=false;writeLocal('suplik-hide-tip',true);render();},
 rotate:()=>{const t=tool(),m=moduleFor();if(!t)return;if(m?.locked)return toast('Nejprve odemkněte polohu modulu.');commit(()=>{const b=bounds(t);t.rotation=(t.rotation+90)%360;const next=bounds(t);t.x=b.x+(b.width-next.width)/2;t.y=b.y+(b.height-next.height)/2;},'Nástroj otočen. Pokud přesahuje modul, spusťte Auto rozložení.');},
 lock:()=>{const m=moduleFor();if(!m)return;commit(()=>{m.locked=!m.locked;project.tools.filter(t=>t.moduleId===m.id).forEach(t=>t.locked=m.locked);},m.locked?'Poloha modulu je odemčená.':'Poloha modulu je zamčená.');},
 duplicate:()=>{const t=tool();if(t)addTools([{...clone(t),name:t.name+' · kopie'}]);},
 delete:()=>{const t=tool(),m=moduleFor();if(!t&&!m)return;commit(()=>{if(t){project.tools=project.tools.filter(x=>x.id!==t.id);project.modules=project.modules.filter(x=>x.id!==t.moduleId||project.tools.some(o=>o.moduleId===x.id));selected=project.tools[0]?.id||null;}else project.modules=project.modules.filter(x=>x.id!==m.id);selectedModule=null;},'Odstraněno ze sestavy. Akci můžete vrátit tlačítkem Zpět.');}
};
$('#app').addEventListener('click',e=>{const sel=e.target.closest('[data-select]');if(sel){selected=sel.dataset.select;selectedModule=null;inspectorTab='tool';render();return;}const group=e.target.closest('[data-module]');if(group&&(view==='3d'||!moveMode)){const m=project.modules.find(m=>m.id===group.dataset.module),t=project.tools.find(t=>t.moduleId===m?.id);selected=t?.id||null;selectedModule=t?null:m?.id;inspectorTab='tool';render();return;}const a=e.target.closest('[data-action]');if(a){e.preventDefault();try{actions[a.dataset.action]?.();}catch(error){toast(error.message);}}});
$('#app').addEventListener('change',e=>{
  const el=e.target.closest('[data-field]');if(!el)return;const field=el.dataset.field,scope=el.dataset.scope;let value=el.type==='number'?Number(el.value):el.value.trim();
  if(el.type==='number'&&(!el.value||!Number.isFinite(value)||value<Number(el.min)||value>Number(el.max))){toast(`Zadejte hodnotu od ${el.min} do ${el.max}.`);render();return;}
    if(scope==='tool'){
    const t=tool();if(!t)return;
    if(field==='name'&&!value){render();return;}
    if(field==='toolWidth'){const ratio=value/bounds(t).width;if(t.points.some(p=>p.x*ratio>3000||p.y*ratio>3000)){toast('Kontura nesmí v žádném směru přesáhnout 3000 mm.');render();return;}}if(field==='toolWidth'&&moduleFor()?.locked){toast('Pro změnu rozměru nejdřív odemkněte modul.');render();return;}
    let scaled=null;
    if(field==='toolWidth'){
      const ratio=value/bounds(t).width;scaled={...t,points:t.points.map(p=>({x:p.x*ratio,y:p.y*ratio}))};
      try{if(Object.prototype.hasOwnProperty.call(t,'fingerGrips'))scaled.fingerGrips=validateFingerGrips(t.fingerGrips.map(g=>({...g,x:g.x*ratio,y:g.y*ratio})));pocketOutline(scaled,project.clearance);}
      catch(error){toast('Velikost kontury nelze změnit. U výřezů použijte „Automaticky umístit“ a zkuste to znovu. '+error.message);render();return;}
    }
    commit(()=>{if(scaled){t.points=scaled.points;if(Object.prototype.hasOwnProperty.call(scaled,'fingerGrips'))t.fingerGrips=scaled.fingerGrips;}else t[field]=typeof value==='string'?value.slice(0,100):value;});
  }else commit(()=>project[field]=value);
});
$('#app').addEventListener('pointerdown',e=>{
  if(view==='3d'||e.button!==0)return;
  if(e.pointerType==='touch'&&!moveMode)return;
  const group=e.target.closest('[data-module]'),svg=$('#board-svg');if(!group||!svg)return;
  const m=project.modules.find(m=>m.id===group.dataset.module);if(!m)return;
  const t=project.tools.find(t=>t.moduleId===m.id);selected=t?.id||null;selectedModule=t?null:m.id;inspectorTab='tool';
  if(m.locked){render();toast('Poloha modulu je zamčená. Odemkněte ji ve vlastnostech.');return;}
  e.preventDefault();const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());
  drag={pointer:e.pointerId,id:m.id,start:p,x:m.x,y:m.y,snapshot:clone(project),moved:false};svg.setPointerCapture(e.pointerId);renderBoard();
});
$('#app').addEventListener('pointermove',e=>{
  if(view==='3d'||!drag)return;const svg=$('#board-svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());const m=project.modules.find(m=>m.id===drag.id);if(!m)return;
  const dx=q.x-drag.start.x,dy=q.y-drag.start.y;if(Math.hypot(dx,dy)<2&&!drag.moved)return;drag.moved=true;
  let x=drag.x+dx,y=drag.y+dy;if(snap){x=Math.round(x/project.grid)*project.grid;y=Math.round(y/project.grid)*project.grid;}x=Math.max(0,Math.min(project.width-m.width,x));y=Math.max(0,Math.min(project.height-m.height,y));
  const sx=x-m.x,sy=y-m.y;m.x=x;m.y=y;project.tools.filter(t=>t.moduleId===m.id).forEach(t=>{t.x+=sx;t.y+=sy;});renderBoard();
});
function endDrag(){if(!drag)return;if(drag.moved){const invalid=errors().some(i=>i.ids.includes(drag.id)&&i.type==='overlap');if(invalid){project=drag.snapshot;toast('Tady už je jiný modul. Zkuste volné místo.');}else{undoStack.push(drag.snapshot);redoStack=[];persist();}}drag=null;render();}
$('#app').addEventListener('pointerup',endDrag);$('#app').addEventListener('pointercancel',()=>{if(drag){project=drag.snapshot;drag=null;render();}});
$('#app').addEventListener('keydown',e=>{const group=e.target.closest('[data-module]');if(group&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const m=project.modules.find(m=>m.id===group.dataset.module),t=project.tools.find(t=>t.moduleId===m.id);selected=t?.id||null;selectedModule=t?null:m.id;inspectorTab='tool';render();}});
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||$('#modal-root').children.length)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='r')actions.rotate();else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();actions.delete();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();actions['save-project']();}});
$('#project-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>12*1024*1024)return toast('Projekt je příliš velký. Maximum je 12 MB.');try{const data=JSON.parse(await file.text());if(data.schemaVersion&&data.schemaVersion!==1)throw Error('Tato verze projektu zatím není podporovaná.');const imported=validateProject(data);imported.id=uid();switchProject(imported);toast('Projekt otevřen. Původní projekty zůstaly uložené.');}catch(error){toast('Projekt nelze otevřít: '+error.message);}});
persist();render();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
