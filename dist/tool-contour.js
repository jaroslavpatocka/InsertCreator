import {regularizeContour,CONTOUR_SMOOTHING_MM} from './contour-smoothing.js';
import {clone,validateProject} from './model.js';
import {validateLayout} from './geometry.js';
import {pocketOutline} from './finger-grip.js';
import {i18nError} from './i18n.js';

const issueKey=issue=>JSON.stringify([issue.type,[...issue.ids].sort(),issue.i18n?.cs||issue.message]);
const issueError=issue=>Object.assign(Error(issue.message),{i18n:issue.i18n});
const minimum=points=>({x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y))});
function rotatedMinimum(points,rotation){
  const radians=rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return minimum(points.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c})));
}
function boundaryWithin(points,boundary,tolerance){
  const limit=tolerance*tolerance;
  const near=(point,a,b)=>{
    if(point.x<Math.min(a.x,b.x)-tolerance||point.x>Math.max(a.x,b.x)+tolerance||point.y<Math.min(a.y,b.y)-tolerance||point.y>Math.max(a.y,b.y)+tolerance)return false;
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
    return(point.x-a.x-t*dx)**2+(point.y-a.y-t*dy)**2<=limit;
  };
  const covered=(a,b,depth=0)=>{
    let aNear=false,bNear=false;
    for(let i=0;i<boundary.length;i++){
      const p=boundary[i],q=boundary[(i+1)%boundary.length],first=near(a,p,q),last=near(b,p,q);
      // A segment's tolerance tube is convex: if both endpoints lie inside
      // one tube, every point of this edge does too. Subdivide across corners.
      if(first&&last)return true;aNear||=first;bNear||=last;
    }
    if(!aNear||!bNear||depth>=12)return false;
    const middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    return covered(a,middle,depth+1)&&covered(middle,b,depth+1);
  };
  return points.every((point,i)=>covered(point,points[(i+1)%points.length]));
}

/** Smooth one existing outline in millimetres, keeping its world frame and the module fixed. */
export function smoothToolContour(project,toolId,tolerance=CONTOUR_SMOOTHING_MM){
  validateProject(project);
  if(typeof tolerance!=='number'||!Number.isFinite(tolerance)||tolerance<0||tolerance>1)throw i18nError('Vyhlazení kontury musí být od 0 do 1 mm.');
  const next=clone(project),tool=next.tools.find(item=>item.id===toolId);
  if(!tool)throw i18nError('Vybraný nástroj neexistuje.');
  if(tolerance===0)return next;
  const module=next.modules.find(item=>item.id===tool.moduleId);
  if(tool.locked||module?.locked)throw i18nError('Nejprve odemkněte polohu modulu.');
  const points=regularizeContour(tool.points,tolerance);
  // Reapplying a tiny local fit must not gradually shrink an already clean
  // tool. Retain exact original points when the complete boundaries agree.
  if(boundaryWithin(points,tool.points,tolerance*.2)&&boundaryWithin(tool.points,points,tolerance*.2))return next;
  const before=rotatedMinimum(tool.points,tool.rotation??0);
  const after=rotatedMinimum(points,tool.rotation??0),origin=minimum(points);
  tool.points=points.map(p=>({x:p.x-origin.x,y:p.y-origin.y}));
  // transformedPoints anchors at the rotated minimum, which can move during
  // cleanup. Compensate that shift instead of recentering the entire tool.
  tool.x=(tool.x??0)+after.x-before.x;tool.y=(tool.y??0)+after.y-before.y;
  if(Array.isArray(tool.fingerGrips))tool.fingerGrips=tool.fingerGrips.map(grip=>({...grip,x:grip.x-origin.x,y:grip.y-origin.y}));
  validateProject(next);
  // Check physical attachment before clearance can bridge a detached finger bay.
  pocketOutline(tool,0);
  const oldIssues=new Set(validateLayout(project).map(issueKey));
  for(const issue of validateLayout(next)){
    if(issue.ids.includes(toolId)&&issue.type!=='depth')throw issueError(issue);
    const affected=issue.ids.includes(toolId)||(module&&issue.ids.includes(module.id));
    if(affected&&!oldIssues.has(issueKey(issue)))throw issueError(issue);
  }
  return next;
}
