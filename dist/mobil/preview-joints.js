// Display guides for the real base-layer puzzle profiles. The manufacturing
// planner owns every polygon here; this module never invents or edits a joint.
import {printConfig} from './print-geometry.js';
import {moduleMagnetLift} from './print-material.js';
import {esc} from './ui.js';
import {t} from './i18n.js';

export const NO_PREVIEW_JOINTS='Pro tuto sestavu nevznikla žádná puzzle spojka. Zkontrolujte společné hrany, místo kolem kapes a tiskovou podložku.';
export const PREVIEW_JOINT_GUIDE='Průhledové zvýraznění spojek ve vrstvě dna';

/** Exact tab/socket regions consumed by buildPrintPart, in assembled physical XY.
 * The optional part keys restrict guides to the parts that actually produced STL.
 */
export function moduleJointProfiles(project,moduleId,batch,partKeys=null){
  if(project.connectors!==true||project.bottomMode==='grid'||!batch?.jointPlan?.joints?.length)return[];
  const plan=batch.plans?.find(plan=>plan.module.id===moduleId);if(!plan)return[];
  const cfg=printConfig(project),height=Number(project.height),own=(project.tools||[]).filter(tool=>tool.moduleId===moduleId);
  const bottom=cfg.footHeight,top=bottom+cfg.effectiveBaseMm+moduleMagnetLift(project,own),profiles=[];
  for(const tile of plan.tiles){
    if(partKeys&&!partKeys.has(tile.key))continue;
    const actual=batch.jointPlan.byPart?.get(tile.key);if(!actual)continue;
    for(const [kind,paths] of [['socket',actual.sockets],['tab',actual.tabs]])for(const [index,path] of (paths||[]).entries()){
      if(path.length<3)continue;
      profiles.push({id:tile.key+':'+kind+':'+index,moduleId,partKey:tile.key,kind,bottom,top,points:path.map(point=>[point.x,height-point.y])});
    }
  }
  return profiles;
}

/** Clear a small gap in straight bed-cut lines around actual puzzle regions. */
export function omitJointCutSegments(segments,profiles){
  if(!profiles.length)return segments;
  const boxes=profiles.map(profile=>[0,1].map(axis=>({min:Math.min(...profile.points.map(point=>point[axis]))-.6,max:Math.max(...profile.points.map(point=>point[axis]))+.6})));
  return segments.flatMap(segment=>{
    const [a,b]=segment.points,delta=b.map((value,axis)=>value-a[axis]),intervals=[];
    for(const box of boxes){
      let lo=0,hi=1;
      for(let axis=0;axis<2&&hi>=lo;axis++){
        if(Math.abs(delta[axis])<1e-9){if(a[axis]<box[axis].min||a[axis]>box[axis].max)hi=-1;}
        else{const ends=[(box[axis].min-a[axis])/delta[axis],(box[axis].max-a[axis])/delta[axis]].sort((x,y)=>x-y);lo=Math.max(lo,ends[0]);hi=Math.min(hi,ends[1]);}
      }
      if(hi>lo)intervals.push([lo,hi]);
    }
    if(!intervals.length)return[segment];
    const keep=[],point=at=>a.map((value,axis)=>value+at*delta[axis]);let cursor=0;
    for(const [lo,hi] of intervals.sort((x,y)=>x[0]-y[0])){if(lo>cursor+1e-7)keep.push({...segment,points:[point(cursor),point(lo)]});cursor=Math.max(cursor,hi);}
    if(cursor<1-1e-7)keep.push({...segment,points:[point(cursor),point(1)]});return keep;
  });
}

/** Always visible, intentional x-ray guides: profiles remain at their real base
 * Z plane, including underneath views; upper solid walls do not conceal them.
 */
export function jointPreviewMarkup(profiles,frame,center,{legend=true}={}){
  if(!profiles?.length)return'';
  const projectPoint=frame.project(center),below=frame.towards[2]<0,parts=[],label=t(PREVIEW_JOINT_GUIDE);
  for(const profile of [...profiles].sort((a,b)=>(a.kind==='tab')-(b.kind==='tab'))){
    const z=below?profile.bottom:profile.top,points=profile.points.map(point=>projectPoint([...point,z]));
    const path=points.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join('')+'Z';
    const attrs=`d="${path}" fill="none" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"`;
    parts.push(`<g data-preview-joint="${profile.kind}" data-joint-profile="${esc(profile.id)}" data-joint-module="${esc(profile.moduleId)}" data-joint-z="${z}" data-joint-source="print-plan"><path ${attrs} stroke="#fffdf5" stroke-width="5"/><path ${attrs} stroke="#243d42" stroke-width="3.2"/><path ${attrs} stroke="${profile.kind==='tab'?'#f2b544':'#57d2df'}" stroke-width="1.8"${profile.kind==='socket'?' stroke-dasharray="3 2"':''}/></g>`);
  }
  return `<g data-preview-joints="true" data-joint-guide="xray" pointer-events="none" aria-label="${esc(label)}"><title>${esc(label)}</title>${parts.join('')}${legend?jointPreviewLegend(frame):''}</g>`;
}
export function jointPreviewLegend(frame){
  const font=11*frame.height/Math.max(1,frame.size?.height||600),x=frame.state.panX,y=frame.state.panY-frame.height/2+font*1.8;
  const position=`x="${x}" y="${y}" text-anchor="middle" font-size="${font}"`,label=esc(t(PREVIEW_JOINT_GUIDE));
  return `<text data-preview-joint-legend-halo="true" ${position} aria-hidden="true" fill="none" stroke="#fffdf5" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke">${label}</text><text data-preview-joint-legend="true" ${position} fill="#243d42">${label}</text>`;
}
