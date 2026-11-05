import {i18nError} from './i18n.js';

export const DEFAULT_POCKET_MARGIN=.8;
export const MAX_POCKET_MARGIN=10;

/** A radial/side allowance in millimetres; parsing display units belongs to UI. */
export function validatePocketMargin(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>MAX_POCKET_MARGIN)throw i18nError('Přídavek kapsy musí být číslo od {min} do {max} mm.',{min:0,max:MAX_POCKET_MARGIN});
  return value;
}

/** Null and an absent field both mean inherit, while zero is an explicit value. */
export function optionalPocketMargin(value){
  return value==null?undefined:validatePocketMargin(value);
}
// Legacy geometry accepts explicit offsets up to 6000 mm. Keep that range for
// the old fallback so invalid layouts still receive their original diagnostics.
function legacyMargin(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>6000)throw i18nError('Přídavek kapsy musí být číslo od {min} do {max} mm.',{min:0,max:6000});
  return value;
}

/** Resolve one pocket without changing the tool, module or drawer.
 * Tool override -> its own module -> the legacy drawer clearance.
 * A numeric context preserves legacy pocketOutline(tool, clearance) callers;
 * its default zero also preserves construction-time attachment checks.
 */
export function effectivePocketMargin(tool,context=0){
  const own=optionalPocketMargin(tool?.pocketMargin);
  if(own!==undefined)return own;
  if(context&&typeof context==='object'&&!Array.isArray(context)){
    const module=tool?.moduleId!=null&&Array.isArray(context.modules)?context.modules.find(item=>item?.id===tool.moduleId):undefined;
    const inherited=optionalPocketMargin(module?.pocketMargin);
    if(inherited!==undefined)return inherited;
    return legacyMargin(context.clearance??DEFAULT_POCKET_MARGIN);
  }
  return legacyMargin(context);
}
