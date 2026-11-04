import {FLOOR_THICKNESS,materialConfig,materialSlots} from './print-material.js';
import {createManufacturingClient} from './manufacturing-client.js';
import {bounds,transformedPoints,autoArrange,resizeModule,validateLayout,createDemoProject} from './geometry.js';
import {previewGeometryKey,createCamera3D,normalizeCamera3D} from './preview3d.js';
import {validatePrintBed} from './print-geometry.js';
import {createViewControls,createViewControls2D} from './view-controls.js';
import {openCapture} from './capture.js';
import {mountLibraryFolders} from './catalog-ui.js';
import {CATEGORIES,toolCategory} from './tool-categories.js';
import {addToolGroup,scaleTool} from './set-module.js';
import {photoLayout} from './photo-layout.js';
import {getToolDimensions,resizeToolDimensions} from './tool-dimensions.js';
import {openContextMenu,closeContextMenu} from './context-menu.js';
import {createEditorGeometryCache} from './editor-cache.js';
import {moduleOutline,moduleArea,moduleIntersects,modulePadding} from './module-footprint.js';
import {gridfinityLayout,planBaseplateTiles} from './gridfinity-baseplate.js';
import {sizeText} from './tool-size.js';
import {SIZE_LABEL_REASONS} from './size-labels.js';
import * as bulk from './bulk-edit.js';
import * as moduleEdit from './module-edit.js';
import {esc,icon,openModal,closeModal,toast,download} from './ui.js';
import {uid,clone,validateProject,readLocal,writeLocal,blankProject} from './model.js';
import {automaticFingerGrips,fittingFingerGrips,pocketOutline as calculatePocketOutline,validateFingerGrips} from './finger-grip.js';
import {runSmartLayout} from './smart-layout-client.js';
import {findToolSets as calculateToolSets,setCoherence} from './tool-sets.js';
// `t` is used for tool variables throughout this file, so the translator is imported as `tr`.
import {t as tr,plural,i18nError,errorText,getLang,setLang,onLangChange,LANGS,LANG_NAMES,fmtNum} from './i18n.js';
import {unit,unitFor,getAppUnit,setAppUnit,setProjectUnit,UNITS,fmtLen,fmtSize,inputValue,parseLength} from './units.js';

const $=s=>document.querySelector(s);
const fmt=(v,d=1)=>fmtNum(v,d);
const sizeShort=(w,h,u=unit())=>fmtSize(w,h,{unit:u,digits:u==='in'?2:0});
const localizeDemo=p=>({...p,name:tr(p.name),tools:p.tools.map(x=>({...x,name:tr(x.name)})),modules:(p.modules||[]).map(m=>({...m,name:tr(m.name)}))});
const demoProject=()=>validateProject({...localizeDemo(createDemoProject()),id:uid()});
function applyDocumentText(){
  document.documentElement.lang=getLang();document.title=tr('InsertCreator — místo pro každý nástroj');
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
let bulkSelection=new Set();
let undoStack=[],redoStack=[],drag=null,storageFailed=false,moveMode=false,boardSelectionGesture=null;
let camera3D=createCamera3D(),cameraFrame={width:1000,height:600,zoom:1},viewControls=null,pan2D={x:0,y:0};
let smartLayoutRun=null;
const smartModeKey='suplik-studio-smart-mode';
let smartMode=readLocal(smartModeKey,'sets');if(!['sets','compact'].includes(smartMode))smartMode='sets';writeLocal(smartModeKey,smartMode);
let smartShape=readLocal('suplik-studio-module-shape','stepped');if(!['rectangular','stepped'].includes(smartShape))smartShape='stepped';
const tool=()=>project.tools.find(t=>t.id===selected);
const moduleFor=(t=tool())=>project.modules.find(m=>m.id===(t?.moduleId||selectedModule));
const geometryCache=createEditorGeometryCache({validateLayout,pocketOutline:calculatePocketOutline,findToolSets:calculateToolSets});
const errors=()=>{
  if(!drag)return geometryCache.validate(project,getLang()+':'+unit());
  // A rigid move cannot change internal pocket walls. During the gesture check only moving module bounds and neighbours.
  const ids=new Set(drag.toolIds?drag.snapshot.tools.filter(t=>drag.toolIds.includes(t.id)).map(t=>t.moduleId):[drag.id]);
  const base=geometryCache.validate(drag.snapshot,getLang()+':'+unit()),moduleIds=new Set(project.modules.map(m=>m.id));
  const issues=base.filter(issue=>!(issue.ids.some(id=>ids.has(id))&&(issue.type==='outside'&&issue.ids.length===1||issue.type==='overlap'&&issue.ids.every(id=>moduleIds.has(id)))));
  for(const module of project.modules.filter(m=>ids.has(m.id))){
    if(module.x<0||module.y<0||module.x+module.width>project.width+.001||module.y+module.height>project.height+.001)issues.push({type:'outside',ids:[module.id],message:tr('Modul „{name}“ přesahuje šuplík.',{name:module.name})});
    for(const other of project.modules)if(other.id!==module.id&&moduleIntersects(module,other,project.grid))issues.push({type:'overlap',ids:[module.id,other.id],message:tr('Moduly „{a}“ a „{b}“ se překrývají.',{a:module.name,b:other.name})});
  }return issues;
};
const pocketOutline=(tool,clearance)=>geometryCache.pocket(tool,clearance);
const findToolSets=p=>geometryCache.sets(p,getLang());
function remember(){undoStack.push(clone(project));if(undoStack.length>40)undoStack.shift();redoStack=[];}
function persist(){
  project.updatedAt=new Date().toISOString();const index=projects.findIndex(p=>p.id===project.id);if(index>=0)projects[index]=clone(project);else projects.push(clone(project));
  const ok=writeLocal(storageKey,projects)&&writeLocal('suplik-studio-current',project.id);
  if(!ok&&!storageFailed)toast(tr('Úložiště prohlížeče je plné nebo vypnuté. Uložte projekt jako JSON.'));storageFailed=!ok;return ok;
}
function commit(fn,message){remember();fn();persist();render();if(message)toast(message);}
function smartMessage(message){const text=String(message||'Porovnávám rozvržení…'),match=text.match(/^Hledám místo pro celé kapsy včetně prstů \((\d+) vhodných dvojic\)…$/);return match?tr('Hledám místo pro celé kapsy včetně prstů ({n} vhodných dvojic)…',{n:match[1]}):tr(text);}
const same=value=>JSON.stringify(value);
const analysisClient=createManufacturingClient(),previewClient=createManufacturingClient(),fileClient=createManufacturingClient();
let fileBusy=false,fileJobId=0,exportSession=null,editorNeedsRefresh=false,labelJob=null,previewSequence=0,previewSource='',previewValue=null,previewSignature='';
const backgroundOptions=()=>({lang:getLang(),unit:unit()});
const labelKey=p=>JSON.stringify([p.sizeLabels,p.printMode,p.bottomMode,p.grid,p.wall,p.base,p.insertHeight,p.clearance,p.magnetDepth,p.modules,p.tools,getLang(),unit()]);
const labelCache=new Map();
function cachedLabels(){return !project.sizeLabels?{labels:[],skipped:[]}:labelCache.get(labelKey(project));}
function ensureLabels(){
  const key=labelKey(project),known=cachedLabels();if(known)return Promise.resolve(known);
  if(exportSession||fileBusy)return Promise.resolve(null);
  if(labelJob?.key===key)return labelJob.promise;
  const snapshot=clone(project),job={key};
  job.promise=analysisClient.run('labels',snapshot,backgroundOptions()).then(plan=>{
    if(labelJob!==job||key!==labelKey(project))return null;
    labelCache.set(key,plan);while(labelCache.size>3)labelCache.delete(labelCache.keys().next().value);
    document.querySelectorAll('[data-label-status]').forEach(element=>{const ids=new Set(JSON.parse(element.dataset.labelStatus));element.innerHTML=labelStatusContent({labels:plan.labels.filter(label=>ids.has(label.moduleId)),skipped:plan.skipped.filter(label=>ids.has(label.moduleId))});});
    if(view==='2d'&&!drag&&!resizeDrag&&!exportSession&&!fileBusy)renderBoard();return plan;
  }).catch(error=>{
    if(error.name!=='AbortError'&&labelJob===job)document.querySelectorAll('[data-label-status]').forEach(element=>element.textContent=errorText(error));return null;
  }).finally(()=>{if(labelJob===job)labelJob=null;});
  labelJob=job;return job.promise;
}
function resumeEditor(){if(editorNeedsRefresh){editorNeedsRefresh=false;setTimeout(()=>render(),0);}else if(view==='3d')setTimeout(()=>renderBoard(),0);else ensureLabels();}
function labelStatusContent(plan){
  const count=Array.isArray(plan.labels)?plan.labels.length:plan.count??0,skipped=plan.skipped||[];
  if(!skipped.length)return `<p class="muted-note">${tr('Popisky v modelu: {n}.',{n:count})}</p>`;
  return `<div class="issue-box label-warning" role="status"><p>${tr('Popisky v modelu: {n}, vynecháno: {skipped}.',{n:count,skipped:skipped.length})}</p>${[...new Set(skipped.map(s=>s.reason))].map(reason=>`<p>${esc(tr(SIZE_LABEL_REASONS[reason]||reason))}</p>`).join('')}</div>`;
}
const paintOpportunity=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
const modulePhysicalArea=(m,grid)=>{if(!m.cells)return(m.width-.5)*(m.height-.5);const points=moduleOutline(m,grid,{inset:.25});return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2);};
const layoutArea=p=>p.modules.reduce((sum,m)=>sum+modulePhysicalArea(m,p.grid),0);
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
  const uniformConstraint=m=>(before.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===m.setId||members(m.id).some(t=>set.toolIds.includes(t.id))));
  const rebuildable=m=>!fixedIds.has(m.id)&&m.sizeMode!=='manual'&&!uniformConstraint(m)&&(m.grouped===true||m.setLayout==='auto'||m.setLayout==='uniform');
  const protectedIds=new Set(before.modules.filter(m=>fixedIds.has(m.id)||m.sizeMode==='manual'||(!rebuildable(m)&&(m.grouped||m.setLayout==='uniform'||members(m.id).length>1))).map(m=>m.id));
  const next={...clone(before),tools:[],modules:checked.modules.map(m=>{
    const metadata=clone(oldModules.get(m.id)||{});delete metadata.cells;delete metadata.shape;
    return{...metadata,...m};
  })};
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
      const old=oldModules.get(t.moduleId),m=newModules.get(t.moduleId),anchor=members(t.moduleId)[0],nextAnchor=checked.tools.find(n=>n.id===anchor.id);
      if(!m||!nextAnchor||item.moduleId!==t.moduleId||item.rotation!==t.rotation||Math.abs(item.x-t.x-(nextAnchor.x-anchor.x))>1e-6||Math.abs(item.y-t.y-(nextAnchor.y-anchor.y))>1e-6)throw Error(tr('Chytré rozvržení změnilo vzájemnou polohu nástrojů ve společném nebo ručním modulu.'));
      if((uniformConstraint(old)||Math.abs(m.width-old.width)<1e-6&&Math.abs(m.height-old.height)<1e-6)&&(Math.abs(item.x-t.x-(m.x-old.x))>1e-6||Math.abs(item.y-t.y-(m.y-old.y))>1e-6))throw Error(tr('Chytré rozvržení změnilo vzájemnou polohu nástrojů ve společném nebo ručním modulu.'));
    }
    next.tools.push(item);
  }
  for(const id of protectedIds){
    const old=oldModules.get(id),m=newModules.get(id);
    const resized=m&&(Math.abs(m.width-old.width)>1e-6||Math.abs(m.height-old.height)>1e-6);
    if(m&&(uniformConstraint(old)||old.sizeMode==='manual')&&(same(m.cells)!==same(old.cells)||m.shape!==old.shape))throw Error(tr('Chytré rozvržení změnilo zamčený, ruční nebo společný modul.'));
    const shrinkAllowed=!fixedIds.has(id)&&!uniformConstraint(old)&&m&&m.width<=old.width+1e-6&&m.height<=old.height+1e-6&&(old.sizeMode!=='manual'||placedTools(checked).size>placedTools(before).size);
    if(!m||['id','name','locked','unit','setId','setLayout'].some(key=>same(m[key])!==same(old[key]))||(resized&&!shrinkAllowed)||(fixedIds.has(id)&&(m.x!==old.x||m.y!==old.y||same(m.cells)!==same(old.cells)||m.shape!==old.shape))||(m.sizeMode||'auto')!==(old.sizeMode||'auto')||!!m.grouped!==!!old.grouped)throw Error(tr('Chytré rozvržení změnilo zamčený, ruční nebo společný modul.'));
    const metadata=clone(old);delete metadata.cells;delete metadata.shape;
    next.modules[next.modules.findIndex(m=>m.id===id)]={...metadata,...m};
  }
  checkLayoutTransition(before,next);return next;
}
// Every automatic layout starts with this choice; the last answer stays preselected.
function smartArrangeProject(){
  const card=(choice,title,text)=>`<button class="smart-choice" data-smart-choice="${choice}" ${(smartMode==='compact')===(choice==='space')?'data-smart-default':''}><strong>${tr(title)}</strong><span>${tr(text)}</span></button>`;
  const modal=openModal({title:tr('Rozložit nástroje'),subtitle:tr('Co je pro vás důležitější?'),body:`<div class="smart-choices">${card('space','Co nejvíc šetřit místem','Nástroje z různých sad mohou sdílet modul a sady se mohou rozdělit. Výpočet trvá déle.')}${card('logic','Udržet co největší logiku','Každá sada zůstane pohromadě ve svém modulu. Moduly zaberou víc místa.')}</div>`,footer:`<span></span><button class="btn btn-light" data-modal-close>${tr('Zrušit')}</button>`});
  modal.el.querySelectorAll('[data-smart-choice]').forEach(button=>button.onclick=()=>{
    const space=button.dataset.smartChoice==='space';smartMode=space?'compact':'sets';writeLocal(smartModeKey,smartMode);modal.close();runSmartArrange(smartMode,space);
  });
  modal.el.querySelector('[data-smart-default]')?.focus();
}
async function runSmartArrange(mode,merge){
  const before=clone(project),definitions=mode==='sets'?findToolSets(before).sets:[],controller=new AbortController(),job={controller,key:same(project),done:false};
  const modal=openModal({title:tr('Rozložit nástroje'),subtitle:mode==='sets'?tr('Sady nástrojů: společný směr a sjednocené moduly.'):tr('Nejmenší plocha: porovnám bezpečné varianty a společné moduly.'),body:tr('<div class="smart-layout-progress" role="status" aria-live="polite"><p data-smart-message>Připravuji výpočet…</p><progress data-smart-progress max="1" value="0" aria-label="Průběh chytrého rozvržení"></progress><small data-smart-percent>0 %</small></div>'),footer:tr('<span class="footnote">Sestavu můžete během výpočtu ponechat beze změny.</span><button class="btn btn-light" data-smart-cancel>Zrušit</button>'),onClose:()=>{if(!job.done)controller.abort();}});
  smartLayoutRun=job;
  const finishUI=(title,body)=>{modal.body.innerHTML=`<div class="smart-layout-result"><h3>${esc(title)}</h3>${body}</div>`;modal.footer.innerHTML=`<span></span><button class="btn btn-primary" data-smart-close>${tr('Hotovo')}</button>`;modal.footer.querySelector('[data-smart-close]').onclick=modal.close;};
  modal.el.querySelector('[data-smart-cancel]').onclick=()=>{controller.abort();modal.close();toast(tr('Chytré rozvržení zrušeno. Sestava se nezměnila.'));};
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    if(controller.signal.aborted||smartLayoutRun!==job||!modal.el.isConnected)return;
    const metric=p=>({...layoutMetric(p),setScore:mode==='sets'?setCoherence(p,definitions).score:0});
    // Run the two existing operations in order, without committing their intermediate state.
    let baseline=before;
    try{baseline=checkedSmartResult(before,autoArrange(before),'compact');}catch{}
    let result,optimizerError=null;
    try{result=await runSmartLayout(baseline,{mode,moduleShape:smartShape,merge,signal:controller.signal,onProgress:event=>{
      if(smartLayoutRun!==job||controller.signal.aborted||!modal.el.isConnected)return;
      const value=Math.max(0,Math.min(1,Number(event?.progress)||0));job.lastMessage=event?.message?smartMessage(event.message):job.lastMessage;modal.body.querySelector('[data-smart-progress]').value=value;modal.body.querySelector('[data-smart-percent]').textContent=Math.round(value*100)+' %';modal.body.querySelector('[data-smart-message]').textContent=smartMessage(event?.message);
    }});}catch(error){if(controller.signal.aborted)throw error;optimizerError=error;result={tools:baseline.tools,modules:baseline.modules};}
    if(controller.signal.aborted||smartLayoutRun!==job||!modal.el.isConnected)return;
    if(same(project)!==job.key)throw Error(tr('Sestava se během výpočtu změnila. Spusťte chytré rozvržení znovu.'));
    let next=baseline;
    try{
      const candidate=checkedSmartResult(before,result,mode);
      for(const original of before.tools)if(!Object.hasOwn(original,'fingerGrips'))delete candidate.tools.find(tool=>tool.id===original.id).fingerGrips;
      for(const module of candidate.modules)if(!module.unit){
        const units=new Set(candidate.tools.filter(tool=>tool.moduleId===module.id).map(tool=>{
          const original=before.tools.find(item=>item.id===tool.id);return before.modules.find(item=>item.id===original?.moduleId)?.unit;
        }).filter(Boolean));
        if(units.size===1)module.unit=[...units][0];
      }
      checkLayoutTransition(before,candidate);
      const unitsKept=before.tools.every(original=>{
        const previous=before.modules.find(module=>module.id===original.moduleId),tool=candidate.tools.find(tool=>tool.id===original.id),module=candidate.modules.find(module=>module.id===tool.moduleId);
        return merge||!previous?.unit||module?.unit===previous.unit;
      });
      if(unitsKept&&betterLayout(metric(candidate),metric(baseline),mode))next=candidate;
    }
    catch(error){optimizerError=error;}
    if(optimizerError&&same(baseline)===same(before))throw optimizerError;
    if(next===baseline)result={tools:baseline.tools,modules:baseline.modules};
    const oldMetric=layoutMetric(before),newMetric=layoutMetric(next),beforeArea=oldMetric.area,afterArea=newMetric.area,saving=beforeArea>0?(beforeArea-afterArea)/beforeArea*100:0;
    oldMetric.setScore=mode==='sets'?setCoherence(before,definitions).score:0;newMetric.setScore=mode==='sets'?setCoherence(next,definitions).score:0;
    const resized=next.modules.flatMap(module=>{const old=before.modules.find(m=>m.id===module.id);return old&&(module.width<old.width-1e-6||module.height<old.height-1e-6)?[{old,module}]:[];});
    const resizeSummary=resized.length?`<details><summary>${tr('Zmenšené moduly: {n}',{n:resized.length})}</summary><ul>${resized.map(({old,module})=>`<li>${esc(module.name)}: ${fmtSize(old.width,old.height)} → ${fmtSize(module.width,module.height)}</li>`).join('')}</ul></details>`:'';
    const searchSummary=result.stats?.searchLimited?`<p>${tr('Výpočet dosáhl limitu hledání. Další prostor může být využitelný jiným rozvržením.')}</p>`:'';
    const mergedSummary=next!==baseline&&result.stats?.mergedModules?`<p>${tr('Sloučené moduly: {n}. Do volného místa se přesunuly nástroje, které spolu nesouvisí.',{n:result.stats.mergedModules})}</p>`:'';
    const setSummary=(mode==='sets'?toolSetResultSummary(definitions,before,next,result):'')+resizeSummary+searchSummary+mergedSummary;
    if(same(next)===same(before)){job.done=true;finishUI(job.lastMessage||tr('Lepší bezpečné rozvržení nebylo nalezeno.'),tr('<p>Stávající sestava zůstala beze změny.</p>')+setSummary);return;}
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
  const modal=openModal({title:editing?'Upravit sadu':tr('Nová sada'),subtitle:tr('Nástroj může být právě v jedné uložené sadě.'),wide:true,body:`${input(tr('Název sady'),draft.name,'setName',{type:'text',unit:'',scope:'set'})}<label class="field"><span>${tr("Rozvržení sady")}</span><select data-set-layout>${Object.entries(setLayoutNames()).map(([key,name])=>`<option value="${key}" ${draft.layout===key?'selected':''}>${name}</option>`).join('')}</select></label><p class="muted-note">${tr("Stejné samostatné moduly mají shodnou šířku i hloubku a každý vlastní nástroj. Společný modul obsahuje celou sadu.")}</p><label class="field"><span>${tr('Uložení nástrojů')}</span><select data-set-arrangement><option value="ordered" ${draft.arrangement!=='compact'?'selected':''}>${tr('Přehledně podle velikosti')}</option><option value="compact" ${draft.arrangement==='compact'?'selected':''}>${tr('Úsporně proti sobě')}</option></select></label><label class="field"><span>${tr('Pořadí velikostí')}</span><select data-set-order><option value="asc" ${draft.order!=='desc'?'selected':''}>${tr('Od nejmenšího po největší')}</option><option value="desc" ${draft.order==='desc'?'selected':''}>${tr('Od největšího po nejmenší')}</option></select></label><div class="tool-set-member-heading"><strong>${tr("Členové sady")}</strong><span data-set-member-count></span></div><div class="tool-set-members">${project.tools.map(t=>{const other=(project.toolSets??[]).find(s=>s.id!==draft.id&&s.toolIds.includes(t.id));return `<label class="tool-set-member"><input type="checkbox" data-set-tool="${esc(t.id)}" ${draft.toolIds.includes(t.id)?'checked':''}><span><strong>${esc(t.name)}</strong>${other?`<small>${tr('V sadě „{name}“. Výběrem jej přesunete do této sady.',{name:esc(other.name)})}</small>`:''}</span></label>`;}).join('')||tr('<p class="muted-note">Nejdřív přidejte nástroje do šuplíku.</p>')}</div><p class="form-error" data-set-error role="status"></p>`,footer:tr('<button class="btn btn-light" data-set-cancel>Zpět na sady</button><button class="btn btn-primary" data-set-save>Uložit sadu</button>')});
  const count=()=>modal.body.querySelector('[data-set-member-count]').textContent=tr('Vybráno: {n}',{n:modal.body.querySelectorAll('[data-set-tool]:checked').length});
  modal.body.addEventListener('change',count);count();modal.el.querySelector('[data-set-cancel]').onclick=openToolSets;
  modal.el.querySelector('[data-set-save]').onclick=()=>{
    try{
      const name=modal.body.querySelector('[data-field=setName]').value.trim(),toolIds=[...modal.body.querySelectorAll('[data-set-tool]:checked')].map(el=>el.dataset.setTool),selectedIds=new Set(toolIds);
      if(!name)throw Error(tr('Zadejte název sady.'));if(!toolIds.length)throw Error(tr('Vyberte alespoň jeden nástroj.'));
      const item={id:draft.id,name:name.slice(0,100),toolIds,layout:modal.body.querySelector('[data-set-layout]').value,arrangement:modal.body.querySelector('[data-set-arrangement]').value,order:modal.body.querySelector('[data-set-order]').value};let replaced=false;
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
  const rows=definitions.map(s=>{const satisfied=after.satisfied.includes(s.id),record=records.find(r=>r.id===s.id),status=satisfied?(old.satisfied.includes(s.id)?tr('Zůstává sjednocená'):'Sjednocena'):tr('Zatím nesjednocena');let reason=!satisfied?(record?.reason||tr('Celou sadu se nepodařilo bezpečně umístit podle zvolené volby.')):'';if(!satisfied&&s.layout==='shared')reason+=tr(' Zvolte stejné moduly nebo upravte rozměry šuplíku.');return `<li><strong>${esc(s.name)}: ${status}</strong>${record?.applied?` · ${esc(setLayoutNames()[record.applied]||record.applied)}`:''}${reason?`<p>${esc(reason)}</p>`:''}</li>`;}).join('');
  return `<div class="tool-set-result"><h4>${tr("Sady nástrojů")}</h4>${definitions.length?`<p>${tr('Sjednocené sady: {before} → {after}',{before:old.satisfied.length,after:after.satisfied.length})}</p><ul>${rows}</ul>`:tr('<p>Žádná sada nebyla nalezena. Vlastní sadu můžete vytvořit v nabídce Sady nástrojů.</p>')}${warnings.length?`<ul class="tool-set-warnings">${warnings.map(message=>`<li>${esc(message)}</li>`).join('')}</ul>`:''}</div>`;
}
// End tool set editor.
const toolUnit=t=>unitFor(t?.unit),moduleUnit=m=>unitFor(m?.unit);
const unitBadge=u=>u?`<span class="unit-badge" title="${tr('Vlastní jednotky: {unit}',{unit:u})}">${u}</span>`:'';
function unitSelect(label,value,scope){return `<label class="field unit-field"><span>${label}</span><select data-field="unit" data-scope="${scope}" aria-label="${label}"><option value="" ${value?'':'selected'}>${tr('Podle šuplíku ({unit})',{unit:unit()})}</option>${UNITS.map(u=>`<option value="${u}" ${value===u?'selected':''}>${u}</option>`).join('')}</select></label>`;}
function arrange(message=true){const result=autoArrange(project);project.tools=result.tools;project.modules=result.modules;if(message)toast(result.unplaced.length?plural(result.unplaced.length,['{n} nástroj se nevešel. Zkontrolujte rozměry šuplíku nebo odemkněte moduly.','{n} nástroje se nevešly. Zkontrolujte rozměry šuplíku nebo odemkněte moduly.','{n} nástrojů se nevešlo. Zkontrolujte rozměry šuplíku nebo odemkněte moduly.']):tr('Rozložení hotové. Zamčené moduly zůstaly na svém místě.'));return result;}
function isToolSelected(id){return bulkSelection.size?bulkSelection.has(id):selected===id;}
function thumb(t){const b=bounds({...t,x:0,y:0,rotation:0});return `<svg viewBox="${-3} ${-3} ${b.width+6} ${b.height+6}" aria-hidden="true"><path d="${paths(transformedPoints({...t,x:0,y:0,rotation:0}))}" fill="${isToolSelected(t.id)?'#c79c53':'#9fae90'}" stroke="none"/></svg>`;}
// Lengths follow display units; angle fields always use degrees.
function input(label,value,key,{unit:u,min=0,max=3000,scope='project',type='length'}={}){
  if(type==='text')return `<label class="field"><span>${label}</span><div class="input-wrap"><input type="text" value="${esc(value)}" data-field="${key}" data-scope="${scope}" aria-label="${label}"></div></label>`;
  if(type==='angle')return `<label class="field"><span>${label}</span><div class="input-wrap"><input type="number" inputmode="decimal" min="${min}" max="${max}" step="0.01" value="${esc(Math.min(max,Math.max(min,Math.round(value*100)/100)))}" data-angle data-field="${key}" data-scope="${scope}" aria-label="${label} (°)"><em>°</em></div></label>`;
  u=u||unit();
  return `<label class="field"><span>${label}</span><div class="input-wrap"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(inputValue(value,{unit:u}))}" data-length data-mm="${esc(value)}" data-unit="${u}" data-min="${min}" data-max="${max}" data-field="${key}" data-scope="${scope}" aria-label="${label} (${u})"><em>${u}</em></div></label>`;
}
function drawerPanel(){return `<div class="panel-header"><h2 class="panel-title">${icon('ruler')} ${tr('Rozměry šuplíku')}</h2><span>${unit()}</span></div><div class="panel-body"><div class="fields-row">${input(tr('Šířka · zleva doprava'),project.width,'width',{min:42})}${input(tr('Hloubka · zepředu dozadu'),project.height,'height',{min:42})}</div>${input(tr('Výška inzertu'),project.insertHeight,'insertHeight',{min:3,max:100})}<div class="toggle-row"><span>${tr('Popisky velikostí v modelu')}</span><button class="switch ${project.sizeLabels?'on':''}" data-action="toggle-size-labels" role="switch" aria-checked="${!!project.sizeLabels}" aria-label="${tr('Popisky velikostí v modelu')}"></button></div>${labelStatus()}<label class='field'><span>${tr('Systém modulů')}</span><select data-field='bottomMode' data-scope='project'><option value='plain' ${project.bottomMode==='plain'?'selected':''}>${tr('Volně v šuplíku')}</option><option value='grid' ${project.bottomMode==='grid'?'selected':''}>Gridfinity · 42 mm</option><option value='magnet' ${project.bottomMode==='magnet'?'selected':''}>${tr('Magnety')}</option><option value='adhesive' ${project.bottomMode==='adhesive'?'selected':''}>${tr('Lepicí páska')}</option></select></label>${gridfinitySummary()}<label class="field"><span>${tr('Jednotky šuplíku')}</span><select data-field="unit" data-scope="project" aria-label="${tr('Jednotky šuplíku')}"><option value="" ${project.unit?'':'selected'}>${tr('Podle aplikace ({unit})',{unit:getAppUnit()})}</option>${UNITS.map(u=>`<option value="${u}" ${project.unit===u?'selected':''}>${u}</option>`).join('')}</select></label><p class="muted-note unit-hint">${tr('Lze zadat i jiné jednotky: 12 in, 3 1/2" nebo 30 cm.')}</p><details class="advanced"><summary>${tr('Další nastavení')}</summary><div class="fields-row">${input(tr('Rastr modulů'),project.grid,'grid',{min:10,max:100})}${input(tr('Vůle kolem nástroje'),project.clearance,'clearance',{min:0,max:5})}</div><div class="fields-row">${input(tr('Tloušťka dna'),project.base,'base',{min:1,max:20})}${input(tr('Minimální stěna'),project.wall,'wall',{min:1,max:15})}</div><div class="toggle-row"><span>${tr('Přichytit k rastru')}</span><button class="switch ${snap?'on':''}" data-action="snap" role="switch" aria-checked="${snap}" aria-label="${tr('Přichytit k rastru')}"></button></div></details><button class="btn btn-soft block-button" data-action="expand">${icon('expand')} ${tr('Rozšířit sestavu')}</button><p class="muted-note">${tr('Hotové moduly zamkněte. Další nástroje přidáte i z jiné fotografie.')}</p></div>`;}

function safePocket(tool,clearance=project.clearance){try{return pocketOutline(tool,clearance);}catch{return transformedPoints(tool,clearance);}}
function gridfinitySummary(){
  if(project.bottomMode!=='grid')return '';
  try{const layout=gridfinityLayout(project);return `<p class='muted-note'>${tr('Základna Gridfinity: {cols} × {rows} polí, rozteč 42 mm.',{cols:layout.columns,rows:layout.rows})} ${tr('Volný okraj vpravo {right}, dole {bottom}.',{right:fmtLen(layout.remainder.right),bottom:fmtLen(layout.remainder.bottom)})}</p><button class='btn btn-light' data-action='export-baseplate'>${icon('download')}${tr('Exportovat základnu Gridfinity')}</button>`;}catch(error){return `<p class='form-error'>${esc(errorText(error))}</p>`;}
}
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
function moduleSizing(m){const u=moduleUnit(m),count=project.tools.filter(t=>t.moduleId===m.id).length;return `<div class="module-sizing"><strong>${m.sizeMode==='manual'?tr('Rozměry modulu · ruční'):tr('Rozměry modulu · automatické')}${unitBadge(m.unit)}</strong><small>${tr('Jmenovité {size}',{size:fmtSize(m.width,m.height,{unit:u})})}<br>${tr('Vnější {size}',{size:fmtSize(m.width-.5,m.height-.5,{unit:u})})}${count>1?`<br>${tr('Nástrojů ve společném modulu: {n}',{n:count})}`:''}</small><div class="fields-row module-position">${input(tr('X · poloha v šuplíku'),m.x,'moduleX',{unit:u,min:0,max:3000,scope:'module'})}${input(tr('Y · poloha v šuplíku'),m.y,'moduleY',{unit:u,min:0,max:3000,scope:'module'})}</div>${unitSelect(tr('Jednotky modulu'),m.unit,'module')}${moduleStepControls(m)}<div class="selected-actions"><button class="btn btn-soft module-resize-button" data-action="resize-module">${icon('ruler')}${tr('Změnit velikost')}</button>${project.tools.some(t=>t.moduleId===m.id)?`<button class="btn btn-light" data-action="size-module-auto">${tr('Podle nástroje')}</button>`:''}${count>1?`<button class="btn btn-light" data-action="split-module">${tr('Rozdělit modul')}</button>`:''}<button class="btn btn-light" data-action="rotate-module">${icon('rotate')}${tr('Otočit modul o 90°')}</button><button class="btn btn-light" data-action="duplicate-module">${icon('copy')}${tr('Kopie modulu')}</button></div></div>`;}
/** −/+ one grid step for the module width and depth, right in the inspector. */
function moduleStepControls(m){
  const step=fmtLen(project.grid,{unit:moduleUnit(m)}),off=m.locked?` disabled title="${tr(LOCKED_RESIZE)}"`:'';
  const pair=(label,key,less,more)=>`<span class="module-step-label">${label}</span><button class="icon-btn module-step-btn" data-action="module-step" data-value="${key}-" aria-label="${tr(less,{step})}"${off}>−</button><button class="icon-btn module-step-btn" data-action="module-step" data-value="${key}+" aria-label="${tr(more,{step})}"${off}>+</button>`;
  return `<div class="module-steps" role="group" aria-label="${tr('Rychlá změna velikosti o krok rastru')}">${pair(tr('Šířka'),'w','Zúžit o {step}','Rozšířit o {step}')}${pair(tr('Hloubka'),'h','Zkrátit o {step}','Prodloužit o {step}')}</div><p class="muted-note module-resize-hint">${m.locked?tr(LOCKED_RESIZE):tr('Velikost změníte také tažením úchytů na okraji modulu nebo klávesami Alt+Shift+šipky.')}${m.cells?' '+tr('Ruční změna rozměrů převede schodový modul na obdélník.'):''}</p>`;
}
function editModuleSize(){
  const m=moduleFor();if(!m)return;
  const fields=(w,h,u)=>`${input(tr('Jmenovitá šířka'),w,'moduleWidth',{unit:u,min:5,max:3000})}${input(tr('Jmenovitá hloubka'),h,'moduleHeight',{unit:u,min:5,max:3000})}`;
  const modal=openModal({title:tr('Rozměry modulu'),subtitle:m.name,body:`<div class="fields-row" data-module-fields>${fields(m.width,m.height,moduleUnit(m))}</div><div class="module-steps" role="group" aria-label="${tr('Rychlá změna velikosti o krok rastru')}">${[['moduleWidth',tr('Šířka')],['moduleHeight',tr('Hloubka')]].map(([key,label])=>`<span class="module-step-label">${label}</span><button type="button" class="icon-btn module-step-btn" data-dialog-step="${key}" data-dir="-1" aria-label="${tr('{label} − {step}',{label,step:fmtLen(project.grid,{unit:moduleUnit(m)})})}">−</button><button type="button" class="icon-btn module-step-btn" data-dialog-step="${key}" data-dir="1" aria-label="${tr('{label} + {step}',{label,step:fmtLen(project.grid,{unit:moduleUnit(m)})})}">+</button>`).join('')}</div>${unitSelect(tr('Jednotky modulu'),m.unit,'module-modal')}<p class="muted-note">${tr('Skutečné vnější rozměry jsou o {gap} menší kvůli mezeře mezi moduly. Obrys nástroje zůstane stejně velký.',{gap:fmtLen(.5,{unit:moduleUnit(m)})})}</p>`,footer:`<span class="footnote">${tr('Zamknutí určuje polohu; ruční rozměr zůstane i při dalším rozložení.')}</span><button class="btn btn-primary" data-resize-module>${tr('Uložit rozměry')}</button>`});
  const read=()=>[readLength(modal.el.querySelector('[data-field=moduleWidth]')),readLength(modal.el.querySelector('[data-field=moduleHeight]'))];
  const pick=modal.el.querySelector('[data-scope=module-modal]');pick.value=m.unit||'';
  // Switching the unit here re-displays the typed sizes in the chosen unit.
  pick.onchange=()=>{const [w,h]=read();if(Number.isFinite(w)&&Number.isFinite(h))modal.el.querySelector('[data-module-fields]').innerHTML=fields(w,h,unitFor(pick.value));};
  // −/+ buttons change the typed size by one grid step; nothing is saved until "Uložit rozměry".
  modal.el.addEventListener('click',e=>{
    const b=e.target.closest('[data-dialog-step]');if(!b)return;const el=modal.el.querySelector(`[data-field=${b.dataset.dialogStep}]`),v=readLength(el);
    if(!Number.isFinite(v))return toast(tr('Zadejte platnou délku, například 12, 12,5 mm nebo 3 1/2 in.'));
    const next=Math.round(Math.min(3000,Math.max(5,v+Number(b.dataset.dir)*project.grid))*1e4)/1e4;el.dataset.mm=next;el.setAttribute('value',inputValue(next,{unit:el.dataset.unit}));el.value=el.getAttribute('value');
  });
  modal.el.querySelector('[data-resize-module]').onclick=()=>{
    const [width,height]=read(),u=pick.value;
    if(!Number.isFinite(width)||!Number.isFinite(height))return toast(tr('Zadejte platnou délku, například 12, 12,5 mm nebo 3 1/2 in.'));
    try{const next=resizeModule(project,m.id,{width,height,mode:'manual'}),nm=next.modules.find(x=>x.id===m.id);if(nm){if(u)nm.unit=u;else delete nm.unit;}let note='';commit(()=>{project=next;note=releaseUniformSet(m.id);});toast(tr('Rozměry modulu uloženy.')+note);modal.close();}catch(error){toast(errorText(error));}
  };
}
function sizeModuleAutomatically(){const m=moduleFor();if(!m)return;const next=resizeModule(project,m.id,{mode:'auto'});let note='';commit(()=>{project=next;note=releaseUniformSet(m.id,{ifUnsatisfied:true});});toast(tr('Velikost modulu upravena podle nástroje.')+note);}
// ---- Direct module resizing: board handles, Alt+Shift+arrows and inspector quick buttons ----
const SIXTEENTH_IN=25.4/16,LOCKED_RESIZE='Odemkněte modul pro změnu velikosti';
let resizeDrag=null;
/** Smallest nominal size that still holds every pocket of the module plus the wall on each side. */
function moduleMinSize(p,m){
  const pts=p.tools.filter(t=>t.moduleId===m.id).flatMap(t=>safePocket(t,p.clearance));if(!pts.length)return{width:5,height:5};
  const xs=pts.map(q=>q.x),ys=pts.map(q=>q.y),pad=2*modulePadding(p);
  return{width:Math.max(5,Math.max(...xs)-Math.min(...xs)+pad),height:Math.max(5,Math.max(...ys)-Math.min(...ys)+pad)};
}
/**
 * Resize candidate for moving edges `dir` (any of e/w/s/n) of module `id` in `base` by dx/dy mm.
 * Snaps to the grid (or 1 mm / 1/16 in), clamps to the minimum, the drawer and neighbouring modules,
 * and validates through resizeModule(). Returns {project,width,height,limit,min} or {error,min}.
 */
function resizeCandidate(base,id,dir,dx,dy,{step,relative=!snap}={}){
  const m=base.modules.find(x=>x.id===id);if(!m)return null;
  step=step||(snap?base.grid:(moduleUnit(m)==='in'?SIXTEENTH_IN:1));
  const min=moduleMinSize(base,m),others=base.modules.filter(o=>o.id!==id),eps=.001,L0=m.x,T0=m.y,R0=m.x+m.width,B0=m.y+m.height;
  const move=(edge,d)=>relative?edge+Math.round(d/step)*step:Math.round((edge+d)/step)*step;
  const up=v=>relative?v:Math.ceil(v/step-1e-9)*step,down=v=>relative?v:Math.floor(v/step+1e-9)*step;
  let L=L0,T=T0,R=R0,B=B0,limit='';
  if(dir.includes('e'))R=move(R0,dx);if(dir.includes('w'))L=move(L0,dx);if(dir.includes('s'))B=move(B0,dy);if(dir.includes('n'))T=move(T0,dy);
  if(R-L<min.width-1e-6){limit='min';if(dir.includes('e'))R=up(L+min.width);else L=down(R-min.width);}
  if(B-T<min.height-1e-6){limit='min';if(dir.includes('s'))B=up(T+min.height);else T=down(B-min.height);}
  if(R>base.width+eps){R=base.width;limit=limit||'drawer';}if(L<-eps){L=0;limit=limit||'drawer';}
  if(B>base.height+eps){B=base.height;limit=limit||'drawer';}if(T<-eps){T=0;limit=limit||'drawer';}
  for(const o of others){
    if(!(o.y<B0-eps&&o.y+o.height>T0+eps))continue;
    if(dir.includes('e')&&o.x>=R0-eps&&R>o.x){R=o.x;limit='overlap';}
    if(dir.includes('w')&&o.x+o.width<=L0+eps&&L<o.x+o.width){L=o.x+o.width;limit='overlap';}
  }
  for(const o of others){
    if(!(o.x<R-eps&&o.x+o.width>L+eps))continue;
    if(dir.includes('s')&&o.y>=B0-eps&&B>o.y){B=o.y;limit='overlap';}
    if(dir.includes('n')&&o.y+o.height<=T0+eps&&T<o.y+o.height){T=o.y+o.height;limit='overlap';}
  }
  if(R-L<min.width-1e-6||B-T<min.height-1e-6)return{error:tr('Modul tu nemá místo. Nejmenší velikost je {size}.',{size:fmtSize(min.width,min.height,{unit:moduleUnit(m)})}),min};
  const r=v=>Math.round(v*1e4)/1e4,attempt=(l,t,rr,b)=>{const tmp=clone(base),tm=tmp.modules.find(x=>x.id===id),width=r(rr-l),height=r(b-t);tm.x=r(l);tm.y=r(t);return{project:resizeModule(tmp,id,{width,height,mode:'manual'}),width,height};};
  try{return{...attempt(L,T,R,B),limit,min};}catch(error){
    // At another geometry limit, step moving edges back and keep the largest valid size.
    const grow=(R-L)>m.width+1e-6||(B-T)>m.height+1e-6;
    if(grow)for(let k=1;k<=200;k++){
      const l=dir.includes('w')?Math.min(L0,L+k*step):L,rr=dir.includes('e')?Math.max(R0,R-k*step):R,t=dir.includes('n')?Math.min(T0,T+k*step):T,b=dir.includes('s')?Math.max(B0,B-k*step):B;
      if(rr-l<min.width-1e-6||b-t<min.height-1e-6)break;
      try{return{...attempt(l,t,rr,b),limit:'max',reason:errorText(error),min};}catch{}
      if(l===L0&&rr===R0&&t===T0&&b===B0)break;
    }
    return{error:errorText(error),min};
  }
}
function resizeLabel(m,c){
  const u=moduleUnit(m),size=fmtSize(m.width,m.height,{unit:u});
  if(c?.error)return size+' · '+c.error;
  if(c?.limit==='min')return size+' · '+tr('nejmenší možná velikost');
  if(c?.limit==='overlap')return size+' · '+tr('dál je jiný modul');
  if(c?.limit==='drawer')return size+' · '+tr('okraj šuplíku');
  if(c?.limit==='max')return size+' · '+c.reason;
  return size;
}
/** One grid step from the inspector buttons or Alt+Shift+arrows; code is w+, w-, h+ or h-. */
function stepModule(code){
  const m=moduleFor();if(!m)return;if(m.locked)return toast(tr(LOCKED_RESIZE));
  const dir=code[0]==='w'?'e':'s',d=(code[1]==='-'?-1:1)*project.grid,c=resizeCandidate(project,m.id,dir,dir==='e'?d:0,dir==='s'?d:0,{step:project.grid,relative:true});
  if(!c)return;if(c.error)return toast(c.error);
  if(Math.abs(c.width-m.width)<1e-6&&Math.abs(c.height-m.height)<1e-6)return toast(resizeLabel(m,c));
  let note='';commit(()=>{project=c.project;note=releaseUniformSet(m.id);});
  toast(tr('Velikost modulu: {size}',{size:fmtSize(c.width,c.height,{unit:moduleUnit(m)})})+note);
}
/**
 * A hand-resized module can no longer match its siblings in a 'uniform' tool set. Rather than silently
 * resizing (and possibly pushing) every sibling, the set switches to 'auto' and the user is told why.
 * Call inside the commit; returns the extra toast text ('' when no set was affected).
 */
function releaseUniformSet(moduleId,{ifUnsatisfied=false}={}){
  const m=project.modules.find(x=>x.id===moduleId);if(!m||!Array.isArray(project.toolSets))return '';
  const ids=new Set(project.tools.filter(t=>t.moduleId===moduleId).map(t=>t.id));
  const set=project.toolSets.find(s=>s.layout==='uniform'&&((m.setId&&s.id===m.setId)||s.toolIds.some(id=>ids.has(id))));if(!set)return '';
  if(ifUnsatisfied&&setCoherence(project,[set]).satisfied.includes(set.id))return '';
  project.toolSets=project.toolSets.map(s=>s.id===set.id?{...s,layout:'auto'}:s);
  return ' '+tr('Sada „{name}“ už nemá stejně velké moduly, její uspořádání je teď Automaticky.',{name:set.name});
}
// ---- Uniform tool scaling (Měřítko / Délka / Šířka kontury) ----
/**
 * scaleTool() from set-module.js scales points and grip centres (radius stays); here the placed outline
 * also keeps its centre. The editor never silently swaps grips: if scaleTool had to re-place them, it fails.
 */
function scaleToolCentred(tool,factor){
  const next=scaleTool(tool,factor),b=bounds(tool),nb=bounds(next);
  if(tool.fingerGrips?.length&&same(next.fingerGrips)!==same(tool.fingerGrips.map(g=>({...g,x:Number(g.x)*factor,y:Number(g.y)*factor}))))throw i18nError('Výřezy pro prsty by po změně velikosti nebyly platné.');
  next.x=tool.x+(b.width-nb.width)/2;next.y=tool.y+(b.height-nb.height)/2;return next;
}
/** Scale factor requested by a tool size field; null = not a scale field, false = invalid input (already reported). */
function toolScaleRatio(t,field,value){
  const b=bounds(t);
  if(field==='toolWidth')return value/b.width;
  if(field!=='toolScale')return null;
  const pct=Number(String(value).replace(/[\s%]/g,'').replace(',','.'));
  if(!Number.isFinite(pct)||pct<20||pct>500){toast(tr('Zadejte měřítko od {min} do {max} %.',{min:20,max:500}));return false;}
  return pct/100;
}

const STORAGE_VARIANTS=[['ordered','Přehledně podle velikosti'],['compact','Úsporně proti sobě'],['uniform','Stejné samostatné moduly']];
function currentSet(m=moduleFor()){
  const ids=new Set(m?project.tools.filter(t=>t.moduleId===m.id).map(t=>t.id):tool()?[tool().id]:[]);
  return(project.toolSets||[]).find(s=>s.id===m?.setId||s.toolIds.some(id=>ids.has(id)));
}
function moduleSetControls(m){return currentSet(m)||(m&&project.tools.filter(t=>t.moduleId===m.id).length>1)?`<button class="btn btn-soft block-button" data-action="arrange-current-set">${tr('Uložení a pořadí sady')}</button>`:'';}
function moduleMembersPanel(m){
  const members=m?project.tools.filter(t=>t.moduleId===m.id):[];if(members.length<2)return '';
  return `<div class="module-members"><strong>${tr('Nástroje v modulu')}</strong><div role="group" aria-label="${tr('Nástroje v modulu')}">${members.map(t=>`<button type="button" class="btn btn-light ${isToolSelected(t.id)?'active is-selected':''}" data-select="${esc(t.id)}" data-tool-selected="${isToolSelected(t.id)}" aria-pressed="${isToolSelected(t.id)}">${esc(t.name)}</button>`).join('')}</div></div>`;
}
function boardToolFromTarget(target,m){
  const id=target.closest('[data-tool]')?.dataset.tool,own=m?project.tools.filter(t=>t.moduleId===m.id):[];
  return own.find(t=>t.id===id)||null;
}
function selectBoardTarget(module,tool=null){bulkSelection.clear();selected=tool?.id||null;selectedModule=tool?null:module.id;inspectorTab='tool';}
function moduleKindNote(m){const shared=project.tools.some(t=>t.moduleId===m.id);return tr(shared?(m.locked?'Společný modul · zamčená poloha':'Společný modul · volná poloha'):(m.locked?'Výplňový modul · zamčená poloha':'Výplňový modul · volná poloha'));}
function storageVariantOptions(value){return STORAGE_VARIANTS.map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${tr(label)}</option>`).join('');}
function openSetPlacement(){
  const saved=currentSet(),own=project.tools.filter(t=>t.moduleId===moduleFor()?.id);
  const set=saved||{id:uid(),name:moduleFor()?.name||tr('Sada nástrojů'),toolIds:own.map(t=>t.id),layout:'shared'};
  if(set.toolIds.length<2)return toast(tr('Vyberte sadu s alespoň dvěma nástroji.'));
  const variant=set.layout==='uniform'?'uniform':set.arrangement||'ordered';
  const modal=openModal({title:tr('Uložení a pořadí sady'),subtitle:set.name,body:`<label class="field"><span>${tr('Varianta uložení')}</span><select data-storage-variant>${storageVariantOptions(variant)}</select></label><label class="field"><span>${tr('Pořadí velikostí')}</span><select data-storage-order><option value="asc" ${set.order!=='desc'?'selected':''}>${tr('Od nejmenšího po největší')}</option><option value="desc" ${set.order==='desc'?'selected':''}>${tr('Od největšího po nejmenší')}</option></select></label><p class="muted-note">${tr('Přehledná řada sjednotí směr nástrojů. Úsporné uložení zkusí otočení proti sobě, pokud se tím zmenší modul. Výřezy pro prsty a stěny se započítávají.')}</p>`,footer:`<button class="btn btn-primary" data-apply-set-storage>${tr('Použít uložení')}</button>`});
  modal.el.querySelector('[data-apply-set-storage]').onclick=()=>{
    try{
      const variant=modal.el.querySelector('[data-storage-variant]').value,order=modal.el.querySelector('[data-storage-order]').value;
      const ids=new Set(set.toolIds),tools=project.tools.filter(t=>ids.has(t.id)),modules=new Set(tools.map(t=>t.moduleId).filter(Boolean));
      if(tools.some(t=>t.locked)||project.modules.some(m=>modules.has(m.id)&&m.locked))throw i18nError('Nejprve odemkněte všechny moduly sady.');
      if(project.tools.some(t=>modules.has(t.moduleId)&&!ids.has(t.id)))throw i18nError('Nejprve rozdělte modul, který obsahuje nástroje z více sad.');
      const before=clone(project),base={...clone(project),tools:project.tools.filter(t=>!ids.has(t.id)),modules:project.modules.filter(m=>!modules.has(m.id)),toolSets:(project.toolSets||[]).filter(s=>s.id!==set.id)};
      const opts={name:set.name,arrangement:variant==='uniform'?'ordered':variant,order,toolSet:{id:set.id,name:set.name,layout:variant==='uniform'?'uniform':'shared'}};
      const result=addToolGroup(base,clone(tools),opts),byId=new Map(result.project.tools.map(t=>[t.id,t]));
      result.project.tools=before.tools.map(t=>byId.get(t.id));validateProject(result.project);
      commit(()=>{project=result.project;selected=tools[0].id;selectedModule=null;inspectorTab='tool';},tr('Uložení sady změněno.'));modal.close();
      if(!result.placed)offerFit(ids,{name:set.name,group:variant!=='uniform'});
    }catch(error){toast(errorText(error));}
  };
}
function selectedIds(){const known=new Set(project.tools.map(t=>t.id));bulkSelection=new Set([...bulkSelection].filter(id=>known.has(id)));return[...bulkSelection];}
function toggleToolSelection(id){if(bulkSelection.has(id))bulkSelection.delete(id);else bulkSelection.add(id);render();}
function selectionToolbar(){
  const count=selectedIds().length;if(!project.tools.length)return '';
  const button=(action,label,style='btn-light')=>`<button class='btn ${style}' data-action='${action}'>${tr(label)}</button>`;
  return `<div class='bulk-controls'><div class='bulk-heading'><strong role='status' aria-live='polite'>${count?tr('Vybráno: {n}',{n:count}):tr('Výběr nástrojů')}</strong><button class='section-link' data-action='select-all-tools'>${tr('Vybrat vše')}</button>${count?`<button class='section-link' data-action='select-no-tools'>${tr('Zrušit výběr')}</button>`:''}</div>${count?`<div class='bulk-actions' role='group' aria-label='${tr('Hromadné úpravy nástrojů')}'>${button('bulk-rotate','Otočit o 90°','btn-primary')}${button('bulk-angle','Úhel otočení…')}${button('bulk-move','Přesunout vybrané')}${button('bulk-delete','Smazat vybrané','btn-danger')}</div><details class='bulk-more' data-bulk-more><summary>${tr('Další úpravy')}</summary><div class='bulk-secondary-actions'>${button('bulk-flip','Otočit o 180°')}${button('bulk-align','Zarovnat / rozestupy')}${button('bulk-depth','Hloubka kapes')}${button('bulk-grips-auto','Automatické výřezy vybraných')}${button('bulk-grips-clear','Odstranit výřezy vybraných')}${button('bulk-lock','Zamknout')}${button('bulk-unlock','Odemknout')}${button('bulk-create-set','Vytvořit sadu','btn-soft')}</div></details>`:`<p class='muted-note selection-hint'>${tr('Ctrl/Shift + kliknutí nebo checkbox: více nástrojů.')}</p>`}</div>`;
}
function toolList(){
  return project.tools.map(t=>`<div class="tool-select-row ${bulkSelection.has(t.id)?'batch-selected':''} ${isToolSelected(t.id)?'is-selected':''}"><input type="checkbox" data-tool-check="${esc(t.id)}" ${bulkSelection.has(t.id)?'checked':''} aria-label="${esc(tr('Vybrat {name}',{name:t.name}))}"><button class="tool-row ${isToolSelected(t.id)?'selected is-selected':''}" data-select="${esc(t.id)}" data-tool-selected="${isToolSelected(t.id)}" aria-pressed="${isToolSelected(t.id)}"><span class="tool-thumb">${thumb(t)}</span><span><strong>${esc(t.name)}${unitBadge(t.unit)}</strong><small>${sizeShort(bounds(t).width,bounds(t).height,toolUnit(t))}${!t.moduleId?' · '+tr('neumístěno'):''}</small></span>${icon(project.modules.find(m=>m.id===t.moduleId)?.locked?'lock':'chevron')}</button></div>`).join('')||`<div class="empty-note">${tr('Zatím žádné nástroje.')}</div>`;
}
function applyBulk(operation,value){
  const ids=selectedIds();if(!ids.length)return toast(tr('Nejprve vyberte nástroje.'));
  const next=operation(project,ids,value);
  if(same(next)===same(project))return toast(tr('Beze změny.'));
  commit(()=>{project=next;if(!project.tools.some(t=>t.id===selected))selected=project.tools[0]?.id||null;if(!project.modules.some(m=>m.id===selectedModule))selectedModule=null;selectedIds();},tr('Upraveno nástrojů: {n}.',{n:ids.length}));
}
function openBulkMove(){
  const modal=openModal({title:tr('Přesunout vybrané nástroje'),body:`<label class="field"><span>${tr('Co přesunout')}</span><select data-bulk-move-mode><option value="modules">${tr('Celé moduly')}</option><option value="tools">${tr('Nástroje uvnitř modulů')}</option></select></label><div class="fields-row">${input(tr('Posun doprava'),0,'bulkDx',{min:-3000,max:3000})}${input(tr('Posun dolů'),0,'bulkDy',{min:-3000,max:3000})}</div><p class="muted-note">${tr('Vzdálenosti se přičtou k současným polohám. Při přesunu nástrojů zůstanou moduly i ostatní nástroje na místě.')}</p>`,footer:`<button class="btn btn-primary" data-apply-bulk-move>${tr('Přesunout vybrané')}</button>`});
  modal.el.querySelector('[data-apply-bulk-move]').onclick=()=>{const dx=lengthFrom(modal.el.querySelector('[data-field=bulkDx]')),dy=lengthFrom(modal.el.querySelector('[data-field=bulkDy]'));if(dx===null||dy===null)return;try{applyBulk(modal.el.querySelector('[data-bulk-move-mode]').value==='tools'?bulk.bulkMoveTools:bulk.bulkMove,{dx,dy});modal.close();}catch(error){toast(errorText(error));}};
}
function openBulkAlign(){
  const modal=openModal({title:tr('Zarovnat / rozestupy'),body:`<div class="fields-row"><label class="field"><span>${tr('Směr')}</span><select data-align-axis><option value="x">${tr('Vodorovně · X')}</option><option value="y">${tr('Svisle · Y')}</option></select></label><label class="field"><span>${tr('Zarovnat podle')}</span><select data-align-edge><option value="min">${tr('Levý / horní okraj')}</option><option value="center">${tr('Střed')}</option><option value="max">${tr('Pravý / dolní okraj')}</option></select></label></div><p class="muted-note">${tr('Vyberte nejméně dva nástroje v jednom modulu. Stejné mezery vyžadují alespoň tři nástroje; krajní nástroje zůstanou na místě.')}</p>`,footer:`<button class="btn btn-light" data-apply-bulk-distribute ${selectedIds().length<3?'disabled':''}>${tr('Stejné mezery')}</button><button class="btn btn-primary" data-apply-bulk-align>${tr('Zarovnat nástroje')}</button>`});
  const axis=()=>modal.el.querySelector('[data-align-axis]').value;
  modal.el.querySelector('[data-apply-bulk-align]').onclick=()=>{try{applyBulk(bulk.bulkAlignTools,{axis:axis(),edge:modal.el.querySelector('[data-align-edge]').value});modal.close();}catch(error){toast(errorText(error));}};
  modal.el.querySelector('[data-apply-bulk-distribute]').onclick=()=>{try{applyBulk(bulk.bulkDistributeTools,{axis:axis()});modal.close();}catch(error){toast(errorText(error));}};
}
function openBulkDepth(){
  const modal=openModal({title:tr('Hloubka vybraných kapes'),body:input(tr('Hloubka kapsy'),tool()?.depth||12,'bulkDepth',{min:.5,max:project.insertHeight-project.base}),footer:`<button class="btn btn-primary" data-apply-bulk-depth>${tr('Použít hloubku')}</button>`});
  modal.el.querySelector('[data-apply-bulk-depth]').onclick=()=>{const value=lengthFrom(modal.el.querySelector('[data-field=bulkDepth]'));if(value===null)return;try{applyBulk(bulk.bulkSetDepth,value);modal.close();}catch(error){toast(errorText(error));}};
}
function readAngle(value,{relative=false}={}){
  const text=String(value).trim().replace(',','.'),degrees=Number(text);
  if(!text||!Number.isFinite(degrees)||degrees<(relative?-359.99:0)||degrees>359.99)throw i18nError('Zadejte úhel od {min} do {max} °.',{min:relative?-359.99:0,max:359.99});
  return Math.round(degrees*100)/100;
}
function openBulkAngle(){
  const modal=openModal({title:tr('Úhel otočení'),body:`<label class="field"><span>${tr('Způsob otočení')}</span><select data-rotation-mode><option value="relative">${tr('Otočit o')}</option><option value="absolute">${tr('Nastavit na')}</option></select></label>${input(tr('Úhel otočení'),90,'bulkAngle',{type:'angle',min:-359.99,max:359.99,scope:'bulk'})}<p class="muted-note">${tr('Otáčejí se jen vybrané nástroje kolem vlastních středů. Společný modul a ostatní nástroje zůstávají na místě.')}</p>`,footer:`<button class="btn btn-primary" data-apply-bulk-angle>${tr('Použít otočení')}</button>`});
  const mode=modal.el.querySelector('[data-rotation-mode]'),field=modal.el.querySelector('[data-field=bulkAngle]');
  mode.onchange=()=>{field.min=mode.value==='absolute'?'0':'-359.99';};
  modal.el.querySelector('[data-apply-bulk-angle]').onclick=()=>{
    try{const relative=mode.value!=='absolute',degrees=readAngle(field.value,{relative});applyBulk(relative?bulk.bulkRotate:bulk.bulkSetRotation,degrees);modal.close();}
    catch(error){toast(errorText(error));}
  };
}
function rotateCurrentTool(degrees){
  const t=tool();if(!t)return;
  const next=bulk.bulkRotate(project,[t.id],degrees);if(same(next)===same(project))return;
  commit(()=>project=next,tr('Nástroj otočen.'));
}
function toolPositionPanel(t,m){
  if(!m)return '';
  return `<div class="tool-position"><strong>${tr('Poloha uvnitř modulu')}</strong><div class="fields-row">${input(tr('X · zleva'),t.x-m.x,'toolX',{unit:toolUnit(t),min:-3000,max:3000,scope:'tool'})}${input(tr('Y · shora'),t.y-m.y,'toolY',{unit:toolUnit(t),min:-3000,max:3000,scope:'tool'})}</div></div>`;
}
function applyModuleEdit(operation,value,message){
  const m=moduleFor();if(!m)return;
  const next=operation(project,m.id,value);if(same(next)===same(project))return;
  commit(()=>project=next,message);
}
function duplicateCurrentModule(){
  const m=moduleFor();if(!m)return;const previous=new Set(project.modules.map(m=>m.id)),next=moduleEdit.duplicateModule(project,m.id);
  if(same(next)===same(project))return;
  const copied=next.modules.find(m=>!previous.has(m.id));
  commit(()=>{project=next;selected=null;selectedModule=copied?.id||m.id;inspectorTab='tool';},tr('Modul zkopírován.'));
}
function sizeLabelPanel(t){return `<div class="size-label-editor">${input(tr('Popisek velikosti'),t.sizeLabel??sizeText(t),'sizeLabel',{type:'text',scope:'tool'})}<p class="muted-note">${tr('Například 13 mm nebo 1/2 in. U nástroje z fotografie zadejte skutečnou velikost. Tisk popisků zapnete pro celý šuplík.')}</p><button class="btn btn-light" data-action="toggle-size-labels">${tr(project.sizeLabels?'Vypnout popisky v modelu':'Zapnout popisky v modelu')}</button></div>`;}
function labelStatus(modules=project.modules,summary=null){
  if(!project.sizeLabels)return '';
  const ids=new Set(modules.map(module=>module.id)),known=cachedLabels();
  const plan=summary||known&&{labels:known.labels.filter(label=>ids.has(label.moduleId)),skipped:known.skipped.filter(label=>ids.has(label.moduleId))};
  if(!plan)ensureLabels();
  return '<div data-label-status="'+esc(JSON.stringify([...ids]))+'">'+(plan?labelStatusContent(plan):'<p class="muted-note" role="status">'+tr('Připravuji popisky…')+'</p>')+'</div>';
}
function inspectorSection(key,title,body){return `<details class='inspector-section' data-inspector-section='${key}'><summary>${title}</summary><div class='inspector-section-body'>${body}</div></details>`;}
function bulkSelectionPanel(){
  const ids=new Set(selectedIds()),tools=project.tools.filter(t=>ids.has(t.id));
  return `<div class='panel-header'><h2 class='panel-title'>${icon('wrench')}${tr('Vybrané nástroje')}</h2><span>${tools.length}</span></div><div class='panel-body bulk-selection-summary'><p class='muted-note'>${tr('Akce nahoře upraví všechny označené nástroje.')}</p><ul class='bulk-selected-list'>${tools.map(t=>`<li><button type='button' data-select='${esc(t.id)}' title='${esc(tr('Vlastnosti nástroje {name}',{name:t.name}))}'>${esc(t.name)}</button></li>`).join('')}</ul><p class='muted-note'>${tr('Pro samostatné vlastnosti klikněte na název nástroje.')}</p></div>`;
}
function selectedPanel(){
  const t=tool(),m=moduleFor();
  if(!t&&!m)return `<div class='panel-header'><h2 class='panel-title'>${tr('Vlastnosti nástroje')}</h2></div><div class='empty-note'>${tr('Vyberte nástroj v náhledu nebo v seznamu.')}</div>`;
  const drawerButton=`<button class='icon-btn' data-action='drawer-tab' aria-label='${tr('Rozměry šuplíku')}'>${icon('ruler')}</button>`;
  if(!t)return `<div class='panel-header'><h2 class='panel-title'>${tr(project.tools.some(t=>t.moduleId===m.id)?'Společný modul':'Prázdný modul')}</h2>${drawerButton}</div><div class='panel-body'>${moduleSizing(m)}${moduleMembersPanel(m)}${moduleSetControls(m)}<p class='muted-note'>${moduleKindNote(m)}</p><div class='selected-actions'><button class='btn btn-light' data-action='lock'>${icon(m.locked?'unlock':'lock')}${m.locked?tr('Odemknout'):tr('Zamknout')}</button><button class='btn btn-danger' data-action='delete'>${icon('trash')}${tr('Smazat')}</button></div></div>`;
  const dimensions=getToolDimensions(t),dimensionFields=`<div class='fields-row'>${input(tr('Délka'),dimensions.length,'toolLength',{unit:toolUnit(t),scope:'tool',min:2,max:3000})}${input(tr('Šířka'),dimensions.width,'toolBreadth',{unit:toolUnit(t),scope:'tool',min:2,max:3000})}</div><p class='muted-note'>${tr('Délka a šířka mění jen vybranou konturu v jejích osách. Jmenovitá velikost a ostatní nástroje se nemění.')}</p>`;
  const shape=`${input(tr('Šířka při rovnoměrném měřítku'),bounds(t).width,'toolWidth',{unit:toolUnit(t),scope:'tool',min:2,max:2000})}<label class='field'><span>${tr('Měřítko')}</span><div class='input-wrap'><input type='text' inputmode='decimal' autocomplete='off' spellcheck='false' value='100' data-field='toolScale' data-scope='tool' aria-label='${tr('Měřítko')} (%)'><em>%</em></div></label><p class='muted-note tool-scale-hint'>${tr('Měřítko mění délku i šířku rovnoměrně kolem středu. Poloměr výřezů pro prsty zůstává stejný.')}</p>${unitSelect(tr('Jednotky nástroje'),t.unit,'tool')}`;
  const moduleOptions=m?`${moduleSizing(m)}<button class='btn btn-light' data-action='lock'>${icon(m.locked?'unlock':'lock')}${m.locked?tr('Odemknout'):tr('Zamknout')}</button><p class='muted-note'>${moduleKindNote(m)}</p>`:unplacedToolNote(t);
  return `<div class='panel-header'><h2 class='panel-title'>${icon('wrench')}${tr('Vybraný nástroj')}${unitBadge(t.unit)}</h2>${drawerButton}</div><div class='panel-body'><div class='tool-basic-properties'>${input(tr('Název'),t.name,'name',{type:'text',scope:'tool'})}${dimensionFields}${toolPositionPanel(t,m)}<div class='fields-row'>${input(tr('Otočení'),((t.rotation%360)+360)%360,'rotation',{type:'angle',min:0,max:359.99,scope:'tool'})}${input(tr('Hloubka kapsy'),t.depth,'depth',{unit:toolUnit(t),scope:'tool',min:.5,max:project.insertHeight-project.base})}</div><div class='selected-actions'><button class='btn btn-light' data-action='rotate'>${icon('rotate')}${tr('Otočit 90°')}</button><button class='btn btn-light' data-action='duplicate'>${icon('copy')}${tr('Kopie')}</button><button class='btn btn-danger' data-action='delete' aria-label='${tr('Smazat nástroj')}'>${icon('trash')}</button></div></div>${moduleMembersPanel(m)}${inspectorSection('finger-grips',tr('Výřezy pro prsty'),fingerGripPanel(t))}${inspectorSection('tool-shape',tr('Rozměry a měřítko'),shape)}${inspectorSection('size-label',tr('Popisek velikosti'),sizeLabelPanel(t))}${inspectorSection('tool-set',tr('Sady nástrojů'),selectedToolSetPanel(t)+moduleSetControls(m))}${inspectorSection('module-options',tr('Nastavení modulu'),moduleOptions)}</div>`;
}
const inspectorDisclosureState=new Map();
const inspectorContext=()=>`${project.id}:${selectedIds().length?'bulk':inspectorTab+':'+(selectedModule||selected||'')}`;
function captureInspectorState(){
  const aside=$('.inspector'),scroll=aside?.querySelector('.inspector-scroll');if(!aside||!scroll)return null;
  const projectId=scroll.dataset.projectId;
  for(const el of aside.querySelectorAll('[data-inspector-section],[data-bulk-more]'))inspectorDisclosureState.set(`${projectId}:${el.dataset.inspectorSection||'bulk-more'}`,el.open);
  const active=document.activeElement,focused=aside.contains(active)?{field:active.dataset.field,scope:active.dataset.scope,action:active.dataset.action,check:active.dataset.toolCheck,section:active.matches('summary')?active.parentElement.dataset.inspectorSection:null,more:active.matches('summary')&&active.parentElement.hasAttribute('data-bulk-more')}:null;
  return {context:scroll.dataset.inspectorContext,top:scroll.scrollTop,focused,lists:[...aside.querySelectorAll('.module-members>div,.bulk-selected-list,.tool-list')].map(el=>({key:el.className||'members',top:el.scrollTop}))};
}
function restoreInspectorState(state){
  const aside=$('.inspector'),scroll=aside?.querySelector('.inspector-scroll');if(!scroll)return;
  for(const el of aside.querySelectorAll('[data-inspector-section],[data-bulk-more]')){const key=`${project.id}:${el.dataset.inspectorSection||'bulk-more'}`;if(inspectorDisclosureState.has(key))el.open=inspectorDisclosureState.get(key);}
  const sameContext=state?.context===scroll.dataset.inspectorContext;
  if(sameContext){
    scroll.scrollTop=state.top;
    for(const el of aside.querySelectorAll('.module-members>div,.bulk-selected-list,.tool-list')){const old=state.lists.find(list=>list.key===(el.className||'members'));if(old)el.scrollTop=old.top;}
  }
  const f=state?.focused;if(!f||(!sameContext&&!f.check))return;
  const target=[...aside.querySelectorAll('[data-field],[data-action],[data-tool-check],summary')].find(el=>{
    if(f.check)return el.dataset.toolCheck===f.check;
    if(f.field)return el.dataset.field===f.field&&el.dataset.scope===f.scope;
    if(f.action)return el.dataset.action===f.action;
    return el.matches('summary')&&((f.section&&el.parentElement.dataset.inspectorSection===f.section)||(f.more&&el.parentElement.hasAttribute('data-bulk-more')));
  });
  try{target?.focus({preventScroll:sameContext});}catch{}
}
function updateEditorViewport(){
  const editor=$('.workbench');if(!editor)return false;
  if(window.innerWidth<=760){const had=!!editor.style.getPropertyValue('--editor-pane-height');editor.style.removeProperty('--editor-pane-height');return had;}
  const viewport=window.visualViewport?.height||window.innerHeight;
  if(!Number.isFinite(viewport)||viewport<=32)return false;
  const top=Math.max(16,editor.getBoundingClientRect().top-(window.visualViewport?.offsetTop||0));
  // Leave room for the real heading/steps position. Very short windows retain a usable pane and page scrolling.
  const height=Math.floor(Math.min(viewport-32,Math.max(280,viewport-top-16))),value=height+'px';
  if(editor.style.getPropertyValue('--editor-pane-height')===value)return false;
  editor.style.setProperty('--editor-pane-height',value);return true;
}
let editorViewportFrame=null;
function scheduleEditorViewport(){
  if(editorViewportFrame!==null)return;
  editorViewportFrame=requestAnimationFrame(()=>{editorViewportFrame=null;if(!drag&&!resizeDrag&&updateEditorViewport())renderCameraFrame();});
}
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
// ---- Why a tool has no module: shown in the issue list and in the selected-tool panel ----
/**
 * 'drawer'  – that module is larger than the drawer itself;
 * 'space'   – it would fit, but there is no free room left; 'invalid' – the pocket cannot be computed.
 */
function unplacedReason(p,t){
  const num=(v,d)=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v):d;
  const grid=Math.max(1,num(p.grid,42)),pad=Math.max(num(p.wall,2.4),num(p.gap,3)/2)+.25;
  const sizes=[num(t.rotation,0),num(t.rotation,0)+90].flatMap(rotation=>{try{
    const pts=pocketOutline({...t,x:0,y:0,rotation},num(p.clearance,.8));if(pts.length<3)return[];
    const xs=pts.map(q=>q.x),ys=pts.map(q=>q.y);
    return[{w:Math.ceil((Math.max(...xs)-Math.min(...xs)+2*pad)/grid)*grid,h:Math.ceil((Math.max(...ys)-Math.min(...ys)+2*pad)/grid)*grid}];
  }catch{return[];}});
  if(!sizes.length)return 'invalid';
  if(!sizes.some(s=>s.w<=num(p.width,0)&&s.h<=num(p.height,0)))return 'drawer';
  return 'space';
}
function unplacedSummary(p,tools){const out={drawer:[],space:[],invalid:[]};for(const t of tools)out[unplacedReason(p,t)].push(t.id);return out;}
function unplacedLines(p,why){
  const lines=[];
  if(why.drawer.length)lines.push(plural(why.drawer.length,['{n} nástroj je větší než šuplík {size}.','{n} nástroje jsou větší než šuplík {size}.','{n} nástrojů je větších než šuplík {size}.'],{size:fmtSize(p.width,p.height)}));
  if(why.space.length)lines.push(plural(why.space.length,['{n} nástroj se nevešel do šuplíku.','{n} nástroje se nevešly do šuplíku.','{n} nástrojů se nevešlo do šuplíku.']));
  return lines;
}
/** Explanation box for the selected tool when it has no module. */
function unplacedToolNote(t){
  const reason=unplacedReason(project,t),link=(action,label)=>`<button class="section-link" data-action="${action}">${label}</button>`;
  if(reason==='drawer')return `<div class="issue-box unplaced-why"><p>${tr('Nástroj čeká na umístění: jeho modul je větší než šuplík {size}.',{size:fmtSize(project.width,project.height)})}</p>${link('expand',tr('Zvětšit šuplík'))}</div>`;
  if(reason==='space')return `<div class="issue-box unplaced-why"><p>${tr('Nástroj čeká na umístění: v šuplíku pro něj už není volné místo.')}</p>${link('smart-layout',tr('Rozložit'))} ${link('expand',tr('Zvětšit šuplík'))}</div>`;
  return `<div class="issue-box">${tr('Nástroj čeká na umístění.')}</div>`;
}
function render(){
  closeContextMenu();
  const preservedInspector=captureInspectorState();
  viewControls?.dispose();viewControls=null;
  setProjectUnit(project.unit);
  const issues=errors(),unplaced=project.tools.filter(t=>!project.modules.some(m=>m.id===t.moduleId));
  // "Not placed yet" issues collapse into one line per cause (drawer size / no free room) with a direct way out.
  const unplacedIds=new Set(unplaced.map(t=>t.id)),waitingIds=new Set(issues.filter(i=>i.type==='outside'&&i.ids.length===1&&unplacedIds.has(i.ids[0])).map(i=>i.ids[0]));
  const why=unplacedSummary(project,unplaced.filter(t=>waitingIds.has(t.id))),explained=new Set([...why.drawer,...why.space]);
  const waiting=issues.filter(i=>i.type==='outside'&&i.ids.length===1&&explained.has(i.ids[0]));
  const issueLines=[...unplacedLines(project,why),...issues.filter(i=>!waiting.includes(i)).map(i=>errorText(i))];
  const issueActions=`<button class="section-link" data-action="smart-layout">${tr('Rozložit nástroje')}</button>${why.space.length||why.drawer.length?` <button class="section-link" data-action="expand">${tr('Zvětšit šuplík')}</button>`:''}`;
  const occupied=project.modules.reduce((s,m)=>s+moduleArea(m,project.grid),0),usage=Math.min(100,Math.round(occupied/(project.width*project.height)*100)),lockedCount=project.modules.filter(m=>m.locked).length;
  const drawerSize=fmtSize(project.width,project.height);
  $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand" href="#" aria-label="InsertCreator" data-action="home"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span class="brand-name">InsertCreator</span></a><nav class="sidebar-nav" aria-label="${tr('Hlavní navigace')}"><button class="nav-item active" data-action="home">${icon('drawer')}<span>${tr('Můj šuplík')}</span></button><button class="nav-item" data-action="library">${icon('wrench')}<span>${tr('Knihovna nástrojů')}</span></button></nav><div class="sidebar-separator"></div>${drawerList()}<div class="sidebar-bottom"><button class="nav-item" data-action="help">${icon('help')}<span>${tr('Jak na to')}</span></button><div class="sidebar-separator" style="margin:18px 0"></div><div class="local-tag">${icon('shield')} ${tr('Všechno zůstává u vás')}</div><p>${tr('Fotky zpracovává váš prohlížeč.')}<br>${tr('Bez cloudu. Bez předplatného.')}</p></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${tr('Dílna')} <span>/</span> <b>${tr('Organizér nářadí')}</b></div><div class="top-actions">${prefsControls()}<span class="save-state">${icon(storageFailed?'info':'check')} <span class="save-text">${storageFailed?tr('Stáhněte zálohu'):tr('Uloženo v zařízení')}</span></span><button class="btn btn-light" data-action="save-project" aria-label="${tr('Uložit projekt')}">${icon('download')} <span class="btn-label">${tr('Uložit projekt')}</span></button><span class="avatar" title="${tr('Lokální dílna')}">JD</span></div></header><div class="page"><div class="page-heading"><div><p class="eyebrow">${tr('MÍSTO PRO KAŽDÝ NÁSTROJ')}</p><div class="name-edit"><h1>${esc(project.name)}</h1><button class="icon-btn" data-action="rename" aria-label="${tr('Přejmenovat šuplík')}">${icon('edit')}</button></div><p class="subtitle">${tr('Od fotky k pořádku. Přesně podle vaší dílny.')}</p><button class="drawer-dimensions" data-action="drawer-tab">${icon('ruler')}<span>${tr('Rozměry šuplíku')}</span><small>${drawerSize}</small></button></div><div class="heading-actions"><button class="btn btn-light" data-action="add-shape">${icon('plus')} ${tr('Prázdný modul')}</button><button class="btn btn-primary" data-action="capture">${icon('camera')} <span>${tr('Přidat nástroj')}</span></button></div></div><div class="steps" aria-label="${tr('Postup')}"><button class="step done" data-action="capture"><span class="step-num">01</span>${tr('Vyfotit nástroj')}</button><span class="step-chevron">›</span><button class="step done" data-action="capture"><span class="step-num">02</span>${tr('Rozpoznat obrys')}</button><span class="step-chevron">›</span><span class="step active"><span class="step-num">03</span>${tr('Rozvrhnout')}</span><span class="step-chevron">›</span><button class="step" data-action="export"><span class="step-num">04</span>${tr('Vyrobit')}</button></div><div class="workbench"><div class="workspace-col"><section class="workspace" aria-label="${tr('Editor sestavy')}"><div class="workspace-header"><div class="workspace-header-title">${icon('drawer')} ${tr('Náhled šuplíku')} <small>${drawerSize}</small></div><div class="segmented" aria-label="${tr('Režim náhledu')}"><button data-action="2d" class="${view==='2d'?'active':''}" aria-pressed="${view==='2d'}">${icon('grid')}2D</button><button data-action="3d" class="${view==='3d'?'active':''}" aria-pressed="${view==='3d'}">${icon('cube')}3D</button></div></div><div class="board-toolbar"><div class="tool-group"><button class="icon-btn" data-action="undo" aria-label="${tr('Zpět (Ctrl+Z)')}" ${undoStack.length?'':'disabled'}>${icon('undo')}</button><button class="icon-btn" data-action="redo" aria-label="${tr('Znovu (Ctrl+Shift+Z)')}" ${redoStack.length?'':'disabled'}>${icon('redo')}</button><span class="toolbar-sep"></span><button class="icon-btn ${showGrid?'active':''}" data-action="grid" aria-label="${tr('Zobrazit rastr')}" aria-pressed="${showGrid}">${icon('grid')}</button><button class="tiny-button" data-action="labels" aria-pressed="${showLabels}">${icon('eye')} ${tr('Popisky')}</button></div><div class="tool-group"><button class="tiny-button ${moveMode?'active':''}" data-action="move-mode" aria-pressed="${moveMode}">${icon('move')}${moveMode?tr('Hotovo'):tr('Přesunout')}</button><select class="smart-shape-select" data-smart-shape aria-label="${tr('Tvar modulů pro chytré rozvržení')}"><option value="stepped" ${smartShape==='stepped'?'selected':''}>${tr('Schodové moduly')}</option><option value="rectangular" ${smartShape==='rectangular'?'selected':''}>${tr('Obdélníkové moduly')}</option></select><button class="tiny-button smart-layout-button" data-action="smart-layout">${icon('spark')} ${tr('Rozložit nástroje')}</button></div></div><div class="board-area" id="board-area"><svg class="board-svg ${moveMode?'moving':''} ${view==='3d'?'view-3d':''}" id="board-svg" tabindex="0" role="img" aria-label="${tr('Rozložení modulů a nástrojů v šuplíku')}"></svg>${!project.modules.length&&view==='2d'?`<div class="board-empty">${icon('drawer')}<h3>${tr('Začněte jedním nástrojem')}</h3><p>${tr('Vyfoťte ho na A4 papíru nebo vložte z uložené knihovny.')}</p><button class="btn btn-primary" data-action="capture">${icon('camera')} ${tr('Přidat nástroj')}</button></div>`:''}${view==='3d'?'<div class="view-3d-hint">'+esc(tr('Levé tlačítko: otáčet · Pravé: posouvat · Kolečko: přiblížit'))+'</div>':''}</div><div class="board-footer"><div class="legend"><span><i></i>${tr('Modul')}</span><span><i></i>${tr('Vybraný nástroj')}</span></div><div class="key-hint">${view==='2d'?tr('Pravé kliknutí: možnosti · Tažení pravým: posouvat · Kolečko: přiblížit')+' · '+tr('Tažením přesunete modul')+' <kbd>R</kbd> '+tr('otočit'):tr('Pohled kamerou')}</div><div class="tool-group"><button class="icon-btn" data-action="zoom-out" aria-label="${tr('Oddálit')}">${icon('zoomOut')}</button><span data-zoom-value>${Math.round((view==='3d'?camera3D.zoom:zoom)*100)} %</span><button class="icon-btn" data-action="zoom-in" aria-label="${tr('Přiblížit')}">${icon('zoomIn')}</button><button class="icon-btn" data-action="fit" aria-label="${tr('Zobrazit vše')}">${icon('fit')}</button></div></div></section><div class="metrics"><div class="metric"><div class="metric-icon">${icon('wrench')}</div><div><strong>${project.tools.length} <small>${plural(project.tools.length,['nástroj','nástroje','nástrojů'])}</small></strong><p>${unplaced.length?tr('{n} čeká na umístění',{n:unplaced.length}):tr('Každý má svoje místo')}</p></div></div><div class="metric"><div class="metric-icon">${icon('grid')}</div><div><strong>${project.modules.length} <small>${plural(project.modules.length,['modul','moduly','modulů'])}</small></strong><p>${tr('{n} zamčených · rozšiřitelné',{n:lockedCount})}</p></div></div><div class="metric"><div class="metric-icon">${icon('drawer')}</div><div><strong>${usage} <small>${tr('% plochy')}</small></strong><p>${tr('{n} % na další nástroje',{n:Math.max(0,100-usage)})}</p></div></div></div>${issues.length?`<div class="issue-box" role="status">${issueLines.slice(0,3).map(text=>`<p>${esc(text)}</p>`).join('')}${issueLines.length>3?`<p>${tr('A dalších {n} upozornění.',{n:issueLines.length-3})}</p>`:''}${issueActions}</div>`:''}${tipVisible?`<div class="tip">${icon('lightbulb')}<div><strong>${tr('Vaše dílna poroste. Sestava taky.')}</strong> ${tr('Zamkněte hotové moduly a přidejte další nástroje. Rozložení zachová jejich polohu.')}</div><button class="icon-btn" data-action="hide-tip" aria-label="${tr('Skrýt tip')}">${icon('close')}</button></div>`:''}</div><aside class='inspector' aria-label='${tr('Nastavení a nástroje')}'><section class='inspector-selection' aria-label='${tr('Úpravy výběru')}'>${selectionToolbar()}</section><div class='inspector-scroll' role='region' tabindex='0' aria-label='${tr('Nastavení a seznam nástrojů')}' data-inspector-context='${esc(inspectorContext())}' data-project-id='${esc(project.id)}'><section class='panel' id='drawer-settings'>${selectedIds().length?bulkSelectionPanel():inspectorTab==='tool'?selectedPanel():drawerPanel()}</section><section class='panel assembly-panel'><div class='panel-header'><h2 class='panel-title'>${tr('Nástroje v sestavě')}</h2><span>${project.tools.length.toString().padStart(2,'0')}</span></div><button class='btn btn-light tool-sets-open' data-action='tool-sets'>${tr('Sady nástrojů')}</button><div class='tool-list'>${toolList()}</div><button class='add-tool-row' data-action='capture'>${icon('plus')} ${tr('Přidat další nástroj')}</button></section><div class='export-card'><div class='ready'>${icon(issues.length?'info':'check')} ${issues.length?tr('Zkontrolujte sestavu'):tr('Sestava připravena')}</div><p>${issues.length?tr('Před výrobou opravte označené rozměry nebo překryvy.'):tr('STL pro 3D tisk, SVG a DXF pro výřez. Vše v reálných milimetrech.')}</p><button class='btn btn-dark block-button' data-action='export'>${icon('download')} ${tr('Připravit export')} ${icon('arrow')}</button></div></div></aside></div><footer class="footer-line"><span>${tr('Navrženo ve skutečných rozměrech. Vyrobeno pro vaši dílnu.')}</span><div class="footer-links"><button data-action="help">${tr('Návod a inspirace')}</button><a href="${getLang()==='en'?'./licenses-en.html':'./licenses.html'}" target="_blank" rel="noopener">${tr('Použité součásti a licence')}</a></div><span class="app-version">InsertCreator / 1.2</span></footer></div></main></div><nav class="mobile-nav" aria-label="${tr('Mobilní navigace')}"><button class="active" data-action="home">${icon('drawer')}${tr('Šuplík')}</button><button data-action="library">${icon('wrench')}${tr('Knihovna')}</button><button class="camera-nav" data-action="capture" aria-label="${tr('Vyfotit nástroj')}">${icon('camera')}</button><button data-action="projects">${icon('folder')}${tr('Šuplíky')}</button><button data-action="export">${icon('download')}${tr('Export')}</button></nav>`;
  const authorCredit=document.createElement('p');
  authorCredit.className='author-credit';
  authorCredit.textContent='Created by Jaroslav Patočka · 2026';
  $('#app .brand').after(authorCredit);
  updateEditorViewport();
  renderBoard();
  restoreInspectorState(preservedInspector);
}

function moduleLabelFrame(module){
  if(!module.cells)return module;
  const row=Math.max(...module.cells.map(cell=>cell.y)),xs=module.cells.filter(cell=>cell.y===row).map(cell=>cell.x).sort((a,b)=>a-b);
  let first=xs[0],previous=first,best={first,length:1};
  for(const x of xs.slice(1)){if(x!==previous+1)first=x;const length=x-first+1;if(length>best.length)best={first,length};previous=x;}
  return{x:module.x+best.first*project.grid,y:module.y+row*project.grid,width:best.length*project.grid,height:project.grid};
}
function renderBoard(){
  const svg=$('#board-svg');if(!svg)return;
  if(view==='3d'){
    render3D(svg);
    if(!viewControls)viewControls=createViewControls(svg,{getCamera:()=>camera3D,setCamera:value=>camera3D=value,getFrame:()=>({width:cameraFrame.width*cameraFrame.zoom/camera3D.zoom,height:cameraFrame.height*cameraFrame.zoom/camera3D.zoom}),render:renderCameraFrame});
    return;
  }
  const pad=34,w=project.width+pad*2,h=project.height+pad*2;
  svg.setAttribute('viewBox',`${-pad+(w-w/zoom)/2+pan2D.x} ${-pad+(h-h/zoom)/2+pan2D.y} ${w/zoom} ${h/zoom}`);
  const issues=errors(),bad=new Set(issues.flatMap(x=>x.ids));
  let html=`<defs><pattern id="module-grid" width="${project.grid}" height="${project.grid}" patternUnits="userSpaceOnUse"><path d="M ${project.grid} 0 L 0 0 0 ${project.grid}" fill="none" stroke="#dce4d2" stroke-width=".65"/></pattern><pattern id="empty-hatch" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="#e4e9dc" stroke-width=".45"/></pattern><filter id="softshadow" x="-10%" y="-10%" width="125%" height="125%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#5b6846" flood-opacity=".08"/></filter></defs><rect x="-2" y="-2" width="${project.width+4}" height="${project.height+4}" rx="5" fill="#eff2e9" stroke="#c5cfb9" stroke-width="1.1"/><rect x="0" y="0" width="${project.width}" height="${project.height}" rx="3" fill="${showGrid?'url(#module-grid)':'#f4f7ee'}"/>`;
  html+=`<g stroke="#a4af97" stroke-width=".6"><path d="M0 -17H${project.width} M0 -21v8 M${project.width} -21v8"/><path d="M-17 0V${project.height} M-21 0h8 M-21 ${project.height}h8"/></g><rect x="${project.width/2-29}" y="-24" width="58" height="14" fill="#fbfcf9"/><text x="${project.width/2}" y="-14" text-anchor="middle" fill="#93a083" font-size="8.5">${fmtLen(project.width)}</text><text transform="translate(-23 ${project.height/2}) rotate(-90)" text-anchor="middle" fill="#93a083" font-size="8.5">${fmtLen(project.height)}</text>`;
  if(project.bottomMode==='grid'){
    try{const layout=gridfinityLayout(project);html+=`<g class='gridfinity-baseplate' data-baseplate='true' pointer-events='none' aria-label='${tr('Základna Gridfinity')}'><defs><pattern id='gridfinity-sockets' width='42' height='42' patternUnits='userSpaceOnUse'><rect x='.1' y='.1' width='41.8' height='41.8' rx='3.9' fill='none' stroke='#6b9294' stroke-width='.6'/><rect x='2.15' y='2.15' width='37.7' height='37.7' rx='1.85' fill='none' stroke='#8ba8a8' stroke-width='.4'/></pattern></defs><rect x='0' y='0' width='${layout.width}' height='${layout.height}' fill='url(#gridfinity-sockets)' stroke='#6b9294' stroke-width='.7'/></g>`;}catch{}
  }
  for(const [i,m] of project.modules.entries()){
    const ts=project.tools.filter(t=>t.moduleId===m.id),sel=ts.some(t=>isToolSelected(t.id))||(!bulkSelection.size&&selectedModule===m.id),isBad=bad.has(m.id)||ts.some(t=>bad.has(t.id));
    html+=`<g class="module" data-module="${esc(m.id)}" data-module-selected="${sel}" tabindex="0" role="button" aria-label="${esc(m.name)}${m.locked?' — '+tr('zamčený'):''}">${m.cells?`<path class="module-footprint" d="${paths(moduleOutline(m,project.grid,{inset:.25}))}" fill="${sel?'#fcf0d7':palette[i%palette.length]+'20'}" stroke="${isBad?'#cb7d60':sel?'#dab06b':'#becdac'}" stroke-width="${sel?1.4:.8}" filter="url(#softshadow)"/>`:`<rect x="${m.x+.9}" y="${m.y+.9}" width="${m.width-1.8}" height="${m.height-1.8}" rx="3" fill="${sel?'#fcf0d7':palette[i%palette.length]+'20'}" stroke="${isBad?'#cb7d60':sel?'#dab06b':'#becdac'}" stroke-width="${sel?1.4:.8}" filter="url(#softshadow)"/>`}`;
    if(!ts.length)html+=`<rect x="${m.x+5}" y="${m.y+5}" width="${m.width-10}" height="${m.height-10}" fill="url(#empty-hatch)" rx="2"/><text x="${m.x+m.width/2}" y="${m.y+m.height/2}" fill="#a2af92" text-anchor="middle" font-size="8">${tr('PRÁZDNÝ MODUL')}</text>`;
    for(const t of ts){const b=bounds(t),toolSelected=isToolSelected(t.id);html+=`<path class="tool-outline ${toolSelected?'is-selected':''}" data-tool="${esc(t.id)}" data-tool-selected="${toolSelected}" tabindex="0" role="button" aria-label="${esc(t.name)}" aria-pressed="${toolSelected}" d="${paths(safePocket(t))}" fill="${toolSelected?'#e4b96c66':'#a8b99855'}" stroke="${isBad?'#bd775e':toolSelected?'#a16c16':'#90a67c'}" stroke-width="${toolSelected?1.3:.8}"/><path class="tool-body ${toolSelected?'is-selected':''}" data-tool="${esc(t.id)}" data-tool-selected="${toolSelected}" d="${paths(transformedPoints(t))}" fill="${toolSelected?'#e3a33a55':'#b7c6a377'}" stroke="${toolSelected?'#a16c16':'#99ac86'}" stroke-width="${toolSelected?0.85:0.55}"/>`;
      // Small etched centre detail reinforces the contour without changing the manufacturing outline.
      if(b.height>80&&b.width<65)html+=`<path d="M${b.x+b.width/2} ${b.y+b.height*.58}v${b.height*.24}" stroke="${toolSelected?'#bd8c3c':'#a9b896'}" stroke-width="1.1" stroke-linecap="round" opacity=".55" pointer-events="none"/>`;
    }
    if(showLabels){const frame=moduleLabelFrame(m),own=ts.find(t=>t.unit)?.unit||m.unit,label=(ts[0]?.name||m.name)+(own?` · ${own}`:''),max=Math.max(1,Math.floor((frame.width-16)/3.7));html+=`<rect x="${frame.x+6}" y="${frame.y+frame.height-15}" width="${Math.max(0,Math.min(frame.width-12,label.length*3.7+10))}" height="10" rx="2" fill="${sel?'#fff6e6':'#f3f6ee'}" opacity=".88"/><text x="${frame.x+10}" y="${frame.y+frame.height-7.5}" fill="${sel?'#ab8547':'#8c9b7a'}" font-size="6.3">${esc(label.length>max?label.slice(0,max-1)+'…':label)}</text>`;}
    if(m.locked){const right=m.cells?(Math.max(...m.cells.filter(cell=>cell.y===0).map(cell=>cell.x))+1)*project.grid:m.width;html+=`<g transform="translate(${m.x+right-13} ${m.y+5}) scale(.33)" color="#8b9b78">${icon('lock')}</g>`;}
    html+='</g>';
  }
  if(!project.modules.length&&showGrid)html+=`<text x="${project.width/2}" y="${project.height-14}" text-anchor="middle" font-size="7" fill="#b2bca5">${tr('{cols} × {rows} polí · {grid}',{cols:Math.floor(project.width/project.grid),rows:Math.floor(project.height/project.grid),grid:fmtLen(project.grid)})}</text>`;
  else if(project.modules.length&&showLabels){const unusedY=Math.max(...project.modules.map(m=>m.y+m.height));if(project.height-unusedY>36)html+=`<text x="${project.width/2}" y="${unusedY+(project.height-unusedY)/2}" text-anchor="middle" font-size="8" fill="#b0bca1" letter-spacing=".8">${tr('PROSTOR PRO DALŠÍ NÁPADY')}</text>`;}
  if(project.sizeLabels){const plan=cachedLabels();if(!plan)ensureLabels();for(const label of plan?.labels||[])html+=`<g class="model-size-label" data-tool-label="${esc(label.toolId)}" aria-label="${esc(label.text)}" pointer-events="none">${label.screenPolygons.map(poly=>`<path d="${paths(poly)}" fill="#4c613c"/>`).join('')}</g>`;}
  html+=resizeHandles(svg,w,h);
  svg.innerHTML=html;
  if(!viewControls)viewControls=createViewControls2D(svg,{getCamera:()=>({zoom,panX:pan2D.x,panY:pan2D.y}),setCamera:value=>{zoom=value.zoom;pan2D={x:value.panX,y:value.panY};},getFrame:()=>({width:w/zoom,height:h/zoom}),render:renderCameraFrame});
}
/** Edge/corner resize handles for the selected module, sized in screen pixels (≥ 24 px hit area on touch). */
function resizeHandles(svg,w,h){
  const m=drag?null:project.modules.find(x=>x.id===(resizeDrag?.id||moduleFor()?.id));if(!m)return '';
  const rect=svg.getBoundingClientRect?.()||{},px=rect.width>0&&rect.height>0?Math.max(w/zoom/rect.width,h/zoom/rect.height):.5;
  const coarse=!!window.matchMedia?.('(pointer:coarse)')?.matches,hit=(coarse?28:14)*px,grip=(coarse?5:3.5)*px,len=Math.min(16*px,m.width*.4,m.height*.4);
  const L=m.x,T=m.y,R=m.x+m.width,B=m.y+m.height,locked=!!m.locked,title=esc(locked?tr(LOCKED_RESIZE):tr('Táhněte pro změnu velikosti (Alt+Shift+šipky)'));
  const one=(dir,hx,hy,hw,hh,gx,gy,gw,gh)=>`<g class="resize-handle resize-${dir}${locked?' disabled':''}" data-resize-of="${esc(m.id)}"${locked?' aria-disabled="true"':` data-resize="${dir}"`}><title>${title}</title><rect class="resize-hit" x="${hx}" y="${hy}" width="${Math.max(0,hw)}" height="${Math.max(0,hh)}"/><rect class="resize-grip" x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="${grip/2}"/></g>`;
  let out=`<g class="resize-handles${locked?' locked':''}">`;
  out+=one('w',L-hit/2,T+hit/2,hit,m.height-hit,L-grip/2,T+m.height/2-len/2,grip,len);
  out+=one('n',L+hit/2,T-hit/2,m.width-hit,hit,L+m.width/2-len/2,T-grip/2,len,grip);
  out+=one('e',R-hit/2,T+hit/2,hit,m.height-hit,R-grip/2,T+m.height/2-len/2,grip,len);
  out+=one('s',L+hit/2,B-hit/2,m.width-hit,hit,L+m.width/2-len/2,B-grip/2,len,grip);
  out+=one('se',R-hit/2,B-hit/2,hit,hit,R-grip*1.2,B-grip*1.2,grip*2.4,grip*2.4);
  out+='</g>';
  if(resizeDrag?.id===m.id){
    const text=resizeDrag.label||'',fs=11*px,tw=Math.max(40*px,text.length*fs*.56+12*px),th=fs*1.8,lx=Math.max(0,Math.min(project.width-tw,L+m.width/2-tw/2)),ly=T>th+4*px?T-th-4*px:B+4*px;
    out+=`<g class="resize-label${resizeDrag.limited?' limited':''}" aria-live="polite"><rect x="${lx}" y="${ly}" width="${tw}" height="${th}" rx="${th/3}"/><text x="${lx+tw/2}" y="${ly+th*.66}" text-anchor="middle" font-size="${fs}">${esc(text)}</text></g>`;
  }
  return out;
}
function previewNotice(svg,text,busy=false){
  let notice=svg.parentElement?.querySelector('[data-preview-state]');
  if(!notice){notice=document.createElement('div');notice.dataset.previewState='';notice.className='preview-state';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');svg.parentElement?.append(notice);}
  notice.hidden=!text;notice.setAttribute('aria-busy',String(busy));notice.textContent=text;
}
function applyPreviewFrame(svg,result,signature,viewport){
  const aspect=viewport.width/viewport.height,fit=result.frame.fitSize;
  const width=fit*Math.max(1,aspect)/camera3D.zoom,height=fit*Math.max(1,1/aspect)/camera3D.zoom;
  svg.setAttribute('viewBox',[(camera3D.panX||0)-width/2,(camera3D.panY||0)-height/2,width,height].join(' '));
  if(svg.dataset.previewSignature!==signature){svg.innerHTML=result.html;svg.dataset.previewSignature=signature;}
  cameraFrame={...result.frame,width,height,zoom:camera3D.zoom};
  const font=height/70,hudY=(camera3D.panY||0)+height/2-font;
  svg.querySelectorAll('[data-preview-hud],[data-preview-warning]').forEach(text=>{text.setAttribute('x',camera3D.panX||0);text.setAttribute('y',text.hasAttribute('data-preview-warning')?hudY-font*1.5:hudY);text.setAttribute('font-size',font);});
  previewNotice(svg,(result.warnings||[]).join(' '));
}
function render3D(svg){
  if(fileBusy||exportSession){previewNotice(svg,tr('Náhled obnovím po dokončení výpočtu.'));return;}
  const rect=svg.getBoundingClientRect(),viewport={width:rect.width||svg.clientWidth||1000,height:rect.height||svg.clientHeight||600};
  const source=same(project),geometrySource=previewGeometryKey(project),signature=JSON.stringify([source,camera3D.yaw,camera3D.pitch,bulkSelection.size?null:selected,bulkSelection.size?null:selectedModule,[...bulkSelection],getLang()]);
  const sequence=++previewSequence;
  if(previewValue&&signature===previewSignature){applyPreviewFrame(svg,previewValue,signature,viewport);return;}
  if(previewSource!==geometrySource){previewClient.cancel();previewSource=geometrySource;}
  previewNotice(svg,tr('Připravuji 3D náhled…'),true);
  previewClient.run('preview',project,{...backgroundOptions(),queueLatest:true,selected:bulkSelection.size?null:selected,selectedModule:bulkSelection.size?null:selectedModule,camera:camera3D,viewport,selectedToolIds:[...bulkSelection]}).then(result=>{
    if(sequence!==previewSequence||view!=='3d'||!svg.isConnected||same(project)!==source)return;
    previewValue=result;previewSignature=signature;applyPreviewFrame(svg,result,signature,viewport);
  }).catch(error=>{if(error.name!=='AbortError'&&sequence===previewSequence&&svg.isConnected)previewNotice(svg,errorText(error));});
}
function renderCameraFrame(){
  const svg=$('#board-svg');if(!svg)return;if(view==='3d')render3D(svg);else{
    const pad=34,w=project.width+pad*2,h=project.height+pad*2;
    svg.setAttribute('viewBox',`${-pad+(w-w/zoom)/2+pan2D.x} ${-pad+(h-h/zoom)/2+pan2D.y} ${w/zoom} ${h/zoom}`);
  }
  if(view==='2d'){
    // Keep resize handles usable in screen pixels without rebuilding any tool paths.
    const w=project.width+68,h=project.height+68;
    svg.querySelector('.resize-handles')?.remove();
    const handles=document.createElementNS('http://www.w3.org/2000/svg','g');handles.innerHTML=resizeHandles(svg,w,h);
    while(handles.firstChild)svg.append(handles.firstChild);
  }
  const label=$('[data-zoom-value]');if(label)label.textContent=Math.round((view==='3d'?camera3D.zoom:zoom)*100)+' %';
}

function switchProject(p){labelJob=null;analysisClient.cancel();previewClient.cancel();fileClient.cancel();previewSequence++;persist();project=clone(p);selected=project.tools[0]?.id||null;selectedModule=null;inspectorTab='drawer';undoStack=[];redoStack=[];bulkSelection.clear();zoom=1;pan2D={x:0,y:0};camera3D=createCamera3D();persist();closeModal();render();}
function addTools(tools,opts={}){
  if(project.tools.length+tools.length>300)throw i18nError('V jednom projektu může být nejvýše 300 nástrojů. Založte další projekt.');
  if(project.insertHeight-project.base<.5)throw i18nError('Výška inzertu musí být alespoň o {gap} větší než tloušťka dna.',{gap:fmtLen(.5)});
  const prepared=tools.map(t=>{
    const item=validateProject({...blankProject(),tools:[{...t,id:uid(),depth:Math.min(t.depth||12,project.insertHeight-project.base),locked:false,moduleId:null}]}).tools[0];
    if(!Object.prototype.hasOwnProperty.call(t,'fingerGrips'))item.fingerGrips=fittingFingerGrips(item,{radius:9});
    pocketOutline(item,project.clearance);return item;
  });
  // opts.group={name,unit}: the whole set as ONE module (finger grips are already on the tools, so the packing includes them).
  if(opts.layout&&prepared.length>1){
    const info={name:opts.name||tr('Sada z fotky')},plan=photoLayout(project,prepared,opts.layout,info);
    if(plan.layout==='shared')return addToolSet(prepared,{...info,arrangement:plan.arrangement});
  }
  if(opts.group&&prepared.length)return addToolSet(prepared,opts.group);
  if(opts.set&&prepared.length>1)return addToolSet(prepared,opts.set,opts.set.layout||'auto');
  if(opts.collections?.length)return addToolCollections(prepared,opts);
  let unplaced=0;
  commit(()=>{for(const item of prepared){project.tools.push(item);rememberTool(item);}writeLocal(libraryKey,library);selected=project.tools.at(-1)?.id;inspectorTab='tool';const added=new Set(prepared.map(x=>x.id));unplaced=arrange(false).unplaced.filter(id=>added.has(id)).length;if(opts.set&&prepared.length>1)registerToolSet(prepared.map(x=>x.id),opts.set.name,opts.set.layout||'auto');});
  // One toast for the whole addition (e.g. a catalogue tool set), including tools that did not fit.
  toast(plural(tools.length,['Přidán {n} nástroj. Kontura je také v knihovně.','Přidány {n} nástroje. Kontury jsou také v knihovně.','Přidáno {n} nástrojů. Kontury jsou také v knihovně.'])+(unplaced?' '+plural(unplaced,['{n} nástroj se nevešel. Zkontrolujte rozměry šuplíku nebo odemkněte moduly.','{n} nástroje se nevešly. Zkontrolujte rozměry šuplíku nebo odemkněte moduly.','{n} nástrojů se nevešlo. Zkontrolujte rozměry šuplíku nebo odemkněte moduly.']):''));
  if(unplaced&&opts.offerFit)offerFit(new Set(prepared.map(x=>x.id)),{name:opts.name});
}
// A catalogue set also becomes an editable project.toolSets entry ("Sady nástrojů"); call inside a commit. Skipped when the tools already form a set.
function registerToolSet(ids,name,layout){
  const sets=project.toolSets??[];if(sets.some(s=>ids.some(id=>s.toolIds.includes(id))))return;
  project.toolSets=[...sets,{id:'set-'+uid(),name:String(name||tr('Sada nástrojů')).slice(0,100),toolIds:[...ids],layout}];
}
// A catalogue set as ONE module (packed by set-module.js). One commit = one undo step.
function addToolSet(prepared,{name,unit:u,arrangement,order}={},layout='shared'){
  const groupOpts={...(arrangement?{arrangement}:{}),...(order?{order}:{}),name:name||tr('Sada nástrojů'),...(UNITS.includes(u)?{unit:u}:{}),...(prepared.length>1?{toolSet:{name:name||tr('Sada nástrojů'),layout}}:{})};
  const result=addToolGroup(project,prepared,groupOpts);
  orderAddedTools(result.project,prepared);
  commit(()=>{project=result.project;cacheAddedTools(prepared);selected=null;selectedModule=result.moduleId;inspectorTab='tool';});
  if(result.placed)toast(layout==='shared'?tr('Sada přidána jako jeden modul.'):plural(prepared.length,['Přidán {n} nástroj. Kontura je také v knihovně.','Přidány {n} nástroje. Kontury jsou také v knihovně.','Přidáno {n} nástrojů. Kontury jsou také v knihovně.']));
  else offerFit(new Set(prepared.map(x=>x.id)),{name,group:layout==='shared'});
}
function orderAddedTools(p,tools){
  const own=new Set(tools.map(t=>t.id)),byId=new Map(p.tools.map(t=>[t.id,t]));
  p.tools=[...p.tools.filter(t=>!own.has(t.id)),...tools.map(t=>byId.get(t.id))];
}
function cacheAddedTools(tools){
  for(const item of tools)rememberTool(item);
  writeLocal(libraryKey,library);
}
// Catalogue bulk addition: keep each set's layout and commit the whole selection atomically.
function addToolCollections(prepared,{collections,offerFit:showFit,name}={}){
  const covered=new Set(),groups=[];
  for(const group of collections){
    const {start,count,layout}=group;
    if(!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<2||start+count>prepared.length||!['shared','uniform','auto'].includes(layout))throw Error('Invalid catalogue collection.');
    for(let i=start;i<start+count;i++){if(covered.has(i))throw Error('Overlapping catalogue collections.');covered.add(i);}
    groups.push(group);
  }
  // Build the whole selection atomically.
  const build=base=>{
    let next=base;
    next.tools.push(...clone(prepared.filter((_,i)=>!covered.has(i))));
    if(covered.size<prepared.length){const arranged=autoArrange(next);next={...next,tools:arranged.tools,modules:arranged.modules};}
    for(const group of groups.sort((a,b)=>a.start-b.start)){
      next=addToolGroup(next,prepared.slice(group.start,group.start+group.count),{name:group.name,...(group.arrangement?{arrangement:group.arrangement}:{}),...(group.order?{order:group.order}:{}),...(UNITS.includes(group.unit)?{unit:group.unit}:{}),toolSet:{name:group.name,layout:group.layout}}).project;
    }
    orderAddedTools(next,prepared);return next;
  };
  const next=build(clone(project));
  const added=new Set(prepared.map(t=>t.id)),placed=placedTools(next),missing=prepared.filter(t=>!placed.has(t.id)).length;
  commit(()=>{project=next;cacheAddedTools(prepared);selected=prepared.at(-1)?.id||null;selectedModule=null;inspectorTab='tool';});
  toast(plural(prepared.length,['Přidán {n} nástroj. Kontura je také v knihovně.','Přidány {n} nástroje. Kontury jsou také v knihovně.','Přidáno {n} nástrojů. Kontury jsou také v knihovně.']));
  if(missing&&showFit)offerFit(added,{name});
}
// Smallest drawer (in grid steps, at most 3000 mm) in which the tools `ids` get placed; modules already placed stay where they are.
// The drawer and occupied module footprints are the only placement limits. null = impossible.
function fitPlan(base,ids){
  const inside=(p,m)=>m.x>=-.001&&m.y>=-.001&&m.x+m.width<=p.width+.001&&m.y+m.height<=p.height+.001;
  const allIn=p=>{const ok=new Set(p.modules.filter(m=>inside(p,m)).map(m=>m.id));return p.tools.every(t=>!ids.has(t.id)||ok.has(t.moduleId));};
  const own=new Set(base.tools.filter(t=>ids.has(t.id)).map(t=>t.moduleId));
  const arrangeIn=(width,height,src=base)=>{
    const trial={...clone(src),width,height},locks=new Map(trial.modules.map(m=>[m.id,m.locked]));
    for(const m of trial.modules)if(!own.has(m.id)&&inside(src,m))m.locked=true;
    const r=autoArrange(trial),out={...trial,tools:r.tools,modules:r.modules.map(m=>locks.has(m.id)?{...m,locked:locks.get(m.id)}:m)};
    return allIn(out)?out:null;
  };
  const alone={...base,tools:base.tools.filter(t=>ids.has(t.id)),modules:base.modules.filter(m=>own.has(m.id))};
  const W=base.width,H=base.height,g=Math.max(1,base.grid||42);
  const same=arrangeIn(W,H);if(same)return{project:same};
  // One group module: put it next to the drawer on its shorter side (always free).
  const single=alone.modules.length===1&&alone.modules[0].grouped;
  // Several modules: binary search on a common growth factor (few autoArrange runs), then trim each side back in grid steps.
  if(!single){
    const dims=k=>[Math.min(3000,Math.ceil(W*k/g-1e-9)*g),Math.min(3000,Math.ceil(H*k/g-1e-9)*g)];
    let lo=1,hi=3000/Math.min(W,H),best=null;
    const top=arrangeIn(...dims(hi));if(!top)return null;best={out:top,d:dims(hi)};
    for(let n=0;n<8;n++){const mid=(lo+hi)/2,d=dims(mid),out=arrangeIn(...d);if(out){hi=mid;best={out,d};}else lo=mid;}
    for(const axis of [0,1])for(let step=0;step<6&&best.d[axis]-g>=(axis?H:W);step++){const d=[...best.d];d[axis]-=g;const out=arrangeIn(...d);if(!out)break;best={out,d};}
    return{project:best.out};
  }
  if(single){
    const m=alone.modules[0],right={w:W+m.width,h:Math.max(H,m.height),x:W,y:0},below={w:Math.max(W,m.width),h:H+m.height,x:0,y:H},c=right.w*right.h<=below.w*below.h?right:below;
    if(c.w>3000||c.h>3000)return null;
    const out={...clone(base),width:c.w,height:c.h},dx=c.x-m.x,dy=c.y-m.y;
    for(const mod of out.modules)if(mod.id===m.id){mod.x=c.x;mod.y=c.y;}
    for(const t of out.tools)if(t.moduleId===m.id){t.x+=dx;t.y+=dy;}
    return{project:out};
  }
  return null;
}
// Editor decisions depend only on available drawer space.
function offerFit(ids,opts={}){offerDrawerFit(ids,opts);}
// The drawer itself is too small: enlarge it, use a new drawer or keep the tools outside.
function offerDrawerFit(ids,{name,group}={}){
  const base=clone(project),stamp=JSON.stringify(base),title=String(name||tr('Nástroje z katalogu')).slice(0,100);
  const missing=base.tools.filter(t=>ids.has(t.id)&&!base.modules.some(m=>m.id===t.moduleId&&m.x>=-.001&&m.y>=-.001&&m.x+m.width<=base.width+.001&&m.y+m.height<=base.height+.001)).length;
  if(!missing)return;
  const grow=fitPlan(base,ids);
  const fresh=(()=>{const tools=clone(base.tools.filter(t=>ids.has(t.id))),keep=new Set(tools.map(t=>t.moduleId)),modules=clone(base.modules.filter(m=>keep.has(m.id)));for(const t of tools)if(!modules.some(m=>m.id===t.moduleId)){t.moduleId=null;t.x=0;t.y=0;}return{...clone(base),id:uid(),name:title,tools,modules,...(Array.isArray(base.toolSets)?{toolSets:base.toolSets.map(s=>({...s,toolIds:s.toolIds.filter(id=>ids.has(id))})).filter(s=>s.toolIds.length)}:{})};})();
  const fresh2=fitPlan(fresh,ids);
  const groupModule=group?base.modules.find(m=>base.tools.some(t=>ids.has(t.id)&&t.moduleId===m.id)):null;
  const size=p=>fmtSize(p.width,p.height);
  const intro=groupModule?tr('Modul sady „{name}“ ({size}) se do šuplíku {drawer} nevešel.',{name:title,size:size(groupModule),drawer:size(base)}):plural(missing,['{n} nástroj se do šuplíku {drawer} nevešel.','{n} nástroje se do šuplíku {drawer} nevešly.','{n} nástrojů se do šuplíku {drawer} nevešlo.'],{drawer:size(base)});
  const option=(key,label,desc,primary,disabled)=>`<button type="button" class="fit-option ${primary?'primary':''}" data-fit="${key}" ${disabled?'disabled':''}><strong>${esc(label)}</strong><small>${esc(desc)}</small></button>`;
  const m=openModal({title:tr('Sada se do šuplíku nevešla'),subtitle:tr('Vyberte, co s nástroji, které nemají místo.'),body:`<p class="help-intro">${esc(intro)}</p><div class="fit-options">`
    +option('grow',tr('Zvětšit šuplík'),grow?tr('Nový rozměr šuplíku: {size}. Jeden krok zpět vrátí celé přidání.',{size:size(grow.project)}):tr('Šuplík by musel být větší než {max}.',{max:fmtLen(3000)}),true,!grow)
    +option('new',tr('Přidat do nového šuplíku'),fresh2?tr('Nový šuplík „{name}“ ({size}); tento šuplík zůstane beze změny.',{name:title,size:size(fresh2.project)}):tr('Šuplík by musel být větší než {max}.',{max:fmtLen(3000)}),false,!fresh2)
    +option('keep',tr('Ponechat mimo šuplík'),tr('Nástroje zůstanou v projektu bez místa; umístíte je později.'),false,false)+`</div>`,footer:''});
  m.el.querySelector(grow?'[data-fit="grow"]':'[data-fit="keep"]')?.focus();
  m.el.addEventListener('click',e=>{
    const choice=e.target.closest('[data-fit]')?.dataset.fit;if(!choice)return;
    if(choice==='keep'){m.close();toast(tr('Nástroje zůstaly mimo šuplík. Umístíte je po zvětšení šuplíku nebo rozvržením.'));return;}
    if(JSON.stringify(project)!==stamp){m.close();toast(tr('Sestava se mezitím změnila. Zkuste to prosím znovu.'));return;}
    if(choice==='grow'&&grow){project=clone(grow.project);persist();render();m.close();toast(tr('Šuplík zvětšen na {size}.',{size:size(project)}));}
    if(choice==='new'&&fresh2){try{const next=validateProject(clone(fresh2.project));project=undoStack.pop()||project;persist();switchProject(next);toast(tr('Nástroje přidány do nového šuplíku „{name}“.',{name:next.name}));}catch(error){toast(errorText(error));}}
  });
}
function capture(){openCapture({onAdd:(tools,{layout}={})=>addTools(tools,{layout,offerFit:true,name:tr('Sada z fotky')}),toast,maxDepth:()=>project.insertHeight-project.base});}
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

// One library entry per outline: a known tool only gains the sets and the category it arrived with.
function rememberTool(item,{grips=true}={}){
  const found=library.find(l=>l.name===item.name&&same(l.points)===same(item.points)&&(!grips||same(l.fingerGrips)===same(item.fingerGrips)));
  if(!found){library.push({...clone(item),x:0,y:0,moduleId:null});return true;}
  for(const name of item.setNames||[])if(!found.setNames?.includes(name))found.setNames=[...(found.setNames||[]),name];
  if(item.category&&!found.category)found.category=item.category;
  return false;
}
function saveToLibrary(tools){let n=0;for(const x of tools)if(rememberTool(validateProject({...blankProject(),tools:[{...x,id:uid()}]}).tools[0],{grips:false}))n++;writeLocal(libraryKey,library);return n;}
const categoryName=c=>c[getLang()]||c.cs;
// A set is listed in one category, so moving a tool of a set moves the whole set. Returns the number of moved tools.
function moveToCategory(index,category){
  const tool=library[index],sets=tool.setNames||[],moved=library.filter(t=>t===tool||t.setNames?.some(name=>sets.includes(name)));
  for(const t of moved)t.category=category;
  writeLocal(libraryKey,library);return moved.length;
}
function libraryCard(t,i){const current=toolCategory(t);return`<div class="library-item"><span class="tool-thumb">${thumb(t)}</span><div><strong>${esc(t.name)}${unitBadge(t.unit)}</strong><p>${fmtSize(bounds(t).width,bounds(t).height,{unit:toolUnit(t)})}</p><select class="library-category" data-library-category="${i}" aria-label="${tr('Kategorie nástroje {name}',{name:esc(t.name)})}">${CATEGORIES.map(c=>`<option value="${c.id}" ${c.id===current?'selected':''}>${esc(categoryName(c))}</option>`).join('')}</select></div><button class="btn btn-light" data-library-add="${i}" aria-label="${tr('Přidat {name} do sestavy',{name:esc(t.name)})}">${icon('plus')}</button><button class="icon-btn" data-library-remove="${i}" aria-label="${tr('Odstranit {name} z knihovny',{name:esc(t.name)})}">${icon('trash')}</button></div>`;}
function openLibrary(){const mine=()=>({tools:library,card:libraryCard,empty:`<p class="empty-note">${tr('Vyfoťte první nástroj nebo vyberte obrys z Katalogu.')}</p>`,footer:`<span class="footnote">${tr('Knihovna je uložená v tomto prohlížeči.')}</span><button class="btn btn-primary" data-capture>${icon('camera')}${tr('Vyfotit nástroj')}</button>`});const m=openModal({title:tr('Vaše knihovna nástrojů'),subtitle:tr('Jednou načtený obrys můžete použít v každém dalším šuplíku.'),wide:true});const folders=mountLibraryFolders(m,{mine,onAdd:(tools,opts={})=>{addTools(tools,{...opts,offerFit:true,name:opts.set?.name||opts.group?.name});m.close();},onSave:saveToLibrary});m.el.onclick=e=>{const add=e.target.closest('[data-library-add]'),remove=e.target.closest('[data-library-remove]');if(add){try{addTools([clone(library[Number(add.dataset.libraryAdd)])]);m.close();}catch(error){toast(errorText(error));}}if(remove){library.splice(Number(remove.dataset.libraryRemove),1);writeLocal(libraryKey,library);folders.refresh();}if(e.target.closest('[data-capture]'))capture();};m.el.onchange=e=>{const select=e.target.closest('[data-library-category]');if(!select)return;const index=select.dataset.libraryCategory,category=select.value,moved=moveToCategory(Number(index),category),name=categoryName(CATEGORIES.find(c=>c.id===category));folders.refresh();m.el.querySelector(`[data-library-category="${index}"]`)?.focus();toast(tr(moved>1?'Sada přesunuta do kategorie {name}.':'Nástroj přesunut do kategorie {name}.',{name}));};}
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
  openModal({title:tr('Z fotky do šuplíku'),subtitle:tr('Čtyři kroky. Žádný CAD. Vše přímo ve vašem zařízení.'),wide:true,body:`<div class="help-grid">${card(tr('01 / Vyfoťte nástroj'),tr('Položte nástroje na bílou A4, odděleně od sebe. Celý papír musí být vidět. Fotografujte co nejvíc kolmo a v rozptýleném světle bez tvrdého stínu. Můžete použít i pravítko.'))}${card(tr('02 / Obrys připravíme automaticky'),tr('Aplikace najde A4 a narovná perspektivu. Lokální rozpoznávání oddělí předměty od pozadí a zpřesní obrys podle skutečných hran. Kontrast, odstranění šumu a vyhlazení zvolí samo. U pravítka označíte jen dvě známé značky pro měřítko.'))}${card(tr('03 / Rozvrhněte sestavu'),tr('Zadejte vnitřní rozměr šuplíku. Rozložit nástroje nejprve připraví základní rozložení a potom porovná chytré varianty v rastru. Je to praktická heuristika, nemusí najít nejúspornější možné řešení. Vytištěné moduly zamkněte a přidávejte další kolem nich.'))}${card(tr('04 / Exportujte a vyrobte'),tr('Zvolte úspornou otevřenou konstrukci nebo plný blok. Dno může být hladké, s patkami Gridfinity, kapsami pro magnety nebo připravené k lepení. Nejdřív přiložte nástroj na PDF v měřítku 1:1 nebo vytiskněte tenkou zkoušku vůle. SVG/DXF slouží pro pěnu či CNC.'))}</div><h3 style="margin-top:27px">${tr('Alternativy, ze kterých vychází návrh')}</h3><p class="help-intro">${tr('Průzkum vlastností na oficiálních webech. Vlastní implementace; kód těchto aplikací se nepřebírá.')}</p><div class="help-grid">${ref('Outline App','https://github.com/georgslazdans/outline-app',tr('Open source editor kontur'),tr('Inspirace: kalibrace fotografie a převod obrysů do výrobních rozměrů.'))}${ref('Tracefinity','https://github.com/tracefinity/tracefinity',tr('Vlastní hostování a knihovna'),tr('Inspirace: opakované použití nástrojů a projekty sestav.'))}${ref('Binforge','https://binforge.app/',tr('Plánování modulů v šuplíku'),tr('Inspirace: jednoduchá práce s rozměry, rastr a samostatné exporty.'))}${ref('TracetoForge','https://tracetoforge.com/',tr('Fotografie → vlastní vložka'),tr('Inspirace: kontrola měřítka, vůle a rozložení více nástrojů.'))}</div><div class="tip" style="margin-top:20px">${icon('shield')} ${tr('Fotografie se nikam neodesílají. Detekce kombinuje lokální model U²-Net a hrany v původní fotce. Pokud snímek nedává dost jistoty, vyžádá novou fotku. U zcela neviditelné hrany nelze skutečný tvar spolehlivě dopočítat.')}</div><p class="muted-note" style="margin-top:15px">${tr('Jednotky: rozměry lze zadávat v mm i palcích (např. 12 in, 3 1/2" nebo 30 cm). Výchozí jednotky přepnete v horní liště, vlastní jednotky šuplíku v Rozměrech šuplíku. Exportované soubory jsou vždy v milimetrech.')}</p><p class="muted-note" style="margin-top:15px">${tr('Na mobilu: přidejte stránku na plochu přes nabídku prohlížeče. Po prvním načtení může editor díky uloženým souborům pracovat i offline. Projekty mezi zařízeními přenesete přes JSON.')}</p>`,footer:`<span class="footnote">${tr('InsertCreator 1.2 · vlastní editor bez účtu a předplatného.')}</span><button class="btn btn-dark" data-modal-close-extra>${tr('Rozumím, jdeme tvořit')}</button>`}).el.querySelector('[data-modal-close-extra]').onclick=closeModal;
}

const bottomNames=()=>({plain:tr('Hladké dno'),grid:tr('Gridfinity · patky 42 mm'),magnet:tr('Magnety'),adhesive:tr('Lepidlo / oboustranná páska')});
const volumeText=cm3=>unit()==='in'?`${fmt(cm3/16.387064,2)} in³`:`${fmt(cm3)} cm³`;
// Splitting for a printer is an explicit export action. Ordinary editing never consults the bed.
// Colour printing settings of the export dialog. Filament numbers match the parts in the slicer.
function colorPrintPanel(){
  const config=materialConfig(project),{zones}=materialSlots({...config,text:config.text&&!!project.sizeLabels}),zone=(key,label,field,toggle)=>`<div class="color-zone">${toggle?`<input type="checkbox" data-zone-on="${key}" aria-label="${tr(label)}" ${config[key]?'checked':''}>`:'<span></span>'}<input type="color" data-zone-color="${field}" value="${config[field]}" aria-label="${tr('Barva: {name}',{name:tr(label)})}"><span>${tr(label)}</span><small>${zones[key]?tr('Filament {n}',{n:zones[key]}):tr('Stejně jako tělo')}</small></div>`;
  return`<section class="color-print"><label class="print-toggle"><input id="print-colors" type="checkbox" ${config.enabled?'checked':''}><span><strong>${tr('Vícebarevný tisk')}</strong><small>${tr('Tělo, dno kapes a text jako samostatné části pro více filamentů.')}</small></span></label>${config.enabled?`<div class="color-zones">${zone('body','Tělo','bodyColor',false)}${zone('floor','Dno kapes','floorColor',true)}${zone('text','Text','textColor',true)}</div>${config.floor?`<label class="field"><span>${tr('Tloušťka vložky dna (mm)')}</span><input id="print-floor-thickness" inputmode="decimal" value="${inputValue(config.floorThickness,{unit:'mm',digits:2})}"></label>`:''}${config.text&&!project.sizeLabels?`<p class="muted-note">${tr('Text se vytiskne jen se zapnutými popisky velikostí.')}</p>`:''}<p class="muted-note">${tr('Stáhne se 3MF s částmi a čísly filamentů. Barvy ve sliceru nastavte podle čísel. Pro ostatní slicery jsou ve složce barvy samostatné STL.')}</p>`:''}</section>`;
}
function splitModuleForExport(moduleId){
  return exportPrintBatch([moduleId]);
}
let exportFormat='stl',exportScope='all';
let exportModuleChoice={projectId:null,all:true,ids:new Set()};
function exportModuleIds(){
  if(exportModuleChoice.projectId!==project.id)exportModuleChoice={projectId:project.id,all:true,ids:new Set()};
  const existing=new Set(project.modules.map(module=>module.id));
  exportModuleChoice.ids=exportModuleChoice.all?existing:new Set([...exportModuleChoice.ids].filter(id=>existing.has(id)));
  return exportModuleChoice.ids;
}
const fitsExportBed=m=>(m.width-.5<=project.bedWidth&&m.height-.5<=project.bedHeight)||(m.height-.5<=project.bedWidth&&m.width-.5<=project.bedHeight);
function exportModulePicker(){
  const ids=exportModuleIds();
  return `<section class='export-module-picker' aria-label='${tr('Moduly pro tisk')}'><div class='export-module-controls'><strong>${tr('Vybráno {n} z {total}',{n:ids.size,total:project.modules.length})}</strong><button type='button' class='btn btn-light' data-export-select='all'>${tr('Označit vše')}</button><button type='button' class='btn btn-light' data-export-select='none'>${tr('Zrušit označení')}</button></div><div class='export-module-list'>${project.modules.map(module=>`<label class='export-module-row'><input type='checkbox' data-export-module='${esc(module.id)}' ${ids.has(module.id)?'checked':''}><span><strong>${esc(module.name)}</strong><small>${fmtSize(module.width-.5,module.height-.5)} · ${tr(fitsExportBed(module)?'Vejde se na podložku':'Model se rozřeže na tiskové díly')}</small></span></label>`).join('')||`<p>${tr('Zatím žádné moduly.')}</p>`}</div><p class='muted-note'>${tr('Řeže se pouze 3D model. Moduly, nástroje ani jejich poloha v šuplíku se nemění.')}</p></section>`;
}
async function runFileTask(operation,snapshot,options,title,delivery,success=''){
  analysisClient.cancel();previewClient.cancel();previewSequence++;fileBusy=true;const jobId=++fileJobId,key=same(project),controller=new AbortController();let finished=false;
  const release=()=>{if(jobId!==fileJobId)return;fileBusy=false;if(view==='3d')setTimeout(()=>renderBoard(),0);else ensureLabels();};
  const modal=openModal({title,body:'<progress data-print-batch-progress max="1" value="0"></progress><p data-print-batch-status data-baseplate-progress role="status" aria-live="polite">'+tr('Připravuji…')+'</p>',footer:'<button class="btn btn-light" data-print-batch-cancel data-baseplate-cancel>'+tr('Zrušit')+'</button>',onClose:()=>{if(!finished)controller.abort();release();}});
  modal.el.querySelector('[data-print-batch-cancel]').onclick=modal.close;
  try{
    await paintOpportunity();if(controller.signal.aborted||!modal.el.isConnected)return null;
    const result=await fileClient.run(operation,snapshot,{...backgroundOptions(),...options,signal:controller.signal,onProgress:event=>{
      if(!modal.el.isConnected||controller.signal.aborted)return;
      modal.el.querySelector('[data-print-batch-progress]').value=Math.max(0,Math.min(1,Number(event?.progress)||0));
      modal.el.querySelector('[data-print-batch-status]').textContent=event?.message?tr(event.message):tr('Připravuji…');
    }});
    if(controller.signal.aborted||!modal.el.isConnected)return null;
    if(same(project)!==key)throw i18nError('Sestava se mezitím změnila. Spusťte export znovu.');
    const file=delivery(result);download(file.name,file.data,file.type);finished=true;modal.close();if(success)toast(success);return result;
  }catch(error){
    if(controller.signal.aborted||!modal.el.isConnected)return null;
    finished=true;release();modal.body.innerHTML='<div class="issue-box" role="alert"><p>'+esc(errorText(error))+'</p></div>';
    modal.footer.innerHTML='<button class="btn btn-light" data-print-batch-close>'+tr('Zavřít')+'</button>';modal.el.querySelector('[data-print-batch-close]').onclick=modal.close;return null;
  }
}
function exportPrintBatch(ids){
  const snapshot=clone(project);
  return runFileTask('export',snapshot,{moduleIds:[...ids],package:true,bundle:true,readme:'InsertCreator\n\n'+tr('Tiskové díly sestavte podle assembly.json. Souřadnice jsou v mm. Dělení je pouze pro tisk; rozvržení šuplíku zůstává původní.'),jointNote:jointFitInstructions(snapshot.jointClearance??.2)},tr('Příprava tiskových dílů'),result=>({name:slug(snapshot.name)+'-tiskove-dily.zip',data:result.zip,type:'application/zip'}),tr('ZIP s tiskovými díly je připravený.'));
}
function exportGridfinityBaseplate(){
  const snapshot=clone(project);let plan;try{plan=planBaseplateTiles(snapshot);}catch(error){toast(errorText(error));return;}
  const readme='InsertCreator\n\n'+tr('Základna Gridfinity: díly sestavte podle assembly.json. Polohy buněk x/y a xMm/yMm popisují layout od levého horního rohu šuplíku. assemblyTransform umístí STL do fyzické sestavy s X doprava, Y nahoru a Z nahoru. STL jsou v mm; mezi díly nepřidávejte mezeru. Volný okraj šuplíku zůstává bez základny.')+(plan.rotated?'\n'+tr('Díly při tisku otočte o 90° podle podložky tiskárny.'):'');
  return runFileTask('baseplate',snapshot,{package:true,extraFiles:[{name:'README.txt',data:readme}]},tr('Základna Gridfinity'),result=>({name:slug(snapshot.name)+'-gridfinity-baseplate.zip',data:result.zip,type:'application/zip'}),tr('Základna Gridfinity exportována.'));
}

// Joints change the smallest module size, so switching them re-packs the drawer as one undoable step.
// A layout that would leave tools outside the drawer is not applied; joints then appear only where there is room.
async function setConnectors(on,modal,session,redraw){
  const snapshot=clone(project),key=same(project),status=modal.el.querySelector('[data-export-analysis]');clearTimeout(session.timer);session.connectorsBusy=true;session.done=false;analysisClient.cancel();
  status.setAttribute('aria-busy','true');status.textContent=tr('Připravuji spojky…');modal.el.querySelector('[data-do-export]').disabled=true;modal.el.querySelectorAll('[data-fit-pdf],[data-fit-stl],#export-joint-fit').forEach(button=>button.disabled=true);
  try{
    const result=await fileClient.run('connectors',snapshot,{...backgroundOptions(),enabled:on,signal:session.controller.signal});
    if(session.closed||!modal.el.isConnected||same(project)!==key)return;
    remember();project=result.project;persist();editorNeedsRefresh=true;redraw();
    toast(result.fits?(on?tr('Moduly jsme upravili, aby se spojky vešly mimo nástroje. Krok lze vrátit.'):tr('Moduly mají zase nejmenší možnou velikost. Krok lze vrátit.')):tr('Větší moduly by se do šuplíku nevešly, rozložení zůstává. Spojky vzniknou jen tam, kde je místo.'));
  }catch(error){if(error.name!=='AbortError'&&!session.closed){toast(errorText(error));redraw();}}
}

function jointFitInstructions(clearance){
  return tr('Vůle v XY: {side} na každé straně, zdířka je o {total} širší. Svislá vůle se tímto nastavením nemění.',{side:fmtLen(clearance,{unit:'mm',digits:2}),total:fmtLen(2*clearance,{unit:'mm',digits:2})})+' '+tr('Nejprve vytiskněte zkušební spojku stejným materiálem a nastavením jako finální díly. Pokud jde ztuha, vůli zvětšete; pokud je volná, zmenšete ji. Zkontrolujte také rozšíření první vrstvy. Díly spojujte nasazením shora.');
}
function exportJointFit(){
  const snapshot=clone(project),clearance=snapshot.jointClearance??.2;
  return runFileTask('joint-fit',snapshot,{package:true,extraFiles:[{name:'README.txt',data:'InsertCreator\n\n'+tr('Zkušební tisk spojky')+'\n'+jointFitInstructions(clearance)}]},tr('Zkušební tisk spojky'),result=>({name:'InsertCreator-joint-fit-'+result.clearance.toFixed(2).replace('.','-')+'.zip',data:result.zip,type:'application/zip'}));
}

// Plan the same printable parts as the ZIP so cut seams and bed margins agree with this summary.
function jointStatus(source,entries,summary=null,jointError=""){
  const unsupported=project.bottomMode==='grid';
  const toggle=`<label class="check-row"><input id="export-connectors" type="checkbox" ${project.connectors&&!unsupported?'checked':''} ${unsupported?'disabled':''}>${tr('Spojky mezi tiskovými díly (puzzle)')}</label>`;
  if(unsupported)return toggle+`<p class="muted-note">${tr('U Gridfinity se puzzle spojky nepřidávají, moduly drží základna. S magnety lze puzzle spojky kombinovat.')}</p>`;
  if(!project.connectors)return toggle;
  const clearance=source.jointClearance??.2;
  const settings=`<label class="field"><span>${tr('Boční vůle spoje v XY na každé straně')}</span><div class="input-wrap"><input id="export-joint-clearance" type="text" inputmode="decimal" value="${inputValue(clearance,{unit:'mm',digits:4})}" aria-describedby="joint-clearance-help"><em>mm</em></div></label><p class="muted-note" id="joint-clearance-help">${esc(tr('Výchozí hodnota je 0,20 mm na stranu. Povolený rozsah je 0–1 mm. Vhodná vůle závisí na tiskárně, materiálu a první vrstvě.'))} ${esc(tr('Aktuálně {side} na stranu = {total} navíc přes šířku zdířky.',{side:fmtLen(clearance,{unit:'mm',digits:4}),total:fmtLen(2*clearance,{unit:'mm',digits:4})}))}</p><button type="button" class="btn btn-light" id="export-joint-fit">${icon('cube')}${tr('Zkušební tisk spojky')}</button>`;
  return toggle+settings+'<p class="muted-note" data-joint-status>'+jointSummary(summary,jointError)+'</p>';
}
function jointSummary(plan,error=''){
  if(error)return esc(errorText(error));if(!plan)return '<span class="spinner"></span> '+tr('Připravuji spojky…');
  const n=plan.count??plan.joints?.length??0;
  const count=n?plural(n,['Vznikne {n} spojka.','Vzniknou {n} spojky.','Vznikne {n} spojek.']):tr('Vybrané moduly nemají společnou hranu s místem pro spojku.');
  const cuts=plan.cutCount?' '+tr('Z toho {n} spojek propojuje díly rozdělené podle podložky.',{n:plan.cutCount}):'';
  const skipped=plan.skipped?' '+plural(plan.skipped,['{n} spojka se nevešla: u hrany leží kapsa nástroje, nebo by díl přesáhl tiskovou plochu.','{n} spojky se nevešly: u hrany leží kapsa nástroje, nebo by díl přesáhl tiskovou plochu.','{n} spojek se nevešlo: u hrany leží kapsa nástroje, nebo by díl přesáhl tiskovou plochu.']):'';
  const unjoined=plan.unjoined?.length?' '+tr('Na {n} společných hranách není bezpečné místo pro spojku. Podrobnosti jsou v assembly.json.',{n:plan.unjoined.length}):'';
  return esc(count+cuts+skipped+unjoined)+' '+tr('Spojky jsou ve vrstvě dna. V sestaveném modelu je zkontrolujete pohledem zespodu.')+' '+tr('Skládejte zleva doprava a shora dolů, další modul vždy nasaďte shora. Moduly exportujte společně, aby výstupky a zdířky seděly. Se spojkami mají moduly větší okraj, ruční a zamčené moduly se nemění.');
}
const exportAnalysisCache=new Map();
function printSummary(stats){
  if(!stats)return '';
  return '<div class="print-summary"><strong>'+tr('{volume} modelu',{volume:volumeText(stats.volumeCm3)})+(stats.savingPercent>0?'<em>'+tr('−{n} % proti plnému bloku',{n:fmt(stats.savingPercent,0)})+'</em>':'')+'</strong><span>'+tr('Výška nejvyššího dílu {height} · dno {base}',{height:fmtLen(stats.heightMm),base:fmtLen(stats.effectiveBaseMm)})+'</span><small>'+tr('Objem geometrie. Skutečnou spotřebu a čas určí slicer podle výplně a nastavení.')+'</small>'+(stats.notes||[]).map(note=>'<small>'+esc(errorText(note))+'</small>').join('')+'</div>';
}
function exportIssues(issues,printError){return issues.length||printError?'<div class="issue-box">'+issues.slice(0,3).map(issue=>'<p>'+esc(errorText(issue))+'</p>').join('')+(printError?'<p>'+esc(printError)+'</p>':'')+'<button class="section-link" data-repack>'+tr('Přepočítat rozvržení')+'</button></div>':'';}

function openExport(){
  previewSequence++;previewClient.cancel();
  const m=moduleFor(),selectedId=m?.id||null;
  if(exportScope==='selected'&&!selectedId)exportScope='all';
  if(exportFormat==='stl'&&exportScope==='selected'&&selectedId){exportModuleIds();exportModuleChoice.all=false;exportModuleChoice.ids=new Set([selectedId]);}
  const chosen=exportModuleIds(),entries=exportFormat==='stl'?project.modules.filter(module=>chosen.has(module.id)):exportScope==='selected'?project.modules.filter(m=>m.id===selectedId):project.modules;
  const opts={moduleId:exportFormat!=='stl'&&exportScope==='selected'?selectedId:null};
  const exportProject=exportFormat==='stl'||exportScope==='selected'?{...project,modules:entries,tools:project.tools.filter(tool=>entries.some(module=>module.id===tool.moduleId))}:project;
  const cacheKey=JSON.stringify([{...exportProject,updatedAt:undefined},exportFormat,exportScope,getLang(),unit()]),cached=exportAnalysisCache.get(cacheKey);
  const issues=cached?.issues||[];
  const session={controller:new AbortController(),timer:null,done:!!cached,closed:false};exportSession=session;
  const formats={stl:['STL',tr('3D tisk')],svg:['SVG',tr('Pěna · laser')],dxf:['DXF','CAD · CNC'],json:['JSON',tr('Záloha projektu')]};
  let stats=cached?.stats||null,printError=cached?.printError||'',bedError='';
  if(exportFormat==='stl'&&entries.length){try{validatePrintBed({...project,limitToBed:true},entries);}catch(e){bedError=errorText(e);}}
  const bottoms=bottomNames(),mmNote=unit()!=='mm'?`<p class="muted-note">${tr('Exportované soubory jsou vždy v milimetrech, i když editor zobrazuje {unit}.',{unit:unit()})}</p>`:'';
  const modal=openModal({title:tr('Připraveno k výrobě'),subtitle:tr('Vyberte provedení. Každý modul se stáhne zvlášť v jednom ZIPu.'),body:`<p data-export-analysis role="status" aria-live="polite" aria-busy="${!cached&&exportFormat!=='json'}">${!cached&&exportFormat!=='json'?'<span class="spinner"></span> '+tr('Kontroluji tiskové díly na pozadí…'):''}</p><div class="format-grid">${Object.entries(formats).map(([key,[title,desc]])=>`<button class="format ${exportFormat===key?'active':''}" data-format="${key}"><strong>${title}</strong><span>${desc}</span></button>`).join('')}</div>${exportFormat==='stl'?exportModulePicker():''}${exportFormat!=='json'?`<label class="field"><span>${tr('Co exportovat')}</span><select id="export-scope">${exportFormat==='stl'&&exportScope==='custom'?`<option value="custom" selected>${tr('Označené moduly')}</option>`:''}<option value="all" ${exportScope==='all'?'selected':''}>${tr('Celou sestavu')}</option><option value="selected" ${exportScope==='selected'?'selected':''} ${selectedId?'':'disabled'}>${tr('Vybraný modul')}${m?' · '+esc(m.name):''}</option></select></label>`:''}${exportFormat==='stl'?`<label class="print-toggle"><input id="print-light" type="checkbox" ${project.printMode==='light'?'checked':''}><span><strong>${tr('Úsporný tisk')}</strong><small>${tr('Tenké dno a stěny kolem nástroje. Okolí zůstane otevřené.')}</small></span>${icon('spark')}</label><label class="field"><span>${tr('Dno a uchycení')}</span><select id="print-bottom">${Object.entries(bottoms).map(([key,label])=>`<option value="${key}" ${project.bottomMode===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted-note">${project.bottomMode==='grid'?tr('Patky pro podložku Gridfinity. Rastr a rozměry modulů musí být v násobcích 42 mm.'):project.bottomMode==='magnet'?tr('Čtyři kapsy zespodu pro magnety 6 × 2 mm. Strop nad magnetem se automaticky zesílí.'):project.bottomMode==='adhesive'?tr('Rovné spodní plochy pro lepidlo či tenkou oboustrannou pásku. Tloušťku pásky přičtěte k výšce sestavy.'):tr('Rovné dno pro volné položení do šuplíku.')}</p><div data-export-stats>${printSummary(stats)}</div><section class="export-printer"><h3>${tr('Tisková podložka')}</h3><div class="fields-row">${input(tr('Tisková plocha · šířka'),project.bedWidth,'bedWidth',{min:50,max:2000})}${input(tr('Tisková plocha · hloubka'),project.bedHeight,'bedHeight',{min:50,max:2000})}</div>${project.bottomMode==='magnet'?`<div class="fields-row">${input(tr('Průměr kapsy'),project.magnetDiameter,'magnetDiameter',{min:3,max:20})}${input(tr('Hloubka kapsy'),project.magnetDepth,'magnetDepth',{min:1,max:8})}</div>`:''}<p class="muted-note">${tr('Rozměry podložky se kontrolují pouze při exportu STL. Rozvržení šuplíku neovlivňují.')}</p></section><label class="check-row"><input id="export-size-labels" type="checkbox" ${project.sizeLabels?'checked':''}>${tr('Popisky velikostí v modelu')}</label><div data-export-labels>${labelStatus(entries,cached?.labels)}</div>${colorPrintPanel()}${jointStatus(exportProject,entries,cached?.joints,cached?.jointError)}${gridfinitySummary()}<div id="bed-warnings"></div>`:''}<div data-export-issues>${exportFormat!=='json'?exportIssues(issues,printError):''}</div>${exportFormat==='svg'||exportFormat==='dxf'?`<p class="muted-note">${tr('Černá / MODULES = obrys modulu, červená / POCKETS = kapsa včetně vůle. Všechny rozměry jsou v mm.')}</p>`:''}${exportFormat!=='json'?mmNote:''}${exportFormat==='json'?`<p class="muted-note">${tr('Uloží kontury, rozměry, provedení a polohy modulů. Na jiném zařízení otevřete JSON přes Moje šuplíky.')}</p>`:`<details class="advanced fit-check"><summary>${tr('Nejdřív ověřit velikost')}</summary><p>${tr('Přiložte nástroj na papír nebo zkuste tenký rámeček. Nemusíte hned tisknout celý inzert.')}</p><div class="test-actions"><button class="btn btn-light" data-fit-pdf ${issues.length||!entries.length?'disabled':''}>${icon('print')}${tr('PDF v měřítku 1:1')}</button><button class="btn btn-light" data-fit-stl ${issues.length||!entries.length?'disabled':''}>${icon('cube')}${tr('Tenká zkouška STL')}</button></div><p class="muted-note">${tr('PDF tiskněte na 100 % a přeměřte kontrolní úsečku 100 mm. Fotografie nemusí zachytit nejširší část vysokého nástroje.')}</p></details>`}`,footer:`<span class="footnote">${exportFormat==='stl'?tr('STL v mm · samostatné uzavřené díly'):tr('Soubory vznikají ve vašem zařízení')}</span><button class="btn btn-primary" data-do-export ${exportFormat!=='json'&&(issues.length||!entries.length||(exportFormat!=='stl'&&(printError||bedError)))?'disabled':''}>${icon('download')}${exportFormat==='stl'?tr('Připravit a stáhnout ZIP'):tr('Stáhnout {format}',{format:exportFormat.toUpperCase()})}</button>`,onClose:()=>{session.closed=true;clearTimeout(session.timer);session.controller.abort();if(exportSession===session){exportSession=null;resumeEditor();}}});
  const redraw=()=>{const scroll=modal.body.scrollTop,focused=document.activeElement?.id;openExport();const body=document.querySelector('.modal-body');if(body)body.scrollTop=scroll;if(focused)document.getElementById(focused)?.focus();};
  modal.el.querySelector('[data-action="export-baseplate"]')?.addEventListener('click',exportGridfinityBaseplate);
  const setting=(key,value)=>{remember();project[key]=value;persist();editorNeedsRefresh=true;redraw();};
  modal.el.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>{exportFormat=b.dataset.format;redraw();});
  modal.el.querySelector('#export-scope')?.addEventListener('change',e=>{exportScope=e.target.value;if(exportFormat==='stl'){exportModuleChoice.all=exportScope==='all';exportModuleChoice.ids=new Set(exportScope==='selected'?[selectedId]:exportScope==='all'?project.modules.map(m=>m.id):chosen);}redraw();});
  modal.el.querySelectorAll('[data-export-module]').forEach(input=>input.onchange=()=>{const ids=exportModuleIds();exportModuleChoice.all=false;if(input.checked)ids.add(input.dataset.exportModule);else ids.delete(input.dataset.exportModule);exportModuleChoice.ids=ids;exportScope=ids.size===project.modules.length?'all':'custom';exportModuleChoice.all=exportScope==='all';redraw();});
  modal.el.querySelectorAll('[data-export-select]').forEach(button=>button.onclick=()=>{exportModuleChoice.all=button.dataset.exportSelect==='all';exportModuleChoice.ids=new Set(exportModuleChoice.all?project.modules.map(module=>module.id):[]);exportScope=exportModuleChoice.all?'all':'custom';redraw();});
  modal.el.querySelector('#export-size-labels')?.addEventListener('change',e=>setting('sizeLabels',e.target.checked));
  const material=(key,value)=>{remember();project.multiMaterial={...materialConfig(project),[key]:value};persist();editorNeedsRefresh=true;redraw();};
  modal.el.querySelector('#print-colors')?.addEventListener('change',e=>material('enabled',e.target.checked));
  modal.el.querySelectorAll('[data-zone-on]').forEach(input=>input.onchange=()=>material(input.dataset.zoneOn,input.checked));
  modal.el.querySelectorAll('[data-zone-color]').forEach(input=>input.onchange=()=>material(input.dataset.zoneColor,input.value));
  modal.el.querySelector('#print-floor-thickness')?.addEventListener('change',e=>{
    const value=parseLength(e.target.value,'mm');
    if(!Number.isFinite(value)||value<FLOOR_THICKNESS.min||value>FLOOR_THICKNESS.max){toast(tr('Zadejte tloušťku vložky od {min} do {max} mm.',FLOOR_THICKNESS));e.target.value=inputValue(materialConfig(project).floorThickness,{unit:'mm',digits:2});return;}
    material('floorThickness',value);
  });
  modal.el.querySelector('#export-connectors')?.addEventListener('change',e=>setConnectors(e.target.checked,modal,session,redraw));
  modal.el.querySelector('#export-joint-clearance')?.addEventListener('change',e=>{
    const value=parseLength(e.target.value,'mm');
    if(!Number.isFinite(value)||value<0||value>1){toast(tr('Zadejte vůli spojky od 0 do 1 mm na každé straně.'));e.target.value=inputValue(project.jointClearance??.2,{unit:'mm',digits:4});return;}
    if(value!==(project.jointClearance??.2))setting('jointClearance',value);
  });
  modal.el.querySelector('#export-joint-fit')?.addEventListener('click',e=>exportJointFit(e.currentTarget,modal));
  modal.el.querySelector('#print-light')?.addEventListener('change',e=>setting('printMode',e.target.checked?'light':'solid'));
  modal.el.querySelector('#print-bottom')?.addEventListener('change',e=>setting('bottomMode',e.target.value));
  modal.el.querySelector('#limit-bed')?.addEventListener('change',e=>setting('limitToBed',e.target.checked));
  modal.el.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{const v=lengthFrom(el);if(v!==null)setting(el.dataset.field,v);});
  const oversized=entries.filter(m=>!((m.width-.5<=project.bedWidth&&m.height-.5<=project.bedHeight)||(m.height-.5<=project.bedWidth&&m.width-.5<=project.bedHeight)));
  const bed=modal.el.querySelector('#bed-warnings');if(bed&&bedError){
    bed.innerHTML=`<div class="issue-box export-bed-warning" role="status"><p>${tr('Vybraný 3D model se nevejde na podložku vcelku. Při exportu se rozřeže na tisknutelné díly.')}</p><p>${tr('Vybrané 3D modely se automaticky rozřežou podle podložky. Rozvržení šuplíku se nemění.')}</p><ul>${oversized.map(m=>{
      return `<li><span>${esc(m.name)} · ${fmtSize(m.width-.5,m.height-.5)}</span><button type="button" class="btn btn-light" data-export-split-module="${esc(m.id)}">${tr('Stáhnout tiskové díly')}</button></li>`;
    }).join('')}</ul></div>`;
    modal.el.querySelector('[data-do-export]').disabled=!cached||!!issues.length||!entries.length;
  }
  modal.el.querySelectorAll('[data-export-split-module]').forEach(button=>button.onclick=()=>splitModuleForExport(button.dataset.exportSplitModule));
  modal.el.querySelectorAll('[data-repack]').forEach(b=>b.onclick=()=>{modal.close();smartArrangeProject();});
  const analysisStatus=modal.el.querySelector('[data-export-analysis]'),exportButton=modal.el.querySelector('[data-do-export]');
  function applyAnalysis(result){
    if(session.closed||session.connectorsBusy||!modal.el.isConnected)return;
    session.done=true;analysisStatus.setAttribute('aria-busy','false');analysisStatus.textContent='';
    const statsSlot=modal.el.querySelector('[data-export-stats]');if(statsSlot){
      statsSlot.innerHTML=printSummary(result.stats);
      if(!result.stats&&!result.issues?.length&&!result.printError&&entries.length&&entries.every(fitsExportBed)){
        const button=document.createElement('button');button.type='button';button.className='btn btn-light';button.dataset.computeVolume='';button.textContent=tr('Vypočítat objem modelu');
        button.onclick=()=>{button.disabled=true;analysisStatus.setAttribute('aria-busy','true');analysisStatus.textContent=tr('Počítám objem modelu…');analyze(true);};statsSlot.append(button);
      }
    }
    const labels=modal.el.querySelector('[data-export-labels]');if(labels)labels.innerHTML=labelStatus(entries,result.labels);
    const joints=modal.el.querySelector('[data-joint-status]');if(joints)joints.innerHTML=jointSummary(result.joints,result.jointError);
    const issueBox=modal.el.querySelector('[data-export-issues]');issueBox.innerHTML=exportIssues(result.issues||[],result.printError);
    issueBox.querySelector('[data-repack]')?.addEventListener('click',()=>{modal.close();smartArrangeProject();});
    exportButton.disabled=!!result.issues?.length||!entries.length||(exportFormat!=='stl'&&!!(result.printError||bedError));
  }
  async function analyze(forceStats=false){
    if(session.closed||!modal.el.isConnected||exportFormat==='json')return;
    const snapshot=clone(exportProject),key=same(project);
    try{
      const result=await analysisClient.run('analyze',snapshot,{...backgroundOptions(),signal:session.controller.signal,stats:exportFormat==='stl'&&(forceStats||snapshot.tools.length<=24&&snapshot.tools.reduce((sum,tool)=>sum+tool.points.length,0)<=4000)});
      if(session.closed||same(project)!==key)return;
      exportAnalysisCache.set(cacheKey,result);while(exportAnalysisCache.size>5)exportAnalysisCache.delete(exportAnalysisCache.keys().next().value);
      applyAnalysis(result);
    }catch(error){
      if(error.name==='AbortError'||session.closed)return;
      analysisStatus.setAttribute('aria-busy','false');analysisStatus.textContent=errorText(error)+' ';
      const retry=document.createElement('button');retry.type='button';retry.className='section-link';retry.textContent=tr('Zkusit znovu');retry.onclick=()=>{analysisStatus.setAttribute('aria-busy','true');analysisStatus.textContent=tr('Kontroluji tiskové díly na pozadí…');analyze();};analysisStatus.append(retry);
    }
  }
  if(exportFormat!=='json'){
    if(cached)applyAnalysis(cached);else{exportButton.disabled=true;session.timer=setTimeout(analyze,90);}
  }
  modal.el.querySelector('[data-fit-pdf]')?.addEventListener('click',()=>{
    const snapshot=clone(exportProject);runFileTask('fit-pdf',snapshot,{moduleId:opts.moduleId},tr('PDF v měřítku 1:1'),result=>({name:slug(snapshot.name)+'-meritko-1-1.pdf',data:result.data,type:'application/pdf'}),tr('PDF připraveno. Tiskněte na 100 % bez přizpůsobení stránce.'));
  });
  modal.el.querySelector('[data-fit-stl]')?.addEventListener('click',()=>{
    const snapshot=clone(exportProject);runFileTask('fit-stl',snapshot,{moduleId:opts.moduleId,package:entries.length>1},tr('Tenká zkouška STL'),result=>entries.length>1?{name:slug(snapshot.name)+'-zkousky.zip',data:result.zip,type:'application/zip'}:{name:result.files[0].name,data:result.files[0].data,type:'model/stl'},tr('Tenké zkoušky jsou připravené. Mají stejnou vůli jako finální kapsy.'));
  });
  modal.el.querySelector('[data-do-export]').onclick=()=>{
    if(exportFormat==='stl'){exportPrintBatch([...chosen]);return;}
    if(exportFormat==='json'){saveJSON();modal.close();return;}
    const format=exportFormat,snapshot=clone(exportProject);
    runFileTask(format,snapshot,{moduleId:opts.moduleId},tr('Připravuji…'),result=>({name:slug(snapshot.name)+'.'+format,data:result.data,type:format==='svg'?'image/svg+xml':'application/dxf'}),tr('Soubor je připravený ve stažených souborech.'));
  };
}

function saveJSON(){download(slug(project.name)+'.json',JSON.stringify({schemaVersion:1,app:'InsertCreator',project},null,2),'application/json');}


// Right click opens local actions; a right-button drag still pans the model.
let contextPointer=null;
$('#app').addEventListener('pointerdown',event=>{
  if(event.button!==2||event.isPrimary===false||!event.target.closest('#board-svg'))return;
  contextPointer={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
},true);
document.addEventListener('pointermove',event=>{if(contextPointer?.id===event.pointerId&&Math.hypot(event.clientX-contextPointer.x,event.clientY-contextPointer.y)>5)contextPointer.moved=true;},true);
document.addEventListener('pointercancel',event=>{if(contextPointer?.id===event.pointerId)contextPointer.moved=true;},true);
$('#app').addEventListener('contextmenu',event=>{
  const svg=event.target.closest('#board-svg');if(!svg)return;event.preventDefault();event.stopPropagation();
  if(contextPointer?.moved){contextPointer=null;return;}contextPointer=null;
  if(drag||resizeDrag||boardSelectionGesture)return;
  const group=event.target.closest('[data-module]'),module=project.modules.find(item=>item.id===group?.dataset.module),hit=boardToolFromTarget(event.target,module);
  if(module){if(!hit||!bulkSelection.has(hit.id))selectBoardTarget(module,hit);render();}
  else{bulkSelection.clear();selected=null;selectedModule=null;inspectorTab='drawer';render();}
  const many=selectedIds().length>0,locked=module?.locked||hit?.locked;
  const entry=(action,label,danger=false,disabled=false)=>({action,label:tr(label),danger,disabled});
  const items=many?[
    entry('bulk-rotate','Otočit 90°'),entry('bulk-angle','Nastavit úhel'),entry('bulk-move','Přesunout vybrané'),entry('bulk-grips-auto','Automaticky umístit výřezy'),entry('bulk-depth','Hloubka kapes'),entry('bulk-delete','Smazat vybrané',true)
  ]:hit?[
    entry('context-properties','Vlastnosti nástroje'),entry('rotate','Otočit 90°',false,locked),entry('finger-grips','Výřezy pro prsty'),entry('context-dimensions','Délka a šířka'),entry('duplicate','Kopie'),entry('delete','Smazat nástroj',true)
  ]:module?[
    entry('context-properties','Nastavení modulu'),entry('rotate-module','Otočit modul 90°',false,locked),entry('resize-module','Změnit velikost',false,locked),entry('size-module-auto','Podle nástroje',false,locked||!project.tools.some(t=>t.moduleId===module.id)),entry('duplicate-module','Kopie modulu'),entry('lock',locked?'Odemknout':'Zamknout'),entry('delete','Smazat modul',true)
  ]:[entry('smart-layout','Rozložit nástroje'),entry('add-shape','Prázdný modul'),entry('select-all-tools','Vybrat vše'),entry('fit','Zobrazit vše')];
  const projectId=project.id;
  openContextMenu({items,title:many?tr('Vybrané nástroje'):hit?.name||module?.name||tr('Šuplík'),x:event.clientX,y:event.clientY,returnFocus:$('#board-svg'),onAction:action=>{
    if(project.id!==projectId)return;
    if(action==='context-properties'||action==='context-dimensions'){
      const field=action==='context-dimensions'?'toolLength':hit?'name':'moduleX',input=$(`[data-field="${field}"]`);
      input?.focus();input?.scrollIntoView?.({block:'nearest'});return;
    }
    try{actions[action]?.();}catch(error){toast(errorText(error));}
  }});
},true);
const actions={
 'export-baseplate':exportGridfinityBaseplate,
 'move-mode':()=>{moveMode=!moveMode;render();if(moveMode)toast(tr('Přetáhněte modul. Tlačítkem Hotovo obnovíte posouvání stránky.'));},
 home:()=>{closeModal();window.scrollTo({top:0,behavior:'smooth'});},capture,library:openLibrary,projects:openProjects,help,rename,expand,'add-shape':addShape,'resize-module':editModuleSize,'size-module-auto':sizeModuleAutomatically,export:openExport,
 'save-project':()=>{persist();saveJSON();toast(tr('Projekt uložen jako přenosný JSON.'));},
 'set-lang':lang=>{setLang(lang);},
 'new-drawer':createDrawer,'import-json':()=>$('#project-file').click(),'demo-drawer':()=>switchProject(demoProject()),
 'set-unit':u=>{setAppUnit(u);render();if(project.unit&&project.unit!==u)toast(tr('Tento šuplík má vlastní jednotky ({unit}). Změníte je v Rozměrech šuplíku.',{unit:project.unit}));},
 'drawer-tab':showDrawerDimensions,
 'edit-contour':capture,'finger-grips':editFingerGrips,'finger-grips-auto':()=>{const t=tool();if(t)setFingerGrips(automaticFingerGrips(t,{radius:9}));},'finger-grips-clear':()=>setFingerGrips([]),
 auto:smartArrangeProject,'smart-layout':smartArrangeProject,'split-module':splitModule,'tool-sets':openToolSets,'tool-set-current':editSelectedToolSet,
 undo,redo,
 snap:()=>{snap=!snap;render();},grid:()=>{showGrid=!showGrid;render();},labels:()=>{showLabels=!showLabels;render();},
 '2d':()=>{previewSequence++;previewClient.cancel();view='2d';render();},'3d':()=>{view='3d';render();},
 'zoom-in':()=>{if(view==='3d')camera3D=normalizeCamera3D({...camera3D,zoom:camera3D.zoom*1.25});else zoom=Math.min(3,zoom+.25);render();},'zoom-out':()=>{if(view==='3d')camera3D=normalizeCamera3D({...camera3D,zoom:camera3D.zoom/1.25});else zoom=Math.max(.5,zoom-.25);render();},fit:()=>{if(view==='3d')camera3D=createCamera3D();else{zoom=1;pan2D={x:0,y:0};}render();},
 'hide-tip':()=>{tipVisible=false;writeLocal('suplik-hide-tip',true);render();},
 rotate:()=>rotateCurrentTool(90),'rotate-module':()=>applyModuleEdit(moduleEdit.rotateModule,90,tr('Modul otočen.')),'duplicate-module':duplicateCurrentModule,
 'module-step':stepModule,
 'arrange-current-set':openSetPlacement,'toggle-size-labels':()=>commit(()=>project.sizeLabels=!project.sizeLabels),
 'select-all-tools':()=>{bulkSelection=new Set(project.tools.map(t=>t.id));render();},'select-no-tools':()=>{bulkSelection.clear();render();},
 'bulk-rotate':()=>applyBulk(bulk.bulkRotate,90),'bulk-flip':()=>applyBulk(bulk.bulkRotate,180),'bulk-delete':()=>applyBulk(bulk.bulkDelete),
 'bulk-move':openBulkMove,'bulk-depth':openBulkDepth,'bulk-angle':openBulkAngle,'bulk-align':openBulkAlign,'bulk-grips-auto':()=>applyBulk(bulk.bulkFingerGrips,{mode:'auto',radius:9}),'bulk-grips-clear':()=>applyBulk(bulk.bulkFingerGrips,{mode:'clear'}),'bulk-lock':()=>applyBulk(bulk.bulkLock,true),'bulk-unlock':()=>applyBulk(bulk.bulkLock,false),
 'bulk-create-set':()=>editToolSet({id:uid(),name:tr('Nová sada'),toolIds:selectedIds(),layout:'shared',arrangement:'ordered',order:'asc'},false),
 lock:()=>{const m=moduleFor();if(!m)return;commit(()=>{m.locked=!m.locked;project.tools.filter(t=>t.moduleId===m.id).forEach(t=>t.locked=m.locked);},m.locked?tr('Poloha modulu je odemčená.'):tr('Poloha modulu je zamčená.'));},
 duplicate:()=>{const t=tool();if(t)addTools([{...clone(t),name:t.name+' · '+tr('kopie')}]);},
 delete:()=>{const t=tool(),m=moduleFor();if(!t&&!m)return;commit(()=>{if(t){removeToolSetMember(t.id);project.tools=project.tools.filter(x=>x.id!==t.id);project.modules=project.modules.filter(x=>x.id!==t.moduleId||project.tools.some(o=>o.moduleId===x.id));selected=project.tools[0]?.id||null;}else project.modules=project.modules.filter(x=>x.id!==m.id);selectedModule=null;},tr('Odstraněno ze sestavy. Akci můžete vrátit tlačítkem Zpět.'));}
};
$('#app').addEventListener('click',e=>{
  if(drag||resizeDrag||boardSelectionGesture){e.preventDefault();return;}
  const open=e.target.closest('[data-drawer-open]'),remove=e.target.closest('[data-drawer-remove]');
  if(remove){removeDrawer(remove.dataset.drawerRemove);return;}
  if(open){const p=projects.find(p=>p.id===open.dataset.drawerOpen);if(p&&p.id!==project.id)switchProject(p);return;}
  const sel=e.target.closest('[data-select]');
  if(sel){if(e.shiftKey||e.ctrlKey||e.metaKey){toggleToolSelection(sel.dataset.select);return;}bulkSelection.clear();selected=sel.dataset.select;selectedModule=null;inspectorTab='tool';render();return;}
  const group=e.target.closest('[data-module]');
  if(group){
    const m=project.modules.find(m=>m.id===group.dataset.module),t=boardToolFromTarget(e.target,m);
    if(!m)return;
    if((e.shiftKey||e.ctrlKey||e.metaKey)&&t){toggleToolSelection(t.id);return;}
    selectBoardTarget(m,t);render();return;
  }
  const a=e.target.closest('[data-action]');if(a){e.preventDefault();try{actions[a.dataset.action]?.(a.dataset.value);}catch(error){toast(errorText(error));}}
});
$('#app').addEventListener('change',e=>{
  if(e.target.matches('[data-smart-shape]')){if(['rectangular','stepped'].includes(e.target.value)){smartShape=e.target.value;writeLocal('suplik-studio-module-shape',smartShape);}return;}
  const check=e.target.closest('[data-tool-check]');if(check){toggleToolSelection(check.dataset.toolCheck);return;}
  const el=e.target.closest('[data-field]');if(!el)return;const field=el.dataset.field,scope=el.dataset.scope;let value=el.value.trim();
  if(scope==='project'&&field==='bottomMode'){
    if(!['plain','grid','magnet','adhesive'].includes(value))return;
    if(value==='grid'&&Math.abs(project.grid-42)>.001){toast(tr('Gridfinity patky vyžadují rastr přesně 42 mm.'));render();return;}
    commit(()=>project.bottomMode=value);return;
  }
  if(el.hasAttribute('data-length')){value=lengthFrom(el);if(value===null){render();return;}}
  if(scope==='project'&&field==='grid'&&Math.abs(value-project.grid)>1e-6){
    if(project.bottomMode==='grid'){toast(tr('Gridfinity patky vyžadují rastr přesně 42 mm.'));render();return;}
    if(project.modules.some(module=>module.cells)){toast(tr('Před změnou rastru převeďte schodové moduly na obdélníky změnou jejich rozměrů.'));render();return;}
  }
    if(scope==='tool'){
    const t=tool();if(!t)return;
    if(field==='unit'){commit(()=>{if(value)t.unit=value;else delete t.unit;});return;}
    if(field==='name'&&!value){render();return;}
    if(field==='sizeLabel'){commit(()=>t.sizeLabel=value.slice(0,24));return;}
    if(field==='rotation'){
      try{const next=bulk.bulkSetRotation(project,[t.id],readAngle(value));if(same(next)!==same(project))commit(()=>project=next,tr('Nástroj otočen.'));else render();}
      catch(error){toast(errorText(error));render();}return;
    }
    if(field==='toolX'||field==='toolY'){
      const m=moduleFor();if(!m){render();return;}
      const dx=field==='toolX'?value-(t.x-m.x):0,dy=field==='toolY'?value-(t.y-m.y):0;
      try{const next=bulk.bulkMoveTools(project,[t.id],{dx,dy});if(same(next)!==same(project))commit(()=>project=next,tr('Nástroj přesunut.'));else render();}
      catch(error){toast(errorText(error));render();}return;
    }
    if(field==='toolLength'||field==='toolBreadth'){
      try{
        if(t.locked||moduleFor()?.locked)throw i18nError('Pro změnu rozměru nejdřív odemkněte modul.');
        let next=clone(project);const index=next.tools.findIndex(item=>item.id===t.id);
        next.tools[index]=resizeToolDimensions(t,{[field==='toolLength'?'length':'width']:value});
        const own=next.tools.filter(item=>item.moduleId===t.moduleId),m=next.modules.find(item=>item.id===t.moduleId);
        if(m&&m.sizeMode!=='manual'&&own.length===1)next=resizeModule(next,m.id,{mode:'auto'});
        checkLayoutTransition(project,next);
        if(same(next)===same(project)){render();return;}
        let note='';commit(()=>{project=next;if(m)note=releaseUniformSet(m.id,{ifUnsatisfied:true});});
        if(note)toast(note.trim());
      }catch(error){toast(errorText(error));render();}return;
    }
    // Percentage scale remains an explicit proportional edit.
    const ratio=toolScaleRatio(t,field,value);if(ratio===false){render();return;}
    let scaled=null;
    if(ratio!==null){
      if(Math.abs(ratio-1)<1e-9){render();return;}
      const b=bounds(t);if(b.width*ratio>3000+1e-6||b.height*ratio>3000+1e-6){toast(tr('Kontura nesmí v žádném směru přesáhnout {max}.',{max:fmtLen(3000)}));render();return;}
      if(moduleFor()?.locked){toast(tr('Pro změnu rozměru nejdřív odemkněte modul.'));render();return;}
      if(ratio<.2||ratio>5){toast(tr('Měřítko nástroje musí být mezi {min}× a {max}×.',{min:.2,max:5}));render();return;}
      try{scaled=scaleToolCentred(t,ratio);if(Object.prototype.hasOwnProperty.call(t,'fingerGrips'))scaled.fingerGrips=validateFingerGrips(scaled.fingerGrips);pocketOutline(scaled,project.clearance);}
      catch(error){toast(tr('Velikost kontury nelze změnit. U výřezů použijte „Automaticky umístit“ a zkuste to znovu. {error}',{error:errorText(error)}));render();return;}
    }
    let note='';commit(()=>{if(scaled){t.points=scaled.points;t.x=scaled.x;t.y=scaled.y;if(Object.prototype.hasOwnProperty.call(scaled,'fingerGrips'))t.fingerGrips=scaled.fingerGrips;
      // Automatic modules follow the new outline; manual ones keep their nominal size (layout issues are reported).
      const m=project.modules.find(x=>x.id===t.moduleId);if(m&&m.sizeMode!=='manual')try{project=resizeModule(project,m.id,{mode:'auto'});}catch{}
      if(m)note=releaseUniformSet(m.id,{ifUnsatisfied:true});
    }else t[field]=typeof value==='string'?value.slice(0,100):value;});
    if(note)toast(note.trim());
  }else if(scope==='module'){
    const m=moduleFor();if(!m)return;
    if(field==='unit'){commit(()=>{if(value)m.unit=value;else delete m.unit;});return;}
    if(field==='moduleX'||field==='moduleY'){
      try{const next=moduleEdit.moveModule(project,m.id,{x:field==='moduleX'?value:m.x,y:field==='moduleY'?value:m.y});if(same(next)!==same(project))commit(()=>project=next,tr('Modul přesunut.'));else render();}
      catch(error){toast(errorText(error));render();}
    }
  }
  else commit(()=>project[field]=value);
});
$('#app').addEventListener('pointerdown',e=>{
  // Selection changes obey the same pointer/button ownership as geometry gestures.
  if(e.button!==0||e.isPrimary===false||resizeDrag||drag||boardSelectionGesture)return;
  if(e.shiftKey||e.ctrlKey||e.metaKey){
    const group=e.target.closest('[data-module]'),m=project.modules.find(m=>m.id===group?.dataset.module);
    if(m&&!e.target.closest('[data-tool]')){selectBoardTarget(m);render();}
    return;
  }
  // A second finger cannot start anything while a drag or resize is running (one active pointer at a time).
  if(view==='3d'){
    const group=e.target.closest('[data-module]'),m=project.modules.find(m=>m.id===group?.dataset.module);
    if(e.target.closest('#board-svg'))boardSelectionGesture={pointer:e.pointerId,moduleId:m?.id||null,projectId:project.id,x:e.clientX,y:e.clientY,moved:false};
    return;
  }
  // Resize handles work for mouse, pen and touch (no Move mode needed): they are explicit targets.
  const handle=e.target.closest('[data-resize-of]');
  if(handle){
    const svg=$('#board-svg'),m=project.modules.find(x=>x.id===handle.dataset.resizeOf);if(!svg||!m)return;e.preventDefault();
    selectBoardTarget(m);
    if(m.locked||!handle.dataset.resize){render();toast(tr(LOCKED_RESIZE));return;}
    const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;
    resizeDrag={pointer:e.pointerId,id:m.id,dir:handle.dataset.resize,start:point.matrixTransform(svg.getScreenCTM().inverse()),snapshot:clone(project),moved:false,label:resizeLabel(m)};
    try{svg.setPointerCapture(e.pointerId);}catch{}renderBoard();return;
  }
  if(e.pointerType==='touch'&&!moveMode)return;
  const group=e.target.closest('[data-module]'),svg=$('#board-svg');if(!group||!svg)return;
  const m=project.modules.find(m=>m.id===group.dataset.module);if(!m)return;
  const t=boardToolFromTarget(e.target,m),chosen=selectedIds(),keepBulk=!!t&&bulkSelection.has(t.id);
  if(!keepBulk)bulkSelection.clear();
  selected=t?.id||null;selectedModule=t?null:m.id;inspectorTab='tool';
  const movingSelection=keepBulk&&chosen.length>1;let blocked=false;
  if(movingSelection){
    const chosenSet=new Set(chosen),moduleIds=new Set(project.tools.filter(t=>chosenSet.has(t.id)).map(t=>t.moduleId));
    blocked=project.modules.some(m=>moduleIds.has(m.id)&&m.locked)||project.tools.some(t=>(chosenSet.has(t.id)||moduleIds.has(t.moduleId))&&t.locked);
  }
  if(m.locked&&!movingSelection){selectBoardTarget(m,t);render();toast(tr('Poloha modulu je zamčená. Odemkněte ji ve vlastnostech.'));return;}
  e.preventDefault();const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());
  drag={pointer:e.pointerId,id:m.id,selectionToolId:t?.id||null,start:p,x:m.x,y:m.y,snapshot:clone(project),moved:false,...(movingSelection?{toolIds:chosen}:{}),...(blocked?{blocked:true,error:tr('Nejprve odemkněte polohu modulu.')}:{})};svg.setPointerCapture(e.pointerId);renderBoard();
  if(blocked)toast(drag.error);
});
$('#app').addEventListener('pointermove',e=>{
  if(boardSelectionGesture&&e.pointerId===boardSelectionGesture.pointer&&Math.hypot(e.clientX-boardSelectionGesture.x,e.clientY-boardSelectionGesture.y)>=3)boardSelectionGesture.moved=true;
  if(view!=='3d'&&resizeDrag&&e.pointerId===resizeDrag.pointer){
    const svg=$('#board-svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse()),dx=q.x-resizeDrag.start.x,dy=q.y-resizeDrag.start.y;
    if(!resizeDrag.moved&&Math.hypot(dx,dy)<1)return;resizeDrag.moved=true;
    // Live preview from the original snapshot; an invalid size keeps the last valid one and shows why.
    const c=resizeCandidate(resizeDrag.snapshot,resizeDrag.id,resizeDrag.dir,dx,dy);if(!c)return;
    if(c.project)project=c.project;
    resizeDrag.label=resizeLabel(project.modules.find(x=>x.id===resizeDrag.id),c);resizeDrag.limited=!!(c.error||c.limit);renderBoard();return;
  }
  if(view==='3d'||!drag||e.pointerId!==drag.pointer)return;const svg=$('#board-svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());const m=project.modules.find(m=>m.id===drag.id);if(!m)return;
  const dx=q.x-drag.start.x,dy=q.y-drag.start.y;if(Math.hypot(dx,dy)<2&&!drag.moved)return;drag.moved=true;
  if(drag.blocked)return;
  if(drag.toolIds){
    const grid=drag.snapshot.grid,x=snap?Math.round(dx/grid)*grid:dx,y=snap?Math.round(dy/grid)*grid:dy;
    try{project=bulk.bulkMove(drag.snapshot,drag.toolIds,{dx:x,dy:y});drag.error=null;}
    catch(error){project=clone(drag.snapshot);drag.error=errorText(error);}
    renderBoard();return;
  }
  let x=drag.x+dx,y=drag.y+dy;if(snap){x=Math.round(x/project.grid)*project.grid;y=Math.round(y/project.grid)*project.grid;}x=Math.max(0,Math.min(project.width-m.width,x));y=Math.max(0,Math.min(project.height-m.height,y));
  const sx=x-m.x,sy=y-m.y;m.x=x;m.y=y;project.tools.filter(t=>t.moduleId===m.id).forEach(t=>{t.x+=sx;t.y+=sy;});renderBoard();
});
function endResize(){
  const r=resizeDrag;resizeDrag=null;
  const before=r.snapshot.modules.find(x=>x.id===r.id),after=project.modules.find(x=>x.id===r.id);
  if(r.moved&&before&&after&&same([before.x,before.y,before.width,before.height])!==same([after.x,after.y,after.width,after.height])){undoStack.push(r.snapshot);if(undoStack.length>40)undoStack.shift();redoStack=[];const note=releaseUniformSet(r.id);persist();render();toast(tr('Velikost modulu: {size}',{size:fmtSize(after.width,after.height,{unit:moduleUnit(after)})})+note);}
  else{project=r.snapshot;render();}
}
function finishBoardSelection(e){
  if(boardSelectionGesture&&e.pointerId===boardSelectionGesture.pointer){
    const finished=boardSelectionGesture;boardSelectionGesture=null;
    const module=project.modules.find(m=>m.id===finished.moduleId);
    if(!finished.moved&&finished.projectId===project.id&&module){selectBoardTarget(module);render();}
  }
}
function endDrag(e){
  const active=resizeDrag||drag;if(!active||e.pointerId!==active.pointer)return;if(resizeDrag)return endResize();
  if(!drag.moved){
    const finished=drag;drag=null;project=finished.snapshot;
    const module=project.modules.find(m=>m.id===finished.id),tool=project.tools.find(t=>t.id===finished.selectionToolId);
    if(module)selectBoardTarget(module,tool);
    render();return;
  }
  if(drag.toolIds){
    const finished=drag;drag=null;
    if(finished.error){project=finished.snapshot;render();toast(finished.error);return;}
    if(finished.moved&&(same(project.modules)!==same(finished.snapshot.modules)||same(project.tools)!==same(finished.snapshot.tools))){undoStack.push(finished.snapshot);if(undoStack.length>40)undoStack.shift();redoStack=[];persist();}
    else project=finished.snapshot;
    render();return;
  }
  if(drag.moved){const invalid=errors().some(i=>i.ids.includes(drag.id)&&i.type==='overlap');if(invalid){project=drag.snapshot;toast(tr('Tady už je jiný modul. Zkuste volné místo.'));}else{undoStack.push(drag.snapshot);redoStack=[];persist();}}drag=null;render();
}
// Unfinished edits are previews only. Losing capture/focus restores them without saving or adding history.
function cancelEditGesture(e){
  if(boardSelectionGesture&&(e?.pointerId===undefined||e.pointerId===boardSelectionGesture.pointer))boardSelectionGesture=null;
  const active=resizeDrag||drag;if(!active||(e?.pointerId!==undefined&&e.pointerId!==active.pointer))return;
  project=active.snapshot;resizeDrag=null;drag=null;
  // Clear the state before releasing capture: the resulting lostpointercapture must not cancel twice.
  try{$('#board-svg')?.releasePointerCapture?.(active.pointer);}catch{}
  render();
}
// Resolve an unmoved 3D pick before its camera controller releases capture at the SVG target.
$('#app').addEventListener('pointerup',finishBoardSelection,true);
$('#app').addEventListener('pointerup',endDrag);$('#app').addEventListener('pointercancel',cancelEditGesture);$('#app').addEventListener('lostpointercapture',cancelEditGesture);window.addEventListener('blur',cancelEditGesture);
$('#app').addEventListener('keydown',e=>{const group=e.target.closest('[data-module]');if(group&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const m=project.modules.find(m=>m.id===group.dataset.module),t=boardToolFromTarget(e.target,m);if(!m)return;if((e.shiftKey||e.ctrlKey||e.metaKey)&&t)toggleToolSelection(t.id);else{selectBoardTarget(m,t);render();}}});
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||$('#modal-root').children.length)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if(e.altKey&&e.shiftKey&&!e.ctrlKey&&!e.metaKey&&{ArrowRight:1,ArrowLeft:1,ArrowDown:1,ArrowUp:1}[e.key]){if(moduleFor()){e.preventDefault();stepModule({ArrowRight:'w+',ArrowLeft:'w-',ArrowDown:'h+',ArrowUp:'h-'}[e.key]);}}else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='r'){e.preventDefault();try{actions.rotate();}catch(error){toast(errorText(error));}}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();actions.delete();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();actions['save-project']();}});
$('#project-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>12*1024*1024)return toast(tr('Projekt je příliš velký. Maximum je 12 MB.'));try{const data=JSON.parse(await file.text());if(data.schemaVersion&&data.schemaVersion!==1)throw i18nError('Tato verze projektu zatím není podporovaná.');const imported=validateProject(data);imported.id=uid();switchProject(imported);toast(tr('Projekt otevřen. Původní projekty zůstaly uložené.'));}catch(error){toast(tr('Projekt nelze otevřít: {error}',{error:errorText(error)}));}});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select')||$('#modal-root').children.length)return;
  if(drag||resizeDrag){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape')cancelEditGesture();return;}
  const all=(e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='a',active=selectedIds().length>0,plain=!e.ctrlKey&&!e.metaKey&&!e.altKey;
  if(!all&&!(active&&plain&&['Escape','Delete','Backspace','r','R'].includes(e.key)))return;
  e.preventDefault();e.stopImmediatePropagation();
  try{if(all)actions['select-all-tools']();else if(e.key==='Escape')actions['select-no-tools']();else if(e.key.toLowerCase()==='r')actions['bulk-rotate']();else actions['bulk-delete']();}catch(error){toast(errorText(error));}
},true);
window.addEventListener('resize',scheduleEditorViewport);
window.addEventListener('scroll',scheduleEditorViewport,{passive:true});
window.visualViewport?.addEventListener('resize',scheduleEditorViewport);
document.fonts?.ready?.then(scheduleEditorViewport);
onLangChange(()=>{labelJob=null;analysisClient.cancel();previewClient.cancel();previewSequence++;applyDocumentText();render();if(exportSession)openExport();});
applyDocumentText();persist();render();
if(project.sizeLabels)await ensureLabels();
window.addEventListener('pagehide',()=>{closeModal();labelJob=null;analysisClient.cancel();previewClient.cancel();fileClient.cancel();});
window.addEventListener('pageshow',event=>{if(event.persisted)render();});
if('serviceWorker'in navigator){const register=()=>navigator.serviceWorker.register('./sw.js').catch(()=>{});if(document.readyState==='complete')register();else window.addEventListener('load',register,{once:true});}
