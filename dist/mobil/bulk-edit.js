// Atomic editing of a tool selection. All lengths are stored millimetres, independent of display units.
import {clone,validateProject} from './model.js';
import {bounds,resizeModule,validateLayout} from './geometry.js';
import {automaticFingerGrips} from './finger-grip.js';
import {setCoherence} from './tool-sets.js';
import {i18nError,t} from './i18n.js';
import {fmtLen} from './units.js';
import {maxPocketDepth} from './print-material.js';

const issueError=issue=>Object.assign(Error(issue.message),{i18n:issue.i18n});
const issueKey=issue=>JSON.stringify([issue.type,[...issue.ids].sort(),issue.i18n?.cs||issue.message]);
const angle=value=>((value%360)+360)%360;
function selection(project,toolIds){
  validateProject(project);
  if(!Array.isArray(toolIds)&&!(toolIds instanceof Set))throw i18nError('Vyberte alespoň jeden nástroj.');
  const ids=new Set(toolIds),known=new Set(project.tools.map(t=>t.id));
  if([...ids].some(id=>typeof id!=='string'||!known.has(id)))throw i18nError('Vybraný nástroj neexistuje.');
  const next=clone(project),tools=next.tools.filter(t=>ids.has(t.id)),modules=new Set(tools.map(t=>t.moduleId).filter(Boolean));
  return{next,ids,tools,modules};
}
function finite(value,label){
  const n=Number(value);
  if(!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(n))throw i18nError('Zadejte platnou hodnotu pro {label}.',{label:t(label)});
  return n;
}
function unlocked(next,ids,modules){
  if(next.modules.some(m=>modules.has(m.id)&&m.locked)||next.tools.some(t=>(ids.has(t.id)||modules.has(t.moduleId))&&t.locked))throw i18nError('Nejprve odemkněte polohu modulu.');
}
function unlockedTools(next,tools,modules){
  if(next.modules.some(m=>modules.has(m.id)&&m.locked)||tools.some(t=>t.locked))throw i18nError('Nejprve odemkněte polohu modulu.');
}
function placed(next,tools){
  if(tools.some(t=>!t.moduleId||!next.modules.some(m=>m.id===t.moduleId)))throw i18nError('Nejprve umístěte alespoň jeden modul.');
}
function singleModule(next,tools,modules){
  placed(next,tools);
  if(modules.size!==1)throw i18nError('Zarovnat nebo rozmístit lze pouze nástroje v jednom modulu.');
}
function axisKey(axis){
  if(!['x','y'].includes(axis))throw i18nError('Zvolte osu X nebo Y.');
  return axis==='x'?'width':'height';
}
function affected(next,ids,modules){return new Set([...ids,...modules,...next.tools.filter(t=>modules.has(t.moduleId)).map(t=>t.id)]);}
// Geometry edits must leave the edited group safe. Existing unrelated errors and unchanged depth issues stay editable.
function checked(before,next,ids,modules,{geometry=false,depth=false}={}){
  validateProject(next);
  const touched=affected(next,ids,modules),old=new Set(validateLayout(before).map(issueKey));
  for(const issue of validateLayout(next)){
    if(!issue.ids.some(id=>touched.has(id)))continue;
    if((geometry&&issue.type!=='depth')||(depth&&issue.type==='depth'&&issue.ids.some(id=>ids.has(id)))||!old.has(issueKey(issue)))throw issueError(issue);
  }
  if(geometry){
    const own=next.modules.filter(m=>modules.has(m.id));
    if(next.bottomMode==='grid'){
      if(Math.abs(next.grid-42)>.001)throw i18nError('Gridfinity patky vyžadují rastr přesně 42 mm.');
      if(own.some(m=>[m.x,m.y,m.width,m.height].some(v=>Math.abs(v/42-Math.round(v/42))>.0001)))throw i18nError('Rozměry i poloha modulu musí být v násobcích 42 mm pro Gridfinity patky.');
    }
  }
  return next;
}
function releaseUniform(next,ids,modules){
  if(!Array.isArray(next.toolSets))return;
  const changed=affected(next,ids,modules);
  next.toolSets=next.toolSets.map(set=>set.layout==='uniform'&&set.toolIds.some(id=>changed.has(id))&&!setCoherence(next,[set]).satisfied.includes(set.id)?{...set,layout:'auto'}:set);
}

function rotateSelection(project,toolIds,degrees,absolute){
  let {next,ids,tools,modules}=selection(project,toolIds);
  const turn=finite(degrees,'otočení');
  if(!ids.size||tools.every(tool=>angle((absolute?0:tool.rotation||0)+turn)===angle(tool.rotation||0)))return next;
  unlockedTools(next,tools,modules);
  for(const tool of tools){
    const old=bounds(tool);tool.rotation=angle((absolute?0:tool.rotation||0)+turn);const rotated=bounds(tool);
    tool.x=old.x+(old.width-rotated.width)/2;tool.y=old.y+(old.height-rotated.height)/2;
  }
  // Compute every footprint in isolation; neighbours are checked together against the final result.
  for(const id of modules){
    const module=next.modules.find(m=>m.id===id);if(!module||module.sizeMode==='manual')continue;
    const own=next.tools.filter(t=>t.moduleId===id);
    // Editing a member of a shared module must not move its unselected neighbours or the container.
    if(module.grouped||own.length>1)continue;
    const depths=new Map(own.map(t=>[t.id,t.depth]));
    // The footprint calculation does not alter depth: an existing depth warning must not block a geometry edit.
    const isolated={...next,modules:[module],tools:own.map(t=>({...t,depth:Math.min(t.depth,next.insertHeight-next.base),pocketMagnets:[]}))};
    const resized=resizeModule(isolated,id,{mode:'auto'});
    const magnets=new Map(own.map(t=>[t.id,t.pocketMagnets]));
    const byId=new Map(resized.tools.map(t=>{const {pocketMagnets,...rest}=t,kept=magnets.get(t.id);return[t.id,{...rest,depth:depths.get(t.id),...(kept?{pocketMagnets:kept}:{})}];}));
    next={...next,modules:next.modules.map(m=>m.id===id?resized.modules[0]:m),tools:next.tools.map(t=>byId.get(t.id)||t)};
  }
  checked(project,next,ids,modules,{geometry:true});releaseUniform(next,ids,modules);return next;
}

/** Turn selected outlines by the same angle about their own centres. Shared modules stay fixed. */
export function bulkRotate(project,toolIds,degrees=90){return rotateSelection(project,toolIds,degrees,false);}

/** Set each selected outline to one absolute heading, preserving every unselected member. */
export function bulkSetRotation(project,toolIds,degrees){return rotateSelection(project,toolIds,degrees,true);}

/** Move entire touched modules and every pocket in them by the same vector. */
export function bulkMove(project,toolIds,{dx,dy}={}){
  const {next,ids,tools,modules}=selection(project,toolIds);
  const x=finite(dx,'posun X'),y=finite(dy,'posun Y');
  if(!ids.size||(x===0&&y===0))return next;
  unlocked(next,ids,modules);
  if(tools.some(t=>!t.moduleId||!next.modules.some(m=>m.id===t.moduleId)))throw i18nError('Nejprve umístěte alespoň jeden modul.');
  for(const module of next.modules)if(modules.has(module.id)){module.x+=x;module.y+=y;}
  for(const tool of next.tools)if(modules.has(tool.moduleId)){tool.x+=x;tool.y+=y;}
  return checked(project,next,ids,modules,{geometry:true});
}

/** Move only the selected pockets; every module and unselected sibling stays fixed. */
export function bulkMoveTools(project,toolIds,{dx,dy}={}){
  const {next,ids,tools,modules}=selection(project,toolIds),x=finite(dx,'posun X'),y=finite(dy,'posun Y');
  if(!ids.size||(x===0&&y===0))return next;
  placed(next,tools);unlockedTools(next,tools,modules);
  for(const tool of tools){tool.x+=x;tool.y+=y;}
  return checked(project,next,ids,modules,{geometry:true});
}

/** Align rotated raw bounds to the selected bounds envelope inside one fixed module. */
export function bulkAlignTools(project,toolIds,{axis,edge}={}){
  const {next,ids,tools,modules}=selection(project,toolIds),size=axisKey(axis);
  if(!['min','center','max'].includes(edge))throw i18nError('Zvolte zarovnání na začátek, střed nebo konec.');
  if(tools.length<2)throw i18nError('Pro zarovnání vyberte alespoň dva nástroje.');
  singleModule(next,tools,modules);unlockedTools(next,tools,modules);
  const items=tools.map(tool=>({tool,b:bounds(tool)})),min=Math.min(...items.map(i=>i.b[axis])),max=Math.max(...items.map(i=>i.b[axis]+i.b[size]));
  const ratio={min:0,center:.5,max:1}[edge],target=min+(max-min)*ratio;
  for(const {tool,b} of items)tool[axis]+=target-b[axis]-b[size]*ratio;
  return checked(project,next,ids,modules,{geometry:true});
}

/** Give selected raw bounds equal nonnegative gaps; the two outer tools stay in place. */
export function bulkDistributeTools(project,toolIds,{axis}={}){
  const {next,ids,tools,modules}=selection(project,toolIds),size=axisKey(axis);
  if(tools.length<3)throw i18nError('Pro stejné mezery vyberte alespoň tři nástroje.');
  singleModule(next,tools,modules);unlockedTools(next,tools,modules);
  const items=tools.map(tool=>({tool,b:bounds(tool)})).sort((a,b)=>a.b[axis]-b.b[axis]||a.tool.id.localeCompare(b.tool.id));
  const first=items[0],last=items.at(-1),gap=(last.b[axis]+last.b[size]-first.b[axis]-items.reduce((sum,i)=>sum+i.b[size],0))/(items.length-1);
  if(gap<-.0000001)throw i18nError('Mezi nástroji není dost místa pro stejné mezery.');
  let cursor=first.b[axis]+first.b[size]+Math.max(0,gap);
  for(const {tool,b} of items.slice(1,-1)){tool[axis]+=cursor-b[axis];cursor+=b[size]+Math.max(0,gap);}
  return checked(project,next,ids,modules,{geometry:true});
}

/** Explicitly replace or clear selected finger bays, including on position-locked modules. */
export function bulkFingerGrips(project,toolIds,{mode,radius=9}={}){
  const {next,ids,tools,modules}=selection(project,toolIds);
  if(!['auto','clear'].includes(mode))throw i18nError('Zvolte automatické výřezy nebo jejich odstranění.');
  if(!ids.size)return next;
  placed(next,tools);
  for(const tool of tools)tool.fingerGrips=mode==='auto'?automaticFingerGrips(tool,{radius}):[];
  return checked(project,next,ids,modules,{geometry:true});
}

/** Delete only selected tools; remove their newly empty modules, retain blank fillers and clean set references. */
export function bulkDelete(project,toolIds){
  const {next,ids,modules}=selection(project,toolIds);
  if(!ids.size)return next;
  next.tools=next.tools.filter(t=>!ids.has(t.id));
  next.modules=next.modules.filter(m=>!modules.has(m.id)||next.tools.some(t=>t.moduleId===m.id));
  if(Array.isArray(next.toolSets)){
    next.toolSets=next.toolSets.map(set=>({...set,toolIds:set.toolIds.filter(id=>!ids.has(id))})).filter(set=>set.toolIds.length);
    const sets=new Map(next.toolSets.map(set=>[set.id,set]));
    for(const module of next.modules)if(module.setId){
      const set=sets.get(module.setId);
      if(!set||!next.tools.some(t=>t.moduleId===module.id&&set.toolIds.includes(t.id))){delete module.setId;delete module.setLayout;}
    }
  }
  releaseUniform(next,ids,modules);return checked(project,next,ids,modules);
}

/** Set only selected pocket depths. Position locks do not prevent a depth edit. */
export function bulkSetDepth(project,toolIds,depth){
  const {next,ids,tools,modules}=selection(project,toolIds),value=finite(depth,'hloubku kapsy'),max=Math.min(maxPocketDepth(next),...tools.map(tool=>maxPocketDepth(next,tool)));
  if(value<.5||value>max+.0000001)throw i18nError('Hloubka kapsy musí být od {min} do {max}.',{min:fmtLen(.5),max:fmtLen(max)});
  for(const tool of tools)tool.depth=Math.min(max,value);
  return checked(project,next,ids,modules,{depth:true});
}

/** Position lock applies to every tool of each touched module, including unselected siblings. */
export function bulkLock(project,toolIds,locked){
  const {next,ids,modules}=selection(project,toolIds);
  if(typeof locked!=='boolean')throw i18nError('Zvolte zamknutí nebo odemknutí polohy.');
  for(const module of next.modules)if(modules.has(module.id))module.locked=locked;
  for(const tool of next.tools)if(ids.has(tool.id)||modules.has(tool.moduleId))tool.locked=locked;
  validateProject(next);return next;
}
