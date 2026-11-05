// Length units. All model and manufacturing data stays in millimetres; units only
// affect what the user sees and types. The effective unit is resolved as
//   tool/module override (tool.unit, module.unit; see unitFor) →
//   per-drawer override (project.unit) → app default (saved preference).
// Any length field also accepts an explicit unit in the typed text
// ("12 in", "3 1/2\"", "30 cm", "1' 2\"", "15mm"), so units can be mixed freely.
import {locale} from './i18n.js';

export const UNITS=['mm','in'];
export const MM_PER={mm:1,cm:10,m:1000,in:25.4,ft:304.8};
const UNIT_KEY='insertcreator-mobile:suplik-studio-unit';
const listeners=new Set();

function storage(){try{return typeof document==='undefined'?null:globalThis.localStorage||null;}catch{return null;}}
function detect(){
  try{const saved=storage()?.getItem(UNIT_KEY);if(saved&&UNITS.includes(JSON.parse(saved)))return JSON.parse(saved);}catch{}
  if(typeof document==='undefined')return 'mm';
  const pref=String(globalThis.navigator?.language||'');
  return /^en-(US|LR)$|^my\b/i.test(pref)?'in':'mm';
}
let appUnit=detect(),projectUnit='';

export const getAppUnit=()=>appUnit;
export const getProjectUnit=()=>projectUnit;
/** Effective display/input unit. */
export const unit=()=>projectUnit||appUnit;
// Listeners fire only when the effective unit actually changes.
const notifyIfChanged=before=>{if(unit()!==before)for(const fn of listeners)try{fn(unit());}catch{}};
export function setAppUnit(next,{save=true}={}){
  if(!UNITS.includes(next))return appUnit;
  const before=unit();appUnit=next;
  if(save)try{storage()?.setItem(UNIT_KEY,JSON.stringify(next));}catch{}
  notifyIfChanged(before);return appUnit;
}
/** '' = follow app default. Called by the editor whenever the active drawer changes. */
export function setProjectUnit(next){const before=unit();projectUnit=UNITS.includes(next)?next:'';notifyIfChanged(before);return projectUnit;}
export function onUnitChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}

/**
 * Unit for one specific item. Resolution order: the first valid override given
 * (e.g. tool.unit, then module.unit), then the drawer override, then the app default.
 * Example: unitFor(tool.unit) or unitFor(tool.unit, module?.unit).
 */
export const unitFor=(...overrides)=>overrides.find(u=>UNITS.includes(u))||unit();
/** Default number of decimals shown for a unit. */
export const unitDigits=(u=unit())=>u==='in'?3:1;
export const toUnit=(mm,u=unit())=>Number(mm)/MM_PER[u];
export const fromUnit=(value,u=unit())=>Number(value)*MM_PER[u];
/** Value for an <input>: converted, rounded, no thousands separator, '.' decimal. */
export function inputValue(mm,{unit:u=unit(),digits}={}){const d=digits??unitDigits(u);const v=toUnit(mm,u);return String(Math.round(v*10**d)/10**d);}
/** Localised display text, e.g. "504 mm" or "19.843 in". */
export function fmtLen(mm,{unit:u=unit(),digits,suffix=true}={}){
  const d=digits??unitDigits(u);
  const text=toUnit(mm,u).toLocaleString(locale(),{maximumFractionDigits:d});
  return suffix?`${text} ${u}`:text;
}
/** "W × H unit" display. */
export function fmtSize(...args){const opts=typeof args.at(-1)==='object'?args.pop():{};const u=opts.unit||unit();return args.map(v=>fmtLen(v,{...opts,unit:u,suffix:false})).join(' × ')+` ${u}`;}
/** Input `step` attribute in the given unit for a step defined in mm. */
export const inputStep=(stepMm=1,u=unit())=>u==='in'?(stepMm>=1?0.01:0.001):stepMm;

const UNIT_ALIASES={mm:'mm',millimetr:'mm',millimeter:'mm',millimetre:'mm',milimetr:'mm',milimetry:'mm',milimetrů:'mm',cm:'cm',centimetr:'cm',m:'m',in:'in',inch:'in',inches:'in',palec:'in',palce:'in',palců:'in','"':'in','″':'in','”':'in',ft:'ft',foot:'ft',feet:'ft',stopa:'ft',stopy:'ft',"'":'ft','′':'ft','’':'ft'};
const NUMBER=String.raw`(\d+(?:[.,]\d+)?(?:\s+|-)\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[.,]\d+)`;
const TOKEN=new RegExp(String.raw`^\s*${NUMBER}\s*([a-zA-Zčěšřžýáíéůúňťď"'″”′’]*)`);
function parseNumber(text){
  const s=text.trim().replace(',','.');
  let m=s.match(/^(\d+(?:\.\d+)?)(?:\s+|-)(\d+)\/(\d+)$/);
  if(m)return Number(m[1])+Number(m[2])/Number(m[3]);
  m=s.match(/^(\d+)\/(\d+)$/);if(m)return Number(m[1])/Number(m[2]);
  return Number(s);
}
/**
 * Parse a typed length to millimetres. Numbers without a unit use `defaultUnit`.
 * Supports decimals with '.' or ',', fractions ("3/4", "1 1/2", "1-1/2"), and
 * compound feet+inches ("1' 2\"", "2 ft 3 in"). Returns NaN for invalid input.
 */
export function parseLength(input,defaultUnit=unit()){
  if(typeof input==='number')return Number.isFinite(input)?fromUnit(input,defaultUnit):NaN;
  let rest=String(input??'').trim().toLowerCase();if(!rest)return NaN;
  let sign=1;if(rest.startsWith('-')){sign=-1;rest=rest.slice(1);}
  let total=0,parts=0,last='';
  while(rest.trim()){
    const m=rest.match(TOKEN);if(!m)return NaN;
    const n=parseNumber(m[1]);if(!Number.isFinite(n))return NaN;
    const label=m[2];let u=defaultUnit;
    if(label){u=UNIT_ALIASES[label];if(!u)return NaN;}
    else if(last==='ft')u='in'; // "1' 2" → bare number after feet = inches
    total+=n*MM_PER[u];parts++;last=u;rest=rest.slice(m[0].length);
    if(parts>3)return NaN;
  }
  return sign*total;
}
export const unitLabel=(u=unit())=>u;
