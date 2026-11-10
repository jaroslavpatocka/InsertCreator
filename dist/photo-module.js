// One module from calibrated photo coordinates. No packing or scaling of contours.
import {validateLayout} from './geometry.js';
import {pocketLayoutOutline} from './pocket-wall.js';
import {moduleIntersects,modulePadding} from './module-footprint.js';
import {clone,uid,validateProject} from './model.js';
import {t,i18nError} from './i18n.js';
import {fmtLen} from './units.js';
import {spacePocketCenters} from './pocket-growth.js';

const EPS=1e-7;

/**
 * Add exactly one movable module, preserving calibrated tool x/y offsets and rotations.
 * growMargins permits uniform centre spacing expansion when pocket walls need it.
 * Printer-bed limits apply on export only. An unplaceable module stays intact beside the drawer.
 * Neither the project nor the supplied tools are mutated, including on validation failure.
 */
export function addPhotoModule(project,tools,{name,moduleId,growMargins=false}={}){
  if(!Array.isArray(tools)||!tools.length)throw i18nError('Sada neobsahuje žádné nástroje.');
  const ids=new Set((project.tools||[]).map(tool=>tool.id));
  for(const tool of tools){
    if(!tool||typeof tool.id!=='string'||!tool.id||ids.has(tool.id))throw i18nError('Duplicitní identifikátor nástroje.');
    ids.add(tool.id);
    // JSON copying turns non-finite numbers into null, which must not become an accidental zero.
    if(!Number.isFinite(tool.x)||!Number.isFinite(tool.y)||!Number.isFinite(tool.rotation??0)||
      !Array.isArray(tool.points)||tool.points.some(point=>!Number.isFinite(point?.x)||!Number.isFinite(point?.y)))
      throw i18nError('Měřítko neodpovídá velikosti nástrojů. Zkontrolujte vzdálenost na pravítku nebo použijte celou A4.');
  }
  // Reuse model validation and its project limits without rewriting any existing project data.
  const validated=validateProject({...project,tools:[...(project.tools||[]),...tools]}),next=clone(project);
  let own=validated.tools.slice((project.tools||[]).length).map(tool=>({...tool,locked:false}));
  if(growMargins)own=spacePocketCenters(validated,own);
  const usedModules=new Set(next.modules.map(module=>module.id)),base=String(moduleId||`photo-${uid()}`).slice(0,90);
  let id=base;for(let suffix=2;usedModules.has(id);suffix++)id=`${base}-${suffix}`;
  const grid=validated.grid,padding=modulePadding(validated);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const tool of own)for(const point of pocketLayoutOutline(tool,validated)){
    minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);
  }
  const width=Math.ceil((maxX-minX+2*padding-EPS)/grid)*grid,height=Math.ceil((maxY-minY+2*padding-EPS)/grid)*grid;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width>3000||height>3000)
    throw i18nError('Rozložení z fotky je větší než největší povolený modul ({max}).',{max:fmtLen(3000)});
  const module={id,name:String(name||t('Sada z fotky')).slice(0,100),x:0,y:0,width,height,locked:false,sizeMode:'manual',grouped:true};
  const dx=(width-(maxX-minX))/2-minX,dy=(height-(maxY-minY))/2-minY;
  for(const tool of own){tool.x+=dx;tool.y+=dy;tool.moduleId=id;}
  // Validate the candidate in its own frame: existing unfinished modules do not block this import.
  const issues=validateLayout({...validated,width:Math.max(validated.width,width),height:Math.max(validated.height,height),modules:[module],tools:own});
  if(issues.length)throw i18nError('Rozložení z fotky nelze zachovat: {reason}',{reason:issues[0].message});
  let position=null;
  for(let y=0;y+height<=validated.height+EPS&&!position;y+=grid)for(let x=0;x+width<=validated.width+EPS;x+=grid){
    const candidate={...module,x,y};
    if(!next.modules.some(existing=>moduleIntersects(candidate,existing,grid))){position={x,y};break;}
  }
  const placed=!!position;
  if(!position){
    // Keep saved positions within the model's range even after many failed imports.
    const x=Math.ceil(validated.width/grid)*grid+grid;
    let y=0;
    while(y<=4000&&next.modules.some(existing=>moduleIntersects({...module,x,y},existing,grid)))y+=grid;
    position={x,y:Math.min(y,4000)};
  }
  Object.assign(module,position);
  for(const tool of own){tool.x+=module.x;tool.y+=module.y;}
  next.modules.push(module);next.tools.push(...own);
  validateProject(next);
  return{project:next,moduleId:id,placed,unplaced:placed?[]:own.map(tool=>tool.id)};
}
