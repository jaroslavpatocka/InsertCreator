// Atomic whole-module edits. Printer dimensions are checked only by final STL export.
import {clone,uid,validateProject} from './model.js';
import {bounds,validateLayout} from './geometry.js';
import {moduleIntersects} from './module-footprint.js';
import {i18nError,t} from './i18n.js';

const EPS=.001;
const angle=value=>((value%360)+360)%360;
const issueError=issue=>Object.assign(Error(issue.message),{i18n:issue.i18n});
function select(project,moduleId){
  validateProject(project);
  const next=clone(project),module=next.modules.find(item=>item.id===moduleId);
  if(!module)throw i18nError('Vybraný modul neexistuje.');
  return{next,module,tools:next.tools.filter(tool=>tool.moduleId===moduleId)};
}
function unlocked(module,tools){
  if(module.locked||tools.some(tool=>tool.locked))throw i18nError('Nejprve odemkněte polohu modulu.');
}
function finite(value,label){
  const number=Number(value);
  if(value===null||typeof value==='boolean'||value===''||!Number.isFinite(number))throw i18nError('Zadejte platnou hodnotu pro {label}.',{label:t(label)});
  return number;
}
function checked(next,module,tools){
  validateProject(next);
  const affected=new Set([module.id,...tools.map(tool=>tool.id)]);
  for(const issue of validateLayout(next))if(!issue.ids.length||issue.ids.some(id=>affected.has(id)))throw issueError(issue);
  if(next.bottomMode==='grid'){
    if(Math.abs(next.grid-42)>.001)throw i18nError('Gridfinity patky vyžadují rastr přesně 42 mm.');
    if([module.x,module.y,module.width,module.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Rozměry i poloha modulu musí být v násobcích 42 mm pro Gridfinity patky.');
  }
  return next;
}

/** Set the absolute top-left in millimetres and translate every pocket by the same vector. */
export function moveModule(project,moduleId,{x,y}={}){
  const {next,module,tools}=select(project,moduleId),left=finite(x,'pozice X'),top=finite(y,'pozice Y');
  if(left===module.x&&top===module.y)return next;
  unlocked(module,tools);
  const dx=left-module.x,dy=top-module.y;module.x=left;module.y=top;
  for(const tool of tools){tool.x+=dx;tool.y+=dy;}
  return checked(next,module,tools);
}

/** Rotate the complete module by quarter turns, keeping its top-left and every local tool contour. */
export function rotateModule(project,moduleId,degrees=90){
  const {next,module,tools}=select(project,moduleId),turn=angle(finite(degrees,'otočení'));
  if(![0,90,180,270].includes(turn))throw i18nError('Modul lze otáčet pouze po 90°.');
  if(!turn)return next;
  unlocked(module,tools);
  if(module.cells){
    const cols=Math.round(module.width/next.grid),rows=Math.round(module.height/next.grid);
    module.cells=module.cells.map(({x,y})=>turn===90?{x:rows-1-y,y:x}:turn===180?{x:cols-1-x,y:rows-1-y}:{x:y,y:cols-1-x});
  }
  const cx=module.x+module.width/2,cy=module.y+module.height/2;
  if(turn===90||turn===270)[module.width,module.height]=[module.height,module.width];
  const nx=module.x+module.width/2,ny=module.y+module.height/2;
  // Exact quarter-turn coefficients prevent cumulative drift during repeated rotations.
  const cosine=turn===180?-1:0,sine=turn===90?1:turn===270?-1:0;
  for(const tool of tools){
    const old=bounds(tool),dx=old.x+old.width/2-cx,dy=old.y+old.height/2-cy;
    tool.rotation=angle((tool.rotation||0)+turn);
    const rotated=bounds(tool);
    tool.x=nx+dx*cosine-dy*sine-rotated.width/2;
    tool.y=ny+dx*sine+dy*cosine-rotated.height/2;
  }
  return checked(next,module,tools);
}

/** Copy a complete module into the first free grid location, without moving any existing record. */
export function duplicateModule(project,moduleId){
  const {next,module:source,tools:sourceTools}=select(project,moduleId);
  if(next.modules.length>=4000||next.tools.length+sourceTools.length>3000)throw i18nError('Projekt je příliš velký. Limit je 3000 nástrojů a 4000 modulů.');
  const grid=Number(next.grid),used=new Set([...next.modules.map(item=>item.id),...next.tools.map(item=>item.id),...(next.toolSets||[]).map(item=>item.id)]);
  const allocate=()=>{let id;do{id=uid();}while(used.has(id));used.add(id);return id;};
  let spot=null;
  for(let y=0;y+source.height<=next.height+EPS&&!spot;y+=grid)for(let x=0;x+source.width<=next.width+EPS;x+=grid){
    const candidate={...source,x,y};
    if(!next.modules.some(module=>moduleIntersects(candidate,module,grid))){spot=candidate;break;}
  }
  if(!spot)throw i18nError('Pro kopii modulu není v šuplíku volné místo.');
  const copyName=name=>(String(name||'')+' · '+t('kopie')).slice(0,100),module={...clone(source),id:allocate(),name:copyName(source.name),x:spot.x,y:spot.y,locked:false};
  delete module.setId;delete module.setLayout;
  const toolIds=new Map(),dx=module.x-source.x,dy=module.y-source.y;
  const tools=sourceTools.map(sourceTool=>{
    const id=allocate();toolIds.set(sourceTool.id,id);
    const tool={...clone(sourceTool),id,moduleId:module.id,x:sourceTool.x+dx,y:sourceTool.y+dy,locked:false};
    if(Array.isArray(tool.fingerGrips))tool.fingerGrips=tool.fingerGrips.map((grip,index)=>({...grip,id:`${id}-finger-${index+1}`}));
    return tool;
  });
  const copies=(next.toolSets||[]).filter(set=>set.toolIds.length&&set.toolIds.every(id=>toolIds.has(id))).map(set=>{
    const copy={...set,id:allocate(),name:copyName(set.name),toolIds:set.toolIds.map(id=>toolIds.get(id))};
    if(source.setId===set.id){module.setId=copy.id;module.setLayout=source.setLayout;}
    return copy;
  });
  next.modules.push(module);next.tools.push(...tools);
  if(copies.length)next.toolSets=[...(next.toolSets||[]),...copies];
  return checked(next,module,tools);
}
