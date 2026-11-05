// Editor side of holding magnets: inspector panel, placement dialog and 2D marks.
import {pocketOutline,toolWorldPoint} from './finger-grip.js';
import {clone,uid} from './model.js';
import {moduleMagnetLift,requiredInsertHeight} from './print-material.js';
import {POCKET_MAGNET_DEFAULT,POCKET_MAGNET_LIMITS,automaticPocketMagnets,hasPocketMagnets,magnetHoleDepth,magnetHoleDiameter,pocketMagnetHoles,pocketMagnetProblem,validatePocketMagnets} from './tool-magnet.js';
import {t as tr,i18nError} from './i18n.js';
import {esc,openModal} from './ui.js';
import {fmtLen,inputValue,parseLength,unitDigits} from './units.js';

const MAX_INSERT_HEIGHT=100,MAX_DIALOG_COUNT=6;
// A new tool starts from the size last used in this session: one drawer tends to use one magnet.
let lastSize={...POCKET_MAGNET_DEFAULT};

const peersOf=(project,tool)=>tool.moduleId?project.tools.filter(item=>item.moduleId===tool.moduleId):[tool];

/** The project with these magnets on the tool, the insert raised if they need it. Throws when they cannot be made. */
export function planPocketMagnets(project,toolId,magnets){
  const next=clone(project),tool=next.tools.find(item=>item.id===toolId);
  if(!tool)throw i18nError('Nástroj už v projektu neexistuje.');
  const fromHeight=next.insertHeight,liftBefore=moduleMagnetLift(project,peersOf(project,project.tools.find(item=>item.id===toolId)));
  tool.pocketMagnets=validatePocketMagnets(magnets);
  if(!tool.pocketMagnets.length)delete tool.pocketMagnets;
  const problem=hasPocketMagnets(tool)?pocketMagnetProblem(tool,pocketOutline(tool,next.clearance)):null;
  if(problem==='wall')throw i18nError('Magnet v kapse „{name}“ je příliš blízko stěny nebo mimo dno kapsy.',{name:tool.name});
  if(problem==='spacing')throw i18nError('Magnety v kapse „{name}“ jsou příliš blízko sebe.',{name:tool.name});
  const peers=peersOf(next,tool),required=hasPocketMagnets(tool)?requiredInsertHeight(next,peers):0;
  if(required>MAX_INSERT_HEIGHT)throw i18nError('Magnet by vyžadoval výšku vložky {height}. Nejvyšší možná výška je {max}. Zmenšete hloubku kapsy nebo magnet.',{height:fmtLen(required,{digits:2}),max:fmtLen(MAX_INSERT_HEIGHT)});
  if(required>next.insertHeight)next.insertHeight=required;
  return{project:next,fromHeight,toHeight:next.insertHeight,lift:moduleMagnetLift(next,peers),liftBefore};
}

/** What the magnets do to the module, in one sentence. */
export function pocketMagnetEffect({fromHeight,toHeight,lift}){
  const parts=[];
  if(toHeight>fromHeight+1e-7)parts.push(tr('Výška vložky se zvýší z {from} na {to}.',{from:fmtLen(fromHeight,{digits:2}),to:fmtLen(toHeight,{digits:2})}));
  else parts.push(tr('Výška vložky zůstane {height}.',{height:fmtLen(toHeight,{digits:2})}));
  if(lift>1e-7)parts.push(tr('Dno celého modulu se zesílí o {lift}.',{lift:fmtLen(lift,{digits:2})}));
  return parts.join(' ');
}

/** Small markers on the 2D board: same place and size as the printed holes. */
export function pocketMagnetMarks(tool){
  if(!hasPocketMagnets(tool))return'';
  try{return pocketMagnetHoles(tool).map(hole=>`<circle class="tool-magnet" cx="${hole.x}" cy="${hole.y}" r="${hole.radius}"/>`).join('');}catch{return'';}
}

export function pocketMagnetPanel(tool,{unit}={}){
  const magnets=tool.pocketMagnets||[],first=magnets[0];
  const size=magnet=>`Ø ${fmtLen(magnet.diameter,{unit,suffix:false})} × ${fmtLen(magnet.height,{unit})}`;
  return`<section class="pocket-magnet-panel"><p class="muted-note">${magnets.length?tr('Magnety drží nástroj zespodu. Díry se počítají do výšky modulu.'):tr('Magnet v dně kapsy přidrží ocelový nástroj. Vyberete jeho velikost a polohu.')}</p>${first?`<ul class="grip-summary">${magnets.map((magnet,i)=>`<li>${i+1}. ${size(magnet)} · X ${fmtLen(magnet.x,{unit,suffix:false})} · Y ${fmtLen(magnet.y,{unit,suffix:false})}</li>`).join('')}</ul>`:''}<div class="selected-actions"><button class="btn btn-light" data-action="pocket-magnets">${first?tr('Upravit magnety'):tr('Přidat magnet')}</button>${first?`<button class="btn btn-light" data-action="pocket-magnets-clear">${tr('Odebrat magnety')}</button>`:''}</div></section>`;
}

function preview(project,tool,draft,active){
  const local={...tool,x:0,y:0,rotation:0,fingerGrips:tool.fingerGrips||[]},world=toolWorldPoint(local);
  let pocket;try{pocket=pocketOutline(local,project.clearance);}catch{pocket=local.points.map(world);}
  const raw=local.points.map(world),all=[...pocket,...raw],pad=4;
  const minX=Math.min(...all.map(p=>p.x))-pad,minY=Math.min(...all.map(p=>p.y))-pad,width=Math.max(...all.map(p=>p.x))+pad-minX,height=Math.max(...all.map(p=>p.y))+pad-minY;
  const path=points=>`M${points.map(p=>`${p.x} ${p.y}`).join('L')}Z`;
  const circles=draft.map((magnet,i)=>{const p=world(magnet);return`<g class="magnet-mark${i===active?' is-active':''}"><circle cx="${p.x}" cy="${p.y}" r="${magnetHoleDiameter(magnet)/2}"/><text x="${p.x}" y="${p.y}" class="grip-number">${i+1}</text></g>`;}).join('');
  return`<svg class="finger-grip-preview magnet-preview" data-magnet-canvas viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="${esc(tr('Kapsa nástroje s polohou magnetů'))}"><path class="grip-pocket" d="${path(pocket)}"/><path class="grip-tool" d="${path(raw)}"/>${circles}</svg>`;
}

const lengthField=(label,value,key,u)=>`<label class="field"><span>${label}</span><div class="input-wrap"><input inputmode="decimal" value="${esc(inputValue(value,{unit:u,digits:Math.max(2,unitDigits(u))}))}" data-magnet-field="${key}" aria-label="${label}"><em>${u}</em></div></label>`;

/** Map a pointer position to raw local tool millimetres, through the shown viewBox. */
function pointerToTool(svg,event,tool){
  const rect=svg.getBoundingClientRect(),box=svg.viewBox?.baseVal;if(!box||!rect.width||!rect.height)return null;
  const scale=Math.min(rect.width/box.width,rect.height/box.height),left=rect.left+(rect.width-box.width*scale)/2,top=rect.top+(rect.height-box.height*scale)/2;
  const minX=Math.min(...tool.points.map(p=>p.x)),minY=Math.min(...tool.points.map(p=>p.y));
  return{x:box.x+(event.clientX-left)/scale+minX,y:box.y+(event.clientY-top)/scale+minY};
}

export function openPocketMagnetDialog({project,tool,unit:u,onSave,errorText}){
  let draft=clone(tool.pocketMagnets||[]),active=0,size={...lastSize,...(draft[0]?{diameter:draft[0].diameter,height:draft[0].height}:{})},count=Math.max(1,draft.length),dragging=false;
  const limits=POCKET_MAGNET_LIMITS;
  const modal=openModal({title:tr('Magnety v kapse'),subtitle:tool.name,wide:true,body:'',footer:`<span class="footnote">${tr('Zadejte skutečný rozměr magnetu. Díra je o {play} větší, pod ní zůstane alespoň {cover}.',{play:fmtLen(.2,{unit:u}),cover:fmtLen(1.2,{unit:u})})}</span><button class="btn btn-primary" data-magnets-save>${tr('Uložit magnety')}</button>`});
  const body=modal.body,error=text=>{const el=body.querySelector('[data-magnet-error]');if(el)el.textContent=text||'';};
  const automatic=()=>{draft=automaticPocketMagnets(tool,{...size,count,clearance:project.clearance}).map(magnet=>({...magnet,id:uid()}));active=0;};
  const status=()=>{
    const el=body.querySelector('[data-magnet-status]');if(!el)return;
    if(!draft.length){el.textContent='';return;}
    try{const plan=planPocketMagnets(project,tool.id,draft);el.textContent=`${tr('Díra Ø {diameter} × {depth}.',{diameter:fmtLen(magnetHoleDiameter(size),{unit:u,suffix:false,digits:2}),depth:fmtLen(magnetHoleDepth(size),{unit:u,digits:2})})} ${pocketMagnetEffect(plan)}`;error('');}
    catch(failure){el.textContent='';error(errorText(failure));}
  };
  const paint=()=>{const target=body.querySelector('[data-magnet-preview]');if(target)target.innerHTML=preview(project,tool,draft,active);status();};
  const rows=()=>draft.map((magnet,i)=>`<div class="magnet-row${i===active?' is-active':''}" data-magnet-row="${i}"><button type="button" class="icon-btn" data-magnet-pick="${i}" aria-label="${esc(tr('Vybrat magnet {n}',{n:i+1}))}">${i+1}</button>${lengthField('X',magnet.x,`x-${i}`,u)}${lengthField('Y',magnet.y,`y-${i}`,u)}</div>`).join('');
  const redraw=()=>{
    body.innerHTML=`<div class="grip-editor"><div><div data-magnet-preview></div><p class="muted-note">${tr('Klikněte do kapsy nebo táhněte: vybraný magnet se přesune. Dejte ho pod ocelovou část nástroje.')}</p></div><div><div class="fields-row">${lengthField(tr('Průměr magnetu'),size.diameter,'diameter',u)}${lengthField(tr('Výška magnetu'),size.height,'height',u)}</div><label class="field"><span>${tr('Počet magnetů')}</span><select data-magnet-count aria-label="${esc(tr('Počet magnetů'))}">${Array.from({length:MAX_DIALOG_COUNT},(_,i)=>`<option value="${i+1}" ${count===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><div class="grip-edit-actions"><button type="button" class="btn btn-light" data-magnet-auto>${tr('Rozmístit automaticky')}</button></div><div data-magnet-rows>${rows()}</div><p class="muted-note" data-magnet-status role="status"></p><p class="form-error" data-magnet-error role="status"></p></div></div>`;
    paint();
  };
  const readSize=()=>{
    const read=key=>parseLength(body.querySelector(`[data-magnet-field=${key}]`).value,u),diameter=read('diameter'),height=read('height');
    if(!(diameter>=limits.diameter.min&&diameter<=limits.diameter.max&&height>=limits.height.min&&height<=limits.height.max))throw i18nError('Magnet musí mít průměr {diameter} a výšku {height}.',{diameter:`${fmtLen(limits.diameter.min,{unit:u,suffix:false})}–${fmtLen(limits.diameter.max,{unit:u})}`,height:`${fmtLen(limits.height.min,{unit:u,suffix:false})}–${fmtLen(limits.height.max,{unit:u})}`});
    size={diameter,height};draft=draft.map(magnet=>({...magnet,...size}));
  };
  const readPositions=()=>{
    draft=draft.map((magnet,i)=>{
      const x=parseLength(body.querySelector(`[data-magnet-field=x-${i}]`).value,u),y=parseLength(body.querySelector(`[data-magnet-field=y-${i}]`).value,u);
      if(!Number.isFinite(x)||!Number.isFinite(y))throw i18nError('Zadejte platnou číselnou polohu magnetu.');
      return{...magnet,x,y};
    });
  };
  const moveActive=event=>{
    const svg=body.querySelector('[data-magnet-canvas]'),point=svg&&pointerToTool(svg,event,tool);if(!point||!draft[active])return;
    draft[active]={...draft[active],...point};
    body.querySelector(`[data-magnet-field=x-${active}]`).value=inputValue(point.x,{unit:u,digits:Math.max(2,unitDigits(u))});
    body.querySelector(`[data-magnet-field=y-${active}]`).value=inputValue(point.y,{unit:u,digits:Math.max(2,unitDigits(u))});
    paint();
  };
  const attempt=action=>{try{action();}catch(failure){error(errorText(failure));}};
  body.addEventListener('change',event=>attempt(()=>{
    if(event.target.matches('[data-magnet-count]')){count=Number(event.target.value);readSize();automatic();redraw();return;}
    if(!event.target.matches('[data-magnet-field]'))return;
    readSize();readPositions();paint();
  }));
  body.addEventListener('click',event=>attempt(()=>{
    const pick=event.target.closest('[data-magnet-pick]');
    if(pick){active=Number(pick.dataset.magnetPick);body.querySelector('[data-magnet-rows]').innerHTML=rows();paint();return;}
    if(event.target.closest('[data-magnet-auto]')){readSize();automatic();redraw();}
  }));
  body.addEventListener('pointerdown',event=>{if(event.target.closest?.('[data-magnet-canvas]')){dragging=true;attempt(()=>moveActive(event));}});
  body.addEventListener('pointermove',event=>{if(dragging)attempt(()=>moveActive(event));});
  body.addEventListener('pointerup',()=>{dragging=false;});
  modal.el.querySelector('[data-magnets-save]').onclick=()=>attempt(()=>{
    readSize();readPositions();
    const plan=planPocketMagnets(project,tool.id,draft);
    lastSize={...size};onSave(plan);modal.close();
  });
  redraw();
  if(!draft.length)attempt(()=>{automatic();redraw();});
  return modal;
}
