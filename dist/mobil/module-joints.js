// Optional puzzle joints between printed modules. They exist only in the base layer of the exported models,
// so the drawer layout does not change. The module on the left or on top owns the tab and its neighbour the socket,
// which is open at the bottom: modules go in from left to right and from top to bottom, each lowered onto the tabs of the previous ones.
import Clipper from './vendor/clipper.js';
import {pocketOutline} from './finger-grip.js';
import {effectivePocketMargin} from './pocket-margin.js';
import {moduleOutline} from './module-footprint.js';
import {planSizeLabels} from './size-labels.js';
import {magnetPocketCenters} from './magnet-pockets.js';

const INSET=.25,NECK=5.5,HEAD=4,NECK_LENGTH=1.5,MARGIN=1.2,ROOT=.6,SPACING=16,STEP=2,PITCH=105,MAX_PER_EDGE=4,SCALE=1000,EPS=.01;
// Male geometry stays fixed. Reserve includes the inset between a nominal edge and its printed body.
export const JOINT_TAB_REACH=INSET+NECK_LENGTH+2*HEAD;
export const JOINT_BED_RESERVE=JOINT_TAB_REACH+INSET;
export const jointClearance=project=>Number.isFinite(+project.jointClearance)?Math.max(0,Math.min(1,+project.jointClearance)):.2;
const toInt=paths=>paths.map(path=>path.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)})));
function boolean(subject,clip,type){
  const engine=new Clipper.Clipper(),result=[];
  engine.AddPaths(toInt(subject),Clipper.PolyType.ptSubject,true);engine.AddPaths(toInt(clip),Clipper.PolyType.ptClip,true);
  engine.Execute(type,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);return result;
}
const areaOf=paths=>paths.reduce((sum,path)=>sum+Math.abs(Clipper.Clipper.Area(path)),0)/(SCALE*SCALE);
const overlaps=(a,list)=>list.length>0&&areaOf(boolean([a],list,Clipper.ClipType.ctIntersection))>EPS;
const within=(a,outline)=>areaOf(boolean([a],[outline],Clipper.ClipType.ctDifference))<=EPS;
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}

/** A neck with a round head. `at` lies on the shared edge, `normal` points into the neighbour, `grow` widens the shape on every side. */
function puzzle(at,normal,{start,grow=0}){
  const radius=HEAD+grow,half=NECK/2+grow,center=INSET+NECK_LENGTH+HEAD,limit=Math.PI-Math.asin(half/radius),local=[{u:start,v:-half}];
  for(let i=0;i<=24;i++){const angle=-limit+2*limit*i/24;local.push({u:center+radius*Math.cos(angle),v:radius*Math.sin(angle)});}
  local.push({u:start,v:half});
  return local.map(({u,v})=>({x:at.x+normal.x*u-normal.y*v,y:at.y+normal.y*u+normal.x*v}));
}

// Straight stretches shared by two modules: {normal,at(position),lo,hi}, oriented from the owner of the tab to its neighbour.
function sharedEdges(a,b,outlines){
  const first=outlines.get(a.id),second=outlines.get(b.id),edges=[];
  for(let i=0;i<first.length;i++){
    const p=first[i],q=first[(i+1)%first.length],vertical=Math.abs(p.x-q.x)<EPS,horizontal=Math.abs(p.y-q.y)<EPS;
    if(vertical===horizontal)continue;
    const line=vertical?p.x:p.y,along=point=>vertical?point.y:point.x,from=Math.min(along(p),along(q)),to=Math.max(along(p),along(q));
    const middle=(from+to)/2,beside=sign=>vertical?{x:line+sign*.0001,y:middle}:{x:middle,y:line+sign*.0001};
    if(!inside(beside(-1),first))continue;
    for(let j=0;j<second.length;j++){
      const r=second[j],s=second[(j+1)%second.length],same=vertical?Math.abs(r.x-s.x)<EPS&&Math.abs(r.x-line)<EPS:Math.abs(r.y-s.y)<EPS&&Math.abs(r.y-line)<EPS;
      if(!same)continue;
      const lo=Math.max(from,Math.min(along(r),along(s))),hi=Math.min(to,Math.max(along(r),along(s)));
      if(hi-lo>EPS&&inside(vertical?{x:line+.0001,y:(lo+hi)/2}:{x:(lo+hi)/2,y:line+.0001},second))edges.push({normal:vertical?{x:1,y:0}:{x:0,y:1},at:value=>vertical?{x:line,y:value}:{x:value,y:line},lo,hi});
    }
  }
  return edges;
}

const rectangle=clip=>[{x:clip.x,y:clip.y},{x:clip.x+clip.width,y:clip.y},{x:clip.x+clip.width,y:clip.y+clip.height},{x:clip.x,y:clip.y+clip.height}];
const fromInt=paths=>paths.map(path=>path.map(p=>({x:p.X/SCALE,y:p.Y/SCALE})));
const intersect=(outline,clip)=>fromInt(boolean([outline],[rectangle(clip)],Clipper.ClipType.ctIntersection));
const bounds=paths=>{const points=paths.flat();return{x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};};
const withinPaths=(shape,paths)=>areaOf(boolean([shape],paths,Clipper.ClipType.ctDifference))<=EPS;
function magnetGuard({x,y,radius},wall){
  // Circumscribe the real circular pocket plus its full supporting wall: an
  // inscribed approximation would shave the requested clearance between vertices.
  const reach=(radius+Math.max(1.2,wall))/Math.cos(Math.PI/48);
  return Array.from({length:48},(_,index)=>({x:x+Math.cos(index*Math.PI/24)*reach,y:y+Math.sin(index*Math.PI/24)*reach}));
}
const keepoutsFor=(project,module,tools)=>{
  const own=tools.filter(tool=>tool.moduleId===module.id),wall=Number(project.wall)||2.4;
  const labels=project.sizeLabels?planSizeLabels(project,[module],own.map(tool=>({...tool,poly:pocketOutline(tool,project)}))).labels.map(label=>label.plate):[];
  const magnets=project.bottomMode==='magnet'?magnetPocketCenters(project,module).map(center=>magnetGuard(center,wall)):[];
  return [...own.map(tool=>pocketOutline(tool,effectivePocketMargin(tool,project)+wall)),...labels,...magnets];
};
const rootGuard=(at,normal,inset,clearance)=>rectangle({x:at.x-(normal.x?inset+ROOT+MARGIN:NECK/2+clearance+MARGIN),y:at.y-(normal.x?NECK/2+clearance+MARGIN:inset+ROOT+MARGIN),width:normal.x?ROOT+MARGIN:NECK+2*(clearance+MARGIN),height:normal.x?NECK+2*(clearance+MARGIN):ROOT+MARGIN});

const fitsBed=(width,height,bedWidth,bedHeight)=>(width<=bedWidth+1e-6&&height<=bedHeight+1e-6)||(height<=bedWidth+1e-6&&width<=bedHeight+1e-6);

/**
 * joints: every planned joint; byModule: Map of module id to {tabs,sockets} in world millimetres; skipped: joints with no free place.
 * Modules cut into parts for the printer are handled by planCutJoints. Gridfinity takes no joints.
 */
export function planJoints(project,modules,tools){
  const unsupported=project.bottomMode==='grid',result={joints:[],byModule:new Map(),skipped:0,unsupported};
  if(unsupported)return result;
  const grid=Number(project.grid)||42,bedWidth=Number(project.bedWidth),bedHeight=Number(project.bedHeight),clearance=jointClearance(project);
  const usable=modules.filter(m=>fitsBed(m.width-2*INSET,m.height-2*INSET,bedWidth,bedHeight));
  const outlines=new Map(usable.map(m=>[m.id,moduleOutline(m,grid)])),printed=new Map(usable.map(m=>[m.id,moduleOutline(m,grid,{inset:INSET})]));
  const reach=new Map(usable.map(m=>[m.id,{x:0,y:0}])),keepouts=new Map();
  const keepoutsOf=m=>{
    if(!keepouts.has(m.id)){
      keepouts.set(m.id,keepoutsFor(project,m,tools));
    }
    return keepouts.get(m.id);
  };
  const entry=id=>{if(!result.byModule.has(id))result.byModule.set(id,{tabs:[],sockets:[]});return result.byModule.get(id);};
  for(const owner of usable)for(const host of usable){
    if(owner===host)continue;
    for(const edge of sharedEdges(owner,host,outlines)){
      const reserve=HEAD+clearance+MARGIN+1,lo=edge.lo+reserve,hi=edge.hi-reserve;
      if(hi<lo)continue;
      const wanted=Math.min(MAX_PER_EDGE,Math.max(1,Math.round((edge.hi-edge.lo)/PITCH))),placed=[],grown=edge.normal.x?'x':'y',extent=JOINT_BED_RESERVE;
      // The tab reaches past the owner, so it must still fit the printer together with it.
      const size=()=>({width:owner.width-2*INSET+reach.get(owner.id).x,height:owner.height-2*INSET+reach.get(owner.id).y});
      for(let i=0;i<wanted;i++){
        const preferred=edge.lo+(edge.hi-edge.lo)*(i+.5)/wanted;let spot=null;
        for(let distance=0;distance<=edge.hi-edge.lo&&spot===null;distance+=STEP)for(const value of distance?[preferred+distance,preferred-distance]:[preferred]){
          if(value<lo||value>hi||placed.some(other=>Math.abs(other-value)<SPACING))continue;
          const at=edge.at(value),guard=puzzle(at,edge.normal,{start:INSET*2,grow:clearance+MARGIN}),anchor=rootGuard(at,edge.normal,INSET,clearance);
          if(within(guard,printed.get(host.id))&&within(anchor,printed.get(owner.id))&&!overlaps(guard,keepoutsOf(host))&&!overlaps(anchor,keepoutsOf(owner))){spot=value;break;}
        }
        const next={...size()};if(!reach.get(owner.id)[grown])next[grown==='x'?'width':'height']+=extent;
        if(spot===null||!fitsBed(next.width,next.height,bedWidth,bedHeight)){result.skipped++;continue;}
        reach.get(owner.id)[grown]=extent;placed.push(spot);
        const at=edge.at(spot),tab=puzzle(at,edge.normal,{start:-INSET-ROOT}),socket=puzzle(at,edge.normal,{start:0,grow:clearance});
        entry(owner.id).tabs.push(tab);entry(host.id).sockets.push(socket);result.joints.push({owner:owner.id,host:host.id,at,axis:edge.normal.x?'x':'y'});
      }
    }
  }
  return result;
}

/** Complementary joints on the real shared boundaries of print-bed tiles, in original world coordinates.
 * Each tile has a stable key supplied by the batch planner. No project module/tool is changed.
 * Unjoined seams remain explicit: a cut through a tool must not silently remove its floor or supporting wall.
 */
export function planCutJoints(project,plans,tools,{modulePlan=null}={}){
  const unsupported=project.bottomMode==='grid';
  const result={joints:[],byPart:new Map(),skipped:0,unsupported,seams:[],unjoined:[]};
  if(unsupported)return result;
  const grid=Number(project.grid)||42,clearance=jointClearance(project),bedWidth=Number(project.bedWidth),bedHeight=Number(project.bedHeight);
  const entry=key=>{if(!result.byPart.has(key))result.byPart.set(key,{tabs:[],sockets:[]});return result.byPart.get(key);};
  const pieces=[],keepouts=new Map(),occupied=new Map(),material=new Map(),nominal=new Map();
  for(const {module,tiles} of plans){
    const outline=moduleOutline(module,grid),printed=moduleOutline(module,grid,{inset:INSET});
    keepouts.set(module.id,keepoutsFor(project,module,tools));
    for(const tile of tiles){
      const paths=tile.clip?intersect(printed,tile.clip):[printed],edges=tile.clip?intersect(outline,tile.clip):[outline];
      if(!paths.length||!edges.length)continue;
      pieces.push({...tile,module,split:tiles.length>1,bounds:bounds(edges)});material.set(tile.key,paths);nominal.set(tile.key,edges);
      const previous=tiles.length===1?modulePlan?.byModule.get(module.id):null;
      if(previous)result.byPart.set(tile.key,{tabs:[...previous.tabs],sockets:[...previous.sockets]});
      occupied.set(tile.key,previous?[...previous.tabs,...previous.sockets]:[]);
    }
  }
  for(const owner of pieces)for(const host of pieces){
    if(owner===host||(!owner.split&&!host.split))continue;
    const a=owner.bounds,b=host.bounds;
    // Reentrant stepped boundaries can touch while their bounding boxes overlap.
    // Reject only separated boxes; sharedEdges below tests the actual material.
    if(a.x+a.width<b.x-EPS||b.x+b.width<a.x-EPS||a.y+a.height<b.y-EPS||b.y+b.height<a.y-EPS)continue;
    // Stable part keys distinguish pieces of one module and adjacent original modules alike.
    const edges=[];
    for(const first of nominal.get(owner.key))for(const second of nominal.get(host.key))edges.push(...sharedEdges({id:owner.key},{id:host.key},new Map([[owner.key,first],[host.key,second]])));
    for(const edge of edges){
      const edgeInset=owner.module.id===host.module.id?0:INSET;
      const seam={moduleId:owner.module.id,hostModuleId:host.module.id,owner:owner.key,host:host.key,axis:edge.normal.x?'x':'y',line:edge.normal.x?edge.at(0).x:edge.at(0).y,from:edge.lo,to:edge.hi,count:0,skipped:0};
      result.seams.push(seam);
      const reserve=HEAD+clearance+MARGIN+1,lo=edge.lo+reserve,hi=edge.hi-reserve,wanted=Math.min(MAX_PER_EDGE,Math.max(1,Math.round((edge.hi-edge.lo)/PITCH))),placed=[];
      let bedBlocked=false;
      for(let i=0;i<wanted;i++){
        const preferred=edge.lo+(edge.hi-edge.lo)*(i+.5)/wanted;let spot=null;
        for(let distance=0;distance<=edge.hi-edge.lo&&spot===null;distance+=STEP)for(const value of distance?[preferred+distance,preferred-distance]:[preferred]){
          if(value<lo||value>hi||placed.some(other=>Math.abs(other-value)<SPACING))continue;
          const at=edge.at(value),guard=puzzle(at,edge.normal,{start:2*edgeInset,grow:clearance+MARGIN}),anchor=rootGuard(at,edge.normal,edgeInset,clearance);
          if(!withinPaths(guard,material.get(host.key))||!withinPaths(anchor,material.get(owner.key))||overlaps(guard,keepouts.get(host.module.id))||overlaps(anchor,keepouts.get(owner.module.id))||overlaps(guard,occupied.get(host.key))||overlaps(anchor,occupied.get(owner.key)))continue;
          const tab=puzzle(at,edge.normal,{start:-INSET-ROOT}),extent=bounds([...material.get(owner.key),...(result.byPart.get(owner.key)?.tabs||[]),tab]);
          if(!fitsBed(extent.width,extent.height,bedWidth,bedHeight)){bedBlocked=true;continue;}
          spot=value;break;
        }
        if(spot===null){result.skipped++;seam.skipped++;continue;}
        const at=edge.at(spot),tab=puzzle(at,edge.normal,{start:-INSET-ROOT}),socket=puzzle(at,edge.normal,{start:0,grow:clearance}),guard=puzzle(at,edge.normal,{start:-INSET-ROOT-MARGIN,grow:clearance+MARGIN});
        entry(owner.key).tabs.push(tab);entry(host.key).sockets.push(socket);occupied.get(owner.key).push(guard);occupied.get(host.key).push(guard);placed.push(spot);seam.count++;
        result.joints.push({kind:'cut',moduleId:owner.module.id,ownerModuleId:owner.module.id,hostModuleId:host.module.id,owner:owner.key,host:host.key,at,axis:seam.axis,clearance});
      }
      if(!seam.count){seam.reason=bedBlocked?'no-bed-space':'no-safe-site';result.unjoined.push(seam);}
    }
  }
  return result;
}
