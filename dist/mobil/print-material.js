// Colour printing: which parts of the model get their own filament.
import {magnetPocketCenters} from './magnet-pockets.js';
import {MAGNET_COVER,hasPocketMagnets,pocketMagnetHoles} from './tool-magnet.js';

export const MATERIAL_DEFAULTS={enabled:false,floor:true,text:true,floorThickness:.6,bodyColor:'#2f3a45',floorColor:'#e7a039',textColor:'#ffffff'};
export const FLOOR_THICKNESS={min:.2,max:2};
// Material that must stay under a floor inlay, so a pocket never breaks through the bottom.
export const FLOOR_RESERVE=.6;
const colour=(value,fallback)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():fallback;

/** Complete, valid colour settings of a project. Old projects have none and print in one colour. */
export function materialConfig(project){
  const source=project?.multiMaterial&&typeof project.multiMaterial==='object'?project.multiMaterial:{},thickness=Number(source.floorThickness),d=MATERIAL_DEFAULTS;
  return{enabled:source.enabled===true,floor:source.floor!==false,text:source.text!==false,floorThickness:Number.isFinite(thickness)?Math.min(FLOOR_THICKNESS.max,Math.max(FLOOR_THICKNESS.min,thickness)):d.floorThickness,bodyColor:colour(source.bodyColor,d.bodyColor),floorColor:colour(source.floorColor,d.floorColor),textColor:colour(source.textColor,d.textColor)};
}

const number=(value,fallback)=>Number.isFinite(+value)?+value:fallback;
const depthAllowance=project=>{
  const base=number(project?.base,2.4),config=materialConfig(project);
  if(!config.enabled||!config.floor)return base;
  if(project?.printMode==='light')return base+config.floorThickness;
  const magnetic=project?.bottomMode==='magnet',magnetDepth=number(project?.magnetDepth,2.2);
  const extraBase=magnetic?Math.max(base,magnetDepth+1.2)-base:0;
  // Without inspecting pocket positions, preserve the reserve even above a magnet.
  return Math.max(base,config.floorThickness+FLOOR_RESERVE+(magnetic?magnetDepth:0)-extraBase);
};

export const floorInlay=project=>{const config=materialConfig(project);return config.enabled&&config.floor?config.floorThickness:0;};
const bottomBase=project=>{
  const base=number(project?.base,2.4);
  return project?.bottomMode==='magnet'?Math.max(base,number(project?.magnetDepth,2.2)+1.2):base;
};
function bottomMagnets(project,tool){
  if(project?.bottomMode!=='magnet')return[];
  const module=(project.modules||[]).find(item=>item.id===tool.moduleId);if(!module)return[];
  // A module too small for its bottom magnets is reported by the export itself.
  try{return magnetPocketCenters(project,module,{diameter:number(project.magnetDiameter,6.2),wall:number(project.wall,2.4)});}catch{return[];}
}

/** Material a tool's magnet holes need between the module underside and the visible pocket floor. */
export function magnetFloorNeed(project,tool){
  if(!hasPocketMagnets(tool))return 0;
  // An invalid contour is reported by validateLayout; it must not break its neighbours' limits.
  let holes;try{holes=pocketMagnetHoles(tool);}catch{return 0;}
  const inlay=floorInlay(project),below=bottomMagnets(project,tool),depth=number(project?.magnetDepth,2.2);
  return Math.max(...holes.map(hole=>{
    // A hole over a bottom magnet must also clear that magnet, not just the underside.
    const stacked=below.some(magnet=>Math.hypot(magnet.x-hole.x,magnet.y-hole.y)<magnet.radius+hole.radius+MAGNET_COVER);
    return Math.max(hole.depth,inlay)+MAGNET_COVER+(stacked?depth:0);
  }));
}

/** Light models have one flat base, so a magnet hole thickens the base of its whole module. */
export function moduleMagnetLift(project,tools){
  if(project?.printMode!=='light'||!tools.some(hasPocketMagnets))return 0;
  return Math.max(0,Math.max(...tools.map(tool=>magnetFloorNeed(project,tool)))-floorInlay(project)-bottomBase(project));
}

const depthLimit=(project,allowance)=>Math.max(0,Math.min(99,Math.floor((number(project?.insertHeight,20)-allowance+1e-9)*10000)/10000));
const heightLimit=height=>Math.max(3,Math.ceil((height-1e-9)*100)/100);

/** Per-tool limits for repeated queries: light models share the lift across a module,
 * solid models need only the tool's own floor. Tools are grouped once per call. */
export function pocketHeightLimits(project){
  const general=depthAllowance(project),all=project?.tools||[],light=project?.printMode==='light',magnetic=all.some(hasPocketMagnets),lifts=new Map();
  let groups=null;
  const lift=tool=>{
    if(!light||(!magnetic&&!hasPocketMagnets(tool)))return 0;
    const own=moduleMagnetLift(project,[tool]),id=tool?.moduleId??null;if(!id)return own;
    if(!groups){groups=new Map();for(const item of all){if(!groups.has(item.moduleId))groups.set(item.moduleId,[]);groups.get(item.moduleId).push(item);}}
    if(!lifts.has(id))lifts.set(id,moduleMagnetLift(project,groups.get(id)||[]));
    return Math.max(lifts.get(id),own);
  };
  const allowance=tool=>{
    if(light)return general+lift(tool);
    if(!hasPocketMagnets(tool))return general;
    return Math.max(general,magnetFloorNeed(project,tool)-(bottomBase(project)-number(project?.base,2.4)));
  };
  const rawHeight=tool=>Math.max(.5,number(tool?.depth,10))+allowance(tool);
  return{rawHeight,maxDepth:tool=>depthLimit(project,allowance(tool)),requiredHeight:tool=>heightLimit(rawHeight(tool)),affected:tool=>hasPocketMagnets(tool)||lift(tool)>1e-9};
}

/** Safe editor limit, including the material reserved for an enabled floor inlay and, for a
 * given tool, its magnet holes. A value below the model's 0.5 mm minimum means the insert
 * must first be made taller.
 */
export function maxPocketDepth(project,tool=null){
  return tool?pocketHeightLimits(project).maxDepth(tool):depthLimit(project,depthAllowance(project));
}

/** Minimum insert height for the supplied depths, without changing the project.
 * Only placed tools count by default. Round upwards to 0.01 mm; values above
 * the model's 100 mm height limit remain visible to the caller.
 */
export function requiredInsertHeight(project,tools){
  if(!tools){const moduleIds=new Set((project?.modules||[]).map(module=>module.id));tools=(project?.tools||[]).filter(tool=>moduleIds.has(tool.moduleId));}
  if(!tools.length)return 3;
  const limits=pocketHeightLimits(project);
  return heightLimit(tools.reduce((tallest,tool)=>Math.max(tallest,limits.rawHeight(tool)),0));
}

/** Filament slots in the slicer: one per distinct colour, the body always first. */
export function materialSlots(config){
  const slots=[],slot=color=>{const known=slots.indexOf(color);if(known>=0)return known+1;slots.push(color);return slots.length;};
  const zones={body:slot(config.bodyColor)};
  if(config.floor)zones.floor=slot(config.floorColor);
  if(config.text)zones.text=slot(config.textColor);
  return{zones,colors:slots};
}
