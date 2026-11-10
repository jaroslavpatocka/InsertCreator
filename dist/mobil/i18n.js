import enMenus from './locales/en-menus.js';
// Lightweight i18n. The Czech source text is the message key (gettext style);
// English translations live in ./locales/en-*.js, split per area so they can be
// maintained independently. Missing translations fall back to the Czech text.
import enApp from './locales/en-app.js';
import enCapture from './locales/en-capture.js';
import enCore from './locales/en-core.js';
import enMagnet from './locales/en-magnet.js';
import enGuide from './locales/en-guide.js';
import enCustomModule from './locales/en-custom-module.js';

export const LANGS=['cs','en'];
export const LANG_NAMES={cs:'Čeština',en:'English'};
const LANG_KEY='insertcreator-mobile:suplik-studio-lang';
const dictionaries={cs:null,en:{...enCore,...enCapture,...enApp,...enMagnet,...enGuide,...enCustomModule,...enMenus}};
const listeners=new Set();

function storage(){try{return typeof document==='undefined'?null:globalThis.localStorage||null;}catch{return null;}}
function detect(){
  try{const saved=storage()?.getItem(LANG_KEY);if(saved&&LANGS.includes(JSON.parse(saved)))return JSON.parse(saved);}catch{}
  // Outside a browser document (Node tests, workers) keep the original Czech behaviour.
  if(typeof document==='undefined')return 'cs';
  const prefs=globalThis.navigator?.languages||[globalThis.navigator?.language||'cs'];
  for(const pref of prefs){const code=String(pref||'').slice(0,2).toLowerCase();if(code==='cs'||code==='sk')return 'cs';if(code)return 'en';}
  return 'cs';
}
let lang=detect();
if(typeof document!=='undefined'&&document.documentElement)document.documentElement.lang=lang;

export const getLang=()=>lang;
export const locale=()=>lang==='cs'?'cs-CZ':'en-US';
export function setLang(next,{save=true}={}){
  if(!LANGS.includes(next)||next===lang){return lang;}
  lang=next;
  if(save)try{storage()?.setItem(LANG_KEY,JSON.stringify(next));}catch{}
  if(typeof document!=='undefined')document.documentElement.lang=next;
  for(const fn of listeners)try{fn(lang);}catch{}
  return lang;
}
export function onLangChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}

const fill=(text,params)=>params?String(text).replace(/\{(\w+)\}/g,(m,k)=>Object.hasOwn(params,k)?String(params[k]):m):String(text);

/** Translate Czech source text `cs` to the active language. `{name}` placeholders are filled from `params`. */
export function t(cs,params){
  const dict=dictionaries[lang];
  const text=dict&&Object.hasOwn(dict,cs)?dict[cs]:cs;
  return fill(text,params);
}
/** Translate into an explicit language regardless of the active one. */
export function tIn(target,cs,params){const dict=dictionaries[target];return fill(dict&&Object.hasOwn(dict,cs)?dict[cs]:cs,params);}

/**
 * Pick a Czech plural form for n (forms: [one, few(2–4), many]) and translate it.
 * English translations of the "one" form are used for n===1, the others for the rest.
 * Example: plural(n,['{n} nástroj','{n} nástroje','{n} nástrojů'])
 */
export function plural(n,forms,params={}){
  const abs=Math.abs(Number(n));
  const form=abs===1?forms[0]:Number.isInteger(abs)&&abs>=2&&abs<=4?forms[1]:forms[2]??forms[1];
  return t(form,{n,...params});
}

/** Error whose message is translated now and can be re-translated later (e.g. after crossing a worker boundary). */
export function i18nError(cs,params){const error=Error(t(cs,params));error.i18n={cs,params};return error;}
/** Human readable, translated text of an error or message string. */
export function errorText(error){
  if(error?.i18n?.cs)return t(error.i18n.cs,error.i18n.params);
  const message=typeof error==='string'?error:error?.message;
  return message?t(message):'';
}

export const fmtNum=(value,digits=1)=>Number(value).toLocaleString(locale(),{maximumFractionDigits:digits});

/** For tests/tools: all English keys, to detect untranslated strings. */
export const _dictionaries=dictionaries;
