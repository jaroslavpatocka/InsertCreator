// Size label appearance: drawer-wide defaults and per-tool overrides. No dependencies, so model.js can use it.
export const LABEL_LIMITS={size:{min:2.8,max:30},relief:{min:.2,max:5},offset:3000};
export const LABEL_DEFAULTS={size:3.5,engraved:.35,raised:1};

const clamp=(value,{min,max})=>Math.min(max,Math.max(min,value));
const hundredth=value=>Math.round(value*100)/100;
const given=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));

/** Keeps only valid fields. Imported files are clamped rather than rejected: a label is never worth losing a project. */
export function normalizeLabelStyle(style,{position=true}={}){
  if(!style||typeof style!=='object'||Array.isArray(style))return undefined;
  const out={};
  if(given(style.size))out.size=hundredth(clamp(Number(style.size),LABEL_LIMITS.size));
  if(given(style.relief))out.relief=hundredth(clamp(Number(style.relief),LABEL_LIMITS.relief));
  if(given(style.rotation))out.rotation=hundredth(((Number(style.rotation)%360)+360)%360)%360;
  if(typeof style.background==='boolean')out.background=style.background;
  if(typeof style.color==='string'&&/^#[0-9a-f]{6}$/i.test(style.color))out.color=style.color.toLowerCase();
  if(position&&given(style.dx)&&given(style.dy)){
    const limit={min:-LABEL_LIMITS.offset,max:LABEL_LIMITS.offset};
    out.dx=hundredth(clamp(Number(style.dx),limit));out.dy=hundredth(clamp(Number(style.dy),limit));
  }
  return Object.keys(out).length?out:undefined;
}

/** The effective appearance of one label. An unset rotation or position leaves the choice to the planner. */
export function labelStyleFor(project,tool){
  const style={...normalizeLabelStyle(project?.sizeLabelStyle,{position:false}),...normalizeLabelStyle(tool?.labelStyle)};
  return{size:style.size??LABEL_DEFAULTS.size,relief:style.relief??null,rotation:style.rotation??null,background:style.background!==false,color:style.color??null,position:Object.hasOwn(style,'dx')?{dx:style.dx,dy:style.dy}:null};
}
