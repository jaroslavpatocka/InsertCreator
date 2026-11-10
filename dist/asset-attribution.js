// Provenance of third-party tool outlines (LIC-02). A catalogue item derived from an external 3D model
// (FreeCAD-library CC BY 3.0, Poly Haven CC0) gives its tool an `attribution` object. It survives project
// validation, saving, duplication and travels into manufacturing exports (ATTRIBUTION.txt, 3MF, SVG, PDF).
// Nothing is invented: a tool without known provenance simply has no attribution.
import {t} from './i18n.js';

const LIMITS={title:160,author:200,source:500,revision:80,license:40,licenseUrl:300,changes:1200};
const LICENSE_URLS={'CC-BY-3.0':'https://creativecommons.org/licenses/by/3.0/','CC-BY-4.0':'https://creativecommons.org/licenses/by/4.0/','CC0-1.0':'https://creativecommons.org/publicdomain/zero/1.0/'};
const LICENSE_NAMES={'CC-BY-3.0':'CC BY 3.0','CC-BY-4.0':'CC BY 4.0','CC0-1.0':'CC0 1.0'};
const PUBLIC_DOMAIN=new Set(['CC0-1.0']);
// Control characters (C0, DEL, C1) become spaces; all whitespace (incl. line/paragraph separators) is collapsed.
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
function webUrl(value,max){
  const text=clean(value,max);if(!text)return'';
  try{const url=new URL(text);return url.protocol==='https:'||url.protocol==='http:'?text:'';}catch{return'';}
}
const licenseId=value=>{const text=clean(value,LIMITS.license);return /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(text)?text:'unknown';};

/**
 * Normalised copy of an `attribution` object, or undefined when it carries no usable provenance.
 * Shape: {title?,author?,source?,revision?,license,licenseUrl?,changes?}; `license` is an SPDX-like id or 'unknown'.
 */
export function normalizeAttribution(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const title=clean(value.title,LIMITS.title),author=clean(value.author,LIMITS.author),source=webUrl(value.source,LIMITS.source);
  if(!title&&!author&&!source)return undefined;
  const license=licenseId(value.license),licenseUrl=webUrl(value.licenseUrl,LIMITS.licenseUrl)||LICENSE_URLS[license]||'';
  const revision=clean(value.revision,LIMITS.revision),changes=clean(value.changes,LIMITS.changes);
  return{...(title?{title}:{}),...(author?{author}:{}),...(source?{source}:{}),...(revision?{revision}:{}),license,...(licenseUrl?{licenseUrl}:{}),...(changes?{changes}:{})};
}

/** Attribution of a catalogue item from its `source` record; undefined for own/parametric items without an external source URL. */
export function catalogAttribution(item){
  const source=item?.source;
  if(!source||typeof source!=='object'||!webUrl(source.url,LIMITS.source))return undefined;
  return normalizeAttribution({title:source.title||source.name,author:source.author,source:source.url,revision:source.revision,license:source.license,licenseUrl:source.licenseUrl,changes:source.changes});
}

/** True when the licence does not require attribution (public-domain dedication such as CC0). */
export const isPublicDomain=attribution=>PUBLIC_DOMAIN.has(attribution?.license);
export const licenseName=id=>id==='unknown'||!id?t('neznámá licence'):LICENSE_NAMES[id]||id;

/** Unique attributions used by the given tools: [{attribution,tools:[tool names]}], attribution-required ones first. */
export function collectAttributions(tools=[]){
  const groups=new Map();
  for(const tool of Array.isArray(tools)?tools:[]){
    const attribution=normalizeAttribution(tool?.attribution);if(!attribution)continue;
    const key=JSON.stringify(attribution);
    if(!groups.has(key))groups.set(key,{attribution,tools:[]});
    const name=clean(tool.name,100),group=groups.get(key);
    if(name&&!group.tools.includes(name)&&group.tools.length<20)group.tools.push(name);
  }
  return[...groups.values()].sort((a,b)=>isPublicDomain(a.attribution)-isPublicDomain(b.attribution));
}

/** One-line credit, e.g. "Digital caliper – hasecilu – CC BY 3.0 – https://…". */
export function attributionCredit(attribution){
  const a=normalizeAttribution(attribution);if(!a)return'';
  return[a.title,a.author||t('neznámý autor'),licenseName(a.license),a.source].filter(Boolean).join(' – ');
}

/** Readable ATTRIBUTION.txt text for the given tools in the active language; '' when none carries attribution. */
export function attributionText(tools){
  const groups=collectAttributions(tools);if(!groups.length)return'';
  const lines=['InsertCreator – ATTRIBUTION','',t('Tento export obsahuje obrysy nástrojů odvozené z cizích 3D modelů. Pokud soubory sdílíte nebo zveřejňujete, ponechte u nich tuto atribuci.'),''];
  groups.forEach(({attribution:a,tools:names},index)=>{
    lines.push(`${index+1}. ${a.title||t('Bez názvu')}`);
    lines.push('   '+t('Autor: {value}',{value:a.author||t('neznámý autor')}));
    if(a.source)lines.push('   '+t('Zdroj: {value}',{value:a.source}));
    if(a.revision)lines.push('   '+t('Revize: {value}',{value:a.revision}));
    lines.push('   '+t('Licence: {value}',{value:licenseName(a.license)+(a.licenseUrl?` (${a.licenseUrl})`:'')}));
    if(isPublicDomain(a))lines.push('   '+t('Volné dílo – atribuce není vyžadována, uvádíme ji pro dohledatelnost.'));
    if(a.changes)lines.push('   '+t('Změny při převodu: {value}',{value:a.changes}));
    lines.push('   '+t('Změny v InsertCreatoru: obrys použit jako kapsa vložky; mohl být upraven měřítkem, vůlí, výřezy a ručními úpravami.'));
    if(names.length)lines.push('   '+t('Použito pro: {value}',{value:names.join(', ')}));
    lines.push('');
  });
  return lines.join('\n');
}

/** Export notice for the tools of the exported modules (options.moduleId / options.moduleIds; none = whole project). */
export function exportAttributionNotice(project,{moduleId=null,moduleIds=null}={}){
  const ids=Array.isArray(moduleIds)?new Set(moduleIds):moduleId?new Set([moduleId]):null;
  return attributionNotice((project?.tools||[]).filter(tool=>!ids||ids.has(tool.moduleId)));
}

/** Short export notice for attributions that are required (non-CC0); '' when none. */
export function attributionNotice(tools){
  const required=collectAttributions(tools).filter(group=>!isPublicDomain(group.attribution));
  if(!required.length)return'';
  return t('Při sdílení výstupu uveďte atribuci: {credits}',{credits:required.map(group=>attributionCredit(group.attribution)).join('; ')});
}
