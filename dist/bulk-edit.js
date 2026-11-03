// Atomic editing of a tool selection. All lengths are stored millimetres, independent of display units.
import {clone,validateProject} from './model.js';
import {bounds,resizeModule,validateLayout} from './geometry.js';
import {validatePrintBed} from './print-geometry.js';
import {setCoherence} from './tool-sets.js';
import {i18nError,t} from './i18n.js';
import {fmtLen} from './units.js';

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
  if(value===null||typeof value==='boolean'||value===''||!Number.isFinite(n))throw i18nError('Zadejte platnou hodnotu pro {label}.',{label:t(label)});
  return n;
}
function unlocked(next,ids,modules){
  if(next.modules.some(m=>modules.has(m.id)&&m.locked)||next.tools.some(t=>(ids.has(t.id)||modules.has(t.moduleId))&&t.locked))throw i18nError('Nejprve odemkněte polohu modulu.');
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
    validatePrintBed(next,own);
  }
  return next;
}
function releaseUniform(next,ids,modules){
  if(!Array.isArray(next.toolSets))return;
  const changed=affected(next,ids,modules);
  next.toolSets=next.toolSets.map(set=>set.layout==='uniform'&&set.toolIds.some(id=>changed.has(id))&&!setCoherence(next,[set]).satisfied.includes(set.id)?{...set,layout:'auto'}:set);
}

/** Rotate selected outlines about their own centres; resize automatic modules without repacking other modules. */
export function bulkRotate(project,toolIds,degrees=90){
  let {next,ids,tools,modules}=selection(project,toolIds);
  const turn=finite(degrees,'otočení');
  if(!ids.size||angle(turn)===0)return next;
  unlocked(next,ids,modules);
  for(const tool of tools){
    const old=bounds(tool);tool.rotation=angle((tool.rotation||0)+turn);const rotated=bounds(tool);
    tool.x=old.x+(old.width-rotated.width)/2;tool.y=old.y+(old.height-rotated.height)/2;
  }
  // Compute every footprint in isolation; neighbours are checked together against the final result.
  for(const id of modules){
    const module=next.modules.find(m=>m.id===id);if(!module||module.sizeMode==='manual')continue;
    const own=next.tools.filter(t=>t.moduleId===id),depths=new Map(own.map(t=>[t.id,t.depth]));
    // The footprint calculation does not alter depth: an existing depth warning must not block a geometry edit.
    const isolated={...next,modules:[module],tools:own.map(t=>({...t,depth:Math.min(t.depth,next.insertHeight-next.base)}))};
    const resized=resizeModule(isolated,id,{mode:'auto'});
    const byId=new Map(resized.tools.map(t=>[t.id,{...t,depth:depths.get(t.id)}]));
    next={...next,modules:next.modules.map(m=>m.id===id?resized.modules[0]:m),tools:next.tools.map(t=>byId.get(t.id)||t)};
  }
  checked(project,next,ids,modules,{geometry:true});releaseUniform(next,ids,modules);return next;
}

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
  const {next,ids,tools,modules}=selection(project,toolIds),value=finite(depth,'hloubku kapsy'),max=Math.min(99,next.insertHeight-next.base);
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
