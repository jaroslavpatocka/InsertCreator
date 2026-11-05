import {fitFunctionalPocket,fitHybridPocket} from './functional-pocket.js';
import {clone,validateProject} from './model.js';
import {validateLayout} from './geometry.js';
import {pocketOutline} from './finger-grip.js';
import {i18nError} from './i18n.js';
import {pocketFitSignature} from './pocket-fit-meta.js';
export {pocketFitSignature} from './pocket-fit-meta.js';

const minimum=points=>({x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y))});
const issueKey=issue=>JSON.stringify([issue.type,[...issue.ids].sort(),issue.i18n?.cs||issue.message]);
// Only an unchanged generated polygon can be skipped on a repeated conversion.
// Geometry edits invalidate this marker; position, rotation and manual bays do not.
export function toolPocketPreview(tool,mode='hybrid'){
  if(!['hybrid','functional'].includes(mode))throw i18nError('Vyberte platný tvar kapsy.');
  const fit=(mode==='hybrid'?fitHybridPocket:fitFunctionalPocket)(tool.points);
  if(tool.pocketFit?.mode===mode&&tool.pocketFit.signature===pocketFitSignature(tool.points))return{...fit,points:tool.points.map(p=>({...p})),primitives:[],alreadyRegular:true};
  return fit;
}
function rotatedMinimum(points,rotation){
  const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return minimum(points.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})));
}

/** Replace one saved outline with enclosing geometric parts, keeping its physical frame fixed. */
export function functionalToolPocket(project,toolId,mode='hybrid'){
  validateProject(project);
  const next=clone(project),tool=next.tools.find(item=>item.id===toolId);
  if(!tool)throw i18nError('Vybraný nástroj neexistuje.');
  const module=next.modules.find(item=>item.id===tool.moduleId);
  if(tool.locked||module?.locked)throw i18nError('Nejprve odemkněte polohu modulu.');
  if(!['hybrid','functional'].includes(mode))throw i18nError('Vyberte platný tvar kapsy.');
  if(tool.pocketFit?.mode===mode&&tool.pocketFit.signature===pocketFitSignature(tool.points))return next;
  const {points}=toolPocketPreview(tool,mode);
  if(JSON.stringify(points)===JSON.stringify(tool.points))return next;
  const before=rotatedMinimum(tool.points,tool.rotation??0),after=rotatedMinimum(points,tool.rotation??0),origin=minimum(points);
  tool.points=points.map(p=>({x:p.x-origin.x,y:p.y-origin.y}));
  tool.x=(tool.x??0)+after.x-before.x;tool.y=(tool.y??0)+after.y-before.y;
  if(Array.isArray(tool.fingerGrips))tool.fingerGrips=tool.fingerGrips.map(grip=>({...grip,x:grip.x-origin.x,y:grip.y-origin.y}));
  if(Array.isArray(tool.pocketMagnets))tool.pocketMagnets=tool.pocketMagnets.map(magnet=>({...magnet,x:magnet.x-origin.x,y:magnet.y-origin.y}));
  tool.pocketFit={mode,signature:pocketFitSignature(tool.points)};
  validateProject(next);
  pocketOutline(tool,0);
  const oldIssues=new Set(validateLayout(project).map(issueKey));
  for(const issue of validateLayout(next)){
    const affected=issue.ids.includes(toolId)||(module&&issue.ids.includes(module.id));
    if((issue.ids.includes(toolId)&&issue.type!=='depth')||(affected&&!oldIssues.has(issueKey(issue))))throw Object.assign(Error(issue.message),{i18n:issue.i18n});
  }
  return next;
}
