// Optional puzzle joints between printed modules. They exist only in the base layer of the exported models,
// so the drawer layout does not change. The module on the left or on top owns the tab and its neighbour the socket,
// which is open at the bottom: modules go in from left to right and from top to bottom, each lowered onto the tabs of the previous ones.
import Clipper from './vendor/clipper.js';
import {pocketOutline} from './finger-grip.js';
import {moduleOutline} from './module-footprint.js';
import {planSizeLabels} from './size-labels.js';

const INSET=.25,NECK=5.5,HEAD=4,NECK_LENGTH=1.5,CLEARANCE=.2,MARGIN=1.2,ROOT=.6,SPACING=16,STEP=2,PITCH=105,MAX_PER_EDGE=4,SCALE=1000,EPS=.01;
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
    const middle=(from+to)/2,beside=sign=>vertical?{x:line+sign*.1,y:middle}:{x:middle,y:line+sign*.1};
    if(!inside(beside(-1),first))continue;
    for(let j=0;j<second.length;j++){
      const r=second[j],s=second[(j+1)%second.length],same=vertical?Math.abs(r.x-s.x)<EPS&&Math.abs(r.x-line)<EPS:Math.abs(r.y-s.y)<EPS&&Math.abs(r.y-line)<EPS;
      if(!same)continue;
      const lo=Math.max(from,Math.min(along(r),along(s))),hi=Math.min(to,Math.max(along(r),along(s)));
      if(hi-lo>EPS&&inside(vertical?{x:line+.1,y:(lo+hi)/2}:{x:(lo+hi)/2,y:line+.1},second))edges.push({normal:vertical?{x:1,y:0}:{x:0,y:1},at:value=>vertical?{x:line,y:value}:{x:value,y:line},lo,hi});
    }
  }
  return edges;
}

const fitsBed=(width,height,bedWidth,bedHeight)=>(width<=bedWidth+1e-6&&height<=bedHeight+1e-6)||(height<=bedWidth+1e-6&&width<=bedHeight+1e-6);

/**
 * joints: every planned joint; byModule: Map of module id to {tabs,sockets} in world millimetres; skipped: joints with no free place.
 * Modules cut into parts for the printer take no joints, and neither do Gridfinity or magnet bottoms.
 */
export function planJoints(project,modules,tools){
  const unsupported=project.bottomMode==='grid'||project.bottomMode==='magnet',result={joints:[],byModule:new Map(),skipped:0,unsupported};
  if(unsupported)return result;
  const grid=Number(project.grid)||42,bedWidth=Number(project.bedWidth),bedHeight=Number(project.bedHeight),wall=Number(project.wall)||2.4,clearance=Number(project.clearance)||0;
  const usable=modules.filter(m=>fitsBed(m.width-2*INSET,m.height-2*INSET,bedWidth,bedHeight));
  const outlines=new Map(usable.map(m=>[m.id,moduleOutline(m,grid)])),printed=new Map(usable.map(m=>[m.id,moduleOutline(m,grid,{inset:INSET})]));
  const reach=new Map(usable.map(m=>[m.id,{x:0,y:0}])),keepouts=new Map();
  const keepoutsOf=m=>{
    if(!keepouts.has(m.id)){
      const own=tools.filter(tool=>tool.moduleId===m.id),labels=project.sizeLabels?planSizeLabels(project,[m],own.map(tool=>({...tool,poly:pocketOutline(tool,clearance)}))).labels.filter(label=>label.moduleId===m.id).map(label=>label.plate):[];
      keepouts.set(m.id,[...own.map(tool=>pocketOutline(tool,clearance+wall)),...labels]);
    }
    return keepouts.get(m.id);
  };
  const entry=id=>{if(!result.byModule.has(id))result.byModule.set(id,{tabs:[],sockets:[]});return result.byModule.get(id);};
  for(const owner of usable)for(const host of usable){
    if(owner===host)continue;
    for(const edge of sharedEdges(owner,host,outlines)){
      const reserve=HEAD+CLEARANCE+MARGIN+1,lo=edge.lo+reserve,hi=edge.hi-reserve;
      if(hi<lo)continue;
      const wanted=Math.min(MAX_PER_EDGE,Math.max(1,Math.round((edge.hi-edge.lo)/PITCH))),placed=[],grown=edge.normal.x?'x':'y',extent=INSET+NECK_LENGTH+2*HEAD;
      // The tab reaches past the owner, so it must still fit the printer together with it.
      const size=()=>({width:owner.width-2*INSET+reach.get(owner.id).x,height:owner.height-2*INSET+reach.get(owner.id).y});
      for(let i=0;i<wanted;i++){
        const preferred=edge.lo+(edge.hi-edge.lo)*(i+.5)/wanted;let spot=null;
        for(let distance=0;distance<=edge.hi-edge.lo&&spot===null;distance+=STEP)for(const value of distance?[preferred+distance,preferred-distance]:[preferred]){
          if(value<lo||value>hi||placed.some(other=>Math.abs(other-value)<SPACING))continue;
          const guard=puzzle(edge.at(value),edge.normal,{start:INSET*2,grow:CLEARANCE+MARGIN});
          if(within(guard,printed.get(host.id))&&!overlaps(guard,keepoutsOf(host))){spot=value;break;}
        }
        const next={...size()};if(!reach.get(owner.id)[grown])next[grown==='x'?'width':'height']+=extent;
        if(spot===null||!fitsBed(next.width,next.height,bedWidth,bedHeight)){result.skipped++;continue;}
        reach.get(owner.id)[grown]=extent;placed.push(spot);
        const at=edge.at(spot),tab=puzzle(at,edge.normal,{start:-INSET-ROOT}),socket=puzzle(at,edge.normal,{start:0,grow:CLEARANCE});
        entry(owner.id).tabs.push(tab);entry(host.id).sockets.push(socket);result.joints.push({owner:owner.id,host:host.id,at});
      }
    }
  }
  return result;
}
