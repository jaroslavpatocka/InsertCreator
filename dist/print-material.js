// Colour printing: which parts of the model get their own filament.
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

/** Safe editor limit, including the material reserved for an enabled floor inlay.
 * A value below the model's 0.5 mm minimum means the insert must first be made taller.
 */
export function maxPocketDepth(project){
  return Math.max(0,Math.min(99,Math.floor((number(project?.insertHeight,20)-depthAllowance(project)+1e-9)*10000)/10000));
}

/** Minimum insert height for the supplied depths, without changing the project.
 * Only placed tools count by default. Round upwards to 0.01 mm; values above
 * the model's 100 mm height limit remain visible to the caller.
 */
export function requiredInsertHeight(project,tools){
  if(!tools){const moduleIds=new Set((project?.modules||[]).map(module=>module.id));tools=(project?.tools||[]).filter(tool=>moduleIds.has(tool.moduleId));}
  if(!tools.length)return 3;
  const depth=tools.reduce((deepest,tool)=>Math.max(deepest,number(tool?.depth,10)),.5);
  return Math.max(3,Math.ceil((depth+depthAllowance(project)-1e-9)*100)/100);
}

/** Filament slots in the slicer: one per distinct colour, the body always first. */
export function materialSlots(config){
  const slots=[],slot=color=>{const known=slots.indexOf(color);if(known>=0)return known+1;slots.push(color);return slots.length;};
  const zones={body:slot(config.bodyColor)};
  if(config.floor)zones.floor=slot(config.floorColor);
  if(config.text)zones.text=slot(config.textColor);
  return{zones,colors:slots};
}
