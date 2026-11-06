// Atomic shell merging for an already translated editor proposal. Tool poses are world coordinates.
import {validateProject} from './model.js';
import {validateLayout} from './geometry.js';
import {moduleIntersects,validateModuleFootprint} from './module-footprint.js';
import {effectivePocketMargin} from './pocket-margin.js';
import {setCoherence} from './tool-sets.js';
import {getAppUnit,unitFor} from './units.js';
import {i18nError} from './i18n.js';

const EPS=1e-7,MAX_CELLS=4096;
const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const issueError=issue=>Object.assign(Error(issue.message),{i18n:issue.i18n});
const issueKey=issue=>JSON.stringify([issue.type,[...issue.ids].sort(),issue.i18n?.cs||issue.message,Object.entries(issue.i18n?.params||{}).sort(([a],[b])=>a.localeCompare(b))]);
const itemUnit=(tool,project)=>unitFor(tool.unit,project.modules.find(module=>module.id===tool.moduleId)?.unit,project.unit,getAppUnit());
const aligned=(module,grid)=>[module.x,module.y,module.width,module.height].every(value=>Number.isFinite(value)&&Math.abs(value/grid-Math.round(value/grid))<=EPS);

function footprint(modules,project){
  const grid=project.grid,x=Math.min(...modules.map(module=>module.x)),y=Math.min(...modules.map(module=>module.y));
  if(!modules.every(module=>aligned(module,grid))){
    if(project.bottomMode==='grid'||modules.some(module=>module.cells))throw i18nError('Moduly lze bezpečně sloučit jen v rastru šuplíku.');
    return{x,y,width:Math.max(...modules.map(module=>module.x+module.width))-x,height:Math.max(...modules.map(module=>module.y+module.height))-y};
  }
  const left=Math.round(x/grid),top=Math.round(y/grid),cells=new Map();
  const add=(cx,cy)=>{
    const key=cx+','+cy;if(!cells.has(key))cells.set(key,{x:cx,y:cy});
    if(cells.size>MAX_CELLS)throw i18nError('Sloučený modul je příliš velký pro bezpečné zpracování rastru.');
  };
  for(const module of modules){
    const dx=Math.round(module.x/grid)-left,dy=Math.round(module.y/grid)-top;
    if(module.cells)for(const cell of module.cells)add(cell.x+dx,cell.y+dy);
    else for(let row=0;row<Math.round(module.height/grid);row++)for(let col=0;col<Math.round(module.width/grid);col++)add(col+dx,row+dy);
  }
  const all=[...cells.values()],cols=Math.max(...all.map(cell=>cell.x))+1,rows=Math.max(...all.map(cell=>cell.y))+1;
  const result={x,y,width:cols*grid,height:rows*grid};
  if(all.length===cols*rows)return result;
  return{...result,...validateModuleFootprint({...result,shape:'stepped',cells:all},grid)};
}

/**
 * Merge overlap components reached from moduleIds, after the caller's rigid translation.
 * The first seed in each component survives; no overlap returns the original object.
 * The source is never mutated, including on failure. No packing, pocket scaling or rotation occurs.
 */
export function mergeOverlappingModules(project,moduleIds){
  const seeds=[...new Set(moduleIds||[])];if(!seeds.length)return project;
  validateProject(project);
  const byId=new Map(project.modules.map(module=>[module.id,module])),visited=new Set(),components=[];
  for(const seed of seeds){
    if(!byId.has(seed))throw i18nError('Vybraný modul neexistuje.');
    if(visited.has(seed))continue;
    const component=[byId.get(seed)];visited.add(seed);
    for(let i=0;i<component.length;i++)for(const module of project.modules){
      if(visited.has(module.id)||!moduleIntersects(component[i],module,project.grid))continue;
      visited.add(module.id);component.push(module);
    }
    if(component.length>1)components.push(component);
  }
  if(!components.length)return project;
  const mergedSources=new Set(components.flatMap(component=>component.map(module=>module.id))),affectedTools=project.tools.filter(tool=>mergedSources.has(tool.moduleId));
  if(components.some(component=>component.some(module=>module.locked))||affectedTools.some(tool=>tool.locked))throw i18nError('Překrývající se moduly nelze sloučit, protože je modul nebo nástroj zamčený.');
  if(project.bottomMode==='grid'&&Math.abs(project.grid-42)>.001)throw i18nError('Gridfinity patky vyžadují rastr přesně 42 mm.');
  const beforeDepth=new Set(validateLayout(project,{affectedIds:mergedSources}).filter(issue=>issue.type==='depth').map(issueKey));
  const protectedSets=(project.toolSets||[]).filter(set=>set.layout==='shared'||set.layout==='uniform'||set.arrangement!=null||set.order!=null);
  const coherentBefore=new Set(setCoherence(project,protectedSets).satisfied);
  const oldMargins=new Map(affectedTools.map(tool=>[tool.id,effectivePocketMargin(tool,project)]));
  const oldUnits=new Map(affectedTools.map(tool=>[tool.id,itemUnit(tool,project)]));
  const next=copy(project),replacement=new Map(),removed=new Set(),mergedIds=new Set();
  for(const component of components){
    const source=component[0],ids=new Set(component.map(module=>module.id)),own=project.tools.filter(tool=>ids.has(tool.moduleId));
    const fields=footprint(component,project),module={...copy(source),grouped:true,sizeMode:'manual'};
    delete module.cells;delete module.shape;
    Object.assign(module,fields);
    const set=(project.toolSets||[]).find(set=>set.id===module.setId),members=new Set(own.map(tool=>tool.id));
    const pure=set&&members.size===set.toolIds.length&&set.toolIds.every(id=>members.has(id));
    if(!pure||!component.every(item=>item.setId===source.setId&&item.setLayout===source.setLayout)){delete module.setId;delete module.setLayout;}
    if(project.bottomMode==='grid'&&[module.x,module.y,module.width,module.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Rozměry i poloha modulu musí být v násobcích 42 mm pro Gridfinity patky.');
    replacement.set(source.id,module);mergedIds.add(source.id);
    for(const item of component){replacement.set(item.id,module);if(item.id!==source.id)removed.add(item.id);}
  }
  next.modules=next.modules.filter(module=>!removed.has(module.id)).map(module=>replacement.get(module.id)||module);
  for(const tool of next.tools){
    const module=replacement.get(tool.moduleId);if(!module)continue;
    tool.moduleId=module.id;
    if(effectivePocketMargin(tool,next)!==oldMargins.get(tool.id))tool.pocketMargin=oldMargins.get(tool.id);
    if(itemUnit(tool,next)!==oldUnits.get(tool.id))tool.unit=oldUnits.get(tool.id);
  }
  validateProject(next);
  const affected=new Set([...mergedIds,...affectedTools.map(tool=>tool.id)]);
  for(const issue of validateLayout(next,{affectedIds:affected})){
    if(issue.ids.length&&!issue.ids.some(id=>affected.has(id)))continue;
    if(issue.type==='depth'&&beforeDepth.has(issueKey(issue)))continue;
    throw issueError(issue);
  }
  const coherentAfter=new Set(setCoherence(next,protectedSets).satisfied);
  const broken=protectedSets.find(set=>coherentBefore.has(set.id)&&!coherentAfter.has(set.id));
  if(broken)throw i18nError('Spojení modulů by změnilo nastavené uspořádání sady „{name}“.',{name:broken.name});
  return next;
}
