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

/** Filament slots in the slicer: one per distinct colour, the body always first. */
export function materialSlots(config){
  const slots=[],slot=color=>{const known=slots.indexOf(color);if(known>=0)return known+1;slots.push(color);return slots.length;};
  const zones={body:slot(config.bodyColor)};
  if(config.floor)zones.floor=slot(config.floorColor);
  if(config.text)zones.text=slot(config.textColor);
  return{zones,colors:slots};
}
